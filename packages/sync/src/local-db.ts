import { openDB, type IDBPDatabase, type IDBPTransaction } from "idb";
import type { Row, SyncAction, TxRecord } from "protocol";
import { registry } from "./registry";

// Where the local data is up to: its sync id, the sync groups it holds, and those it follows without being in them.
export type Meta = { lastSyncId: number; groups: string[]; subscribed: string[] };

// IndexedDB in the app; the tests' in-memory one is `memoryLocalDB` in "testing".
export interface LocalDB {
  open(workspaceId: string, schemaHash: string): Promise<"fresh" | "existing">;
  load(model: string): Promise<Row[]>;
  // Server-approved data and where it brings the local data to, in one step: a crash between them can't leave rows a
  // position doesn't account for.
  write(actions: SyncAction[], meta: Meta): Promise<void>;
  // Everything the server sent instead of what's here, in one step (the outbox stays): a crash part way can't leave a
  // database with no position, which the next start would take for a new one and clear, outbox and all.
  replace(actions: SyncAction[], meta: Meta): Promise<void>;
  meta: { get(): Promise<Meta>; set(meta: Meta): Promise<void> };
  outbox: {
    put(txs: TxRecord[]): Promise<void>;
    remove(id: string): Promise<void>;
    all(): Promise<TxRecord[]>;
  };
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
  const store = (
    tx: IDBPTransaction<unknown, string[], "readwrite">,
    actions: SyncAction[],
    meta: Meta,
  ) => {
    for (const { model, modelId, data } of actions)
      void (data ? tx.objectStore(model).put(data) : tx.objectStore(model).delete(modelId));
    void tx.objectStore(META).put({ ...meta, schemaHash }, "meta");
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
    async write(actions, meta) {
      const tx = db.transaction(
        [...new Set(actions.map((action) => action.model)), META],
        "readwrite",
      );
      store(tx, actions, meta);
      await tx.done;
    },
    async replace(actions, meta) {
      const tx = db.transaction([...models(), META], "readwrite");
      for (const model of models()) void tx.objectStore(model).clear();
      store(tx, actions, meta);
      await tx.done;
    },
    meta: {
      get: async () =>
        (await db.get(META, "meta")) ?? { lastSyncId: 0, groups: [], subscribed: [] },
      set: async (meta) => void (await db.put(META, { ...meta, schemaHash }, "meta")),
    },
    outbox: {
      async put(txs) {
        const tx = db.transaction(OUTBOX, "readwrite");
        for (const record of txs) void tx.store.add(record);
        await tx.done;
      },
      // One already gone is left alone, as Map.delete would.
      async remove(id) {
        const key = await db.getKeyFromIndex(OUTBOX, "id", id);
        if (key !== undefined) await db.delete(OUTBOX, key);
      },
      all: () => db.getAll(OUTBOX),
    },
  };
}
