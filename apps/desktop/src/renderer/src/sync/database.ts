import type { AnyRecord, ModelName, SyncAction, TransactionInput } from "model";

// A transaction waiting to reach the server, as kept in the __transactions table so it survives a restart.
export type StoredTransaction = {
  id: string;
  batchIndex: number;
  actorId: string;
  input: TransactionInput;
};

export type StoredMeta = { lastSyncId: number; schemaHash: string };

export type StoredModel = { modelName: ModelName; id: string; data: AnyRecord };

// The client's local database, as in LSE: models exactly as the server confirmed them (never local edits), the
// sync position, and transactions not yet accepted.
export type SyncDatabase = {
  meta(): Promise<StoredMeta | undefined>;
  models(): Promise<StoredModel[]>;
  transactions(): Promise<StoredTransaction[]>;
  // Replaces everything after a full bootstrap.
  reset(models: StoredModel[], meta: StoredMeta): Promise<void>;
  applyActions(actions: SyncAction[], meta: StoredMeta): Promise<void>;
  putTransactions(transactions: StoredTransaction[]): Promise<void>;
  deleteTransactions(ids: string[]): Promise<void>;
  close(): void;
};

const META = "meta";
const MODELS = "models";
const TRANSACTIONS = "__transactions";

function promised<T>(request: IDBRequest<T>): Promise<T> {
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

// One IndexedDB database per data source, like Linear's one per workspace.
export async function openIndexedDb(name: string): Promise<SyncDatabase> {
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
      promised(db.transaction(MODELS).objectStore(MODELS).getAll() as IDBRequest<StoredModel[]>),
    transactions: async () =>
      (
        await promised(
          db.transaction(TRANSACTIONS).objectStore(TRANSACTIONS).getAll() as IDBRequest<
            StoredTransaction[]
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

// The same database in memory, for tests.
export function memoryDatabase(): SyncDatabase {
  let meta: StoredMeta | undefined;
  const models = new Map<string, StoredModel>();
  const transactions = new Map<string, StoredTransaction>();
  const key = (modelName: ModelName, id: string): string => `${modelName}:${id}`;
  return {
    meta: async () => meta,
    models: async () => [...models.values()],
    transactions: async () =>
      [...transactions.values()].sort((a, b) => a.batchIndex - b.batchIndex),
    reset: async (next, nextMeta) => {
      models.clear();
      for (const model of next) models.set(key(model.modelName, model.id), model);
      meta = nextMeta;
    },
    applyActions: async (actions, nextMeta) => {
      for (const action of actions) {
        if (action.data === null) models.delete(key(action.modelName, action.modelId));
        else
          models.set(key(action.modelName, action.modelId), {
            modelName: action.modelName,
            id: action.modelId,
            data: action.data,
          });
      }
      meta = nextMeta;
    },
    putTransactions: async (list) => {
      for (const transaction of list) transactions.set(transaction.id, transaction);
    },
    deleteTransactions: async (ids) => {
      for (const id of ids) transactions.delete(id);
    },
    close: () => {},
  };
}
