// Randomized: several clients make conflicting changes while packets are lost, clients go offline, restart, undo, and
// the log is compacted under them. However it goes, once everyone's back every client must hold exactly what the server
// says it may see, with nothing left pending.
import { expect, test } from "vite-plus/test";
import { memoryDatabase } from "../src/client";
import {
  comment,
  createServer,
  editNote,
  Hub,
  note,
  seedUsers,
  settle,
  txId,
  type TestClient,
  type TestDatabase,
} from "./harness";

// A small seeded generator (mulberry32), so a failing run can be replayed.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERS = ["ann", "bob", "cat"];
const TAGS = ["red", "blue", "green"];

const sorted = <R extends { id: string }>(records: Iterable<R>): R[] =>
  [...records].sort((a, b) => a.id.localeCompare(b.id));

async function run(seed: number, steps: number): Promise<void> {
  const next = random(seed);
  const pick = <V>(list: V[]): V => list[Math.floor(next() * list.length)];
  const server = createServer();
  seedUsers(server, ...USERS);
  server.write((batch) => batch.put("Team", { id: "t", memberIds: ["ann", "bob"] }));
  const hub = new Hub(server);
  const databases = new Map<string, TestDatabase>(USERS.map((user) => [user, memoryDatabase()]));
  const clients = new Map<string, TestClient>();
  const start = async (user: string): Promise<void> => {
    const client = hub.client(user, databases.get(user));
    clients.set(user, client);
    await client.start();
  };
  for (const user of USERS) await start(user);
  await settle();
  let notes = 0;

  for (let step = 0; step < steps; step++) {
    const user = pick(USERS);
    const client = clients.get(user) as TestClient;
    const visible = [...client.pool.maps.Note.values()];
    const target = visible.length > 0 ? pick(visible) : undefined;
    const roll = next();
    if (roll < 0.15)
      client.transact(note(`n${++notes}`, `note ${notes}`, next() < 0.6 ? "t" : null), user);
    else if (roll < 0.3 && target !== undefined)
      client.transact(editNote(target.id, { text: `edit ${step}` }), user);
    else if (roll < 0.45 && target !== undefined)
      client.undoQueue.addOperation("tag", () =>
        client.transact(
          editNote(
            target.id,
            next() < 0.5
              ? { tagIds: { $add: [pick(TAGS)] } }
              : { tagIds: { $remove: [pick(TAGS)] } },
          ),
          user,
        ),
      );
    else if (roll < 0.52 && target !== undefined) {
      client.transact(comment(`c${step}`, target.id), user);
      // Loading fails while offline; the test only cares that whatever loads is right.
      client.hydrate("Comment", "noteId", target.id).catch(() => {});
    } else if (roll < 0.57 && target !== undefined) client.delete("Note", target.id, user);
    else if (roll < 0.62 && target !== undefined)
      if (target.archivedAtMs) client.unarchive("Note", target.id, user);
      else client.archive("Note", target.id, user);
    else if (roll < 0.67 && target !== undefined)
      client.transact(editNote(target.id, { teamId: target.teamId === null ? "t" : null }), user);
    else if (roll < 0.72) client.undoQueue.undo();
    else if (roll < 0.76)
      client.transact(
        {
          id: txId(),
          type: "update",
          modelName: "Team",
          modelId: "t",
          changes:
            next() < 0.5
              ? { memberIds: { $add: [pick(USERS)] } }
              : { memberIds: { $remove: [pick(USERS)] } },
        },
        user,
      );
    else if (roll < 0.82) {
      // Lose packets for a while, or go offline.
      const socket = Array.from(hub.sockets).find(
        (candidate) => "userId" in candidate.session && candidate.session.userId === user,
      );
      if (socket !== undefined) socket.paused = !socket.paused;
    } else if (roll < 0.87) {
      if (hub.offline.has(user)) hub.offline.delete(user);
      else hub.offline.add(user);
    } else if (roll < 0.9) {
      client.stop();
      await start(user);
    } else if (roll < 0.92) server.compact({ keepActions: Math.floor(next() * 20) });
    if (next() < 0.4) await settle();
  }

  // Everyone back: online, every packet flowing, every queue sent, and a change now and then so everyone catches up,
  // until nobody has anything left to do.
  hub.offline.clear();
  for (let round = 0; round < 40; round++) {
    for (const socket of hub.sockets) socket.paused = false;
    for (const client of clients.values()) client.queue.dequeue();
    await settle();
    server.write((batch) => batch.put("User", { id: "ann", name: `ann ${round}` }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await settle();
    const quiet = [...clients.values()].every(
      (client) =>
        client.connected &&
        client.queue.pending.length === 0 &&
        client.lastSyncId === server.lastSyncId,
    );
    if (quiet) break;
  }

  for (const [user, client] of clients) {
    const session = { userId: user };
    const expected = server.bootstrap(session).models;
    expect(client.queue.pending, `${user} has nothing pending (seed ${seed})`).toEqual([]);
    expect(client.lastSyncId, `${user} is caught up (seed ${seed})`).toBe(server.lastSyncId);
    for (const modelName of ["User", "Note", "Team"] as const)
      expect(
        sorted<{ id: string }>(client.pool.maps[modelName].values()),
        `${user}'s ${modelName}s (seed ${seed})`,
      ).toEqual(sorted<{ id: string }>(expected[modelName] ?? []));
    // Every comment it holds is one the server has and lets it see, as the server has it.
    const comments = server.load(session, [{ modelName: "Comment" }]).models.Comment ?? [];
    for (const held of client.pool.maps.Comment.values())
      expect(held, `${user}'s comment ${held.id} (seed ${seed})`).toEqual(
        comments.find((candidate) => candidate.id === held.id),
      );
    for (const loaded of new Set([...client.pool.maps.Comment.values()].map((held) => held.noteId)))
      if (client.isLoaded("Comment", "noteId", loaded))
        expect(
          sorted([...client.pool.maps.Comment.values()].filter((held) => held.noteId === loaded)),
          `${user}'s comments on ${loaded} (seed ${seed})`,
        ).toEqual(sorted(comments.filter((candidate) => candidate.noteId === loaded)));
  }
  for (const client of clients.values()) client.stop();
}

for (let seed = 1; seed <= 12; seed++)
  test(`clients converge whatever happens (seed ${seed})`, () => run(seed, 160), 60_000);
