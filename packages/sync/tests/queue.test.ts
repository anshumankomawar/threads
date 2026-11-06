import { expect, test } from "vite-plus/test";
import type { MutateRequest } from "protocol";
import { RejectedError } from "../src";
import { Conversation, Message } from "./models";
import { row, setup, tick } from "testing";

const seed = [
  { model: "Conversation", row: row("c1", { title: "One", state: "open", teamId: "t1" }) },
  { model: "Conversation", row: row("c2", { title: "Two", state: "open", teamId: "t1" }) },
];

const ok = (request: MutateRequest, syncId: number) => ({
  results: request.transactions.map((tx) => ({ txId: tx.id, ok: true as const, syncId })),
});

test("a tick's transactions share a batch and a request, saved to the outbox first", async () => {
  const { store, transport, localDB } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  const c2 = store.findById(Conversation, "c2")!;
  c1.title = "A";
  c1.save();
  c2.title = "B";
  c2.save();
  await tick();
  const [first] = transport.requests;
  expect(first.request.transactions.map((tx) => tx.modelId)).toEqual(["c1", "c2"]);
  expect(new Set(first.request.transactions.map((tx) => tx.batch)).size).toBe(1);
  expect(await localDB.outbox.all()).toHaveLength(2);

  c1.title = "C";
  c1.save();
  first.resolve(ok(first.request, 1));
  await tick();
  expect(transport.requests[1].request.transactions[0].batch).toBe(
    first.request.transactions[0].batch + 1,
  );
});

test("at most 40 transactions go in one request", async () => {
  const { store, transport } = await setup();
  for (let i = 0; i < 45; i++)
    store.create(Conversation, { title: `${i}`, state: "open", teamId: "t1" });
  await tick();
  expect(transport.requests).toHaveLength(1);
  expect(transport.requests[0].request.transactions).toHaveLength(40);
});

test("a transaction isn't sent with one for the same model or a model it references", async () => {
  const { store, transport } = await setup(seed);
  const c = store.create(Conversation, { title: "New", state: "open", teamId: "t1" });
  store.create(Message, { conversation: c, body: "hi" });
  await tick();
  expect(transport.requests.map((r) => r.request.transactions.map((tx) => tx.model))).toEqual([
    ["Conversation"],
  ]);
  transport.requests[0].resolve(ok(transport.requests[0].request, 1));
  await tick();
  expect(transport.requests[1].request.transactions.map((tx) => tx.model)).toEqual(["Message"]);
});

test("after a network error the request is retried first, after a backoff", async () => {
  const { store, transport, timers } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  c1.title = "A";
  const tx = c1.save();
  await tick();
  transport.requests[0].reject(new Error("offline"));
  await tick();
  expect(tx.status).toBe("queued");
  const c2 = store.findById(Conversation, "c2")!;
  c2.title = "B";
  c2.save();
  await tick();
  expect(transport.requests).toHaveLength(1);
  timers.shift()!();
  expect(transport.requests[1].request.transactions.map((t) => t.modelId)).toEqual(["c1", "c2"]);
});

test("a rejected transaction rolls back and rejects its result; the others in the request go on", async () => {
  const { store, transport } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  c1.title = "A";
  const update = c1.save();
  const created = store.create(Conversation, { title: "New", state: "open", teamId: "t1" });
  const c2 = store.findById(Conversation, "c2")!;
  c2.title = "B";
  const kept = c2.save();
  await tick();
  const { request, resolve } = transport.requests[0];
  resolve({
    results: [
      { txId: request.transactions[0].id, ok: false, code: "forbidden", message: "no" },
      { txId: request.transactions[1].id, ok: false, code: "invalid", message: "no" },
      { txId: request.transactions[2].id, ok: true, syncId: 1 },
    ],
  });
  await expect(update.result()).rejects.toBeInstanceOf(RejectedError);
  await expect(created.transaction.result()).rejects.toThrow("no");
  expect(update.status).toBe("rejected");
  expect(c1.title).toBe("One");
  expect(store.findById(Conversation, created.id)).toBeUndefined();
  expect(c2.title).toBe("B");
  expect(kept.status).toBe("awaitingSync");
});

test("a transaction is done only once lastSyncId reaches its sync id", async () => {
  const { store, transport, localDB } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  c1.title = "A";
  const tx = c1.save();
  await tick();
  transport.requests[0].resolve(ok(transport.requests[0].request, 2));
  await tick();
  expect(tx.status).toBe("awaitingSync");
  expect(store.pendingCount()).toBe(1);
  transport.send({ type: "delta", groups: [], actions: [], lastSyncId: 1 });
  await tick();
  expect(tx.status).toBe("awaitingSync");
  transport.send({ type: "delta", groups: [], actions: [], lastSyncId: 2 });
  await tx.result();
  expect(tx.status).toBe("done");
  expect(store.pendingCount()).toBe(0);
  expect(await localDB.outbox.all()).toEqual([]);
});

test("a confirmed change the socket doesn't bring back makes it reconnect, and catch up", async () => {
  const { store, transport, timers } = await setup(seed);
  const c = store.findById(Conversation, "c1")!;
  const dead = transport.socket;
  c.title = "Mine";
  c.save();
  await tick();
  // The server's own effect on the same row, which only reaches this client through a delta.
  transport.lastSyncId = 1;
  transport.log.push({
    id: 1,
    txId: transport.requests[0].request.transactions[0].id,
    model: "Conversation",
    modelId: "c1",
    action: "U",
    data: row("c1", { title: "Mine", state: "blocked", teamId: "t1" }),
  });
  transport.requests[0].resolve(ok(transport.requests[0].request, 1));
  await tick();
  expect(c.state).toBe("open");
  timers.splice(0).forEach((run) => run()); // the grace runs out, and the socket closes
  await tick();
  timers.splice(0).forEach((run) => run()); // the reconnect
  await tick();
  expect(transport.socket).not.toBe(dead);
  // The new socket's Hello is answered with what it missed.
  transport.send({ type: "delta", groups: [], actions: transport.log, lastSyncId: 1 });
  await tick();
  expect(c.state).toBe("blocked");
  expect(store.pendingCount()).toBe(0);
});
