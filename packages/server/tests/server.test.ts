import type { TxRecord } from "protocol";
import { registry } from "sync";
import { expect, test } from "vite-plus/test";
import {
  handleRequest,
  memoryStorage,
  signSession,
  sqliteStorage,
  verifySession,
  type Storage,
} from "../src";
import { admin, ann, bob, create, createServer, nodeSql, note, socket } from "./helpers";

const update = (
  modelId: string,
  changes: Record<string, unknown>,
  id = `update-${modelId}`,
): TxRecord => ({
  id,
  kind: "update",
  model: "Note",
  modelId,
  changes,
  batch: 0,
});
const tx = (kind: TxRecord["kind"], modelId: string): TxRecord => ({
  id: `${kind}-${modelId}`,
  kind,
  model: "Note",
  modelId,
  batch: 0,
});

test("a transaction id already executed returns its stored sync id and writes nothing", () => {
  const server = createServer();
  const first = server.mutate(ann, { transactions: [note("n")] });
  const again = server.mutate(ann, { transactions: [note("n")] });
  expect(again).toEqual(first);
  expect(server.deltas(admin, 0).actions.map((a) => a.modelId)).toEqual(["t", "n"]);
});

test("the admin's creates keep a given createdAt; a user's get the server's time", () => {
  const server = createServer();
  server.mutate(admin, { transactions: [note("a", { createdAt: 5 })] });
  server.mutate(ann, { transactions: [note("b", { createdAt: 5 })] });
  expect(server.bootstrap(admin).rows.map(({ row }) => row.createdAt)).toEqual([1000, 5, 1000]);
});

test("writes are validated against the registry", () => {
  const server = createServer();
  server.mutate(ann, { transactions: [note("n")] });
  const codes = server
    .mutate(ann, {
      transactions: [
        create("Nope", "x", {}),
        note("a", { colour: "red" }),
        note("b", { state: "closed" }),
        note("c", { title: null }),
        create("Note", "d", { state: "open", teamId: "t" }),
        note("e", { teamId: "missing" }),
        note("f", { body: null }),
        note("n", {}, "again"),
        update("missing", { title: "x" }),
      ],
    })
    .results.map((result) => (result.ok ? "ok" : result.code));
  expect(codes).toEqual([
    "invalid",
    "invalid",
    "invalid",
    "invalid",
    "invalid",
    "invalid",
    "ok",
    "conflict",
    "not_found",
  ]);
});

test("a refused transaction doesn't stop later ones; the admin skips permission hooks", () => {
  const server = createServer({ rules: { Note: (change) => change.after?.title !== "secret" } });
  const results = server.mutate(ann, {
    transactions: [note("a", { title: "secret" }), note("b")],
  }).results;
  expect(results.map((result) => (result.ok ? "ok" : result.code))).toEqual(["forbidden", "ok"]);
  expect(
    server.mutate(admin, { transactions: [note("a", { title: "secret" })] }).results[0]!.ok,
  ).toBe(true);
});

test("effects write in the same commit under the same tx id; a failing effect refuses its transaction", () => {
  const server = createServer({
    effects: {
      Note: (change, db) => {
        if (change.kind === "create")
          db.write({
            kind: "create",
            model: "Inbox",
            modelId: `inbox-${change.modelId}`,
            changes: { userId: change.after!.title, noteId: change.modelId },
          });
      },
    },
  });
  const [ok] = server.mutate(ann, { transactions: [note("n", { title: "bob" })] }).results;
  expect(server.deltas(admin, 1).actions.map((a) => [a.id, a.txId, a.modelId])).toEqual([
    [2, "create-n", "n"],
    [3, "create-n", "inbox-n"],
  ]);
  expect(ok).toEqual({ txId: "create-n", ok: true, syncId: 3 });

  const failing = createServer({
    effects: {
      Note: (_, db) => db.write({ kind: "create", model: "Inbox", modelId: "i", changes: {} }),
    },
  });
  expect(failing.mutate(ann, { transactions: [note("n")] }).results[0]).toMatchObject({
    ok: false,
    code: "invalid",
  });
  expect(failing.bootstrap(admin).rows.map((line) => line.row.id)).toEqual(["t"]);
});

test("archive, unarchive and delete; the server sets the timestamps", () => {
  let now = 1000;
  const server = createServer({ now: () => now });
  server.mutate(ann, { transactions: [note("n", { createdAt: 5, updatedAt: 5 })] });
  now = 2000;
  server.mutate(ann, { transactions: [tx("archive", "n")] });
  expect(server.bootstrap(ann).rows[1]!.row).toMatchObject({
    createdAt: 1000,
    updatedAt: 2000,
    archivedAt: 2000,
  });
  server.mutate(ann, { transactions: [tx("unarchive", "n")] });
  expect(server.bootstrap(ann).rows[1]!.row.archivedAt).toBe(null);
  server.mutate(ann, { transactions: [tx("delete", "n")] });
  const actions = server.deltas(ann, 1).actions;
  expect(actions.map((a) => a.action)).toEqual(["I", "A", "R", "D"]);
  expect(actions[3]!.data).toBeUndefined();
  expect(server.bootstrap(ann).rows).toHaveLength(1);
});

test("bootstrap, deltas and sockets carry only what shares a group; every commit reaches every socket that said hello", () => {
  const server = createServer();
  const [ofAnn, ofBob, silent] = [socket(ann), socket(bob), socket(ann)];
  server.sockets.push(ofAnn, ofBob, silent);
  server.hello(ofBob, 0);
  server.hello(ofAnn, 1);
  server.mutate(ann, { transactions: [note("n")] });
  expect(server.bootstrap(bob).rows.map((line) => line.row.id)).toEqual(["t"]);
  expect(server.bootstrap(ann).rows.map((line) => line.row.id)).toEqual(["t", "n"]);
  expect(server.deltas(bob, 0).actions.map((a) => a.modelId)).toEqual(["t"]);
  expect(server.deltas(ann, 0).actions.map((a) => a.modelId)).toEqual(["t", "n"]);
  const annGroups = ["workspace:w", "user:ann", "team:t"];
  const bobGroups = ["workspace:w", "user:bob"];
  expect(ofAnn.received).toEqual([
    { type: "delta", actions: [], lastSyncId: 1, groups: annGroups },
    { type: "delta", actions: server.deltas(ann, 1).actions, lastSyncId: 2, groups: annGroups },
  ]);
  expect(ofBob.received).toEqual([
    { type: "delta", actions: server.deltas(bob, 0).actions, lastSyncId: 1, groups: bobGroups },
    { type: "delta", actions: [], lastSyncId: 2, groups: bobGroups },
  ]);
  expect(silent.received).toEqual([]);
});

test("a commit that changes a session's groups says so in its packet", () => {
  const server = createServer();
  const ofBob = socket(bob);
  server.sockets.push(ofBob);
  server.hello(ofBob, 1);
  server.mutate(admin, {
    transactions: [
      {
        id: "join",
        kind: "update",
        model: "Team",
        modelId: "t",
        changes: { memberIds: ["ann", "bob"] },
        batch: 0,
      },
    ],
  });
  expect(ofBob.received[1]).toMatchObject({
    lastSyncId: 2,
    groups: ["workspace:w", "user:bob", "team:t"],
  });
});

test("a partial bootstrap is the rows of groups the client lacks and every action since, as of one sync id", () => {
  const server = createServer();
  server.mutate(ann, { transactions: [note("n")] });
  const { rows, end } = server.bootstrap(ann, { holds: ["workspace:w", "user:ann"], after: 1 });
  expect(rows.map((line) => line.row.id)).toEqual(["n"]);
  expect(end.actions.map((action) => action.modelId)).toEqual(["n"]);
  expect(end).toMatchObject({ lastSyncId: 2, groups: ["workspace:w", "user:ann", "team:t"] });
  // Only the session's own groups load.
  expect(server.bootstrap(bob, { holds: ["workspace:w", "user:bob"], after: 0 }).rows).toEqual([]);
});

test("a session follows a group it subscribed to only if it may read it", () => {
  const open = createServer({ mayRead: (_user, group) => group === "team:t" });
  const closed = createServer();
  const subscribed = { userId: "bob", subscribed: ["team:t"] };
  open.mutate(ann, { transactions: [note("n")] });
  closed.mutate(ann, { transactions: [note("n")] });
  expect(open.bootstrap(subscribed).end.groups).toContain("team:t");
  expect(open.bootstrap(subscribed).rows.map((line) => line.row.id)).toEqual(["t", "n"]);
  expect(closed.bootstrap(subscribed).rows.map((line) => line.row.id)).toEqual(["t"]);
});

test("an action writes through the same path and returns its highest sync id", () => {
  const server = createServer({
    actions: {
      twoNotes: (args, _session, db) => {
        for (const id of args as string[]) db.write(note(id));
      },
    },
  });
  expect(server.action(ann, "twoNotes", ["a", "b"])).toEqual({ lastSyncId: 3 });
  const [a, b] = server.deltas(ann, 1).actions;
  expect(a!.txId).toBe(b!.txId);
  expect(() => server.action(ann, "nope", null)).toThrow("No action nope");
});

test("two writes to one row in a transaction are one sync action", () => {
  const server = createServer({
    storage: sqliteStorage(nodeSql()),
    actions: {
      createAndRename: (_, __, db) => {
        db.write(note("n"));
        db.write(update("n", { title: "Renamed" }));
      },
    },
  });
  server.action(ann, "createAndRename", null);
  expect(server.deltas(ann, 1).actions).toEqual([
    expect.objectContaining({ action: "I", data: expect.objectContaining({ title: "Renamed" }) }),
  ]);
});

for (const [name, storage] of [
  ["sqliteStorage", () => sqliteStorage(nodeSql())],
  ["memoryStorage", memoryStorage],
] as const)
  test(`${name}: a server restarted from storage has its rows, log and executed transactions`, () => {
    const kept: Storage = storage();
    const first = createServer({ storage: kept });
    first.mutate(ann, { transactions: [note("n"), note("gone")] });
    first.mutate(ann, { transactions: [tx("delete", "gone")] });
    const second = createServer({ storage: kept });
    expect(second.bootstrap(admin)).toEqual(first.bootstrap(admin));
    expect(second.deltas(admin, 0)).toEqual(first.deltas(admin, 0));
    expect(second.mutate(ann, { transactions: [note("n")] }).results[0]).toEqual({
      txId: "create-n",
      ok: true,
      syncId: 2,
    });
  });

test("HTTP: bootstrap streams NDJSON ending with BootstrapEnd; refusals map to statuses", async () => {
  const server = createServer();
  const response = await handleRequest(server, new Request("http://x/sync/bootstrap"), ann);
  const lines = (await response.text())
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(lines.at(-1)).toEqual({
    lastSyncId: 1,
    schemaHash: registry.schemaHash,
    groups: ["workspace:w", "user:ann", "team:t"],
    actions: [],
  });
  expect(lines).toHaveLength(2);
  const action = await handleRequest(
    server,
    new Request("http://x/actions/nope", { method: "POST", body: "null" }),
    ann,
  );
  expect(action.status).toBe(404);
});

test("a session token is genuine, for its workspace and unexpired", async () => {
  const token = await signSession("secret", { userId: "ann", workspace: "w", expiresAtMs: 2000 });
  expect(await verifySession("secret", token, "w", 1000)).toEqual({
    userId: "ann",
    workspace: "w",
    expiresAtMs: 2000,
  });
  expect(await verifySession("other", token, "w", 1000)).toBeUndefined();
  expect(await verifySession("secret", token, "v", 1000)).toBeUndefined();
  expect(await verifySession("secret", token, "w", 3000)).toBeUndefined();
});
