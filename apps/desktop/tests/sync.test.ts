import {
  descriptionOf,
  SCHEMA_HASH,
  threadFromCreate,
  type AnyRecord,
  type EntryRecord,
  type ModelName,
  type Person,
  type SyncAction,
  type SyncMessage,
  type ThreadRecord,
  type TransactionBatch,
} from "model";
import { expect, test } from "vite-plus/test";
import { memoryDatabase, type SyncDatabase } from "../src/renderer/src/sync/database";
import { SyncClient, type Transport } from "../src/renderer/src/sync/syncClient";
import { RejectedError } from "../src/renderer/src/sync/transactions";

const anshu: Person = { id: "anshu", name: "Anshu" };
const arjun: Person = { id: "arjun", name: "Arjun" };

// A stand-in server: it numbers every change with the next sync id and pushes delta packets to the connected
// client, like the Workspace Durable Object. Tests can hold back packets, refuse batches, or go offline.
class FakeServer implements Transport {
  lastSyncId = 0;
  log: SyncAction[] = [];
  sent: TransactionBatch[] = [];
  online = true;
  refuse = false;
  holdDeltas = false;
  held: SyncMessage[] = [];
  #handlers: Parameters<Transport["connect"]>[0] | undefined;

  constructor() {
    this.change("Person", anshu);
    this.change("Person", arjun);
  }

  // A change made on the server, for example by another client.
  change(modelName: ModelName, data: AnyRecord): SyncAction {
    const action: SyncAction = {
      id: ++this.lastSyncId,
      modelName,
      modelId: data.id,
      action: this.log.some((logged) => logged.modelId === data.id) ? "U" : "I",
      data,
    };
    this.log.push(action);
    this.push({ type: "delta", lastSyncId: action.id, actions: [action] });
    return action;
  }

  push(message: SyncMessage): void {
    if (this.holdDeltas) this.held.push(message);
    else this.#handlers?.onMessage(message);
  }

  async bootstrap() {
    if (!this.online) throw new Error("offline");
    const latest = new Map<string, SyncAction>();
    for (const action of this.log) latest.set(`${action.modelName}:${action.modelId}`, action);
    const models = {
      Person: [],
      Thread: [],
      Entry: [],
      Organization: [],
      Label: [],
      Group: [],
    } as Record<ModelName, AnyRecord[]>;
    for (const action of latest.values())
      if (action.data) models[action.modelName].push(action.data);
    return {
      lastSyncId: this.lastSyncId,
      schemaHash: SCHEMA_HASH,
      models: models as never,
    };
  }

  async deltas(after: number) {
    return { lastSyncId: this.lastSyncId, actions: this.log.filter((action) => action.id > after) };
  }

  // Starts over with just the people, like the Workspace object's reset.
  async reset() {
    this.log = [];
    this.lastSyncId = 0;
    this.change("Person", anshu);
    this.change("Person", arjun);
    return { lastSyncId: this.lastSyncId };
  }

  async send(batch: TransactionBatch) {
    if (!this.online) throw new Error("offline");
    if (this.refuse) throw new RejectedError("Thread not found");
    this.sent.push(batch);
    // Runs the transactions the way the real engine does, minus side effects.
    for (const transaction of batch.transactions) {
      if (transaction.type === "create" && transaction.modelName === "Thread")
        this.change("Thread", threadFromCreate(transaction.data, batch.actorId, 1));
      else if (transaction.type === "update" && transaction.modelName === "Thread") {
        const current = [...this.log]
          .reverse()
          .find((action) => action.modelId === transaction.modelId);
        this.change("Thread", { ...(current?.data as ThreadRecord), ...transaction.changes });
      } else if (transaction.type === "move")
        for (const entryId of transaction.entryIds) {
          const current = [...this.log].reverse().find((action) => action.modelId === entryId);
          this.change("Entry", {
            ...(current?.data as EntryRecord),
            threadId: transaction.threadId,
          });
        }
    }
    return { lastSyncId: this.lastSyncId };
  }

  connect(handlers: Parameters<Transport["connect"]>[0]) {
    this.#handlers = handlers;
    queueMicrotask(() => {
      handlers.onOpen();
      handlers.onMessage({ type: "handshake", lastSyncId: this.lastSyncId });
    });
    return { close: () => (this.#handlers = undefined) };
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function started(server = new FakeServer(), database: SyncDatabase = memoryDatabase()) {
  const client = new SyncClient(server, async () => database);
  await client.start();
  await settle();
  return { client, server, database };
}

const draft = {
  description: "Somewhere warm",
  assignees: [arjun],
};

test("bootstraps the pool from the server and opens the socket", async () => {
  const { client } = await started();
  expect(client.status).toBe("ready");
  expect(client.connected).toBe(true);
  expect(client.people.map((person) => person.id)).toEqual(["anshu", "arjun"]);
  expect(client.lastSyncId).toBe(2);
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
  expect(client.lastSyncId).toBe(server.lastSyncId);
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
  const thread = server.log.at(-1)?.data as ThreadRecord;

  server.holdDeltas = true;
  client.updateThread(threadId, { priority: "high" }, anshu);
  // Arjun changes the same thread before ours reaches the server.
  server.holdDeltas = false;
  server.change("Thread", { ...thread, priority: "low", title: "Offsite, renamed" });
  await settle();
  const local = client.threads.find((candidate) => candidate.id === threadId);
  expect(local?.title).toBe("Offsite, renamed");
  expect(local?.priority).toBe("high");
});

test("offline edits are kept, survive a restart, and send once the server is back", async () => {
  const server = new FakeServer();
  const database = memoryDatabase();
  const first = await started(server, database);
  server.online = false;
  const threadId = first.client.createThread({ ...draft, title: "Written offline" }, anshu);
  await settle();
  expect(await database.transactions()).toHaveLength(2);
  first.client.stop();

  // Restart from the local database while still offline: the edit is replayed onto the cached pool.
  const second = new SyncClient(server, async () => database);
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

test("a gap in sync ids is filled from the server's log", async () => {
  const { client, server } = await started();
  server.holdDeltas = true;
  const missed = server.change("Person", { id: "kk", name: "KK" });
  server.holdDeltas = false;
  server.change("Person", { id: "sam", name: "Sam" });
  await settle();
  expect(missed.id).toBeLessThan(server.lastSyncId);
  expect(client.people.map((person) => person.id)).toEqual(["anshu", "arjun", "kk", "sam"]);
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
