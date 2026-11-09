import type { Row, TxRecord } from "protocol";
import { memoryStorage, type Session } from "server";
import { expect, test } from "vite-plus/test";
import { groupsOf, mayRead, threadsServer } from "../src/rules";

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
    subspaceIds: [],
    assigneeIds: [],
    ...changes,
  });
const message = (id: string, changes: Record<string, unknown> = {}) =>
  tx("create", "Message", id, {
    threadId: "t",
    authorId: "anshu",
    body: "Hi",
    workspaceId: "local",
    subspaceIds: [],
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
  run(server, arjun, message("m0", { authorId: "arjun", body: at("anshu") }));
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
      tx("update", "WorkspaceMember", "member-arjun", { role: "member" }),
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

const at = (...people: string[]) => people.map((id) => `[[person:${id}]]`).join(" ");
const inInbox = (server: ReturnType<typeof setup>, person: string) =>
  inboxOf(server, person).some((item) => item.threadId === "t" && item.doneAt == null);
const assignees = (server: ReturnType<typeof setup>) => row(server, "Thread", "t")!.assigneeIds;

test("an @mention assigns someone: in their inbox until they mark it done, and again if mentioned again", () => {
  const server = setup();
  run(server, arjun, message("m1", { authorId: "arjun", body: `${at("kk")} look` }));
  expect(assignees(server)).toEqual(["kk"]);
  expect(inInbox(server, "kk")).toBe(true);
  const [item] = inboxOf(server, "kk");
  run(server, kk, tx("update", "InboxItem", item!.id, { doneAt: 5 }));
  expect(inInbox(server, "kk")).toBe(false);
  run(server, arjun, message("m2", { authorId: "arjun", body: `${at("kk")} again` }));
  expect(inInbox(server, "kk")).toBe(true);
  expect(assignees(server)).toEqual(["kk"]);
});

test("a message with no @mention tells nobody and assigns nobody", () => {
  const server = setup();
  run(server, anshu, message("m1", { body: `${at("arjun")} over to you` }));
  expect(inInbox(server, "anshu")).toBe(false);
  // Arjun answers without mentioning the owner: it stays in Arjun's inbox, and out of the owner's.
  run(server, arjun, message("m2", { authorId: "arjun", body: "on it" }));
  expect(inInbox(server, "anshu")).toBe(false);
  expect(inInbox(server, "arjun")).toBe(true);
  expect(assignees(server)).toEqual(["arjun"]);
});

test("a new thread is in its owner's inbox only if they're on it", () => {
  const server = setup();
  // "t" is Anshu's, with nobody on it: it's in their My Threads, not their inbox.
  expect(inInbox(server, "anshu")).toBe(false);
  run(server, anshu, thread("s", { assigneeIds: ["anshu"] }));
  expect(inboxOf(server, "anshu").map((item) => item.threadId)).toEqual(["s"]);
});

test("an owner on their thread has it until they hand it off; an @mention brings it back to stay", () => {
  const server = setup();
  run(server, anshu, thread("s", { assigneeIds: ["anshu"] }));
  const inS = () =>
    inboxOf(server, "anshu").some((item) => item.threadId === "s" && item.doneAt == null);
  const on = (id: string, fields: Record<string, unknown>) =>
    message(id, { threadId: "s", ...fields });
  run(server, anshu, on("m1", { body: "a note" }));
  expect(inS()).toBe(true);
  run(server, arjun, on("m3", { authorId: "arjun", body: `${at("anshu")} a question` }));
  expect(inS()).toBe(true);
  // Mentioning someone else doesn't take it out of the inbox of someone on it.
  run(server, anshu, on("m4", { body: `${at("kk")} can you help` }));
  expect(inS()).toBe(true);
  expect(row(server, "Thread", "s")!.assigneeIds).toEqual(["anshu", "kk"]);
});

test("someone who isn't the owner keeps it when they mention someone else", () => {
  const server = setup();
  run(server, anshu, message("m1", { body: at("arjun") }));
  run(server, arjun, message("m2", { authorId: "arjun", body: at("kk") }));
  expect(inInbox(server, "arjun")).toBe(true);
  expect(inInbox(server, "kk")).toBe(true);
});

test("mentioning yourself or nobody real assigns nobody", () => {
  const server = setup();
  run(server, anshu, message("m1", { body: `${at("anshu", "stranger-who-isnt-here")} hi` }));
  expect(assignees(server)).toEqual([]);
});

test("assigning from the thread reaches their inbox, and unassigning takes it out", () => {
  const server = setup();
  run(server, anshu, tx("update", "Thread", "t", { assigneeIds: ["kk"] }));
  expect(inInbox(server, "kk")).toBe(true);
  run(server, anshu, tx("update", "Thread", "t", { assigneeIds: [] }));
  expect(inInbox(server, "kk")).toBe(false);
});

test("a thread assigned to someone from the start is in their inbox, not its owner's", () => {
  const server = setup();
  run(server, anshu, thread("assigned", { assigneeIds: ["kk"] }));
  run(server, anshu, thread("mine", { assigneeIds: ["anshu"] }));
  const threadsIn = (person: string) => inboxOf(server, person).map((item) => item.threadId);
  expect(threadsIn("kk")).toContain("assigned");
  expect(threadsIn("anshu")).not.toContain("assigned");
  expect(threadsIn("anshu")).toContain("mine");
});

const subspace = (id: string, visibility = "open") =>
  tx("create", "Subspace", id, { name: id, visibility, workspaceId: "local" });
const join = (id: string, userId: string) =>
  tx("create", "SubspaceMember", `${id}-${userId}`, { subspaceId: id, userId });

test("a subspace's members load it; anyone may follow an open one, nobody else a private one", () => {
  const server = setup();
  run(
    server,
    anshu,
    subspace("eng"),
    join("eng", "anshu"),
    subspace("exec", "private"),
    join("exec", "anshu"),
  );
  const db = reader(server);
  expect(groupsOf("anshu", db)).toEqual(expect.arrayContaining(["subspace:eng", "subspace:exec"]));
  expect(groupsOf("arjun", db)).not.toContain("subspace:eng");
  expect(mayRead("arjun", "subspace:eng", db)).toBe(true);
  expect(mayRead("arjun", "subspace:exec", db)).toBe(false);
  expect(mayRead("stranger", "subspace:eng", db)).toBe(false);
});

test("you join an open subspace or one nobody's in; a private one's members add you", () => {
  const server = setup();
  run(server, anshu, subspace("eng"), subspace("exec", "private"), join("exec", "anshu"));
  expect(run(server, arjun, join("eng", "arjun"))).toEqual(["ok"]);
  expect(run(server, arjun, join("exec", "arjun"))).toEqual(["forbidden"]);
  expect(run(server, arjun, join("exec", "kk"))).toEqual(["forbidden"]);
  expect(run(server, anshu, join("exec", "arjun"))).toEqual(["ok"]);
  // Only members rename it.
  expect(run(server, kk, tx("update", "Subspace", "exec", { name: "x" }))).toEqual(["forbidden"]);
});

test("a private subspace's threads and messages are its members' alone, and move with the thread", () => {
  const server = setup();
  run(server, anshu, subspace("exec", "private"), join("exec", "anshu"));
  run(
    server,
    anshu,
    thread("p", { subspaceIds: ["exec"] }),
    message("m", { threadId: "p", subspaceIds: ["exec"] }),
  );
  const ids = (userId: string) => server.bootstrap({ userId }).rows.map((line) => line.row.id);
  expect(ids("anshu")).toEqual(expect.arrayContaining(["p", "m"]));
  expect(ids("arjun")).not.toContain("p");
  expect(ids("arjun")).not.toContain("m");
  // Someone outside can't write into it, and a message must say where its thread is.
  expect(run(server, arjun, thread("q", { ownerId: "arjun", subspaceIds: ["exec"] }))).toEqual([
    "forbidden",
  ]);
  expect(run(server, anshu, message("m2", { threadId: "p" }))).toEqual(["invalid"]);
  // Out of the subspace, the thread and what's in it are everyone's.
  run(server, anshu, tx("update", "Thread", "p", { subspaceIds: [] }));
  expect(ids("arjun")).toEqual(expect.arrayContaining(["p", "m"]));
});

test("@mentioning a subspace assigns everyone in it but the author", () => {
  const server = setup();
  run(
    server,
    anshu,
    subspace("eng"),
    join("eng", "anshu"),
    join("eng", "kk"),
    join("eng", "arjun"),
  );
  run(server, anshu, message("m1", { body: "[[subspace:eng]] have a look" }));
  expect(assignees(server)).toEqual(["kk", "arjun"]);
  expect(inInbox(server, "kk")).toBe(true);
  expect(inInbox(server, "anshu")).toBe(false);
});

test("a deleted subspace's threads stay, outside it", () => {
  const server = setup();
  run(server, anshu, subspace("eng"), join("eng", "anshu"), thread("e", { subspaceIds: ["eng"] }));
  run(server, anshu, tx("delete", "Subspace", "eng"));
  expect(row(server, "Thread", "e")!.subspaceIds).toEqual([]);
  expect(server.bootstrap(admin).rows.some((line) => line.model === "SubspaceMember")).toBe(false);
});

const activityOn = (server: ReturnType<typeof setup>, threadId: string) =>
  [...server.bootstrap(admin).rows].filter(
    (line) => line.model === "Activity" && line.row.threadId === threadId,
  );

test("the server writes who changed what on a thread, and nobody else can", () => {
  const server = setup();
  run(server, arjun, tx("update", "Thread", "t", { state: "resolved", priority: "high" }));
  run(server, anshu, tx("update", "Thread", "t", { state: "open" }));
  run(server, anshu, tx("update", "Thread", "t", { assigneeIds: ["kk"] }));
  expect(activityOn(server, "t").map((line) => [line.row.actorId, line.row.text])).toEqual([
    ["arjun", "changed status to Resolved"],
    ["arjun", "set priority to High"],
    ["anshu", "reopened this"],
  ]);
  const [forged] = server.mutate(anshu, {
    transactions: [
      tx("create", "Activity", "x", {
        threadId: "t",
        actorId: "anshu",
        text: "forged",
        workspaceId: "local",
        subspaceIds: [],
      }),
    ],
  }).results;
  expect(forged).toMatchObject({ ok: false, code: "forbidden" });
});

test("a blocked thread says what it's blocked on, and when it's unblocked", () => {
  const server = setup();
  run(server, anshu, thread("b1", { blocksId: "t" }));
  run(server, arjun, tx("update", "Thread", "b1", { state: "resolved" }));
  expect(activityOn(server, "t").map((line) => line.row.text)).toEqual([
    "is blocked on [[thread:b1]]",
    "is unblocked, [[thread:b1]] is resolved",
  ]);
});

test("what was in a deleted bucket is sorted again", () => {
  const server = setup();
  run(server, arjun, message("m0", { authorId: "arjun", body: at("anshu") }));
  const [item] = inboxOf(server, "anshu");
  run(
    server,
    anshu,
    tx("create", "Bucket", "b", { userId: "anshu", name: "B", description: "", position: 9 }),
    tx("update", "InboxItem", item.id, { bucketId: "b", manual: true }),
  );
  run(server, anshu, tx("delete", "Bucket", "b"));
  expect(inboxOf(server, "anshu")[0]).toMatchObject({ bucketId: null, manual: false });
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

test("the sample seed: admin members, subspaces, labelled threads in inboxes, a blocked one; only the admin seeds", () => {
  const server = threadsServer(memoryStorage(), () => []);
  expect(() => server.action(anshu, "seed", "sample")).toThrow("Only the admin");
  server.action(admin, "seed", "sample");
  expect(rows(server, "WorkspaceMember").map((m) => m.role)).toEqual(Array(9).fill("admin"));
  expect(row(server, "Thread", "headcount-plan")?.labelIds).toEqual(["q4-planning"]);
  expect(inboxOf(server, "you").length).toBeGreaterThan(3);
  expect(row(server, "Thread", "soc2-evidence")?.state).toBe("blocked");
  // Leadership is private: its thread is only its members'.
  const sees = (userId: string) =>
    server.bootstrap({ userId }).rows.some((line) => line.row.id === "headcount-plan");
  expect(sees("priya")).toBe(true);
  expect(sees("sam")).toBe(false);
});

test("admitting someone makes their workspace, person and membership once, with their buckets", () => {
  const server = threadsServer(memoryStorage(), () => []);
  const admission = {
    workspace: { id: "w1", name: "Acme" },
    person: { id: "p1", name: "Ada Lovelace", email: "ada@acme.com" },
    role: "admin" as const,
  };
  server.action(admin, "admit", admission);
  server.action(admin, "admit", admission);
  expect(rows(server, "Workspace").map((w) => w.name)).toEqual(["Acme"]);
  expect(rows(server, "User").map((u) => [u.name, u.email, u.workspaceIds])).toEqual([
    ["Ada Lovelace", "ada@acme.com", ["w1"]],
  ]);
  expect(rows(server, "WorkspaceMember").map((m) => [m.userId, m.role])).toEqual([["p1", "admin"]]);
  expect(rows(server, "Bucket").length).toBeGreaterThan(0);
  expect(() => server.action({ userId: "p1" }, "admit", admission)).toThrow();
});
