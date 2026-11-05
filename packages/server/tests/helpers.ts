import { DatabaseSync } from "node:sqlite";
import type { ServerMessage } from "protocol";
import { ClientModel, Model, Property, Reference } from "sync";
import {
  memoryStorage,
  SyncServer,
  type ServerOptions,
  type Session,
  type Socket,
  type SqlStorageLike,
} from "../src";

@ClientModel("Team", { syncGroup: () => ["workspace:w"] })
class Team extends Model {
  @Property() name!: string;
  @Property() memberIds!: string[];
}

@ClientModel("Note", { syncGroup: (row) => [`team:${row.teamId as string}`] })
export class Note extends Model {
  @Property() title!: string;
  @Property({ enum: ["open", "done"] }) state!: string;
  @Property({ nullable: true }) body?: string;
  @Reference(() => Team) team!: Team;
}

@ClientModel("Inbox", { syncGroup: (row) => [`user:${row.userId as string}`] })
export class Inbox extends Model {
  @Property() userId!: string;
  @Property() noteId!: string;
}

export const ann: Session = { userId: "ann" };
export const bob: Session = { userId: "bob" };
export const admin: Session = { admin: true };

export type TestSocket = Socket & { received: ServerMessage[] };
export const socket = (session: Session): TestSocket => {
  const received: ServerMessage[] = [];
  return { session, received, send: (message) => received.push(message) };
};

// A server with team "t" (ann is in it, bob isn't).
export function createServer(
  options: Partial<ServerOptions> = {},
): SyncServer & { sockets: TestSocket[] } {
  const sockets: TestSocket[] = [];
  const server = new SyncServer({
    storage: memoryStorage(),
    sockets: () => sockets,
    groupsOf: (userId, db) => [
      "workspace:w",
      `user:${userId}`,
      ...db
        .all("Team")
        .filter((team) => (team.memberIds as string[]).includes(userId))
        .map((team) => `team:${team.id}`),
    ],
    now: () => 1000,
    ...options,
  });
  if (server.deltas(admin, 0).actions.length === 0)
    server.mutate(admin, {
      transactions: [create("Team", "t", { name: "T", memberIds: ["ann"] }, "seed")],
    });
  return Object.assign(server, { sockets });
}

export const create = (
  model: string,
  modelId: string,
  changes: Record<string, unknown>,
  id = `create-${modelId}`,
) => ({
  id,
  kind: "create" as const,
  model,
  modelId,
  changes,
  batch: 0,
});

export const note = (modelId: string, changes: Record<string, unknown> = {}, id?: string) =>
  create("Note", modelId, { title: "Hi", state: "open", teamId: "t", ...changes }, id);

// A Durable Object's storage API over Node's SQLite.
export function nodeSql(db = new DatabaseSync(":memory:")): SqlStorageLike {
  return {
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
