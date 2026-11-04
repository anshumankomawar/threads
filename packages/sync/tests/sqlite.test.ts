import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vite-plus/test";
import { sqliteStorage, type SqlStorageLike } from "../src/server";
import { createServer, seedUsers, txId, type TestModels } from "./harness";

// A Durable Object's storage API over Node's SQLite.
function nodeSql(db = new DatabaseSync(":memory:")): SqlStorageLike & { db: DatabaseSync } {
  return {
    db,
    sql: {
      exec(query, ...bindings) {
        const statement = db.prepare(query);
        const rows =
          statement.columns().length > 0
            ? statement.all(...bindings)
            : (statement.run(...bindings), []);
        return { toArray: () => rows };
      },
    },
    transactionSync(run) {
      db.exec("BEGIN");
      try {
        const result = run();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

test("a server restarted from SQLite has its models, log, epoch and executed transactions", () => {
  const storage = nodeSql();
  const first = createServer(sqliteStorage<TestModels>(storage));
  seedUsers(first, "ann");
  const create = {
    id: txId(),
    type: "create",
    modelName: "Note",
    data: { id: "n", text: "Kept", teamId: null },
  } as const;
  first.execute({ actorId: "ann", transactions: [create] }, { userId: "ann" });

  const second = createServer(sqliteStorage<TestModels>(storage));
  expect(second.epoch).toBe(first.epoch);
  expect(second.lastSyncId).toBe(first.lastSyncId);
  expect(second.models.Note.get("n")?.text).toBe("Kept");
  expect(second.execute({ actorId: "ann", transactions: [create] }, { userId: "ann" })).toEqual([]);
  const log = second.deltas({ userId: "ann" }, 0);
  expect("actions" in log && log.actions.map((action) => action.modelName)).toEqual([
    "User",
    "Note",
  ]);

  second.compact({ keepActions: 0 });
  const third = createServer(sqliteStorage<TestModels>(storage));
  expect(third.minSyncId).toBe(second.lastSyncId);
  expect(third.lastSyncId).toBe(second.lastSyncId);
  expect(third.deltas({ userId: "ann" }, 0)).toHaveProperty("fullBootstrapRequired", true);
});

test("a log written before sync groups existed is upgraded, its rows visible to everyone", () => {
  const storage = nodeSql();
  storage.db.exec(
    "CREATE TABLE sync_actions (id INTEGER PRIMARY KEY, modelName TEXT NOT NULL, modelId TEXT NOT NULL, action TEXT NOT NULL, data TEXT)",
  );
  storage.db.exec("CREATE TABLE transactions (id TEXT PRIMARY KEY, syncId INTEGER NOT NULL)");
  storage.db.exec(
    `INSERT INTO sync_actions VALUES (1, 'Note', 'old', 'I', '{"id":"old","ownerId":"ann","teamId":null,"text":"Old"}')`,
  );
  const server = createServer(sqliteStorage<TestModels>(storage));
  const log = server.deltas({ userId: "bob" }, 0);
  expect("actions" in log && log.actions.map((action) => action.modelId)).toEqual(["old"]);
});
