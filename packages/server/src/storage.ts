import type { BootstrapLine, SyncAction } from "protocol";

// A sync action with the sync groups it was logged under.
export type Logged = { action: SyncAction; groups: string[] };

export interface Storage {
  load(models: string[]): { rows: BootstrapLine[]; actions: Logged[] };
  // The actions' rows and log entries, in one transaction.
  commit(actions: Logged[], at: number): void;
}

export function memoryStorage(): Storage {
  const rows = new Map<string, BootstrapLine>();
  const log: Logged[] = [];
  return {
    load: () => ({ rows: [...rows.values()], actions: [...log] }),
    commit(actions) {
      for (const { action } of actions) {
        const key = `${action.model}:${action.modelId}`;
        if (action.data === undefined) rows.delete(key);
        else rows.set(key, { model: action.model, row: action.data });
      }
      log.push(...actions);
    },
  };
}

// What `sqliteStorage` uses of a Durable Object's storage.
export type SqlStorageLike = {
  sql: { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): unknown[] } };
  transactionSync<T>(run: () => T): T;
};

type ActionRow = {
  id: number;
  tx_id: string;
  model: string;
  model_id: string;
  action: SyncAction["action"];
  data: string | null;
  sync_groups: string;
};

export function sqliteStorage(storage: SqlStorageLike): Storage {
  const { sql } = storage;
  const rows = <T>(query: string): T[] => sql.exec(query).toArray() as T[];
  return {
    load(models) {
      sql.exec(
        "CREATE TABLE IF NOT EXISTS sync_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, tx_id TEXT NOT NULL, model TEXT NOT NULL, model_id TEXT NOT NULL, action TEXT NOT NULL, data TEXT, sync_groups TEXT NOT NULL, created_at INTEGER NOT NULL)",
      );
      sql.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS sync_actions_tx ON sync_actions (tx_id, model_id)",
      );
      for (const model of models)
        sql.exec(`CREATE TABLE IF NOT EXISTS "${model}" (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
      return {
        rows: models.flatMap((model) =>
          rows<{ data: string }>(`SELECT data FROM "${model}"`).map(({ data }) => ({
            model,
            row: JSON.parse(data),
          })),
        ),
        actions: rows<ActionRow>("SELECT * FROM sync_actions ORDER BY id").map((row) => {
          const action: SyncAction = {
            id: row.id,
            txId: row.tx_id,
            model: row.model,
            modelId: row.model_id,
            action: row.action,
          };
          if (row.data !== null) action.data = JSON.parse(row.data);
          return { action, groups: JSON.parse(row.sync_groups) };
        }),
      };
    },
    commit: (actions, at) =>
      storage.transactionSync(() => {
        for (const { action, groups } of actions) {
          const data = action.data === undefined ? null : JSON.stringify(action.data);
          sql.exec(
            "INSERT INTO sync_actions (id, tx_id, model, model_id, action, data, sync_groups, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            action.id,
            action.txId,
            action.model,
            action.modelId,
            action.action,
            data,
            JSON.stringify(groups),
            at,
          );
          if (data === null) sql.exec(`DELETE FROM "${action.model}" WHERE id = ?`, action.modelId);
          else
            sql.exec(
              `INSERT OR REPLACE INTO "${action.model}" (id, data) VALUES (?, ?)`,
              action.modelId,
              data,
            );
        }
      }),
  };
}
