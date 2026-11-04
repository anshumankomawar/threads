import { SCHEMA_HASH } from "model";
import { decodeBootstrap } from "sync";
import type { BuiltIn, DeltasResponse, TransactionInput } from "model";
import { expect, test } from "vite-plus/test";
import { createApp } from "../src/app.ts";

const NOW = Date.UTC(2026, 10, 2, 8);

// Requests as someone (their session, as `X-User` gives locally), or as an admin when nobody's named.
function as(app: ReturnType<typeof createApp>, userId?: string) {
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Workspace": "local",
        ...(userId === undefined ? {} : { "X-User": userId }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    send,
    transact: (actorId: string, transactions: (TransactionInput | BuiltIn)[]) =>
      send("POST", "/sync/transactions", { actorId, schemaHash: SCHEMA_HASH, transactions }),
    bootstrap: async () =>
      decodeBootstrap(await (await send("GET", "/sync/bootstrap")).text()) as never as {
        syncGroups: string[];
        epoch: string;
        models: { Thread: { id: string }[]; Entry: { id: string }[]; Person: unknown[] };
      },
  };
}

let counter = 0;
const txId = (): string => `tx-${++counter}`;

const thread = (id: string): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Thread",
  data: { id, title: "Plan the offsite", assigneeIds: ["arjun"] },
});

const message = (id: string, threadId: string): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Entry",
  data: { id, threadId, kind: "message", text: "Hello" },
});

const remove = (modelName: BuiltIn["modelName"], modelId: string): BuiltIn => ({
  id: txId(),
  type: "delete",
  modelName,
  modelId,
});

test("a person's session acts only as them", async () => {
  const app = createApp({ now: () => NOW });
  const anshu = as(app, "anshu");
  expect((await anshu.transact("arjun", [thread("t1")])).status).toBe(403);
  expect((await anshu.transact("anshu", [thread("t1")])).status).toBe(200);
});

test("members see the whole workspace; anyone else sees nothing", async () => {
  const app = createApp({ now: () => NOW });
  await as(app, "anshu").transact("anshu", [thread("t1")]);
  const member = await as(app, "arjun").bootstrap();
  expect(member.syncGroups).toEqual(["workspace"]);
  expect(member.models.Thread.map((record) => record.id)).toEqual(["t1"]);
  const stranger = await as(app, "nobody").bootstrap();
  expect(stranger.syncGroups).toEqual([]);
  expect(stranger.models.Thread).toEqual([]);
  expect(stranger.models.Person).toEqual([]);
  const deltas = (await (
    await as(app, "nobody").send("GET", "/sync/deltas?after=0")
  ).json()) as DeltasResponse;
  expect("actions" in deltas && deltas.actions).toEqual([]);
  // An admin session (local development, operators) sees everything.
  expect((await as(app).bootstrap()).models.Thread).toHaveLength(1);
});

test("you can delete your own messages, but not someone else's, a description, or a thread", async () => {
  const app = createApp({ now: () => NOW });
  const anshu = as(app, "anshu");
  const arjun = as(app, "arjun");
  await anshu.transact("anshu", [thread("t1"), message("t1", "t1"), message("mine", "t1")]);
  await arjun.transact("arjun", [message("theirs", "t1")]);

  expect((await anshu.transact("anshu", [remove("Entry", "theirs")])).status).toBe(403);
  expect((await anshu.transact("anshu", [remove("Entry", "t1")])).status).toBe(400);
  expect((await anshu.transact("anshu", [remove("Thread", "t1")])).status).toBe(400);
  expect((await anshu.transact("anshu", [remove("Entry", "mine")])).status).toBe(200);
  const entries = (await anshu.bootstrap()).models.Entry.map((entry) => entry.id);
  expect(entries).toContain("theirs");
  expect(entries).not.toContain("mine");
  // Archiving is a thread's status, not the engine's archive.
  expect(
    (
      await anshu.transact("anshu", [
        { id: txId(), type: "archive", modelName: "Thread", modelId: "t1" },
      ])
    ).status,
  ).toBe(400);
});

test("an app built for another schema is told it's out of date", async () => {
  const app = createApp({ now: () => NOW });
  const send = (schemaHash?: string) =>
    as(app, "anshu").send("POST", "/sync/transactions", {
      actorId: "anshu",
      ...(schemaHash === undefined ? {} : { schemaHash }),
      transactions: [thread("t1")],
    });
  expect((await send("old")).status).toBe(426);
  expect((await send()).status).toBe(426);
  expect((await send(SCHEMA_HASH)).status).toBe(200);
});

test("a malformed batch is refused before anything runs", async () => {
  const app = createApp({ now: () => NOW });
  const response = await as(app, "anshu").send("POST", "/sync/transactions", {
    actorId: "anshu",
    schemaHash: SCHEMA_HASH,
    transactions: [{ id: "x", type: "delete", modelName: "Nope", modelId: "y" }],
  });
  expect(response.status).toBe(400);
});
