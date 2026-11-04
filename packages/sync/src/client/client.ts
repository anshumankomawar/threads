import { makeObservable, observable, runInAction } from "mobx";
import {
  ALL_GROUPS,
  visibleIn,
  type AnyRecord,
  type BootstrapResponse,
  type BuiltInTransaction,
  type DeltasResponse,
  type ModelName,
  type Models,
  type SyncAction,
  type SyncMessage,
  type TransactionBatch,
  type TransactionBatchResponse,
  type TransactionEnvelope,
} from "../protocol";
import { modelNames, schemaHash, syncGroupsOf, type SyncSchema } from "../schema";
import type { StoredMeta, StoredModel, SyncDatabase } from "./database";
import { ObjectPool } from "./pool";
import type { ClientMutations } from "../mutations";
import { Transaction, TransactionQueue } from "./transactions";

// How a client reaches its server: HTTP for bootstrapping, catching up and transactions, and a socket for delta
// packets. `send` throws `RejectedError` when the server refuses a batch, `UnauthorizedError` when the session isn't
// accepted, and anything else when the server can't be reached.
export type Transport<M extends Models, T extends TransactionEnvelope> = {
  bootstrap(onlyGroups?: string[]): Promise<BootstrapResponse<M>>;
  deltas(after: number): Promise<DeltasResponse<M>>;
  send(batch: TransactionBatch<T | BuiltInTransaction<M>>): Promise<TransactionBatchResponse>;
  connect(handlers: {
    onOpen: () => void;
    onMessage: (message: SyncMessage<M>) => void;
    onClose: () => void;
  }): { close(): void };
};

export type ClientOptions<M extends Models, T extends TransactionEnvelope> = {
  schema: SyncSchema<M>;
  mutations: ClientMutations<M, T>;
  transport: Transport<M, T>;
  openDatabase: () => Promise<SyncDatabase<M, T | BuiltInTransaction<M>>>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RECONNECT_MS = 10_000;
const key = (modelName: string, id: string): string => `${modelName}:${id}`;

// The client half of the sync engine, after Linear's SyncClient. It bootstraps the object pool (from the local
// database when it can, else from the server), keeps a socket open for delta packets, applies them in sync id order,
// follows the session's sync groups as they change, and sends this client's changes through the TransactionQueue.
export class SyncClient<M extends Models, T extends TransactionEnvelope = TransactionEnvelope> {
  // "bootstrapping" until the pool is loaded, "waiting" while the server can't be reached for a first load.
  status: "bootstrapping" | "waiting" | "ready" = "bootstrapping";
  connected = false;
  lastSyncId = 0;
  // When the pool first loaded.
  readyAtMs = 0;
  error: string | null = null;
  syncGroups: string[] = [];
  epoch = "";

  readonly schema: SyncSchema<M>;
  readonly schemaHash: string;
  readonly pool: ObjectPool<M>;
  readonly queue: TransactionQueue<M, T>;
  readonly #options: ClientOptions<M, T>;
  #database: SyncDatabase<M, T | BuiltInTransaction<M>> | undefined;
  #socket: { close(): void } | undefined;
  #reconnectMs = 1000;
  #reconnect: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #run = 0;
  // Delta packets and catch-ups are applied one at a time, in order (LSE's updateLock).
  #updateLock: Promise<void> = Promise.resolve();
  // Models loaded by a partial bootstrap, with the sync id they're current to: older actions for them are skipped.
  readonly #fresher = new Map<string, number>();

  constructor(options: ClientOptions<M, T>) {
    this.#options = options;
    this.schema = options.schema;
    this.schemaHash = schemaHash(options.schema);
    this.pool = new ObjectPool(options.schema);
    this.queue = new TransactionQueue<M, T>({
      pool: this.pool,
      // The database opens during start; transactions only begin after that.
      database: {
        putTransactions: (list) => this.#db().putTransactions(list),
        deleteTransactions: (ids) => this.#db().deleteTransactions(ids),
      },
      send: (batch) => options.transport.send(batch),
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
      syncGroups: observable,
    });
  }

  #db(): SyncDatabase<M, T | BuiltInTransaction<M>> {
    if (this.#database === undefined) throw new Error("The sync database isn't open yet");
    return this.#database;
  }

  #meta(): StoredMeta {
    return {
      lastSyncId: this.lastSyncId,
      schemaHash: this.schemaHash,
      epoch: this.epoch,
      // A plain copy: the observable array can't be stored in IndexedDB.
      syncGroups: [...this.syncGroups],
    };
  }

  // --- Starting ---

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
    const database = await this.#options.openDatabase();
    if (run !== this.#run) return database.close();
    this.#database = database;
    const meta = await database.meta();
    if (run !== this.#run) return;
    if (meta !== undefined && meta.schemaHash === this.schemaHash && meta.epoch !== undefined) {
      // Local bootstrap: the last confirmed data, then catch up over the socket.
      const models = await database.models();
      if (run !== this.#run) return;
      runInAction(() => {
        for (const model of models) this.pool.set(model.modelName, model.data);
        this.lastSyncId = meta.lastSyncId;
        this.epoch = meta.epoch;
        this.syncGroups = meta.syncGroups ?? [];
        this.#markReady();
      });
    } else {
      await this.#fullBootstrap(run);
    }
    if (run !== this.#run) return;
    const stored = await database.transactions();
    if (run !== this.#run) return;
    const restored = stored.map((saved) => {
      const transaction = new Transaction<M, T>(
        saved.input,
        saved.actorId,
        this.#options.mutations,
      );
      transaction.batchIndex = saved.batchIndex;
      return transaction;
    });
    runInAction(() => this.queue.restore(restored));
    this.#connect();
  }

  #markReady(): void {
    if (this.status !== "ready") this.readyAtMs = Date.now();
    this.status = "ready";
  }

  // Loads everything from the server, retrying until it answers, and rebuilds the pool with pending changes on top.
  async #fullBootstrap(run = this.#run): Promise<void> {
    while (run === this.#run) {
      try {
        const response = await this.#options.transport.bootstrap();
        if (run !== this.#run) return;
        const models = this.#modelsOf(response);
        runInAction(() => {
          this.lastSyncId = response.lastSyncId;
          this.epoch = response.epoch;
          this.syncGroups = response.syncGroups;
        });
        this.#fresher.clear();
        await this.#db().reset(models, this.#meta());
        runInAction(() => {
          this.pool.clear();
          for (const model of models) this.pool.set(model.modelName, model.data);
          this.queue.reapply();
          this.#markReady();
          this.error = null;
        });
        this.queue.progressQueue(this.lastSyncId);
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

  #modelsOf(response: BootstrapResponse<M>): StoredModel<M>[] {
    return modelNames(this.schema).flatMap((modelName) =>
      // A server that hasn't been updated yet may not send every model.
      (response.models[modelName] ?? []).map((data) => ({
        modelName,
        id: data.id,
        data: data as AnyRecord<M>,
      })),
    );
  }

  // --- The socket ---

  #connect(): void {
    if (this.#stopped) return;
    this.#socket = this.#options.transport.connect({
      onOpen: () => {
        this.#reconnectMs = 1000;
        runInAction(() => (this.connected = true));
        this.queue.online = true;
        this.queue.dequeue();
      },
      onMessage: (message) => this.#locked(() => this.#handle(message)),
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

  #locked(work: () => Promise<void>): Promise<void> {
    this.#updateLock = this.#updateLock
      .then(work)
      .catch((error: unknown) => console.error("Sync failed", error));
    return this.#updateLock;
  }

  async #handle(message: SyncMessage<M>): Promise<void> {
    if (message.type === "handshake") {
      // Another life of the server's data (it was reset), a server behind this cache, or a log that no longer reaches
      // back to where this cache is: start over from the server.
      if (
        message.epoch !== this.epoch ||
        message.lastSyncId < this.lastSyncId ||
        this.lastSyncId < message.minSyncId
      )
        return this.#fullBootstrap();
      await this.#followGroups(message.syncGroups);
      if (message.lastSyncId > this.lastSyncId) await this.#catchUp();
      return;
    }
    // Already applied, for example caught up past it.
    if (message.lastSyncId <= this.lastSyncId) return;
    // A gap: a packet went missing, so fetch everything since the last one applied instead.
    if (message.fromSyncId > this.lastSyncId) return this.#catchUp();
    if (message.syncGroups !== undefined) await this.#followGroups(message.syncGroups);
    await this.applyDelta(message.actions, message.lastSyncId);
  }

  // Fetches and applies everything after this client's sync id. When the server's log no longer reaches back that far,
  // or its data started over, that's a full bootstrap instead: a gap that can't be filled never leaves a client stuck.
  async #catchUp(): Promise<void> {
    const response = await this.#options.transport.deltas(this.lastSyncId);
    if ("fullBootstrapRequired" in response || response.epoch !== this.epoch)
      return this.#fullBootstrap();
    await this.#followGroups(response.syncGroups);
    await this.applyDelta(response.actions, response.lastSyncId);
  }

  // Follows a change in this session's sync groups: loads what's in groups it joined (a partial bootstrap) and drops
  // what's only in groups it left.
  async #followGroups(next: string[]): Promise<void> {
    const current = this.syncGroups;
    const added = next.filter((group) => !current.includes(group));
    const removed = current.filter((group) => !next.includes(group));
    if (added.length === 0 && removed.length === 0) return;
    // Gaining every group at once is simplest as a fresh start.
    if (added.includes(ALL_GROUPS)) return this.#fullBootstrap();
    const loaded: SyncAction<M>[] = [];
    let loadedAt = this.lastSyncId;
    if (added.length > 0 && !current.includes(ALL_GROUPS)) {
      const response = await this.#options.transport.bootstrap(added);
      loadedAt = response.lastSyncId;
      for (const model of this.#modelsOf(response))
        loaded.push({
          id: 0,
          modelName: model.modelName,
          modelId: model.id,
          action: "I",
          data: model.data,
        });
    }
    const dropped: SyncAction<M>[] = [];
    if (removed.length > 0)
      for (const modelName of modelNames(this.schema))
        for (const record of this.pool.maps[modelName].values())
          if (!visibleIn(syncGroupsOf(this.schema, modelName, record as AnyRecord<M>), next))
            dropped.push({ id: 0, modelName, modelId: record.id, action: "D", data: null });
    runInAction(() => (this.syncGroups = next));
    await this.#db().applyActions([...loaded, ...dropped], this.#meta());
    runInAction(() => {
      for (const action of loaded) {
        this.#fresher.set(key(action.modelName, action.modelId), loadedAt);
        this.#put(action.modelName, action.modelId, action.data, loadedAt);
      }
      for (const action of dropped) this.pool.delete(action.modelName, action.modelId);
    });
  }

  // Puts a server record in the pool with pending local changes rebased on top; null removes it.
  #put(modelName: ModelName<M>, id: string, data: AnyRecord<M> | null, syncId: number): void {
    if (data === null) {
      this.pool.delete(modelName, id);
      void this.queue.modelDeleted(modelName, id);
      return;
    }
    let record: AnyRecord<M> | null = data;
    for (const transaction of this.queue.pendingFor(modelName, id, syncId)) {
      if (record === null) break;
      record = transaction.rebase(modelName, record);
    }
    if (record === null) this.pool.delete(modelName, id);
    else this.pool.set(modelName, record);
  }

  // Applies actions up to `lastSyncId`: saves the confirmed models, updates the pool with pending local edits rebased
  // on top, advances the sync position, and completes transactions waiting for it.
  async applyDelta(actions: SyncAction<M>[], lastSyncId: number): Promise<void> {
    if (lastSyncId <= this.lastSyncId) return;
    const fresh = actions.filter((action) => {
      if (action.id <= this.lastSyncId) return false;
      const loadedAt = this.#fresher.get(key(action.modelName, action.modelId));
      return loadedAt === undefined || action.id > loadedAt;
    });
    await this.#db().applyActions(fresh, { ...this.#meta(), lastSyncId });
    runInAction(() => {
      for (const action of fresh)
        this.#put(action.modelName, action.modelId, action.data, action.id);
      this.lastSyncId = lastSyncId;
    });
    for (const [model, loadedAt] of this.#fresher)
      if (loadedAt <= lastSyncId) this.#fresher.delete(model);
    this.queue.progressQueue(lastSyncId);
  }

  dismissError(): void {
    runInAction(() => (this.error = null));
  }

  // --- Changes ---

  // Makes a change: applied to the pool at once, sent with whatever else is made this tick.
  transact(input: T | BuiltInTransaction<M>, actorId: string): void {
    runInAction(() => {
      this.error = null;
      this.queue.enqueue(new Transaction<M, T>(input, actorId, this.#options.mutations));
    });
  }

  delete(modelName: ModelName<M>, modelId: string, actorId: string): void {
    this.transact({ id: crypto.randomUUID(), type: "delete", modelName, modelId }, actorId);
  }

  archive(modelName: ModelName<M>, modelId: string, actorId: string): void {
    this.transact({ id: crypto.randomUUID(), type: "archive", modelName, modelId }, actorId);
  }

  unarchive(modelName: ModelName<M>, modelId: string, actorId: string): void {
    this.transact({ id: crypto.randomUUID(), type: "unarchive", modelName, modelId }, actorId);
  }

  // Throws away everything unsent and loads afresh, such as after the server's data was wiped on purpose.
  async discardAndReload(): Promise<void> {
    runInAction(() => this.queue.clear());
    await this.#db().deleteTransactions(
      (await this.#db().transactions()).map((stored) => stored.id),
    );
    await this.#locked(() => this.#fullBootstrap());
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
