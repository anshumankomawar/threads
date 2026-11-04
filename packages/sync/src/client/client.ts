import { makeObservable, observable, runInAction, type ObservableMap } from "mobx";
import type { ClientMutations } from "../mutations";
import {
  ALL_GROUPS,
  visibleIn,
  type AnyRecord,
  type BootstrapResponse,
  type BuiltInTransaction,
  type ClientMessage,
  type DeltasResponse,
  type LoadRequest,
  type LoadResponse,
  type ModelName,
  type Models,
  type ModelSet,
  type SyncAction,
  type SyncMessage,
  type TransactionBatch,
  type TransactionBatchResponse,
  type TransactionEnvelope,
} from "../protocol";
import {
  loadStrategy,
  modelNames,
  schemaHash,
  syncGroupsOf,
  type Lookup,
  type SyncSchema,
} from "../schema";
import { loadKey, type StoredMeta, type StoredModel, type SyncDatabase } from "./database";
import { ObjectPool } from "./pool";
import { jittered, Transaction, TransactionQueue } from "./transactions";
import { UndoQueue } from "./undo";

// How a client reaches its server: HTTP for bootstrapping, catching up, loading and transactions, and a socket for delta
// packets and ephemeral values. `send` throws `RejectedError` when the server refuses a batch, `UnauthorizedError` when
// the session isn't accepted, and anything else when the server can't be reached. `connect` calls its handlers only after
// it returns, as a WebSocket's events do.
export type Transport<M extends Models, T extends TransactionEnvelope> = {
  bootstrap(onlyGroups?: string[]): Promise<BootstrapResponse<M>>;
  deltas(after: number): Promise<DeltasResponse<M>>;
  load(requests: LoadRequest[]): Promise<LoadResponse<M>>;
  send(batch: TransactionBatch<T | BuiltInTransaction<M>>): Promise<TransactionBatchResponse>;
  connect(handlers: {
    onOpen: () => void;
    onMessage: (message: SyncMessage<M>) => void;
    onClose: () => void;
  }): { close(): void; send(message: ClientMessage): void };
};

// What the client reports as it works, for logs and metrics.
export type ClientEvent =
  | { type: "bootstrapped"; kind: "local" | "full"; models: number }
  | { type: "caughtUp"; actions: number }
  | { type: "groupsChanged"; added: string[]; removed: string[] }
  | { type: "loaded"; keys: string[]; models: number }
  | { type: "rejected"; message: string; transactions: number }
  | { type: "stuck"; message: string }
  | { type: "outdated" };

export type ClientOptions<M extends Models, T extends TransactionEnvelope> = {
  schema: SyncSchema<M>;
  mutations: ClientMutations<M, T>;
  transport: Transport<M, T>;
  openDatabase: () => Promise<SyncDatabase<M, T | BuiltInTransaction<M>>>;
  onEvent?: (event: ClientEvent) => void;
  // How long to wait before reconnecting, doubling from `minMs` up to `maxMs` while it keeps failing.
  reconnect?: { minMs: number; maxMs: number };
  // How long to wait before resending changes after a failure, likewise.
  retry?: { minMs: number; maxMs: number };
};

// An ephemeral value as this client last heard it: from whom (null for an admin session) and when.
export type EphemeralValue = { userId: string | null; value: unknown; receivedAtMs: number };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const OUTDATED = "This version of the app is out of date. Update it to keep syncing.";
const RECONNECT = { minMs: 1000, maxMs: 10_000 };
const key = (modelName: string, id: string): string => `${modelName}:${id}`;

type PendingLoad = { request: LoadRequest; resolve: () => void; reject: (error: unknown) => void };

// The client half of the sync engine, after Linear's SyncClient. It bootstraps the object pool (from the local database
// when it can, else from the server), keeps a socket open for delta packets, applies them in sync id order, follows the
// session's sync groups as they change, loads lazy and partial models when asked (`hydrate`), sends this client's
// changes through the TransactionQueue, and keeps an undo queue of them.
export class SyncClient<M extends Models, T extends TransactionEnvelope = TransactionEnvelope> {
  // "bootstrapping" until the pool is loaded, "waiting" while the server can't be reached for a first load, and
  // "outdated" once the server says it runs a newer schema: this client stops syncing until it's updated.
  status: "bootstrapping" | "waiting" | "ready" | "outdated" = "bootstrapping";
  connected = false;
  lastSyncId = 0;
  // When the pool first loaded.
  readyAtMs = 0;
  error: string | null = null;
  // Why the change at the front of the queue is stuck (the server keeps failing on it), until it's retried or discarded
  // (`retryStuck`, `discardStuck`); everything after it waits.
  stuck: string | null = null;
  syncGroups: string[] = [];
  epoch = "";
  // Ephemeral values by `modelName:modelId:key`, then by who set them.
  readonly ephemeral: ObservableMap<string, ReadonlyMap<string, EphemeralValue>> = observable.map(
    undefined,
    { deep: false },
  );

  readonly schema: SyncSchema<M>;
  readonly schemaHash: string;
  readonly pool: ObjectPool<M>;
  readonly queue: TransactionQueue<M, T>;
  readonly undoQueue: UndoQueue<M, T>;
  readonly #options: ClientOptions<M, T>;
  #database: SyncDatabase<M, T | BuiltInTransaction<M>> | undefined;
  #socket: ReturnType<Transport<M, T>["connect"]> | undefined;
  #reconnectMs: number;
  #reconnect: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #run = 0;
  // Delta packets, catch-ups, group changes and loads are applied one at a time, in order (LSE's updateLock).
  #updateLock: Promise<void> = Promise.resolve();
  // Records loaded after the client's position (by a partial bootstrap or a load), with the sync id they're current to:
  // older actions for them are skipped.
  readonly #fresher = new Map<string, number>();
  // The lazy and partial loads this client holds (`loadKey`), and those asked for but not yet sent (LSE's batch loader
  // collects a tick's worth into one request).
  readonly #loaded = new Set<string>();
  readonly #loading = new Map<string, Promise<void>>();
  #pendingLoads: PendingLoad[] = [];

  constructor(options: ClientOptions<M, T>) {
    this.#options = options;
    this.#reconnectMs = (options.reconnect ?? RECONNECT).minMs;
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
      schemaHash: this.schemaHash,
      retry: options.retry,
      onRejected: (error, transactions) => {
        runInAction(() => (this.error = error.message));
        this.#event({
          type: "rejected",
          message: error.message,
          transactions: transactions.length,
        });
        void this.#locked(() => this.#confirm(transactions));
      },
      onStuck: (message) => {
        runInAction(() => (this.stuck = message));
        if (message !== null) this.#event({ type: "stuck", message });
      },
      onOutdated: () => this.#outdated(),
      utcOffsetMinutes: () => -new Date().getTimezoneOffset(),
      lastSyncId: () => this.lastSyncId,
    });
    this.undoQueue = new UndoQueue(this.queue);
    makeObservable(this, {
      status: observable,
      connected: observable,
      lastSyncId: observable,
      readyAtMs: observable,
      error: observable,
      stuck: observable,
      syncGroups: observable,
    });
  }

  #db(): SyncDatabase<M, T | BuiltInTransaction<M>> {
    if (this.#database === undefined) throw new Error("The sync database isn't open yet");
    return this.#database;
  }

  #meta(lastSyncId = this.lastSyncId): StoredMeta {
    return {
      lastSyncId,
      schemaHash: this.schemaHash,
      epoch: this.epoch,
      // A plain copy: the observable array can't be stored in IndexedDB.
      syncGroups: [...this.syncGroups],
    };
  }

  #event(event: ClientEvent): void {
    this.#options.onEvent?.(event);
  }

  // --- Starting ---

  // Starts (or restarts) syncing. Each run gets a token; a run that's been stopped or superseded bails at its next step,
  // so a quick stop and start (as React StrictMode does in development) leaves exactly one live run.
  async start(): Promise<void> {
    const run = ++this.#run;
    this.#stopped = false;
    this.queue.resume();
    runInAction(() => {
      this.pool.clear();
      this.queue.clear();
      this.undoQueue.clear();
      this.status = "bootstrapping";
    });
    this.#loaded.clear();
    const database = await this.#options.openDatabase();
    if (run !== this.#run) return database.close();
    this.#database = database;
    const meta = await database.meta();
    if (run !== this.#run) return;
    if (meta !== undefined && meta.schemaHash === this.schemaHash && meta.epoch !== undefined) {
      // Local bootstrap: the last confirmed data, then catch up over the socket.
      const [models, loaded] = await Promise.all([database.models(), database.loaded()]);
      if (run !== this.#run) return;
      for (const held of loaded) this.#loaded.add(held);
      runInAction(() => {
        this.lastSyncId = meta.lastSyncId;
        this.epoch = meta.epoch;
        this.syncGroups = meta.syncGroups;
        for (const model of models)
          if (this.#covered(model.modelName, model.data))
            this.pool.set(model.modelName, model.data);
        this.#markReady();
      });
      this.#event({ type: "bootstrapped", kind: "local", models: models.length });
    } else {
      await this.#fullBootstrap(run);
    }
    if (run !== this.#run) return;
    const stored = await database.transactions();
    if (run !== this.#run) return;
    runInAction(() =>
      this.queue.restore(
        stored.map((saved) => Transaction.restore(saved, this.#options.mutations)),
      ),
    );
    this.#connect();
  }

  #markReady(): void {
    if (this.status !== "ready") this.readyAtMs = Date.now();
    this.status = "ready";
  }

  // Loads everything that loads at start from the server, retrying until it answers, rebuilds the pool with pending
  // changes on top, and loads again what had been loaded lazily or partially.
  async #fullBootstrap(run = this.#run): Promise<void> {
    // What was loaded lazily or partially, to load again once the rest is in, however many tries that takes.
    const reload = [...this.#loaded];
    let waitMs = 1000;
    while (run === this.#run) {
      try {
        const response = await this.#options.transport.bootstrap();
        if (run !== this.#run) return;
        if (response.schemaHash !== this.schemaHash) return this.#outdated();
        const models = this.#modelsOf(response.models);
        runInAction(() => {
          this.lastSyncId = response.lastSyncId;
          this.epoch = response.epoch;
          this.syncGroups = response.syncGroups;
        });
        this.#fresher.clear();
        this.#loaded.clear();
        await this.#db().reset(models, this.#meta());
        // Changes the server has already confirmed are in what it sent; only the rest go back on top.
        this.queue.progressQueue(this.lastSyncId);
        runInAction(() => {
          this.pool.clear();
          for (const model of models) this.pool.set(model.modelName, model.data);
          this.queue.reapply();
          this.#markReady();
          this.error = null;
        });
        this.#event({ type: "bootstrapped", kind: "full", models: models.length });
        if (reload.length > 0) await this.#fetch(reload.map(requestOf));
        return;
      } catch (error) {
        runInAction(() => {
          if (this.status !== "ready") this.status = "waiting";
          this.error = String(error);
        });
        // Waiting longer each time, and not in step with every other client waiting on the same server.
        await sleep(jittered(waitMs));
        waitMs = Math.min(waitMs * 2, 30_000);
      }
    }
  }

  #modelsOf(set: ModelSet<M>): StoredModel<M>[] {
    return modelNames(this.schema).flatMap((modelName) =>
      // A server that hasn't been updated yet may not send every model.
      (set[modelName] ?? []).map((data) => ({
        modelName,
        id: data.id,
        data: data as AnyRecord<M>,
      })),
    );
  }

  // Whether a record belongs in the pool: a model that loads at start always does; a lazy one once it's loaded; a
  // partial one once a load covers it (one of its partial indexes); and anything a pending change of this client's
  // touches, so its own edits always show.
  #covered(modelName: ModelName<M>, record: AnyRecord<M>): boolean {
    const strategy = loadStrategy(this.schema, modelName);
    if (strategy === "instant") return true;
    if (strategy === "lazy") return this.#loaded.has(loadKey(modelName));
    const fields = record as Record<string, unknown>;
    return (this.schema.models[modelName].partialIndexes ?? []).some((index) =>
      this.#loaded.has(loadKey(modelName, index, String(fields[index]))),
    );
  }

  // --- The socket ---

  #connect(): void {
    if (this.#stopped) return;
    const socket = this.#options.transport.connect({
      onOpen: () => {
        if (this.#socket !== socket) return;
        this.#reconnectMs = (this.#options.reconnect ?? RECONNECT).minMs;
        runInAction(() => (this.connected = true));
        this.queue.online = true;
        this.queue.dequeue();
      },
      onMessage: (message) => {
        if (this.#socket !== socket) return;
        if (message.type === "ephemeral") return this.#receiveEphemeral(message);
        // A step that fails (the server unreachable mid catch-up, say) can't just be dropped: the packet's changes, or
        // a change of groups, would be lost. Reconnecting starts again from a handshake, which settles everything.
        // Checked again when its turn comes: once a step has failed and the socket is abandoned, the packets queued
        // behind it are skipped too (the handshake after reconnecting covers them), never applied out of turn.
        this.#locked(async () => {
          if (this.#socket === socket) await this.#handle(message);
        }).catch(() => {
          socket.close();
          this.#lost(socket);
        });
      },
      onClose: () => this.#lost(socket),
    });
    this.#socket = socket;
  }

  // The connection is gone: everything that needs it waits, and it reconnects after a backoff.
  #lost(socket: ReturnType<Transport<M, T>["connect"]>): void {
    if (this.#socket !== socket) return;
    this.#socket = undefined;
    runInAction(() => {
      this.connected = false;
      // Ephemeral values are only good while connected.
      this.ephemeral.clear();
    });
    this.queue.online = false;
    if (this.#stopped) return;
    clearTimeout(this.#reconnect);
    this.#reconnect = setTimeout(() => this.#connect(), jittered(this.#reconnectMs));
    this.#reconnectMs = Math.min(
      this.#reconnectMs * 2,
      (this.#options.reconnect ?? RECONNECT).maxMs,
    );
  }

  // Runs work after everything queued before it, one at a time. A failure is the caller's to handle; the lock moves on.
  #locked(work: () => Promise<void>): Promise<void> {
    const next = this.#updateLock.then(work);
    this.#updateLock = next.catch(() => {});
    return next;
  }

  async #handle(message: Exclude<SyncMessage<M>, { type: "ephemeral" }>): Promise<void> {
    if (message.type === "handshake") {
      if (message.schemaHash !== this.schemaHash) return this.#outdated();
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
    // Already applied, for example caught up past it. A socket delivers packets in order and can't lose one without
    // closing, and every reconnect handshakes, so anything missed is caught up there.
    if (message.lastSyncId <= this.lastSyncId) return;
    if (message.syncGroups !== undefined) await this.#followGroups(message.syncGroups);
    await this.applyDelta(message.actions, message.lastSyncId);
  }

  // Fetches and applies everything after this client's sync id. When the server's log no longer reaches back that far,
  // or its data started over, that's a full bootstrap instead: a gap that can't be filled never leaves a client stuck.
  async #catchUp(): Promise<void> {
    const response = await this.#options.transport.deltas(this.lastSyncId);
    if (response.schemaHash !== this.schemaHash) return this.#outdated();
    if ("fullBootstrapRequired" in response || response.epoch !== this.epoch)
      return this.#fullBootstrap();
    await this.#followGroups(response.syncGroups);
    await this.applyDelta(response.actions, response.lastSyncId);
    this.#event({ type: "caughtUp", actions: response.actions.length });
  }

  // Follows a change in this session's sync groups: loads what's in groups it joined (a partial bootstrap) and drops
  // what's only in groups it left, from the pool and the database alike.
  async #followGroups(next: string[]): Promise<void> {
    const current = this.syncGroups;
    const added = next.filter((group) => !current.includes(group));
    const removed = current.filter((group) => !next.includes(group));
    if (added.length === 0 && removed.length === 0) return;
    this.#event({ type: "groupsChanged", added, removed });
    // Gaining every group at once is simplest as a fresh start.
    if (added.includes(ALL_GROUPS)) return this.#fullBootstrap();
    let loaded: StoredModel<M>[] = [];
    let loadedAt = this.lastSyncId;
    if (added.length > 0 && !current.includes(ALL_GROUPS)) {
      const response = await this.#options.transport.bootstrap(added);
      loadedAt = response.lastSyncId;
      loaded = this.#modelsOf(response.models);
    }
    // The models of groups it left go (LSE removes them on leaving), from the database and the pool alike. Each is judged
    // by the server's copy where there is one (a pending change of this client's mustn't decide it), else by the pool's:
    // the pool can hold this client's own new records there that the database never got.
    const dropped: SyncAction<M>[] = [];
    if (removed.length > 0) {
      const records = new Map<string, { modelName: ModelName<M>; data: AnyRecord<M> }>();
      for (const model of await this.#db().models())
        records.set(key(model.modelName, model.id), {
          modelName: model.modelName,
          data: model.data,
        });
      for (const modelName of modelNames(this.schema))
        for (const data of this.pool.maps[modelName].values())
          if (!records.has(key(modelName, data.id)))
            records.set(key(modelName, data.id), { modelName, data: data as AnyRecord<M> });
      const lookup: Lookup<M> = (modelName, id) => records.get(key(modelName, id))?.data;
      for (const { modelName, data } of records.values())
        if (!visibleIn(syncGroupsOf(this.schema, modelName, data, lookup), next))
          dropped.push({ id: 0, modelName, modelId: data.id, action: "D", data: null });
    }
    runInAction(() => (this.syncGroups = next));
    await this.#db().applyActions(
      [
        ...loaded.map((model): SyncAction<M> => ({
          id: 0,
          modelName: model.modelName,
          modelId: model.id,
          action: "I",
          data: model.data,
        })),
        ...dropped,
      ],
      this.#meta(),
    );
    runInAction(() => {
      for (const model of loaded) {
        this.#fresher.set(key(model.modelName, model.id), loadedAt);
        this.#put(model.modelName, model.id, model.data, loadedAt);
      }
      for (const action of dropped) this.pool.delete(action.modelName, action.modelId);
    });
    // The slices already held may have more in them now that more is visible.
    if (added.length > 0 && this.#loaded.size > 0)
      await this.#fetch([...this.#loaded].map(requestOf), true);
  }

  // Puts a server record in the pool with this client's pending changes to it rebased on top (LSE's rebase); null
  // removes it. A new record that isn't covered (a partial model whose slice isn't loaded) stays only in the database;
  // one already in the pool stays current, so nothing on screen disappears.
  #put(modelName: ModelName<M>, id: string, data: AnyRecord<M> | null, syncId: number): void {
    const pending = this.queue.pendingFor(modelName, id, syncId);
    if (data === null) {
      // Rebased onto the deletion: a refusal of any of them won't bring the model back.
      for (const transaction of pending) transaction.rebaseDeleted(modelName, id);
      this.pool.delete(modelName, id);
      void this.queue.modelDeleted(modelName, id);
      return;
    }
    if (
      pending.length === 0 &&
      this.pool.get(modelName, id) === undefined &&
      !this.#covered(modelName, data)
    )
      return;
    let record: AnyRecord<M> | undefined = data;
    for (const transaction of pending) record = transaction.rebase(modelName, id, record);
    if (record === undefined) this.pool.delete(modelName, id);
    else this.pool.set(modelName, record);
  }

  // Applies actions up to `lastSyncId`: saves the confirmed models, updates the pool with pending local edits rebased on
  // top, advances the sync position, and completes transactions waiting for it.
  async applyDelta(actions: SyncAction<M>[], lastSyncId: number): Promise<void> {
    if (lastSyncId <= this.lastSyncId) return;
    const fresh = actions.filter((action) => {
      if (action.id <= this.lastSyncId) return false;
      const loadedAt = this.#fresher.get(key(action.modelName, action.modelId));
      return loadedAt === undefined || action.id > loadedAt;
    });
    await this.#db().applyActions(fresh, this.#meta(lastSyncId));
    runInAction(() => {
      for (const action of fresh) {
        if (action.action === "I") void this.queue.modelUpserted(action.modelName, action.modelId);
        this.#put(action.modelName, action.modelId, action.data, action.id);
      }
      this.lastSyncId = lastSyncId;
    });
    for (const [model, loadedAt] of this.#fresher)
      if (loadedAt <= lastSyncId) this.#fresher.delete(model);
    this.queue.progressQueue(lastSyncId);
  }

  // After a refused batch has rolled back, checks what it touched against the server's copy, with this client's other
  // pending changes rebased on top. Usually the rollback already left exactly that. It differs only when rollback alone
  // can't tell, such as when the record left this client's view while the change was out; the server's copy decides.
  async #confirm(refused: Transaction<M, T>[]): Promise<void> {
    const touched = new Map<string, { modelName: ModelName<M>; id: string }>();
    for (const transaction of refused)
      for (const model of transaction.touches()) touched.set(key(model.modelName, model.id), model);
    const confirmed = await Promise.all(
      [...touched.values()].map(async ({ modelName, id }) => ({
        modelName,
        id,
        stored: await this.#db().model(modelName, id),
      })),
    );
    runInAction(() => {
      for (const { modelName, id, stored } of confirmed) {
        let record = stored?.data;
        for (const transaction of this.queue.pendingFor(modelName, id, this.lastSyncId))
          record = transaction.rebase(modelName, id, record);
        if (record === undefined) this.pool.delete(modelName, id);
        else if (stored !== undefined || this.pool.get(modelName, id) !== undefined)
          this.pool.set(modelName, record);
      }
    });
  }

  // The server runs another schema than this client was built with: sending or applying anything more could misread
  // records, so syncing stops. What's on screen stays readable, and unsent changes stay saved for the updated app.
  #outdated(): void {
    this.#stopped = true;
    clearTimeout(this.#reconnect);
    this.queue.stop();
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close();
    runInAction(() => {
      this.status = "outdated";
      this.connected = false;
      this.error = OUTDATED;
    });
    this.#event({ type: "outdated" });
  }

  // Sends the stuck change again.
  retryStuck(): void {
    this.queue.retryStuck();
  }

  // Gives up on the stuck change, as if the server had refused it, and carries on with the rest.
  discardStuck(): Promise<void> {
    return this.queue.discardStuck();
  }

  dismissError(): void {
    runInAction(() => (this.error = null));
  }

  // --- Loading lazy and partial models ---

  // Whether a lazy model, or a partial model's slice, is loaded.
  isLoaded(modelName: ModelName<M>, key?: string, value?: string): boolean {
    return this.#loaded.has(loadKey(modelName, key, value));
  }

  // Loads a lazy model (`hydrate("Comment")`) or a partial model's slice (`hydrate("Entry", "threadId", id)`) into the
  // pool, from the local database when it holds it, else from the server. Loads asked for in the same tick go as one
  // request. Once loaded, the slice stays current through delta packets.
  hydrate(modelName: ModelName<M>, key?: string, value?: string): Promise<void> {
    const held = loadKey(modelName, key, value);
    if (this.#loaded.has(held)) return Promise.resolve();
    const inFlight = this.#loading.get(held);
    if (inFlight !== undefined) return inFlight;
    const loading = new Promise<void>((resolve, reject) => {
      this.#pendingLoads.push({ request: { modelName, key, value }, resolve, reject });
      if (this.#pendingLoads.length === 1)
        queueMicrotask(() => {
          const batch = this.#pendingLoads;
          this.#pendingLoads = [];
          this.#locked(() => this.#fetch(batch.map((load) => load.request))).then(
            () => batch.forEach((load) => load.resolve()),
            (error: unknown) => batch.forEach((load) => load.reject(error)),
          );
        });
    }).finally(() => this.#loading.delete(held));
    this.#loading.set(held, loading);
    return loading;
  }

  // Loads slices from the server and holds them (`again` loads ones already held, when more of them became visible),
  // inside the update lock so no packet lands halfway through. Records loaded at the server's position skip older
  // actions still on their way.
  async #fetch(requests: LoadRequest[], again = false): Promise<void> {
    const wanted = again
      ? requests
      : requests.filter(
          (request) => !this.#loaded.has(loadKey(request.modelName, request.key, request.value)),
        );
    if (wanted.length === 0) return;
    const response = await this.#options.transport.load(wanted);
    if (response.schemaHash !== this.schemaHash) return this.#outdated();
    if (response.epoch !== this.epoch) return this.#fullBootstrap();
    const models = this.#modelsOf(response.models);
    const keys = wanted.map((request) => loadKey(request.modelName, request.key, request.value));
    await this.#db().putLoaded(models, keys);
    for (const held of keys) this.#loaded.add(held);
    runInAction(() => {
      for (const model of models) {
        if (response.lastSyncId > this.lastSyncId)
          this.#fresher.set(key(model.modelName, model.id), response.lastSyncId);
        this.#put(model.modelName, model.id, model.data, response.lastSyncId);
      }
    });
    this.#event({ type: "loaded", keys, models: models.length });
  }

  // --- Ephemeral values ---

  // Tells everyone who can see a record something that isn't saved, such as that you're looking at it. Sent only while
  // connected; it's gone for them when you disconnect.
  setEphemeral(modelName: ModelName<M>, modelId: string, field: string, value: unknown): void {
    if (this.connected)
      this.#socket?.send({ type: "ephemeral", modelName, modelId, key: field, value });
  }

  // What others last told this client about a record's ephemeral field, by who told it.
  ephemeralOf(
    modelName: ModelName<M>,
    modelId: string,
    field: string,
  ): ReadonlyMap<string, EphemeralValue> {
    return this.ephemeral.get(`${modelName}:${modelId}:${field}`) ?? new Map();
  }

  #receiveEphemeral(message: Extract<SyncMessage<M>, { type: "ephemeral" }>): void {
    const slot = `${message.modelName}:${message.modelId}:${message.key}`;
    runInAction(() => {
      const values = new Map(this.ephemeral.get(slot));
      values.set(message.userId ?? "", {
        userId: message.userId,
        value: message.value,
        receivedAtMs: Date.now(),
      });
      this.ephemeral.set(slot, values);
    });
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
    runInAction(() => {
      this.queue.clear();
      this.undoQueue.clear();
    });
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
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close();
    this.#database?.close();
  }
}

// The load a key stands for.
function requestOf(held: string): LoadRequest {
  const [modelName, key, value] = held.split("|");
  return key === undefined ? { modelName } : { modelName, key, value };
}
