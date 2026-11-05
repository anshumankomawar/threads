import type { Row, TxRecord } from "protocol";
import { memoryStorage, type Session } from "server";
import { expect, test } from "vite-plus/test";
import { groupsOf, threadsServer } from "../src/rules";

const admin: Session = { admin: true };
const anshu: Session = { userId: "anshu" };
const arjun: Session = { userId: "arjun" };
const kk: Session = { userId: "kk" };

let counter = 0;
const tx = (
  kind: TxRecord["kind"],
  model: string,
  modelId: string,
  changes?: Record<string, unknown>,
): TxRecord => ({ id: `tx-${++counter}`, kind, model, modelId, changes, batch: 0 });

const conversation = (id: string, changes: Record<string, unknown> = {}) =>
  tx("create", "Conversation", id, {
    title: id,
    state: "open",
    priority: "none",
    ownerId: "anshu",
    teamId: "core",
    ...changes,
  });
const message = (id: string, changes: Record<string, unknown> = {}) =>
  tx("create", "Message", id, {
    conversationId: "c",
    authorId: "anshu",
    body: "Hi",
    toIds: [],
    teamId: "core",
    ...changes,
  });

// The local workspace, plus team "core" (Anshu and Arjun) with conversation "c" in it.
function setup() {
  const server = threadsServer(memoryStorage(), () => []);
  server.action(admin, "seed", "local");
  run(
    server,
    admin,
    tx("create", "Team", "core", {
      name: "Core",
      workspaceId: "local",
      memberIds: ["anshu", "arjun"],
    }),
  );
  run(server, admin, conversation("c"));
  return server;
}
type Server = ReturnType<typeof threadsServer>;
const run = (server: Server, session: Session, ...transactions: TxRecord[]) =>
  server
    .mutate(session, { transactions })
    .results.map((result) => (result.ok ? "ok" : result.code));
const rows = (server: Server, model: string): Row[] =>
  server
    .bootstrap(admin)
    .rows.filter((line) => line.model === model)
    .map((line) => line.row);
const inboxOf = (server: Server, userId: string) =>
  rows(server, "InboxItem").filter((item) => item.userId === userId);

test("a session's groups: the workspace, its user, and the teams it's in", () => {
  const server = setup();
  const db = {
    get: (model: string, id: string) => rows(server, model).find((row) => row.id === id),
    all: (model: string) => rows(server, model),
  };
  expect(groupsOf("arjun", db)).toEqual([
    "workspace:local",
    "user:arjun",
    "team:everyone",
    "team:core",
  ]);
  expect(groupsOf("kk", db)).toEqual(["workspace:local", "user:kk", "team:everyone"]);
});

test("you write only your own User, Bucket, Draft and InboxItem rows", () => {
  const server = setup();
  const [item] = inboxOf(server, "anshu");
  expect(
    run(
      server,
      arjun,
      tx("update", "User", "arjun", { role: "pm" }),
      tx("update", "User", "anshu", { role: "pm" }),
      tx("create", "Draft", "d1", { userId: "arjun", text: "" }),
      tx("create", "Draft", "d2", { userId: "anshu", text: "" }),
      tx("update", "InboxItem", item!.id, { manual: true }),
      tx("create", "Bucket", "b", { userId: "anshu", name: "B", description: "", position: 2 }),
    ),
  ).toEqual(["ok", "forbidden", "ok", "forbidden", "forbidden", "forbidden"]);
});

test("conversations and messages only in teams you're in", () => {
  const server = setup();
  expect(
    run(server, kk, conversation("x"), tx("update", "Conversation", "c", { title: "Mine" })),
  ).toEqual(["forbidden", "forbidden"]);
  expect(run(server, kk, message("m", { authorId: "kk" }))).toEqual(["forbidden"]);
  expect(run(server, arjun, tx("update", "Conversation", "c", { title: "Ours" }))).toEqual(["ok"]);
});

test("a message's author is you, and only the author deletes it", () => {
  const server = setup();
  expect(
    run(server, arjun, message("m1", { authorId: "anshu" }), message("m2", { authorId: "arjun" })),
  ).toEqual(["forbidden", "ok"]);
  expect(run(server, anshu, tx("delete", "Message", "m2"))).toEqual(["forbidden"]);
  expect(run(server, arjun, tx("update", "Message", "m2", { body: "Edited" }))).toEqual([
    "forbidden",
  ]);
  expect(run(server, arjun, tx("delete", "Message", "m2"))).toEqual(["ok"]);
});

test("members change a team; anyone else may only add themselves", () => {
  const server = setup();
  expect(
    run(
      server,
      kk,
      tx("update", "Team", "core", { name: "Mine" }),
      tx("update", "Team", "core", { memberIds: ["anshu", "arjun", "kk", "nora"] }),
      tx("update", "Team", "core", { memberIds: ["anshu", "arjun", "kk"] }),
    ),
  ).toEqual(["forbidden", "forbidden", "ok"]);
  expect(run(server, kk, tx("update", "Team", "core", { name: "Ours" }))).toEqual(["ok"]);
});

test("a new conversation is in its owner's inbox", () => {
  const server = setup();
  expect(inboxOf(server, "anshu")).toEqual([
    expect.objectContaining({ conversationId: "c", manual: false }),
  ]);
});

test("a message reaches each recipient's inbox, again if they'd marked it done; recipients must be in the team", () => {
  const server = setup();
  run(server, anshu, message("m1", { toIds: ["arjun"] }));
  const [item] = inboxOf(server, "arjun");
  expect(item).toMatchObject({ conversationId: "c" });
  run(server, arjun, tx("update", "InboxItem", item!.id, { doneAt: 5 }));
  run(server, anshu, message("m2", { toIds: ["arjun"] }));
  expect(inboxOf(server, "arjun")).toEqual([
    expect.objectContaining({ id: item!.id, doneAt: null }),
  ]);
  expect(run(server, anshu, message("m3", { toIds: ["kk"] }))).toEqual(["invalid"]);
  expect(inboxOf(server, "kk")).toEqual([]);
});

test("a blocker blocks its conversation until the last open blocker is resolved", () => {
  const server = setup();
  run(server, anshu, conversation("b1", { blocksId: "c" }), conversation("b2", { blocksId: "c" }));
  const state = () => rows(server, "Conversation").find((row) => row.id === "c")!.state;
  expect(state()).toBe("blocked");
  run(server, anshu, tx("update", "Conversation", "b1", { state: "resolved" }));
  expect(state()).toBe("blocked");
  run(server, arjun, tx("update", "Conversation", "b2", { state: "resolved" }));
  expect(state()).toBe("open");
});

test("a new user gets the default buckets", () => {
  const server = setup();
  run(
    server,
    { userId: "new" },
    tx("create", "User", "new", { name: "New", workspaceId: "local" }),
  );
  expect(
    rows(server, "Bucket")
      .filter((bucket) => bucket.userId === "new")
      .map((bucket) => [bucket.position, bucket.name]),
  ).toEqual([
    [0, "Messages that require action"],
    [1, "Messages to read"],
  ]);
});

test("the sample seed: its people in Everyone, conversations in inboxes, a blocked one; only the admin seeds", () => {
  const server = threadsServer(memoryStorage(), () => []);
  expect(() => server.action(anshu, "seed", "sample")).toThrow("Only the admin");
  server.action(admin, "seed", "sample");
  expect(rows(server, "Team").find((team) => team.id === "everyone")?.memberIds).toHaveLength(7);
  expect(inboxOf(server, "you").length).toBeGreaterThan(3);
  expect(rows(server, "Conversation").find((row) => row.id === "soc2-evidence")?.state).toBe(
    "blocked",
  );
  expect(
    server.bootstrap({ userId: "sam" }).rows.some((line) => line.row.id === "headcount-plan"),
  ).toBe(false);
});
