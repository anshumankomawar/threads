import {
  ALL_GROUPS,
  type AnyRecord,
  type ModelName,
  type Models,
  type SyncAction,
} from "../protocol";

// A sync action as the server logs it: with the sync groups its record is in now and was in before, so the log can
// be filtered for each session (`visibleActions`).
export type LoggedAction<M extends Models = Models> = SyncAction<M> & {
  groups: string[];
  previousGroups: string[];
};

export type StoredModel<M extends Models = Models> = {
  modelName: ModelName<M>;
  data: AnyRecord<M>;
};

export type StoredState<M extends Models = Models> = {
  models: StoredModel<M>[];
  lastSyncId: number;
  // Undefined until the server first loads; set again when its data starts over.
  epoch: string | undefined;
  // The log holds the actions after this one; a client further behind bootstraps afresh.
  minSyncId: number;
};

// Where a server keeps its models, its log and the transactions it has executed. `commit` is all or nothing.
export type SyncStorage<M extends Models = Models> = {
  load(): StoredState<M>;
  commit(actions: LoggedAction<M>[], transactionIds: string[], atMs: number): void;
  actionsAfter(syncId: number): LoggedAction<M>[];
  // A transaction already executed, such as one a client resent after losing the response.
  hasTransaction(id: string): boolean;
  setEpoch(epoch: string): void;
  // Drops the actions up to `throughSyncId`, and executed transaction ids recorded before `transactionsBeforeMs`.
  compact(throughSyncId: number, transactionsBeforeMs: number): void;
};

// Storage in memory, for tests. It can start with models already stored, as if written by an older version, with a log
// that starts after `lastSyncId`.
export function memoryStorage<M extends Models>(
  initial: { models?: StoredModel<M>[]; lastSyncId?: number } = {},
): SyncStorage<M> {
  const models = new Map<string, StoredModel<M>>(
    (initial.models ?? []).map((model) => [`${model.modelName}:${model.data.id}`, model]),
  );
  let log: LoggedAction<M>[] = [];
  const transactions = new Map<string, number>();
  let epoch: string | undefined;
  let minSyncId = initial.lastSyncId ?? 0;
  return {
    load: () => ({
      models: [...models.values()],
      lastSyncId: log.at(-1)?.id ?? minSyncId,
      epoch,
      minSyncId,
    }),
    commit(actions, transactionIds, atMs) {
      for (const action of actions) {
        const key = `${action.modelName}:${action.modelId}`;
        if (action.data === null) models.delete(key);
        else models.set(key, { modelName: action.modelName, data: action.data });
      }
      log.push(...actions);
      for (const id of transactionIds) transactions.set(id, atMs);
    },
    actionsAfter: (syncId) => log.filter((action) => action.id > syncId),
    hasTransaction: (id) => transactions.has(id),
    setEpoch: (next) => void (epoch = next),
    compact(throughSyncId, transactionsBeforeMs) {
      log = log.filter((action) => action.id > throughSyncId);
      minSyncId = Math.max(minSyncId, throughSyncId);
      for (const [id, atMs] of transactions)
        if (atMs < transactionsBeforeMs) transactions.delete(id);
    },
  };
}

// The bits of a Durable Object's storage that `sqliteStorage` uses: its SQL API and synchronous transactions.
export type SqlStorageLike = {
  sql: { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): unknown[] } };
  transactionSync<T>(run: () => T): T;
};

type ActionRow = {
  id: number;
  modelName: string;
  modelId: string;
  action: SyncAction["action"];
  data: string | null;
  groups: string | null;
  previousGroups: string | null;
};

// Storage in SQLite, as a Durable Object has it. Tables that an older version made are brought up to date: log rows
// written before sync groups existed are visible to everyone.
export function sqliteStorage<M extends Models>(storage: SqlStorageLike): SyncStorage<M> {
  const { sql } = storage;
  const rows = <T>(query: string, ...bindings: (string | number | null)[]): T[] =>
    sql.exec(query, ...bindings).toArray() as T[];
  const columns = (table: string): string[] =>
    rows<{ name: string }>(`PRAGMA table_info(${table})`).map((column) => column.name);

  sql.exec(
    "CREATE TABLE IF NOT EXISTS models (modelName TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (modelName, id))",
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS sync_actions (id INTEGER PRIMARY KEY, modelName TEXT NOT NULL, modelId TEXT NOT NULL, action TEXT NOT NULL, data TEXT, groups TEXT, previousGroups TEXT)",
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, syncId INTEGER NOT NULL, atMs INTEGER NOT NULL DEFAULT 0)",
  );
  sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const actionColumns = columns("sync_actions");
  if (!actionColumns.includes("groups"))
    sql.exec("ALTER TABLE sync_actions ADD COLUMN groups TEXT");
  if (!actionColumns.includes("previousGroups"))
    sql.exec("ALTER TABLE sync_actions ADD COLUMN previousGroups TEXT");
  if (!columns("transactions").includes("atMs"))
    sql.exec("ALTER TABLE transactions ADD COLUMN atMs INTEGER NOT NULL DEFAULT 0");

  const meta = (key: string): string | undefined =>
    rows<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)[0]?.value;
  const setMeta = (key: string, value: string): void =>
    void sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  const groupsOf = (text: string | null): string[] =>
    text === null ? [ALL_GROUPS] : (JSON.parse(text) as string[]);

  return {
    load() {
      const minSyncId = Number(meta("minSyncId") ?? 0);
      const latest = rows<{ id: number | null }>("SELECT MAX(id) AS id FROM sync_actions")[0]?.id;
      return {
        models: rows<{ modelName: string; data: string }>("SELECT modelName, data FROM models").map(
          (row) => ({
            modelName: row.modelName as ModelName<M>,
            data: JSON.parse(row.data) as AnyRecord<M>,
          }),
        ),
        lastSyncId: Math.max(latest ?? 0, minSyncId),
        epoch: meta("epoch"),
        minSyncId,
      };
    },
    commit: (actions, transactionIds, atMs) =>
      storage.transactionSync(() => {
        for (const action of actions) {
          sql.exec(
            "INSERT INTO sync_actions (id, modelName, modelId, action, data, groups, previousGroups) VALUES (?, ?, ?, ?, ?, ?, ?)",
            action.id,
            action.modelName,
            action.modelId,
            action.action,
            action.data === null ? null : JSON.stringify(action.data),
            JSON.stringify(action.groups),
            JSON.stringify(action.previousGroups),
          );
          if (action.data === null)
            sql.exec(
              "DELETE FROM models WHERE modelName = ? AND id = ?",
              action.modelName,
              action.modelId,
            );
          else
            sql.exec(
              "INSERT OR REPLACE INTO models (modelName, id, data) VALUES (?, ?, ?)",
              action.modelName,
              action.modelId,
              JSON.stringify(action.data),
            );
        }
        const syncId = actions.at(-1)?.id ?? 0;
        for (const id of transactionIds)
          sql.exec(
            "INSERT OR IGNORE INTO transactions (id, syncId, atMs) VALUES (?, ?, ?)",
            id,
            syncId,
            atMs,
          );
      }),
    actionsAfter: (syncId) =>
      rows<ActionRow>(
        "SELECT id, modelName, modelId, action, data, groups, previousGroups FROM sync_actions WHERE id > ? ORDER BY id",
        syncId,
      ).map((row) => ({
        id: row.id,
        modelName: row.modelName as ModelName<M>,
        modelId: row.modelId,
        action: row.action,
        data: row.data === null ? null : (JSON.parse(row.data) as AnyRecord<M>),
        groups: row.data === null ? [] : groupsOf(row.groups),
        previousGroups: groupsOf(row.previousGroups),
      })),
    hasTransaction: (id) => rows("SELECT 1 FROM transactions WHERE id = ?", id).length > 0,
    setEpoch: (epoch) => setMeta("epoch", epoch),
    compact: (throughSyncId, transactionsBeforeMs) =>
      storage.transactionSync(() => {
        sql.exec("DELETE FROM sync_actions WHERE id <= ?", throughSyncId);
        sql.exec("DELETE FROM transactions WHERE atMs < ?", transactionsBeforeMs);
        setMeta("minSyncId", String(Math.max(Number(meta("minSyncId") ?? 0), throughSyncId)));
      }),
  };
}
