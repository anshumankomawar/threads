import { expect, test } from "vite-plus/test";
import type { SyncAction } from "protocol";
import { fakeTransport, memoryLocalDB, row, setup, tick } from "testing";
import { createStore } from "../src";
import { Conversation } from "./models";

const c1 = (fields: Record<string, unknown> = {}) =>
  row("c1", { title: "One", state: "open", teamId: "t1", dueAt: null, ownerId: null, ...fields });
const seed = [{ model: "Conversation", row: c1() }];
const update = (id: number, fields: Record<string, unknown>): SyncAction => ({
  id,
  txId: `x${id}`,
  model: "Conversation",
  modelId: "c1",
  action: "U",
  data: c1(fields),
});

test("a delta is rebased under pending and unsaved edits", async () => {
  const { store, transport } = await setup(seed);
  const c = store.findById(Conversation, "c1")!;
  c.title = "Mine";
  const tx = c.save();
  c.state = "resolved";
  transport.send({
    type: "delta",
    groups: [],
    actions: [update(1, { title: "Theirs", state: "open", teamId: "t2" })],
    lastSyncId: 1,
  });
  await tick();
  expect([c.title, c.state, c.teamId]).toEqual(["Mine", "resolved", "t2"]);
  c.discardChanges();
  expect(c.state).toBe("open");

  const { request, resolve } = transport.requests[0];
  resolve({
    results: [{ txId: request.transactions[0].id, ok: false, code: "forbidden", message: "no" }],
  });
  await tx.result().catch(() => {});
  expect(c.title).toBe("Theirs");
});

test("applyDelta writes the local database, fetches a gap, and skips what it has", async () => {
  const { store, transport, localDB } = await setup(seed);
  transport.log = [update(1, { title: "A" }), update(2, { title: "B" })];
  transport.lastSyncId = 2;
  transport.send({
    type: "delta",
    groups: [],
    actions: [update(2, { title: "B" })],
    lastSyncId: 2,
  });
  await tick();
  expect(transport.deltaCalls).toEqual([0]);
  expect(store.findById(Conversation, "c1")!.title).toBe("B");
  expect(await localDB.load("Conversation")).toMatchObject([{ title: "B" }]);
  expect(await localDB.meta.get()).toMatchObject({ lastSyncId: 2 });

  transport.send({
    type: "delta",
    groups: [],
    actions: [update(2, { title: "Old" })],
    lastSyncId: 2,
  });
  await tick();
  expect(store.findById(Conversation, "c1")!.title).toBe("B");
});

test("a packet with other groups drops what they don't cover, loads what they gain, and keeps pending edits", async () => {
  const { store, transport } = await setup(seed);
  const mine = store.create(Conversation, { title: "Mine", state: "open", teamId: "t1" });
  await tick();
  transport.rows = [
    { model: "Conversation", row: row("c9", { title: "Nine", state: "open", teamId: "t3" }) },
  ];
  transport.send({ type: "delta", groups: ["team:t3"], actions: [], lastSyncId: 0 });
  await tick();
  expect(transport.bootstraps).toBe(2);
  expect(
    store
      .all(Conversation)
      .map((c) => c.title)
      .sort(),
  ).toEqual(["Mine", "Nine"]);
  expect(store.findById(Conversation, mine.id)).toBe(mine);
  expect(mine.transaction.status).toBe("sending");
});

test("a reload replays the outbox over the local database and resends it", async () => {
  const localDB = memoryLocalDB();
  const first = await setup(seed, localDB);
  const c = first.store.findById(Conversation, "c1")!;
  c.title = "Unsent";
  c.save();
  await tick();

  const transport = fakeTransport();
  const store = createStore({
    transport,
    localDB,
    workspace: "w",
    token: "t",
    setTimeout: () => {},
  });
  await store.ready();
  await tick();
  expect(transport.bootstraps).toBe(0);
  expect(store.findById(Conversation, "c1")!.title).toBe("Unsent");
  expect(store.pendingCount()).toBe(1);
  expect(transport.requests[0].request.transactions).toMatchObject([
    { modelId: "c1", changes: { title: "Unsent" } },
  ]);
});

test("a server that started over replaces what the local database kept", async () => {
  const localDB = memoryLocalDB();
  const first = await setup(seed, localDB);
  first.transport.send({
    type: "delta",
    groups: [],
    actions: [update(1, { title: "Old" })],
    lastSyncId: 1,
  });
  await tick();

  const transport = fakeTransport();
  transport.rows = [
    {
      model: "Conversation",
      row: row("c2", { title: "Fresh", state: "open", teamId: "t1", dueAt: null, ownerId: null }),
    },
  ];
  const store = createStore({
    transport,
    localDB,
    workspace: "w",
    token: "t",
    setTimeout: () => {},
  });
  await store.ready();
  await tick();
  expect(transport.bootstraps).toBe(1);
  expect(store.all(Conversation).map((c) => c.id)).toEqual(["c2"]);
});
