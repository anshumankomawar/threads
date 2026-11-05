import type { Row, TxRecord } from "protocol";
import { memoryStorage, type Session } from "server";
import { expect, test } from "vite-plus/test";
import { groupsOf, threadsServer } from "../src/rules";

const admin: Session = { admin: true };
const anshu: Session = { userId: "anshu" };
const arjun: Session = { userId: "arjun" };
const kk: Session = { userId: "kk" };
const stranger: Session = { userId: "stranger" };

let counter = 0;
const tx = (
  kind: TxRecord["kind"],
  model: string,
  modelId: string,
  changes?: Record<string, unknown>,
): TxRecord => ({ id: `tx-${++counter}`, kind, model, modelId, changes, batch: 0 });

const thread = (id: string, changes: Record<string, unknown> = {}) =>
  tx("create", "Thread", id, {
    title: id,
    state: "open",
    priority: "none",
    ownerId: "anshu",
    workspaceId: "local",
    labelIds: [],
    ...changes,
  });
const message = (id: string, changes: Record<string, unknown> = {}) =>
  tx("create", "Message", id, {
    threadId: "t",
    authorId: "anshu",
    body: "Hi",
    toIds: [],
    workspaceId: "local",
    ...changes,
  });

// The local workspace with Anshu's thread "t", and "stranger", a person who isn't a member.
function setup() {
  const server = threadsServer(memoryStorage(), () => []);
  server.action(admin, "seed", "local");
  run(server, admin, tx("create", "User", "stranger", { name: "Stranger", workspaceIds: [] }));
  run(server, admin, thread("t"));
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
const row = (server: Server, model: string, id: string): Row | undefined =>
  rows(server, model).find((r) => r.id === id);
const inboxOf = (server: Server, userId: string) =>
  rows(server, "InboxItem").filter((item) => item.userId === userId);
const reader = (server: Server) => ({
  get: (model: string, id: string) => row(server, model, id),
  all: (model: string) => rows(server, model),
});

test("a session's groups: its workspace when it's a member, and its user", () => {
  const server = setup();
  expect(groupsOf("arjun", reader(server))).toEqual(["workspace:local", "user:arjun"]);
  expect(groupsOf("stranger", reader(server))).toEqual(["user:stranger"]);
});

test("a membership puts the workspace in the person's workspaceIds, and its removal takes it out", () => {
  const server = setup();
  expect(row(server, "User", "anshu")?.workspaceIds).toEqual(["local"]);
  const join = tx("create", "WorkspaceMember", "m", {
    workspaceId: "local",
    userId: "stranger",
    role: "member",
  });
  expect(run(server, anshu, join)).toEqual(["ok"]);
  expect(row(server, "User", "stranger")?.workspaceIds).toEqual(["local"]);
  expect(groupsOf("stranger", reader(server))).toEqual(["workspace:local", "user:stranger"]);
  run(server, anshu, tx("delete", "WorkspaceMember", "m"));
  expect(row(server, "User", "stranger")?.workspaceIds).toEqual([]);
});

test("you write only your own User (not its workspaces), Bucket, Draft and InboxItem rows", () => {
  const server = setup();
  const [item] = inboxOf(server, "anshu");
  expect(
    run(
      server,
      arjun,
      tx("update", "User", "arjun", { name: "Arjun K" }),
      tx("update", "User", "arjun", { workspaceIds: [] }),
      tx("update", "User", "anshu", { name: "Mine" }),
      tx("create", "Draft", "d1", { userId: "arjun", text: "" }),
      tx("create", "Draft", "d2", { userId: "anshu", text: "" }),
      tx("update", "InboxItem", item!.id, { manual: true }),
      tx("create", "Bucket", "b", { userId: "anshu", name: "B", description: "", position: 2 }),
    ),
  ).toEqual(["ok", "forbidden", "forbidden", "ok", "forbidden", "forbidden", "forbidden"]);
});

test("members write threads, labels and messages in their workspace; others can't", () => {
  const server = setup();
  const label = (id: string) => tx("create", "Label", id, { name: id, workspaceId: "local" });
  expect(
    run(
      server,
      stranger,
      thread("x", { ownerId: "stranger" }),
      tx("update", "Thread", "t", { title: "Mine" }),
      label("l1"),
      message("m", { authorId: "stranger" }),
    ),
  ).toEqual(["forbidden", "forbidden", "forbidden", "forbidden"]);
  expect(
    run(
      server,
      arjun,
      tx("update", "Thread", "t", { title: "Ours", labelIds: ["l2"] }),
      label("l2"),
    ),
  ).toEqual(["ok", "ok"]);
});

test("only admins change memberships and roles", () => {
  const server = setup();
  expect(
    run(server, admin, tx("update", "WorkspaceMember", "member-kk", { role: "member" })),
  ).toEqual(["ok"]);
  expect(
    run(
      server,
      kk,
      tx("update", "WorkspaceMember", "member-kk", { role: "admin" }),
      tx("update", "WorkspaceMember", "member-arjun", { title: "pm" }),
    ),
  ).toEqual(["forbidden", "forbidden"]);
  expect(
    run(server, anshu, tx("update", "WorkspaceMember", "member-kk", { role: "admin" })),
  ).toEqual(["ok"]);
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
  expect(run(server, arjun, message("m3", { authorId: "arjun", workspaceId: "other" }))).toEqual([
    "forbidden",
  ]);
});

test("a message reaches each recipient's inbox, again if they'd marked it done", () => {
  const server = setup();
  run(server, arjun, message("m1", { authorId: "arjun", toIds: ["kk"] }));
  const [item] = inboxOf(server, "kk");
  expect(item).toMatchObject({ threadId: "t" });
  run(server, kk, tx("update", "InboxItem", item!.id, { doneAt: 5 }));
  run(server, arjun, message("m2", { authorId: "arjun", toIds: ["kk"] }));
  expect(inboxOf(server, "kk")).toEqual([expect.objectContaining({ id: item!.id, doneAt: null })]);
});

test("a new thread is in its owner's inbox until they send it to someone; a message to them brings it back", () => {
  const server = setup();
  const inInbox = () =>
    inboxOf(server, "anshu").map((item) => [item.threadId, item.doneAt == null]);
  expect(inInbox()).toEqual([["t", true]]);
  run(server, anshu, message("m1", { toIds: ["arjun"] }));
  expect(inInbox()).toEqual([["t", false]]);
  run(server, arjun, message("m2", { authorId: "arjun", toIds: ["anshu"] }));
  expect(inInbox()).toEqual([["t", true]]);
  // Once someone has sent the owner something here, the owner's own messages leave it in their inbox.
  run(server, anshu, message("m3", { toIds: ["arjun"] }));
  expect(inInbox()).toEqual([["t", true]]);
});

test("a blocker blocks its thread until the last open blocker is resolved", () => {
  const server = setup();
  run(server, anshu, thread("b1", { blocksId: "t" }), thread("b2", { blocksId: "t" }));
  const state = () => row(server, "Thread", "t")!.state;
  expect(state()).toBe("blocked");
  run(server, anshu, tx("update", "Thread", "b1", { state: "resolved" }));
  expect(state()).toBe("blocked");
  run(server, arjun, tx("update", "Thread", "b2", { state: "resolved" }));
  expect(state()).toBe("open");
});

test("a new user gets the default buckets", () => {
  const server = setup();
  run(server, { userId: "new" }, tx("create", "User", "new", { name: "New", workspaceIds: [] }));
  expect(
    rows(server, "Bucket")
      .filter((bucket) => bucket.userId === "new")
      .map((bucket) => [bucket.position, bucket.name]),
  ).toEqual([
    [0, "Messages that require action"],
    [1, "Messages to read"],
  ]);
});

test("the sample seed: admin members, labelled threads in inboxes, a blocked one; only the admin seeds", () => {
  const server = threadsServer(memoryStorage(), () => []);
  expect(() => server.action(anshu, "seed", "sample")).toThrow("Only the admin");
  server.action(admin, "seed", "sample");
  expect(rows(server, "WorkspaceMember").map((m) => m.role)).toEqual(Array(7).fill("admin"));
  expect(row(server, "Thread", "headcount-plan")?.labelIds).toEqual(["q4-planning"]);
  expect(inboxOf(server, "you").length).toBeGreaterThan(3);
  expect(row(server, "Thread", "soc2-evidence")?.state).toBe("blocked");
  expect(
    server.bootstrap({ userId: "sam" }).rows.some((line) => line.row.id === "headcount-plan"),
  ).toBe(true);
});
