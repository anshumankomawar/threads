import {
  descriptionOf,
  threadsMutations,
  threadsSchema,
  type AnyRecord,
  type BuiltIn,
  type ModelName,
  type ModelRecords,
  type Person,
  type SyncMessage,
  type ThreadRecord,
  type TransactionBatch,
  type TransactionInput,
} from "model";
import { memoryDatabase, RejectedError, type SyncDatabase } from "sync/client";
import { broadcast, receive, SyncError, SyncServer, type HubSocket } from "sync/server";
import { expect, test } from "vite-plus/test";
import { ThreadsClient, type ThreadsTransport } from "../src/renderer/src/sync/syncClient";

const anshu: Person = { id: "anshu", name: "Anshu" };
const arjun: Person = { id: "arjun", name: "Arjun" };

// The sync engine's server with Threads' models, running each transaction the way the client predicts it (the real
// rules and side effects are the API's, tested there). Tests can refuse batches, hold back packets, or go offline.
class TestServer {
  readonly #sockets = new Set<HubSocket>();
  engine = this.#fresh();
  sent: TransactionBatch[] = [];
  online = true;
  refuse = false;
  holdDeltas = false;
  held: string[] = [];

  #fresh(): SyncServer<ModelRecords, TransactionInput> {
    const engine = new SyncServer<ModelRecords, TransactionInput>({
      schema: threadsSchema,
      now: () => 1,
      apply: (batch, transaction, context) => {
        if (this.refuse) throw new SyncError(400, "Thread not found");
        if (transaction.type === "delete")
          return batch.delete(transaction.modelName, transaction.modelId);
        if (transaction.type === "archive" || transaction.type === "unarchive") return;
        for (const { modelName, id } of threadsMutations.touches(transaction)) {
          const next = threadsMutations.change(
            transaction,
            modelName,
            batch.get(modelName, id),
            context,
          );
          if (next === null) batch.delete(modelName, id);
          else if (next !== undefined) batch.put(modelName, next);
        }
      },
      onCommit: (actions) => broadcast(engine, this.#sockets, actions),
    });
    engine.write((batch) => {
      batch.put("Person", anshu);
      batch.put("Person", arjun);
    });
    return engine;
  }

  // A change made on the server, for example by another client.
  change(modelName: ModelName, data: AnyRecord): number {
    this.engine.write((batch) => batch.put(modelName, data as never));
    return this.engine.lastSyncId;
  }

  release(): void {
    this.holdDeltas = false;
    for (const message of this.held.splice(0))
      for (const socket of this.#sockets) socket.send(message);
  }

  transport(): ThreadsTransport {
    const session = { admin: true } as const;
    const copy = <V>(value: V): V => JSON.parse(JSON.stringify(value)) as V;
    const offline = (): void => {
      if (!this.online) throw new Error("offline");
    };
    return {
      bootstrap: async (onlyGroups) => (
        offline(),
        copy(this.engine.bootstrap(session, onlyGroups))
      ),
      deltas: async (after) => (offline(), copy(this.engine.deltas(session, after))),
      load: async (requests) => (offline(), copy(this.engine.load(session, requests))),
      send: async (batch) => {
        offline();
        try {
          this.engine.execute(copy(batch), session);
        } catch (error) {
          throw error instanceof SyncError ? new RejectedError(error.message) : error;
        }
        this.sent.push(batch as TransactionBatch);
        return { lastSyncId: this.engine.lastSyncId };
      },
      // Starts over with just the people, like the Workspace object's reset.
      reset: async () => {
        this.engine = this.#fresh();
        return {};
      },
      connect: (handlers) => {
        const socket: HubSocket = {
          session,
          groups: ["*"],
          setGroups: () => {},
          send: (message) => {
            if (this.holdDeltas) this.held.push(message);
            else handlers.onMessage(JSON.parse(message) as SyncMessage);
          },
        };
        this.#sockets.add(socket);
        queueMicrotask(() => {
          handlers.onOpen();
          handlers.onMessage(copy(this.engine.handshake(session)));
        });
        return {
          close: () => void this.#sockets.delete(socket),
          send: (message) => receive(this.engine, this.#sockets, socket, JSON.stringify(message)),
        };
      },
    };
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

type Database = SyncDatabase<ModelRecords, TransactionInput | BuiltIn>;

async function started(server = new TestServer(), database: Database = memoryDatabase()) {
  const client = new ThreadsClient(server.transport(), async () => database);
  await client.start();
  await settle();
  return { client, server, database };
}

const draft = {
  description: "Somewhere warm",
  assignees: [arjun],
};

test("bootstraps the pool from the server and opens the socket", async () => {
  const { client, server } = await started();
  expect(client.status).toBe("ready");
  expect(client.connected).toBe(true);
  expect(client.people.map((person) => person.id)).toEqual(["anshu", "arjun"]);
  expect(client.lastSyncId).toBe(server.engine.lastSyncId);
});

test("a change shows at once, goes out in one batch per tick, and completes when its sync id arrives", async () => {
  const { client, server } = await started();
  const threadId = client.createThread({ ...draft, title: "Plan the offsite" }, anshu);
  client.updateThread(threadId, { priority: "high" }, anshu);
  // Optimistic: visible before the server has seen anything.
  expect(client.threads.find((thread) => thread.id === threadId)?.priority).toBe("high");
  await settle();
  expect(server.sent).toHaveLength(1);
  expect(server.sent[0].transactions.map((transaction) => transaction.type)).toEqual([
    "create",
    "create",
    "update",
  ]);
  expect(client.queue.pending).toEqual([]);
  expect(client.lastSyncId).toBe(server.engine.lastSyncId);
});

test("done, snoozed and bucket changes show at once, on whoever made them", async () => {
  const { client } = await started();
  const threadId = client.createThread({ ...draft, title: "Plan the offsite" }, anshu);
  client.updateThread(threadId, { done: true, snoozeUntilMs: 5, bucketId: "action" }, arjun);
  const thread = client.threads.find((candidate) => candidate.id === threadId);
  expect(thread?.doneBy).toEqual({ arjun: expect.any(Number) });
  expect(thread?.snoozedUntil).toEqual({ arjun: 5 });
  expect(thread?.triage).toEqual({
    arjun: { bucketId: "action", reason: "", manual: true, stale: false },
  });
  // None of them are fields of the thread itself.
  expect(thread).not.toHaveProperty("done");
});

test("a thread's description is a message with the thread's id, and a thread can have none", async () => {
  const { client, server } = await started();
  const described = client.createThread({ ...draft, title: "Plan the offsite" }, anshu);
  const bare = client.createThread({ ...draft, title: "Pricing", description: "  " }, anshu);
  await settle();
  const thread = client.threads.find((candidate) => candidate.id === described);
  expect(thread === undefined ? undefined : descriptionOf(thread)?.text).toBe("Somewhere warm");
  const empty = client.threads.find((candidate) => candidate.id === bare);
  expect(empty?.entries).toEqual([]);
  expect(server.sent[0].transactions.map((transaction) => transaction.modelName)).toEqual([
    "Thread",
    "Entry",
    "Thread",
  ]);
});

test("a refused batch is rolled back", async () => {
  const { client, server } = await started();
  server.refuse = true;
  const threadId = client.createThread({ ...draft, title: "Doomed" }, anshu);
  expect(client.threads.some((thread) => thread.id === threadId)).toBe(true);
  await settle();
  expect(client.threads.some((thread) => thread.id === threadId)).toBe(false);
  expect(client.error).toBe("Thread not found");
  client.dismissError();
  expect(client.error).toBeNull();
});

test("a newer server change is rebased under a pending local edit, and the local edit wins", async () => {
  const { client, server } = await started();
  const threadId = client.createThread({ ...draft, title: "Plan the offsite" }, anshu);
  await settle();
  const thread = server.engine.models.Thread.get(threadId) as ThreadRecord;

  server.online = false;
  client.updateThread(threadId, { priority: "high" }, anshu);
  // Arjun changes the same thread before ours reaches the server.
  server.change("Thread", { ...thread, priority: "low", title: "Offsite, renamed" });
  await settle();
  const local = client.threads.find((candidate) => candidate.id === threadId);
  expect(local?.title).toBe("Offsite, renamed");
  expect(local?.priority).toBe("high");
});

test("offline edits are kept, survive a restart, and send once the server is back", async () => {
  const server = new TestServer();
  const database: Database = memoryDatabase();
  const first = await started(server, database);
  server.online = false;
  const threadId = first.client.createThread({ ...draft, title: "Written offline" }, anshu);
  await settle();
  expect(await database.transactions()).toHaveLength(2);
  first.client.stop();

  // Restart from the local database while still offline: the edit is replayed onto the cached pool.
  const second = new ThreadsClient(server.transport(), async () => database);
  await second.start();
  expect(second.threads.some((thread) => thread.id === threadId)).toBe(true);

  // Its first try failed while offline; once the server is back, the next send goes through.
  await settle();
  server.online = true;
  second.queue.dequeue();
  await settle();
  expect(server.sent.at(-1)?.transactions).toHaveLength(2);
  expect(await database.transactions()).toEqual([]);
  second.stop();
});

test("what a client missed while away is caught up when it connects again", async () => {
  const server = new TestServer();
  const database: Database = memoryDatabase();
  const first = await started(server, database);
  first.client.stop();
  server.change("Person", { id: "kk", name: "KK" });
  server.change("Person", { id: "sam", name: "Sam" });
  // Back from its local cache, it hears where the server is at the handshake and fetches what it missed.
  const { client } = await started(server, database);
  expect(client.people.map((person) => person.id)).toEqual(["anshu", "arjun", "kk", "sam"]);
  expect(client.lastSyncId).toBe(server.engine.lastSyncId);
});

test("moving messages shows at once, and is undone if the server refuses it", async () => {
  const { client, server } = await started();
  const source = client.createThread({ ...draft, title: "Plan the offsite" }, anshu);
  const destination = client.createThread({ ...draft, title: "Pricing" }, anshu);
  await settle();
  server.change("Entry", {
    id: "m1",
    threadId: source,
    kind: "message",
    authorId: "arjun",
    text: "Pricing?",
    sentToIds: [],
    createdAtMs: 2,
  });
  await settle();
  const has = (threadId: string): boolean =>
    client.threads.find((thread) => thread.id === threadId)?.entries.some((e) => e.id === "m1") ??
    false;

  server.refuse = true;
  client.moveMessages(["m1"], destination, anshu);
  expect(has(destination)).toBe(true);
  await settle();
  expect([has(source), has(destination)]).toEqual([true, false]);

  server.refuse = false;
  client.moveMessages(["m1"], destination, anshu);
  await settle();
  expect([has(source), has(destination)]).toEqual([false, true]);
  expect(client.queue.pending).toEqual([]);
});

test("wiping leaves the people and clears every thread at once", async () => {
  const { client } = await started();
  client.createThread({ ...draft, title: "Plan the offsite" }, anshu);
  await settle();
  expect(client.threads).toHaveLength(1);
  await client.wipe();
  expect(client.threads).toEqual([]);
  expect(client.people.map((person) => person.id)).toEqual(["anshu", "arjun"]);
  expect(client.queue.pending).toEqual([]);
});

test("deleting your message takes it out at once, and the server's delete confirms it", async () => {
  const { client, server } = await started();
  const threadId = client.createThread({ ...draft, title: "Plan the offsite" }, anshu);
  client.addEntry(threadId, "message", "Oops", anshu, "oops");
  await settle();
  client.deleteMessage("oops", anshu);
  const has = (): boolean =>
    client.threads.find((thread) => thread.id === threadId)?.entries.some((e) => e.id === "oops") ??
    false;
  expect(has()).toBe(false);
  await settle();
  expect(server.engine.models.Entry.has("oops")).toBe(false);
  expect(has()).toBe(false);
  expect(client.queue.pending).toEqual([]);
});

test("a list is sent whole, and the later change wins", async () => {
  const { client, server } = await started();
  const threadId = client.createThread({ ...draft, title: "Plan the offsite" }, anshu);
  for (const id of ["bug", "infra"])
    server.change("Label", { id, name: id, groupId: null, createdById: null, createdAtMs: 1 });
  await settle();
  client.updateThread(threadId, { labelIds: ["bug", "infra"] }, anshu);
  await settle();
  expect(server.sent.at(-1)?.transactions[0]).toMatchObject({
    changes: { labelIds: ["bug", "infra"] },
  });
  client.updateThread(threadId, { labelIds: ["bug"] }, anshu);
  await settle();
  expect(server.engine.models.Thread.get(threadId)?.labelIds).toEqual(["bug"]);
});

test("undo puts a thread's fields, labels and your own done back, and redo does them again", async () => {
  const { client, server } = await started();
  const threadId = client.createThread({ ...draft, title: "Plan the offsite" }, anshu);
  server.change("Label", {
    id: "bug",
    name: "Bug",
    groupId: null,
    createdById: null,
    createdAtMs: 1,
  });
  await settle();
  client.undoQueue.addOperation("Triage", () =>
    client.updateThread(threadId, { priority: "high", labelIds: ["bug"], done: true }, anshu),
  );
  await settle();
  expect(server.engine.models.Thread.get(threadId)).toMatchObject({
    priority: "high",
    labelIds: ["bug"],
    doneBy: { anshu: expect.any(Number) },
  });
  client.undoQueue.undo();
  await settle();
  expect(server.engine.models.Thread.get(threadId)).toMatchObject({
    priority: "none",
    labelIds: [],
    doneBy: {},
  });
  client.undoQueue.redo();
  await settle();
  expect(server.engine.models.Thread.get(threadId)).toMatchObject({
    priority: "high",
    labelIds: ["bug"],
  });
  // Making a thread can't be undone (threads aren't deleted); sending a message is, by deleting it.
  client.undoQueue.addOperation("Thread", () =>
    client.createThread({ ...draft, title: "Another" }, anshu),
  );
  client.undoQueue.addOperation("Reply", () =>
    client.addEntry(threadId, "message", "Oops", anshu, "oops"),
  );
  await settle();
  client.undoQueue.undo();
  await settle();
  expect(server.engine.models.Entry.has("oops")).toBe(false);
});
