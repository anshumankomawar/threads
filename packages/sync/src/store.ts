import type { Transport } from "./http";
import type { LocalDB } from "./local-db";
import { unarchived, type Core, type Model } from "./model";
import { ObjectPool } from "./pool";
import { registry, type ModelClass } from "./registry";
import { memo } from "./signals";
import { SyncClient } from "./sync-client";
import { TransactionQueue, type Timer, type Transaction } from "./transactions";

export interface UndoQueue {
  group(label: string, fn: () => void): void; // every save() inside = one undo step
  undo(): void;
  redo(): void; // v1: stubs, added after the core works
}

// Named server actions and their arguments; a product declares its own by merging into this interface.
export interface ServerActions {}

export interface Store {
  create<T extends Model>(
    type: ModelClass<T>,
    fields: Partial<T>,
  ): T & { transaction: Transaction };
  findById<T extends Model>(type: ModelClass<T>, id: string): T | undefined;
  all<T extends Model>(type: ModelClass<T>, opts?: { includeArchived?: boolean }): T[];
  where<T extends Model>(type: ModelClass<T>, index: keyof T, value: unknown): T[];
  view<R>(fn: () => R): () => R;
  action<A extends keyof ServerActions>(name: A, args: ServerActions[A]): Promise<void>;
  undo: UndoQueue;
  readonly connection: () => "connecting" | "live" | "offline";
  readonly pendingCount: () => number;
  ready(): Promise<void>;
}

// Starts loading at once: from the local database when it has this workspace, else from the server; then connects.
// `setTimeout` drives every retry and reconnect, so a simulation can control them.
export function createStore({
  transport,
  localDB,
  workspace,
  token,
  setTimeout = (fn, ms) => globalThis.setTimeout(fn, ms),
}: {
  transport: Transport;
  localDB: LocalDB;
  workspace: string;
  token: string;
  setTimeout?: Timer;
}): Store {
  const pool = new ObjectPool();
  const core: Core = {
    pool,
    materialize: (name, row) => {
      const model = new (registry.classOf(name))();
      model.__data = { ...row };
      model.__store = core;
      return model;
    },
    enqueue: (kind, model, changes, original) =>
      queue.enqueue({
        id: crypto.randomUUID(),
        kind,
        model: model.__meta.name,
        modelId: model.id,
        changes,
        original,
        batch: queue.batch,
      }),
  };
  const queue = new TransactionQueue({
    core,
    localDB,
    transport,
    setTimeout,
    waitForSyncId: (id) => sync.waitForSyncId(id),
    lastSyncId: () => sync.lastSyncId,
  });
  const sync = new SyncClient({ core, queue, transport, localDB, workspace, token, setTimeout });
  const started = sync.bootstrap().then(() => sync.connect());

  return {
    create<T extends Model>(type: ModelClass<T>, fields: Partial<T>) {
      const { name, fields: meta } = type.prototype.__meta;
      const now = Date.now();
      const row = Object.fromEntries(
        Object.keys(meta)
          .filter((field) => meta[field].kind === "property")
          .map((field) => [field, null]),
      );
      const model = core.materialize(name, {
        ...row,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      }) as T;
      Object.assign(model, fields);
      model.__original = {};
      pool.put(model);
      return Object.assign(model, {
        transaction: core.enqueue("create", model, { ...model.__data }),
      });
    },
    findById: <T extends Model>(_type: ModelClass<T>, id: string) => pool.get(id) as T | undefined,
    all: <T extends Model>(type: ModelClass<T>, opts?: { includeArchived?: boolean }) => {
      const models = pool.all(type.prototype.__meta.name) as T[];
      return opts?.includeArchived ? models : unarchived(models);
    },
    where: <T extends Model>(type: ModelClass<T>, index: keyof T, value: unknown) =>
      unarchived(pool.byIndex(type.prototype.__meta.name, index as string, value) as T[]),
    view: memo,
    async action(name, args) {
      const { lastSyncId } = await transport.action(name, args);
      await sync.waitForSyncId(lastSyncId);
    },
    undo: { group: (_label, fn) => fn(), undo() {}, redo() {} },
    connection: sync.connection,
    pendingCount: queue.pendingCount,
    ready: () => started,
  };
}
