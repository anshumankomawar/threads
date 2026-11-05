import { openDB, type IDBPDatabase } from "idb";
import type { Row, SyncAction, TxRecord } from "protocol";
import { registry } from "./registry";

// IndexedDB in the app; the tests' in-memory one is `memoryLocalDB` in "testing".
export interface LocalDB {
  open(workspaceId: string, schemaHash: string): Promise<"fresh" | "existing">;
  load(model: string): Promise<Row[]>;
  write(actions: SyncAction[]): Promise<void>; // server-approved data only
  meta: { get(): Promise<{ lastSyncId: number }>; set(m: { lastSyncId: number }): Promise<void> };
  outbox: {
    put(txs: TxRecord[]): Promise<void>;
    remove(id: string): Promise<void>;
    all(): Promise<TxRecord[]>;
  };
  wipe(): Promise<void>;
}

const META = "_meta";
const OUTBOX = "_outbox";

// One IndexedDB database per workspace: a store per model, plus `_meta` and `_outbox` (in the order it was saved).
export function indexedLocalDB(): LocalDB {
  let db: IDBPDatabase;
  let schemaHash = "";
  const models = () => registry.all().map((meta) => meta.name);
  const clear = async (stores: string[]) => {
    const tx = db.transaction(stores, "readwrite");
    await Promise.all([...stores.map((store) => tx.objectStore(store).clear()), tx.done]);
  };
  return {
    async open(workspace, hash) {
      schemaHash = hash;
      const name = `sync:${workspace}`;
      db = await openDB(name);
      const missing = [...models(), META, OUTBOX].filter(
        (store) => !db.objectStoreNames.contains(store),
      );
      if (missing.length > 0) {
        db.close();
        db = await openDB(name, db.version + 1, {
          upgrade(upgrading) {
            for (const store of missing)
              if (store === OUTBOX)
                upgrading.createObjectStore(store, { autoIncrement: true }).createIndex("id", "id");
              else
                upgrading.createObjectStore(store, store === META ? undefined : { keyPath: "id" });
          },
        });
      }
      if ((await db.get(META, "meta"))?.schemaHash === hash) return "existing";
      await clear([...models(), META, OUTBOX]);
      return "fresh";
    },
    load: (model) => db.getAll(model),
    async write(actions) {
      // An IndexedDB transaction needs at least one store.
      if (actions.length === 0) return;
      const tx = db.transaction([...new Set(actions.map((action) => action.model))], "readwrite");
      for (const { model, modelId, data } of actions)
        void (data ? tx.objectStore(model).put(data) : tx.objectStore(model).delete(modelId));
      await tx.done;
    },
    meta: {
      get: async () => ({ lastSyncId: (await db.get(META, "meta"))?.lastSyncId ?? 0 }),
      set: async ({ lastSyncId }) => void (await db.put(META, { lastSyncId, schemaHash }, "meta")),
    },
    outbox: {
      async put(txs) {
        const tx = db.transaction(OUTBOX, "readwrite");
        for (const record of txs) void tx.store.add(record);
        await tx.done;
      },
      remove: async (id) => db.delete(OUTBOX, (await db.getKeyFromIndex(OUTBOX, "id", id))!),
      all: () => db.getAll(OUTBOX),
    },
    wipe: () => clear([...models(), META]),
  };
}
