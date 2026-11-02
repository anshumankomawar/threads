import { computed, makeObservable, observable, runInAction } from "mobx";
import {
  MODEL_NAMES,
  SCHEMA_HASH,
  toThreads,
  type BootstrapResponse,
  type DeltasResponse,
  type EntryCreate,
  type Person,
  type PersonChanges,
  type Schedule,
  type SyncAction,
  type SyncMessage,
  type Thread,
  type ThreadChanges,
  type ThreadKind,
  type TransactionBatch,
  type TransactionBatchResponse,
} from "model";
import type { StoredModel, SyncDatabase } from "./database";
import { ObjectPool } from "./objectPool";
import {
  BaseTransaction,
  CreationTransaction,
  TransactionQueue,
  MoveTransaction,
  UpdateTransaction,
} from "./transactions";

// How the client reaches a server: HTTP for bootstrapping, catch-up and transactions, and a socket for delta packets.
export type Transport = {
  bootstrap(): Promise<BootstrapResponse>;
  deltas(after: number): Promise<DeltasResponse>;
  // Throws RejectedError when the server refuses the batch, and any other error when it can't be reached.
  send(batch: TransactionBatch): Promise<TransactionBatchResponse>;
  // Starts the workspace over: deletes every thread and schedule, keeping its people.
  reset(): Promise<unknown>;
  connect(handlers: {
    onOpen: () => void;
    onMessage: (message: SyncMessage) => void;
    onClose: () => void;
  }): {
    close(): void;
  };
};

export type NewThread = {
  kind: ThreadKind;
  title: string;
  // Its description (`descriptionOf`), shown under the title; empty for none.
  description: string;
  assignee: Person | null;
  invitees: Person[];
  schedule: Schedule | null;
  // The thread this one branches off from.
  branchedFromId?: string | null;
  // The thread this one blocks (`/blocked`).
  blocksId?: string | null;
  // Messages moved in from the parent to open the thread, in place of a description.
  movedEntryIds?: string[];
  // Who's really asking, when you're making it for someone else.
  onBehalfOf?: Person | null;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RECONNECT_MS = 10_000;

// The client half of the sync engine, after Linear's SyncClient. It bootstraps the object pool (from the local
// database when it can, else from the server), keeps a socket open for delta packets, applies them in sync id
// order, and sends this client's changes as transactions through the TransactionQueue.
export class SyncClient {
  // "bootstrapping" until the pool is loaded, "waiting" while the server can't be reached for a first load.
  status: "bootstrapping" | "waiting" | "ready" = "bootstrapping";
  connected = false;
  lastSyncId = 0;
  // When the pool first loaded. Activity by others after it is new to the user.
  readyAtMs = 0;
  error: string | null = null;

  readonly pool = new ObjectPool();
  readonly queue: TransactionQueue;
  readonly #transport: Transport;
  readonly #openDatabase: () => Promise<SyncDatabase>;
  #database: SyncDatabase | undefined;
  #socket: { close(): void } | undefined;
  #reconnectMs = 1000;
  #reconnect: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #run = 0;
  // Delta packets are applied one at a time, in arrival order.
  #updateLock: Promise<void> = Promise.resolve();

  constructor(transport: Transport, openDatabase: () => Promise<SyncDatabase>) {
    this.#transport = transport;
    this.#openDatabase = openDatabase;
    this.queue = new TransactionQueue({
      pool: this.pool,
      // The database opens during start; transactions only begin after that.
      database: {
        putTransactions: (list) => this.#db().putTransactions(list),
        deleteTransactions: (ids) => this.#db().deleteTransactions(ids),
      },
      send: (batch) => this.#transport.send(batch),
      onRejected: (error) => runInAction(() => (this.error = error.message)),
      utcOffsetMinutes: () => -new Date().getTimezoneOffset(),
      lastSyncId: () => this.lastSyncId,
    });
    makeObservable(this, {
      status: observable,
      connected: observable,
      lastSyncId: observable,
      readyAtMs: observable,
      error: observable,
      threads: computed,
      people: computed,
    });
  }

  #db(): SyncDatabase {
    if (this.#database === undefined) throw new Error("The sync database isn't open yet");
    return this.#database;
  }

  // The pool's threads with their references resolved, as the app renders them.
  get threads(): Thread[] {
    const { maps } = this.pool;
    return toThreads(maps.Thread.values(), maps.Entry.values(), maps.Person);
  }

  get people(): Person[] {
    return [...this.pool.maps.Person.values()];
  }

  // Starts (or restarts) syncing. Each run gets a token; a run that's been stopped or superseded bails at its next
  // step, so a quick stop and start (as React StrictMode does in development) leaves exactly one live run.
  async start(): Promise<void> {
    const run = ++this.#run;
    this.#stopped = false;
    this.queue.resume();
    runInAction(() => {
      this.pool.clear();
      this.queue.clear();
      this.status = "bootstrapping";
    });
    const database = await this.#openDatabase();
    if (run !== this.#run) return database.close();
    this.#database = database;
    const meta = await database.meta();
    if (run !== this.#run) return;
    if (meta !== undefined && meta.schemaHash === SCHEMA_HASH) {
      // Local bootstrap: the last confirmed data, then catch up over the socket.
      const models = await database.models();
      if (run !== this.#run) return;
      runInAction(() => {
        for (const model of models) this.pool.set(model.modelName, model.data);
        this.lastSyncId = meta.lastSyncId;
        this.#markReady();
      });
    } else {
      await this.#fullBootstrap(run);
    }
    if (run !== this.#run) return;
    const stored = await database.transactions();
    if (run !== this.#run) return;
    runInAction(() =>
      this.queue.restore(
        stored.map((transaction) => BaseTransaction.fromSerializedData(transaction)),
      ),
    );
    this.#connect();
  }

  #markReady(): void {
    if (this.status !== "ready") this.readyAtMs = Date.now();
    this.status = "ready";
  }

  // Loads everything from the server, retrying until it answers.
  // Wipes the workspace's threads and schedules (people and the org stay), drops anything still unsent, and loads
  // the clean copy straight away rather than waiting for the socket to notice.
  async wipe(): Promise<void> {
    await this.#transport.reset();
    runInAction(() => this.queue.clear());
    await this.#db().deleteTransactions(
      (await this.#db().transactions()).map((transaction) => transaction.id),
    );
    await this.#fullBootstrap();
  }

  async #fullBootstrap(run = this.#run): Promise<void> {
    while (run === this.#run) {
      try {
        const response = await this.#transport.bootstrap();
        if (run !== this.#run) return;
        const models: StoredModel[] = MODEL_NAMES.flatMap((modelName) =>
          response.models[modelName].map((data) => ({ modelName, id: data.id, data })),
        );
        await this.#db().reset(models, {
          lastSyncId: response.lastSyncId,
          schemaHash: SCHEMA_HASH,
        });
        runInAction(() => {
          this.pool.clear();
          for (const model of models) this.pool.set(model.modelName, model.data);
          for (const transaction of this.queue.pending) transaction.apply(this.pool);
          this.lastSyncId = response.lastSyncId;
          this.#markReady();
          this.error = null;
        });
        return;
      } catch (error) {
        runInAction(() => {
          if (this.status !== "ready") this.status = "waiting";
          this.error = String(error);
        });
        await sleep(1000);
      }
    }
  }

  #connect(): void {
    if (this.#stopped) return;
    this.#socket = this.#transport.connect({
      onOpen: () => {
        this.#reconnectMs = 1000;
        runInAction(() => (this.connected = true));
        this.queue.online = true;
        this.queue.dequeue();
      },
      onMessage: (message) => {
        this.#updateLock = this.#updateLock
          .then(() => this.#handle(message))
          .catch((error: unknown) => console.error("Sync failed", error));
      },
      onClose: () => {
        runInAction(() => (this.connected = false));
        this.queue.online = false;
        if (this.#stopped) return;
        clearTimeout(this.#reconnect);
        this.#reconnect = setTimeout(() => this.#connect(), this.#reconnectMs);
        this.#reconnectMs = Math.min(this.#reconnectMs * 2, MAX_RECONNECT_MS);
      },
    });
  }

  async #handle(message: SyncMessage): Promise<void> {
    if (message.type === "delta") return this.applyDelta(message.actions);
    if (message.lastSyncId < this.lastSyncId) {
      // The server is behind this cache, so its data was reset: start over from it.
      this.queue.clear();
      await this.#fullBootstrap();
    } else if (message.lastSyncId > this.lastSyncId) {
      // Missed changes while away.
      const { actions } = await this.#transport.deltas(this.lastSyncId);
      await this.applyDelta(actions);
    }
  }

  // Applies a delta packet: saves the confirmed models, updates the pool with pending local edits rebased on top,
  // advances lastSyncId, and completes transactions waiting for it.
  async applyDelta(actions: SyncAction[]): Promise<void> {
    const fresh = actions.filter((action) => action.id > this.lastSyncId);
    const [first] = fresh;
    if (first === undefined) return;
    if (first.id > this.lastSyncId + 1) {
      // A gap: fetch everything since the last applied action instead.
      const { actions: missing } = await this.#transport.deltas(this.lastSyncId);
      if (missing[0]?.id === this.lastSyncId + 1) return this.applyDelta(missing);
      return;
    }
    const lastSyncId = fresh[fresh.length - 1].id;
    await this.#db().applyActions(fresh, { lastSyncId, schemaHash: SCHEMA_HASH });
    runInAction(() => {
      for (const action of fresh) {
        if (action.data === null) {
          this.pool.delete(action.modelName, action.modelId);
          continue;
        }
        let record = action.data;
        for (const update of this.queue.updatesFor(action.modelName, action.modelId, action.id))
          record = update.rebase(record);
        this.pool.set(action.modelName, record);
      }
      this.lastSyncId = lastSyncId;
    });
    this.queue.progressQueue(lastSyncId);
  }

  // --- Changes ---

  #enqueue(transaction: BaseTransaction): void {
    runInAction(() => {
      this.error = null;
      this.queue.enqueue(transaction);
    });
  }

  // A thread and its description (or the messages moved in to open it), sent together. Returns its id.
  createThread(draft: NewThread, me: Person): string {
    const threadId = crypto.randomUUID();
    this.#enqueue(
      new CreationTransaction(
        {
          id: crypto.randomUUID(),
          type: "create",
          modelName: "Thread",
          data: {
            id: threadId,
            kind: draft.kind,
            title: draft.title.trim().slice(0, 200),
            assigneeId: draft.assignee?.id ?? null,
            attendeeIds: draft.invitees.map((person) => person.id),
            schedule: draft.schedule,
            branchedFromId: draft.branchedFromId ?? null,
            blocksId: draft.blocksId ?? null,
            onBehalfOfId: draft.onBehalfOf?.id ?? null,
          },
        },
        me.id,
      ),
    );
    if (draft.movedEntryIds !== undefined) this.moveMessages(draft.movedEntryIds, threadId, me);
    else if (draft.description.trim() !== "")
      this.addEntry(threadId, "message", draft.description, me, threadId);
    return threadId;
  }

  moveMessages(entryIds: string[], threadId: string, me: Person): void {
    this.#enqueue(
      new MoveTransaction(
        { id: crypto.randomUUID(), type: "move", modelName: "Entry", entryIds, threadId },
        me.id,
      ),
    );
  }

  // Changes your own profile; the server refuses anyone else's.
  updatePerson(changes: PersonChanges, me: Person): void {
    this.#enqueue(
      new UpdateTransaction(
        { id: crypto.randomUUID(), type: "update", modelName: "Person", modelId: me.id, changes },
        me.id,
      ),
    );
  }

  updateThread(threadId: string, changes: ThreadChanges, me: Person): void {
    this.#enqueue(
      new UpdateTransaction(
        {
          id: crypto.randomUUID(),
          type: "update",
          modelName: "Thread",
          modelId: threadId,
          changes,
        },
        me.id,
      ),
    );
  }

  // `id` is given only for a thread's description, which takes the thread's id.
  addEntry(
    threadId: string,
    kind: EntryCreate["kind"],
    text: string,
    me: Person,
    id: string = crypto.randomUUID(),
  ): void {
    this.#enqueue(
      new CreationTransaction(
        {
          id: crypto.randomUUID(),
          type: "create",
          modelName: "Entry",
          data: { id, threadId, kind, text },
        },
        me.id,
      ),
    );
  }

  stop(): void {
    this.#run += 1;
    this.#stopped = true;
    clearTimeout(this.#reconnect);
    this.queue.stop();
    this.#socket?.close();
    this.#database?.close();
  }
}
