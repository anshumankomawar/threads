import type { DeltasResponse, Row, SyncAction } from "protocol";
import type { Transport } from "./http";
import type { LocalDB } from "./local-db";
import { write, type Core } from "./model";
import { registry } from "./registry";
import { cell } from "./signals";
import { backoff, type Timer, type TransactionQueue } from "./transactions";

type Change = { model: string; modelId: string; data?: Row };

const insert = (model: string, row: Row): SyncAction => ({
  id: 0,
  txId: "",
  model,
  modelId: row.id,
  action: "I",
  data: row,
});

type SyncOptions = {
  core: Core;
  queue: TransactionQueue;
  transport: Transport;
  localDB: LocalDB;
  workspace: string;
  token: string;
  setTimeout: Timer;
};

// Loads the pool, keeps it current from the socket, and tells the queue what the server confirmed.
export class SyncClient {
  lastSyncId = 0;
  readonly connection = cell<"connecting" | "live" | "offline">("connecting");
  readonly #o: SyncOptions;
  #lock = Promise.resolve();
  #waiters: { id: number; resolve: () => void }[] = [];
  #attempt = 0;

  constructor(options: SyncOptions) {
    this.#o = options;
  }

  async bootstrap(): Promise<void> {
    const { localDB, transport, queue, workspace } = this.#o;
    if ((await localDB.open(workspace, registry.schemaHash)) === "fresh")
      for (let attempt = 0; ; attempt++)
        try {
          return await this.#full();
        } catch {
          await new Promise<void>((retry) => this.#o.setTimeout(retry, backoff(attempt)));
        }
    const loaded = await Promise.all(
      registry
        .all()
        .map(async ({ name }) => (await localDB.load(name)).map((row) => insert(name, row))),
    );
    this.#update(loaded.flat(), (await localDB.meta.get()).lastSyncId);
    await queue.replayOutbox();
    // Offline, the socket's Hello catches up once it connects. A server behind this cache has started over.
    await transport
      .deltas(this.lastSyncId)
      .then((packet) =>
        packet.lastSyncId < this.lastSyncId
          ? this.#locked(() => this.#full())
          : this.applyDelta(packet),
      )
      .catch(() => {});
  }

  connect(): void {
    this.connection.set("connecting");
    let failed = false;
    const socket = this.#o.transport.connect({
      hello: () => {
        this.#attempt = 0;
        this.connection.set("live");
        return { type: "hello", lastSyncId: this.lastSyncId, token: this.#o.token };
      },
      // A step that fails can't be skipped: what came after it waits for a new Hello.
      onMessage: (message) =>
        void this.#locked(async () => {
          if (failed) return;
          try {
            await (message.type === "delta" ? this.#apply(message) : this.#full());
          } catch {
            failed = true;
            socket.close();
          }
        }),
      onClose: () => {
        this.connection.set("offline");
        // After what the socket left running (a full load), so the next Hello says where the data really is.
        this.#o.setTimeout(
          () => void this.#lock.then(() => this.connect()),
          backoff(this.#attempt++),
        );
      },
    });
  }

  applyDelta(packet: DeltasResponse): Promise<void> {
    return this.#locked(() => this.#apply(packet));
  }

  waitForSyncId(id: number): Promise<void> {
    if (id <= this.lastSyncId) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push({ id, resolve }));
  }

  async #apply(packet: DeltasResponse): Promise<void> {
    if (packet.lastSyncId <= this.lastSyncId) return;
    let { actions, lastSyncId } = packet;
    actions = actions.filter((action) => action.id > this.lastSyncId);
    // Ids filtered out by sync groups look like gaps too; the fetch confirms nothing visible is missing.
    if (actions.length > 0 && actions[0].id !== this.lastSyncId + 1) {
      ({ actions, lastSyncId } = await this.#o.transport.deltas(this.lastSyncId));
      // The server holds us back when our groups changed: the next Hello says so.
      if (lastSyncId < packet.lastSyncId) throw new Error("Groups changed");
    }
    await this.#o.localDB.write(actions);
    await this.#o.localDB.meta.set({ lastSyncId });
    this.#update(actions, lastSyncId);
  }

  #locked(work: () => Promise<void>): Promise<void> {
    const run = this.#lock.then(work);
    this.#lock = run.catch(() => {});
    return run;
  }

  // A full load: everything the server holds for this session replaces local data. The outbox stays.
  async #full(): Promise<void> {
    const { transport, localDB, core } = this.#o;
    const { rows, end } = await transport.bootstrap();
    const inserts = rows.map(({ model, row }) => insert(model, row));
    await localDB.wipe();
    await localDB.write(inserts);
    await localDB.meta.set({ lastSyncId: end.lastSyncId });
    const kept = new Set(rows.map(({ row }) => row.id));
    const removed = core.pool
      .ids()
      // A local create the server hasn't confirmed isn't the server's to remove.
      .filter((id) => !kept.has(id) && core.pool.get(id)!.isPersisted)
      .map((id) => ({ model: core.pool.get(id)!.__meta.name, modelId: id }));
    this.#update([...inserts, ...removed], end.lastSyncId);
  }

  // Server rows into the pool, then pending transactions and unsaved edits back on top, then the new position.
  #update(changes: Change[], lastSyncId: number): void {
    const { core, queue } = this.#o;
    const unsaved = new Map<string, [string, unknown][]>();
    for (const { model: name, modelId, data } of changes) {
      const model = core.pool.get(modelId);
      if (model && !unsaved.has(modelId))
        unsaved.set(
          modelId,
          model.changedFields.map((field) => [field, model.__data[field]]),
        );
      if (!data) core.pool.remove(modelId);
      else if (!model) {
        const fresh = core.materialize(name, data);
        fresh.__persisted = true;
        core.pool.put(fresh);
      } else {
        for (const field in data) write(model, field, data[field]);
        model.__persisted = true;
      }
    }
    for (const modelId of new Set(changes.map((change) => change.modelId))) {
      queue.onDelta(modelId, lastSyncId);
      const model = core.pool.get(modelId);
      if (model)
        for (const [field, value] of unsaved.get(modelId) ?? []) {
          model.__original[field] = model.__data[field];
          write(model, field, value);
        }
    }
    this.lastSyncId = lastSyncId;
    const ready = this.#waiters.filter((waiter) => waiter.id <= lastSyncId);
    this.#waiters = this.#waiters.filter((waiter) => waiter.id > lastSyncId);
    for (const waiter of ready) waiter.resolve();
  }
}
