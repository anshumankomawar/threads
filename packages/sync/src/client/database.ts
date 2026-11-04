import type { AnyRecord, ModelName, Models, SyncAction, TransactionEnvelope } from "../protocol";

// A transaction waiting to reach the server, as kept in `__transactions` so it survives a restart.
export type StoredTransaction<T = TransactionEnvelope> = {
  id: string;
  batchIndex: number;
  actorId: string;
  // When it was made, so replaying it after a restart stamps what it changes as it did then.
  createdAtMs: number;
  input: T;
};

// Where this cache stands: the server data it's a copy of (`epoch`), how far it has applied (`lastSyncId`), which
// groups it holds, and the schema it was built under.
export type StoredMeta = {
  lastSyncId: number;
  schemaHash: string;
  epoch: string;
  syncGroups: string[];
};

export type StoredModel<M extends Models = Models> = {
  modelName: ModelName<M>;
  id: string;
  data: AnyRecord<M>;
};

// The client's local database, as in LSE: models exactly as the server confirmed them (never local edits), where the
// cache stands, which lazy and partial loads it holds (`loadKey`, LSE's partial index store), and transactions not yet
// accepted.
export type SyncDatabase<M extends Models = Models, T = TransactionEnvelope> = {
  meta(): Promise<StoredMeta | undefined>;
  // Every stored model, or one model's.
  models(modelName?: ModelName<M>): Promise<StoredModel<M>[]>;
  model(modelName: ModelName<M>, id: string): Promise<StoredModel<M> | undefined>;
  loaded(): Promise<string[]>;
  transactions(): Promise<StoredTransaction<T>[]>;
  // Replaces every model after a full bootstrap, forgetting what was loaded.
  reset(models: StoredModel<M>[], meta: StoredMeta): Promise<void>;
  // Writes actions (inserts, updates, archives and deletes) and the new position, together.
  applyActions(actions: SyncAction<M>[], meta: StoredMeta): Promise<void>;
  // Stores models a lazy or partial load returned, and that those loads are held.
  putLoaded(models: StoredModel<M>[], keys: string[]): Promise<void>;
  putTransactions(transactions: StoredTransaction<T>[]): Promise<void>;
  deleteTransactions(ids: string[]): Promise<void>;
  close(): void;
};

// What identifies a load: a whole lazy model, or a partial model's records by one key's value.
export function loadKey(modelName: string, key?: string, value?: string): string {
  return key === undefined ? modelName : `${modelName}|${key}|${value}`;
}

const META = "meta";
const MODELS = "models";
const LOADED = "loaded";
const TRANSACTIONS = "__transactions";

function promised<R>(request: IDBRequest<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// One IndexedDB database per workspace and user, like Linear's.
export async function openIndexedDb<M extends Models, T = TransactionEnvelope>(
  name: string,
): Promise<SyncDatabase<M, T>> {
  const open = indexedDB.open(name, 2);
  open.onupgradeneeded = () => {
    const db = open.result;
    const has = (store: string): boolean => db.objectStoreNames.contains(store);
    if (!has(META)) db.createObjectStore(META);
    if (!has(MODELS)) db.createObjectStore(MODELS, { keyPath: ["modelName", "id"] });
    if (!has(TRANSACTIONS)) db.createObjectStore(TRANSACTIONS, { keyPath: "id" });
    if (!has(LOADED)) db.createObjectStore(LOADED);
  };
  const db = await promised(open);

  const write = async (stores: string[], run: (tx: IDBTransaction) => void): Promise<void> => {
    const tx = db.transaction(stores, "readwrite");
    run(tx);
    await done(tx);
  };

  return {
    meta: () =>
      promised(
        db.transaction(META).objectStore(META).get("meta") as IDBRequest<StoredMeta | undefined>,
      ),
    models: (modelName) =>
      promised(
        db
          .transaction(MODELS)
          .objectStore(MODELS)
          .getAll(
            modelName === undefined ? undefined : IDBKeyRange.bound([modelName], [modelName, []]),
          ) as IDBRequest<StoredModel<M>[]>,
      ),
    model: (modelName, id) =>
      promised(
        db.transaction(MODELS).objectStore(MODELS).get([modelName, id]) as IDBRequest<
          StoredModel<M> | undefined
        >,
      ),
    loaded: async () =>
      (await promised(db.transaction(LOADED).objectStore(LOADED).getAllKeys())).map(String),
    transactions: async () =>
      (
        await promised(
          db.transaction(TRANSACTIONS).objectStore(TRANSACTIONS).getAll() as IDBRequest<
            StoredTransaction<T>[]
          >,
        )
      ).sort((a, b) => a.batchIndex - b.batchIndex),
    reset: (models, meta) =>
      write([META, MODELS, LOADED], (tx) => {
        const store = tx.objectStore(MODELS);
        store.clear();
        tx.objectStore(LOADED).clear();
        for (const model of models) store.put(model);
        tx.objectStore(META).put(meta, "meta");
      }),
    applyActions: (actions, meta) =>
      write([META, MODELS], (tx) => {
        const store = tx.objectStore(MODELS);
        for (const action of actions) {
          if (action.data === null) store.delete([action.modelName, action.modelId]);
          else store.put({ modelName: action.modelName, id: action.modelId, data: action.data });
        }
        tx.objectStore(META).put(meta, "meta");
      }),
    putLoaded: (models, keys) =>
      write([MODELS, LOADED], (tx) => {
        const store = tx.objectStore(MODELS);
        for (const model of models) store.put(model);
        for (const loaded of keys) tx.objectStore(LOADED).put(true, loaded);
      }),
    putTransactions: (transactions) =>
      write([TRANSACTIONS], (tx) => {
        for (const transaction of transactions) tx.objectStore(TRANSACTIONS).put(transaction);
      }),
    deleteTransactions: (ids) =>
      write([TRANSACTIONS], (tx) => {
        for (const id of ids) tx.objectStore(TRANSACTIONS).delete(id);
      }),
    close: () => db.close(),
  };
}

// The same database in memory, for tests. It copies what it stores with the structured clone IndexedDB uses, so
// something IndexedDB can't store (an observable, a function) fails here too.
export function memoryDatabase<M extends Models, T = TransactionEnvelope>(): SyncDatabase<M, T> {
  let meta: StoredMeta | undefined;
  const models = new Map<string, StoredModel<M>>();
  const loaded = new Set<string>();
  const transactions = new Map<string, StoredTransaction<T>>();
  const key = (modelName: string, id: string): string => `${modelName}:${id}`;
  const put = (model: StoredModel<M>): void =>
    void models.set(key(model.modelName, model.id), structuredClone(model));
  return {
    meta: async () => meta,
    models: async (modelName) =>
      [...models.values()].filter(
        (model) => modelName === undefined || model.modelName === modelName,
      ),
    model: async (modelName, id) => {
      const stored = models.get(key(modelName, id));
      return stored === undefined ? undefined : structuredClone(stored);
    },
    loaded: async () => [...loaded],
    transactions: async () =>
      [...transactions.values()].sort((a, b) => a.batchIndex - b.batchIndex),
    reset: async (next, nextMeta) => {
      models.clear();
      loaded.clear();
      for (const model of next) put(model);
      meta = structuredClone(nextMeta);
    },
    applyActions: async (actions, nextMeta) => {
      for (const action of actions) {
        if (action.data === null) models.delete(key(action.modelName, action.modelId));
        else put({ modelName: action.modelName, id: action.modelId, data: action.data });
      }
      meta = structuredClone(nextMeta);
    },
    putLoaded: async (next, keys) => {
      for (const model of next) put(model);
      for (const held of keys) loaded.add(held);
    },
    putTransactions: async (list) => {
      for (const transaction of list)
        transactions.set(transaction.id, structuredClone(transaction));
    },
    deleteTransactions: async (ids) => {
      for (const id of ids) transactions.delete(id);
    },
    close: () => {},
  };
}
