import { expect, test } from "vite-plus/test";
import { memoryDatabase } from "../src/client";
import { memoryStorage, signSession, verifySession } from "../src/server";
import { createServer, Hub, seedUsers, settle, txId, type TestModels } from "./harness";

function setUp(...users: string[]) {
  const server = createServer();
  seedUsers(server, ...users);
  const hub = new Hub(server);
  return { server, hub };
}

const note = (id: string, text = "Hello", teamId: string | null = null) =>
  ({ id: txId(), type: "create", modelName: "Note", data: { id, text, teamId } }) as const;

test("a change shows at once, reaches the server, and every client that can see it", async () => {
  const { hub, server } = setUp("ann", "bob");
  server.write((batch) => batch.put("Team", { id: "t", memberIds: ["ann", "bob"] }));
  const ann = hub.client("ann");
  const bob = hub.client("bob");
  await Promise.all([ann.start(), bob.start()]);
  await settle();

  ann.transact(note("n1", "Shared", "t"), "ann");
  expect(ann.pool.get("Note", "n1")?.text).toBe("Shared");
  await settle();
  expect(server.models.Note.get("n1")?.ownerId).toBe("ann");
  expect(bob.pool.get("Note", "n1")?.text).toBe("Shared");
  expect(ann.queue.pending).toEqual([]);
  expect(bob.lastSyncId).toBe(server.lastSyncId);
});

test("a private note reaches only its owner, through bootstrap, deltas and packets alike", async () => {
  const { hub, server } = setUp("ann", "bob");
  const ann = hub.client("ann");
  const bob = hub.client("bob");
  await Promise.all([ann.start(), bob.start()]);
  await settle();
  ann.transact(note("secret"), "ann");
  await settle();

  expect(bob.pool.get("Note", "secret")).toBeUndefined();
  // Bob still moves along: his position keeps up though he saw nothing.
  expect(bob.lastSyncId).toBe(server.lastSyncId);
  expect(server.bootstrap({ userId: "bob" }).models.Note).toEqual([]);
  expect(server.bootstrap({ userId: "ann" }).models.Note).toHaveLength(1);
  const deltas = server.deltas({ userId: "bob" }, 0);
  expect("actions" in deltas && deltas.actions.some((action) => action.modelName === "Note")).toBe(
    false,
  );
  // An admin session sees everything.
  expect(server.bootstrap({ admin: true }).models.Note).toHaveLength(1);
});

test("a note moved into a team arrives for its members as an insert, and leaves as a delete", async () => {
  const { hub, server } = setUp("ann", "bob");
  server.write((batch) => batch.put("Team", { id: "t", memberIds: ["ann", "bob"] }));
  const ann = hub.client("ann");
  const bob = hub.client("bob");
  await Promise.all([ann.start(), bob.start()]);
  await settle();
  ann.transact(note("n"), "ann");
  await settle();
  const share = (teamId: string | null) =>
    ann.transact(
      { id: txId(), type: "update", modelName: "Note", modelId: "n", changes: { teamId } },
      "ann",
    );

  share("t");
  await settle();
  expect(bob.pool.get("Note", "n")?.teamId).toBe("t");
  share(null);
  await settle();
  expect(bob.pool.get("Note", "n")).toBeUndefined();
  expect(ann.pool.get("Note", "n")?.teamId).toBeNull();
  // As the log has it for Bob: the share an insert, the unshare a delete.
  const log = server.deltas({ userId: "bob" }, 0);
  expect(
    "actions" in log &&
      log.actions.filter((action) => action.modelName === "Note").map((action) => action.action),
  ).toEqual(["I", "D"]);
});

test("joining a team loads its notes, and leaving drops them", async () => {
  const { hub, server } = setUp("ann", "bob");
  server.write((batch) => batch.put("Team", { id: "t", memberIds: ["ann"] }));
  const ann = hub.client("ann");
  const bob = hub.client("bob");
  await Promise.all([ann.start(), bob.start()]);
  await settle();
  ann.transact(note("team-note", "For the team", "t"), "ann");
  await settle();
  expect(bob.pool.get("Note", "team-note")).toBeUndefined();

  const setMembers = (memberIds: string[]) =>
    ann.transact(
      { id: txId(), type: "update", modelName: "Team", modelId: "t", changes: { memberIds } },
      "ann",
    );
  setMembers(["ann", "bob"]);
  await settle();
  expect(bob.syncGroups).toContain("team:t");
  expect(bob.pool.get("Note", "team-note")?.text).toBe("For the team");

  setMembers(["ann"]);
  await settle();
  expect(bob.syncGroups).not.toContain("team:t");
  expect(bob.pool.get("Note", "team-note")).toBeUndefined();
});

test("a user's session acts only as them, and sees only what's theirs to change", async () => {
  const { server } = setUp("ann", "bob");
  expect(() =>
    server.execute({ actorId: "ann", transactions: [note("x")] }, { userId: "bob" }),
  ).toThrow("only act as yourself");
  server.execute({ actorId: "ann", transactions: [note("x")] }, { userId: "ann" });
  // Bob can't delete what he can't see; it's as if it isn't there.
  expect(() =>
    server.execute(
      {
        actorId: "bob",
        transactions: [{ id: txId(), type: "delete", modelName: "Note", modelId: "x" }],
      },
      { userId: "bob" },
    ),
  ).toThrow("Note not found");
});

test("deleting a note deletes its comments, on the server and every client", async () => {
  const { hub, server } = setUp("ann");
  const ann = hub.client("ann");
  await ann.start();
  await settle();
  ann.transact(note("n"), "ann");
  ann.transact(
    {
      id: txId(),
      type: "create",
      modelName: "Comment",
      data: { id: "c", noteId: "n", text: "Hi" },
    },
    "ann",
  );
  await settle();
  expect(server.models.Comment.size).toBe(1);

  ann.delete("Note", "n", "ann");
  expect(ann.pool.get("Note", "n")).toBeUndefined();
  await settle();
  expect(server.models.Note.size).toBe(0);
  expect(server.models.Comment.size).toBe(0);
  expect(ann.pool.get("Comment", "c")).toBeUndefined();
  const actions = server.deltas({ admin: true }, 0);
  expect(
    "actions" in actions && actions.actions.filter((action) => action.action === "D"),
  ).toHaveLength(2);
});

test("archiving keeps a model with its archive time, and unarchiving clears it", async () => {
  const { hub, server } = setUp("ann");
  const ann = hub.client("ann");
  await ann.start();
  await settle();
  ann.transact(note("n"), "ann");
  await settle();

  ann.archive("Note", "n", "ann");
  expect(ann.pool.get("Note", "n")?.archivedAtMs).toBeTypeOf("number");
  await settle();
  expect(server.models.Note.get("n")?.archivedAtMs).toBe(1_000);
  const log = server.deltas({ admin: true }, 0);
  expect("actions" in log && log.actions.at(-1)?.action).toBe("A");

  ann.unarchive("Note", "n", "ann");
  await settle();
  expect(server.models.Note.get("n")?.archivedAtMs).toBeNull();
  // Archiving twice is refused, and rolled back on the client.
  ann.unarchive("Note", "n", "ann");
  await settle();
  expect(ann.error).toContain("isn't archived");
  expect(ann.pool.get("Note", "n")?.archivedAtMs).toBeNull();
});

test("a refused batch rolls back, and changes to a model the server deleted are dropped unsent", async () => {
  const { hub, server } = setUp("ann", "bob");
  server.write((batch) => batch.put("Team", { id: "t", memberIds: ["ann", "bob"] }));
  const ann = hub.client("ann");
  const bob = hub.client("bob");
  await Promise.all([ann.start(), bob.start()]);
  await settle();
  ann.transact(note("n", "Shared", "t"), "ann");
  await settle();

  // Bob may not delete Ann's note: refused, and it comes back.
  bob.delete("Note", "n", "bob");
  expect(bob.pool.get("Note", "n")).toBeUndefined();
  await settle();
  expect(bob.pool.get("Note", "n")?.text).toBe("Shared");
  expect(bob.error).toContain("Only its owner");

  // Bob edits offline; meanwhile Ann deletes it. His edit is dropped rather than sent and refused.
  const bobSocket = [...hub.sockets].find(
    (socket) => "userId" in socket.session && socket.session.userId === "bob",
  )!;
  bobSocket.paused = true;
  bob.queue.online = false;
  bob.dismissError();
  bob.transact(
    { id: txId(), type: "update", modelName: "Note", modelId: "n", changes: { text: "Mine" } },
    "bob",
  );
  ann.delete("Note", "n", "ann");
  await settle();
  bobSocket.paused = false;
  // The next packet shows Bob a gap; catching up brings the delete.
  ann.transact(note("next", "Next", "t"), "ann");
  await settle();
  bob.queue.online = true;
  bob.queue.dequeue();
  await settle();
  expect(bob.pool.get("Note", "n")).toBeUndefined();
  expect(bob.error).toBeNull();
  expect(bob.queue.pending).toEqual([]);
});

test("a missed packet is fetched, and a gap the log can't fill is a fresh bootstrap", async () => {
  const { hub, server } = setUp("ann", "bob");
  server.write((batch) => batch.put("Team", { id: "t", memberIds: ["ann", "bob"] }));
  const ann = hub.client("ann");
  const bob = hub.client("bob");
  await Promise.all([ann.start(), bob.start()]);
  await settle();
  const bobSocket = [...hub.sockets].find(
    (socket) => "userId" in socket.session && socket.session.userId === "bob",
  )!;

  // One packet lost: the next shows the gap and Bob fetches what he missed.
  bobSocket.paused = true;
  ann.transact(note("one", "1", "t"), "ann");
  await settle();
  bobSocket.paused = false;
  ann.transact(note("two", "2", "t"), "ann");
  await settle();
  expect(bob.pool.get("Note", "one")?.text).toBe("1");
  expect(bob.pool.get("Note", "two")?.text).toBe("2");

  // Many lost, and the log compacted past them: Bob starts over rather than getting stuck.
  bobSocket.paused = true;
  ann.transact(note("three", "3", "t"), "ann");
  ann.transact(
    { id: txId(), type: "update", modelName: "Note", modelId: "one", changes: { text: "uno" } },
    "ann",
  );
  await settle();
  server.compact({ keepActions: 0 });
  expect(server.deltas({ userId: "bob" }, bob.lastSyncId)).toHaveProperty(
    "fullBootstrapRequired",
    true,
  );
  bobSocket.paused = false;
  ann.transact(note("four", "4", "t"), "ann");
  await settle();
  expect(bob.pool.get("Note", "three")?.text).toBe("3");
  expect(bob.pool.get("Note", "one")?.text).toBe("uno");
  expect(bob.lastSyncId).toBe(server.lastSyncId);
});

test("a server whose data started over is noticed by its epoch, and unsent changes survive it", async () => {
  const storage = memoryStorage<TestModels>();
  const first = createServer(storage);
  seedUsers(first, "ann");
  const hub = new Hub(first);
  const database = memoryDatabase<TestModels, never>();
  const ann = hub.client("ann", database as never);
  await ann.start();
  await settle();
  ann.transact(note("old"), "ann");
  await settle();

  // A reset: new storage, the same people, and as many changes as before so the sync ids line up.
  const fresh = createServer();
  seedUsers(fresh, "ann");
  fresh.write((batch) => batch.put("User", { id: "filler", name: "filler" }));
  expect(fresh.lastSyncId).toBe(first.lastSyncId);
  ann.queue.online = false;
  ann.transact(note("unsent"), "ann");
  await settle();
  hub.replace(fresh);
  // The client reconnects after its backoff.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await settle();
  expect(ann.epoch).toBe(fresh.epoch);
  expect(ann.pool.get("Note", "old")).toBeUndefined();
  expect(fresh.models.Note.get("unsent")).toBeDefined();
  ann.stop();
});

test("a resent transaction runs once", () => {
  const { server } = setUp("ann");
  const create = note("n");
  server.execute({ actorId: "ann", transactions: [create] }, { userId: "ann" });
  const before = server.lastSyncId;
  expect(server.execute({ actorId: "ann", transactions: [create] }, { userId: "ann" })).toEqual([]);
  expect(server.lastSyncId).toBe(before);
});

test("a restart replays unsent changes from the local database", async () => {
  const { hub, server } = setUp("ann");
  const database = memoryDatabase<TestModels, never>();
  const first = hub.client("ann", database as never);
  await first.start();
  await settle();
  first.queue.online = false;
  first.stop();
  first.queue.resume();
  first.transact(note("offline"), "ann");
  await settle();
  const second = hub.client("ann", database as never);
  await second.start();
  expect(second.pool.get("Note", "offline")?.text).toBe("Hello");
  await settle();
  expect(server.models.Note.get("offline")).toBeDefined();
  second.stop();
});

test("session tokens are signed, scoped to a workspace, and expire", async () => {
  const token = await signSession("secret", { userId: "ann", workspace: "w", expiresAtMs: 2_000 });
  expect(await verifySession("secret", token, "w", 1_000)).toEqual({
    userId: "ann",
    workspace: "w",
    expiresAtMs: 2_000,
  });
  expect(await verifySession("secret", token, "other", 1_000)).toBeUndefined();
  expect(await verifySession("secret", token, "w", 3_000)).toBeUndefined();
  expect(await verifySession("wrong", token, "w", 1_000)).toBeUndefined();
  const [version, , signature] = token.split(".");
  const forged = `${version}.${btoa(JSON.stringify({ userId: "bob", workspace: "w", expiresAtMs: 2_000 }))}.${signature}`;
  expect(await verifySession("secret", forged, "w", 1_000)).toBeUndefined();
});
