import type { AnyRecord, ModelName, Models, SyncAction, TransactionEnvelope } from "../protocol";

// A transaction waiting to reach the server, as kept in `__transactions` so it survives a restart.
export type StoredTransaction<T = TransactionEnvelope> = {
  id: string;
  batchIndex: number;
  actorId: string;
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
// cache stands, and transactions not yet accepted.
export type SyncDatabase<M extends Models = Models, T = TransactionEnvelope> = {
  meta(): Promise<StoredMeta | undefined>;
  models(): Promise<StoredModel<M>[]>;
  transactions(): Promise<StoredTransaction<T>[]>;
  // Replaces every model after a full bootstrap.
  reset(models: StoredModel<M>[], meta: StoredMeta): Promise<void>;
  // Writes actions (inserts, updates, archives and deletes) and the new position, together.
  applyActions(actions: SyncAction<M>[], meta: StoredMeta): Promise<void>;
  putTransactions(transactions: StoredTransaction<T>[]): Promise<void>;
  deleteTransactions(ids: string[]): Promise<void>;
  close(): void;
};

const META = "meta";
const MODELS = "models";
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
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore(META);
    db.createObjectStore(MODELS, { keyPath: ["modelName", "id"] });
    db.createObjectStore(TRANSACTIONS, { keyPath: "id" });
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
    models: () =>
      promised(db.transaction(MODELS).objectStore(MODELS).getAll() as IDBRequest<StoredModel<M>[]>),
    transactions: async () =>
      (
        await promised(
          db.transaction(TRANSACTIONS).objectStore(TRANSACTIONS).getAll() as IDBRequest<
            StoredTransaction<T>[]
          >,
        )
      ).sort((a, b) => a.batchIndex - b.batchIndex),
    reset: (models, meta) =>
      write([META, MODELS], (tx) => {
        const store = tx.objectStore(MODELS);
        store.clear();
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
  const transactions = new Map<string, StoredTransaction<T>>();
  const key = (modelName: string, id: string): string => `${modelName}:${id}`;
  return {
    meta: async () => meta,
    models: async () => [...models.values()],
    transactions: async () =>
      [...transactions.values()].sort((a, b) => a.batchIndex - b.batchIndex),
    reset: async (next, nextMeta) => {
      models.clear();
      for (const model of next) models.set(key(model.modelName, model.id), structuredClone(model));
      meta = structuredClone(nextMeta);
    },
    applyActions: async (actions, nextMeta) => {
      for (const action of actions) {
        if (action.data === null) models.delete(key(action.modelName, action.modelId));
        else
          models.set(key(action.modelName, action.modelId), {
            modelName: action.modelName,
            id: action.modelId,
            data: structuredClone(action.data),
          });
      }
      meta = structuredClone(nextMeta);
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
