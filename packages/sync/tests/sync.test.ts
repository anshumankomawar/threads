import { expect, test } from "vite-plus/test";
import { decodeBootstrap, encodeBootstrap } from "../src";
import { memoryDatabase, type ClientEvent } from "../src/client";
import { memoryStorage, signSession, verifySession, type ServerEvent } from "../src/server";
import {
  comment,
  createServer,
  editNote,
  Hub,
  note,
  seedUsers,
  settle,
  txId,
  type TestDatabase,
  type TestModels,
} from "./harness";

function setUp(...users: string[]) {
  const server = createServer();
  seedUsers(server, ...users);
  server.write((batch) => batch.put("Team", { id: "t", memberIds: users.slice(0, 2) }));
  const hub = new Hub(server);
  return { server, hub };
}

async function started(hub: Hub, ...users: string[]) {
  const clients = users.map((user) => hub.client(user));
  await Promise.all(clients.map((client) => client.start()));
  await settle();
  return clients;
}

// --- Transactions, sync ids and delta packets ---

test("a change shows at once, reaches the server, and every client that can see it", async () => {
  const { hub, server } = setUp("ann", "bob");
  const [ann, bob] = await started(hub, "ann", "bob");
  ann.transact(note("n1", "Shared", "t"), "ann");
  expect(ann.pool.get("Note", "n1")?.text).toBe("Shared");
  await settle();
  expect(server.models.Note.get("n1")?.ownerId).toBe("ann");
  expect(bob.pool.get("Note", "n1")?.text).toBe("Shared");
  expect(ann.queue.pending).toEqual([]);
  expect(bob.lastSyncId).toBe(server.lastSyncId);
});

test("a resent transaction runs once", () => {
  const { server } = setUp("ann");
  const create = note("n");
  server.execute({ actorId: "ann", transactions: [create] }, { userId: "ann" });
  const before = server.lastSyncId;
  expect(server.execute({ actorId: "ann", transactions: [create] }, { userId: "ann" })).toEqual([]);
  expect(server.lastSyncId).toBe(before);
});

test("a refused batch rolls back, and changes to a model the server deleted are dropped unsent", async () => {
  const { hub } = setUp("ann", "bob");
  const [ann, bob] = await started(hub, "ann", "bob");
  ann.transact(note("n", "Shared", "t"), "ann");
  await settle();

  // Bob may not delete Ann's note: refused, and it comes back.
  bob.delete("Note", "n", "bob");
  expect(bob.pool.get("Note", "n")).toBeUndefined();
  await settle();
  expect(bob.pool.get("Note", "n")?.text).toBe("Shared");
  expect(bob.error).toContain("Only its owner");

  // Bob edits offline; meanwhile Ann deletes it. His edit is dropped rather than sent and refused.
  hub.socketOf("bob").paused = true;
  hub.offline.add("bob");
  bob.dismissError();
  bob.transact(editNote("n", { text: "Mine" }), "bob");
  ann.delete("Note", "n", "ann");
  await settle();
  hub.socketOf("bob").paused = false;
  hub.offline.delete("bob");
  // The next packet shows Bob a gap; catching up brings the delete.
  ann.transact(note("next", "Next", "t"), "ann");
  await settle();
  bob.queue.dequeue();
  await settle();
  expect(bob.pool.get("Note", "n")).toBeUndefined();
  expect(bob.error).toBeNull();
});

test("a newer server change is rebased under a pending edit, and the pending edit wins", async () => {
  const { hub } = setUp("ann", "bob");
  const [ann, bob] = await started(hub, "ann", "bob");
  ann.transact(note("n", "Shared", "t"), "ann");
  await settle();
  hub.offline.add("bob");
  bob.transact(editNote("n", { text: "Bob's" }), "bob");
  ann.transact(editNote("n", { text: "Ann's", teamId: "t" }), "ann");
  await settle();
  // Ann's change arrived underneath; Bob's own edit stays on top until it's sent.
  expect(bob.pool.get("Note", "n")?.text).toBe("Bob's");
  hub.offline.delete("bob");
  bob.queue.dequeue();
  await settle();
  expect(ann.pool.get("Note", "n")?.text).toBe("Bob's");
});

// --- Patches: concurrent list edits merge ---

test("two people changing the same list at once both keep their change", async () => {
  const { hub, server } = setUp("ann", "bob");
  const [ann, bob] = await started(hub, "ann", "bob");
  ann.transact(note("n", "Shared", "t"), "ann");
  await settle();
  ann.transact(editNote("n", { tagIds: { $add: ["red", "blue"] } }), "ann");
  await settle();

  // Both edit before either hears of the other.
  hub.offline.add("ann");
  hub.offline.add("bob");
  ann.transact(editNote("n", { tagIds: { $add: ["green"] } }), "ann");
  bob.transact(editNote("n", { tagIds: { $remove: ["red"], $add: ["gold"] } }), "bob");
  await settle();
  hub.offline.clear();
  ann.queue.dequeue();
  bob.queue.dequeue();
  await settle();
  const tags = ["blue", "green", "gold"];
  expect([...(server.models.Note.get("n")?.tagIds ?? [])].sort()).toEqual(tags.sort());
  expect([...(ann.pool.get("Note", "n")?.tagIds ?? [])].sort()).toEqual(tags);
  expect([...(bob.pool.get("Note", "n")?.tagIds ?? [])].sort()).toEqual(tags);
});

// --- Sync groups ---

test("a private note reaches only its owner, through bootstrap, deltas and packets alike", async () => {
  const { hub, server } = setUp("ann", "bob");
  const [ann, bob] = await started(hub, "ann", "bob");
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
  expect(server.bootstrap({ admin: true }).models.Note).toHaveLength(1);
});

test("a note shared with a team arrives for its members as an insert and leaves as a delete, comments with it", async () => {
  const { hub, server } = setUp("ann", "bob");
  const [ann, bob] = await started(hub, "ann", "bob");
  ann.transact(note("n"), "ann");
  ann.transact(comment("c", "n", "On it"), "ann");
  await settle();
  await bob.hydrate("Comment", "noteId", "n");
  expect(bob.pool.get("Comment", "c")).toBeUndefined();

  // Sharing the note brings its comment, which is seen by whoever sees its note, though only the note changed.
  ann.transact(editNote("n", { teamId: "t" }), "ann");
  await settle();
  expect(bob.pool.get("Note", "n")?.teamId).toBe("t");
  expect(bob.pool.get("Comment", "c")?.text).toBe("On it");

  ann.transact(editNote("n", { teamId: null }), "ann");
  await settle();
  expect(bob.pool.get("Note", "n")).toBeUndefined();
  expect(bob.pool.get("Comment", "c")).toBeUndefined();
  const log = server.deltas({ userId: "bob" }, 0);
  expect(
    "actions" in log &&
      log.actions
        .filter((action) => action.modelName !== "User" && action.modelName !== "Team")
        .map((action) => `${action.modelName} ${action.action}`),
  ).toEqual(["Note I", "Comment I", "Note D", "Comment D"]);
});

test("joining a team loads its notes, and leaving drops them", async () => {
  const { hub, server } = setUp("ann", "bob", "cat");
  const [ann, cat] = await started(hub, "ann", "cat");
  ann.transact(note("team-note", "For the team", "t"), "ann");
  await settle();
  expect(cat.pool.get("Note", "team-note")).toBeUndefined();
  const setMembers = (memberIds: string[]) =>
    ann.transact(
      { id: txId(), type: "update", modelName: "Team", modelId: "t", changes: { memberIds } },
      "ann",
    );
  setMembers(["ann", "bob", "cat"]);
  await settle();
  expect(cat.syncGroups).toContain("team:t");
  expect(cat.pool.get("Note", "team-note")?.text).toBe("For the team");
  setMembers(["ann", "bob"]);
  await settle();
  expect(cat.syncGroups).not.toContain("team:t");
  expect(cat.pool.get("Note", "team-note")).toBeUndefined();
  expect(server.models.Note.size).toBe(1);
});

test("a user's session acts only as them, and changes only what it sees", () => {
  const { server } = setUp("ann", "bob");
  expect(() =>
    server.execute({ actorId: "ann", transactions: [note("x")] }, { userId: "bob" }),
  ).toThrow("only act as yourself");
  server.execute({ actorId: "ann", transactions: [note("x")] }, { userId: "ann" });
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

// --- Deleting and archiving ---

test("deleting a note deletes its comments, on the server and every client", async () => {
  const { hub, server } = setUp("ann");
  const [ann] = await started(hub, "ann");
  ann.transact(note("n"), "ann");
  ann.transact(comment("c", "n"), "ann");
  await settle();
  await ann.hydrate("Comment", "noteId", "n");
  expect(ann.pool.get("Comment", "c")).toBeDefined();
  ann.delete("Note", "n", "ann");
  expect(ann.pool.get("Note", "n")).toBeUndefined();
  await settle();
  expect(server.models.Note.size).toBe(0);
  expect(server.models.Comment.size).toBe(0);
  expect(ann.pool.get("Comment", "c")).toBeUndefined();
});

test("archiving keeps a model with its archive time, and unarchiving clears it", async () => {
  const { hub, server } = setUp("ann");
  const [ann] = await started(hub, "ann");
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
  ann.unarchive("Note", "n", "ann");
  await settle();
  expect(ann.error).toContain("isn't archived");
  expect(ann.pool.get("Note", "n")?.archivedAtMs).toBeNull();
});

// --- Lazy and partial loading ---

test("a partial model loads a slice at a time, batched per tick, and stays current once loaded", async () => {
  const { hub, server } = setUp("ann");
  server.execute(
    {
      actorId: "ann",
      transactions: [note("a"), note("b"), comment("a1", "a"), comment("b1", "b")],
    },
    { userId: "ann" },
  );
  const events: ClientEvent[] = [];
  const database: TestDatabase = memoryDatabase();
  const ann = hub.client("ann", database, (event) => events.push(event));
  await ann.start();
  await settle();
  expect(server.bootstrap({ userId: "ann" }).models.Comment).toBeUndefined();
  expect(ann.pool.get("Comment", "a1")).toBeUndefined();

  await Promise.all([ann.hydrate("Comment", "noteId", "a"), ann.hydrate("Comment", "noteId", "b")]);
  expect(events.filter((event) => event.type === "loaded")).toHaveLength(1);
  expect(ann.pool.get("Comment", "a1")).toBeDefined();
  expect(ann.isLoaded("Comment", "noteId", "a")).toBe(true);

  // Another client's comment on a loaded note arrives; one on a note not loaded stays in the database only.
  server.execute(
    { actorId: "ann", transactions: [note("c"), comment("a2", "a"), comment("c1", "c")] },
    { userId: "ann" },
  );
  await settle();
  expect(ann.pool.get("Comment", "a2")).toBeDefined();
  expect(ann.pool.get("Comment", "c1")).toBeUndefined();
  expect((await database.models("Comment")).map((model) => model.id).sort()).toEqual([
    "a1",
    "a2",
    "b1",
    "c1",
  ]);
  // Your own comment always shows, loaded or not.
  ann.transact(comment("c2", "c", "Mine"), "ann");
  expect(ann.pool.get("Comment", "c2")?.text).toBe("Mine");
  await settle();
  expect(ann.pool.get("Comment", "c2")?.text).toBe("Mine");
  ann.stop();

  // After a restart, what was loaded comes back from the database without asking the server.
  const again = hub.client("ann", database, (event) => events.push(event));
  const loads = events.filter((event) => event.type === "loaded").length;
  await again.start();
  await settle();
  await again.hydrate("Comment", "noteId", "a");
  expect(again.pool.get("Comment", "a2")).toBeDefined();
  expect(events.filter((event) => event.type === "loaded")).toHaveLength(loads);
  again.stop();
});

test("a lazy model loads all at once, the first time it's asked for", async () => {
  const { hub, server } = setUp("ann");
  server.write((batch) => {
    batch.put("Sticker", { id: "red", name: "Red" });
    batch.put("Sticker", { id: "blue", name: "Blue" });
  });
  const [ann] = await started(hub, "ann");
  expect(ann.pool.maps.Sticker.size).toBe(0);
  await ann.hydrate("Sticker");
  expect(ann.pool.maps.Sticker.size).toBe(2);
  server.write((batch) => batch.put("Sticker", { id: "gold", name: "Gold" }));
  await settle();
  expect(ann.pool.get("Sticker", "gold")?.name).toBe("Gold");
  expect(() =>
    server.load({ userId: "ann" }, [{ modelName: "Note", key: "text", value: "x" }]),
  ).toThrow("isn't loaded by text");
});

// --- Undo and redo ---

test("undo sends the inverse as a new transaction, and redo undoes the undo", async () => {
  const { hub, server } = setUp("ann", "bob");
  const [ann] = await started(hub, "ann");
  ann.transact(note("n", "First"), "ann");
  await settle();

  ann.undoQueue.addOperation("Edit note", () => {
    ann.transact(editNote("n", { text: "Second", tagIds: { $add: ["red"] } }), "ann");
  });
  await settle();
  expect(server.models.Note.get("n")).toMatchObject({ text: "Second", tagIds: ["red"] });
  expect(ann.undoQueue.undo()).toBe("Edit note");
  expect(ann.pool.get("Note", "n")).toMatchObject({ text: "First", tagIds: [] });
  await settle();
  expect(server.models.Note.get("n")).toMatchObject({ text: "First", tagIds: [] });
  expect(ann.undoQueue.redo()).toBe("Edit note");
  await settle();
  expect(server.models.Note.get("n")).toMatchObject({ text: "Second", tagIds: ["red"] });

  // Undoing a creation deletes what it made; a step that can't be undone is left out.
  ann.undoQueue.addOperation("Comment", () => ann.transact(comment("c", "n"), "ann"));
  await settle();
  ann.undoQueue.undo();
  await settle();
  expect(server.models.Comment.has("c")).toBe(false);
  ann.undoQueue.addOperation("Delete", () => ann.delete("Note", "n", "ann"));
  expect(ann.undoQueue.canUndo).toBe(true);
  ann.undoQueue.undo();
  expect(ann.undoQueue.canRedo).toBe(false);
});

// --- Gaps, compaction, resets and restarts ---

test("a missed packet is fetched, and a gap the log can't fill is a fresh bootstrap", async () => {
  const { hub, server } = setUp("ann", "bob");
  const [ann, bob] = await started(hub, "ann", "bob");
  const bobSocket = hub.socketOf("bob");
  bobSocket.paused = true;
  ann.transact(note("one", "1", "t"), "ann");
  await settle();
  bobSocket.paused = false;
  ann.transact(note("two", "2", "t"), "ann");
  await settle();
  expect(bob.pool.get("Note", "one")?.text).toBe("1");
  expect(bob.pool.get("Note", "two")?.text).toBe("2");

  bobSocket.paused = true;
  ann.transact(note("three", "3", "t"), "ann");
  ann.transact(editNote("one", { text: "uno" }), "ann");
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
  const first = createServer(memoryStorage<TestModels>());
  seedUsers(first, "ann");
  const hub = new Hub(first);
  const [ann] = await started(hub, "ann");
  ann.transact(note("old"), "ann");
  await settle();

  // A reset: new storage, and as many changes as before so the sync ids line up.
  const fresh = createServer();
  seedUsers(fresh, "ann");
  fresh.write((batch) => batch.put("User", { id: "filler", name: "filler" }));
  expect(fresh.lastSyncId).toBe(first.lastSyncId);
  hub.offline.add("ann");
  ann.transact(note("unsent"), "ann");
  await settle();
  hub.offline.delete("ann");
  hub.replace(fresh);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await settle();
  expect(ann.epoch).toBe(fresh.epoch);
  expect(ann.pool.get("Note", "old")).toBeUndefined();
  expect(fresh.models.Note.get("unsent")).toBeDefined();
  ann.stop();
});

test("a restart replays unsent changes as they were made", async () => {
  const { hub, server } = setUp("ann");
  const database: TestDatabase = memoryDatabase();
  const first = hub.client("ann", database);
  await first.start();
  await settle();
  hub.offline.add("ann");
  first.transact(note("offline"), "ann");
  first.archive("Note", "offline", "ann");
  await settle();
  const archivedAt = first.pool.get("Note", "offline")?.archivedAtMs;
  first.stop();
  await new Promise((resolve) => setTimeout(resolve, 5));

  const second = hub.client("ann", database);
  await second.start();
  expect(second.pool.get("Note", "offline")?.archivedAtMs).toBe(archivedAt);
  hub.offline.delete("ann");
  await settle();
  second.queue.dequeue();
  await settle();
  expect(server.models.Note.get("offline")).toBeDefined();
  second.stop();
});

// --- Ephemeral values ---

test("an ephemeral value reaches whoever can see its record, and nobody else", async () => {
  const { hub, server } = setUp("ann", "bob", "cat");
  const [ann, bob, cat] = await started(hub, "ann", "bob", "cat");
  ann.transact(note("n", "Team only", "t"), "ann");
  await settle();
  const before = server.lastSyncId;
  ann.setEphemeral("Note", "n", "viewing", true);
  await settle();
  expect([...bob.ephemeralOf("Note", "n", "viewing").values()]).toEqual([
    expect.objectContaining({ userId: "ann", value: true }),
  ]);
  expect(cat.ephemeralOf("Note", "n", "viewing").size).toBe(0);
  expect(ann.ephemeralOf("Note", "n", "viewing").size).toBe(0);
  // Nothing was written.
  expect(server.lastSyncId).toBe(before);
});

// --- The wire, telemetry and tokens ---

test("a bootstrap streams as lines, and a cut-off one is refused", () => {
  const { server } = setUp("ann");
  server.execute({ actorId: "ann", transactions: [note("n")] }, { userId: "ann" });
  const text = [...encodeBootstrap(server.bootstrap({ userId: "ann" }))].join("");
  const decoded = decodeBootstrap<TestModels>(text);
  expect(decoded.models.Note?.map((record) => record.id)).toEqual(["n"]);
  // Models that don't load at start aren't there; one with nothing in it is, empty.
  expect(decoded.models.Comment).toBeUndefined();
  const bare = createServer();
  expect(
    decodeBootstrap<TestModels>([...encodeBootstrap(bare.bootstrap({ admin: true }))].join(""))
      .models.Note,
  ).toEqual([]);
  expect(decoded.epoch).toBe(server.epoch);
  const lines = text.trim().split("\n");
  expect(() => decodeBootstrap(lines.slice(0, -1).join("\n"))).toThrow("ended early");
  expect(() => decodeBootstrap(lines.slice(1).join("\n"))).toThrow("missing");
});

test("the server reports commits, refusals and compaction", () => {
  const events: ServerEvent[] = [];
  const server = createServer(
    undefined,
    () => 1_000,
    (event) => events.push(event),
  );
  seedUsers(server, "ann");
  server.execute({ actorId: "ann", transactions: [note("n")] }, { userId: "ann" });
  expect(() =>
    server.execute({ actorId: "ann", transactions: [editNote("missing", {})] }, { userId: "ann" }),
  ).toThrow();
  server.compact({ keepActions: 0 });
  expect(events.map((event) => event.type)).toEqual([
    "committed",
    "committed",
    "refused",
    "compacted",
  ]);
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
