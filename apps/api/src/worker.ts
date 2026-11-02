import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AnyRecord, ModelName, SyncAction, SyncMessage } from "model";
import { createWorkspaceApp } from "./app.ts";
import {
  isWorkspaceName,
  refreshSeedPeople,
  SAMPLE_ME,
  seed,
  SyncEngine,
  type EngineStorage,
  type WorkspaceName,
} from "./engine.ts";
import { nextPlanningMs } from "./scheduler.ts";

// Request details a Workspace object needs. The desktop app sends them as headers; a browser WebSocket can't set
// headers, so the sync socket passes them as query parameters instead.
function param(request: Request, header: string, query: string): string | null {
  return request.headers.get(header) ?? new URL(request.url).searchParams.get(query);
}

function utcOffset(request: Request): number | undefined {
  const value = param(request, "X-UTC-Offset", "utcOffset");
  const offset = Number(value);
  return value !== null && Number.isFinite(offset) ? offset : undefined;
}

// One workspace: its sync engine, with models, the sync log and executed transaction ids in this object's SQLite
// storage, and the WebSockets of every client connected to it. Each committed batch goes out to all of them as a
// delta packet, including the client that sent it, as in Linear's sync engine.
export class Workspace extends DurableObject<Env> {
  #engine: SyncEngine | undefined;
  #app: Hono | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => this.#createTables());
  }

  #createTables(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS models (modelName TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (modelName, id))",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS sync_actions (id INTEGER PRIMARY KEY, modelName TEXT NOT NULL, modelId TEXT NOT NULL, action TEXT NOT NULL, data TEXT)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, syncId INTEGER NOT NULL)",
    );
    sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  // Starts the workspace over: deletes everything, so the next request seeds it afresh. Connected clients are
  // dropped; they reconnect, find the server behind their cache and rebuild.
  async #reset(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) socket.close(1012, "Workspace reset");
    await this.ctx.storage.deleteAll();
    this.#engine = undefined;
    this.#app = undefined;
    this.#createTables();
  }

  #storage(): EngineStorage {
    const { sql } = this.ctx.storage;
    return {
      commit: (actions, transactionIds) =>
        this.ctx.storage.transactionSync(() => {
          for (const action of actions) {
            sql.exec(
              "INSERT INTO sync_actions (id, modelName, modelId, action, data) VALUES (?, ?, ?, ?, ?)",
              action.id,
              action.modelName,
              action.modelId,
              action.action,
              action.data === null ? null : JSON.stringify(action.data),
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
            sql.exec("INSERT OR IGNORE INTO transactions (id, syncId) VALUES (?, ?)", id, syncId);
        }),
      actionsAfter: (syncId) =>
        sql
          .exec<{
            id: number;
            modelName: ModelName;
            modelId: string;
            action: SyncAction["action"];
            data: string | null;
          }>(
            "SELECT id, modelName, modelId, action, data FROM sync_actions WHERE id > ? ORDER BY id",
            syncId,
          )
          .toArray()
          .map((row) => ({
            ...row,
            data: row.data === null ? null : (JSON.parse(row.data) as AnyRecord),
          })),
      hasTransaction: (id) =>
        sql.exec("SELECT 1 FROM transactions WHERE id = ?", id).toArray().length > 0,
    };
  }

  // The workspace's engine, loaded from storage on first use. A new workspace is seeded, laying out sample times
  // in the first requester's time zone.
  #load(name: WorkspaceName, utcOffsetMinutes: number | undefined): SyncEngine {
    if (this.#engine !== undefined) return this.#engine;
    const { sql } = this.ctx.storage;
    sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('workspace', ?)", name);
    const engine = new SyncEngine({
      storage: this.#storage(),
      onActions: (actions) => this.#broadcast(actions),
    });
    const rows = sql
      .exec<{ modelName: ModelName; data: string }>("SELECT modelName, data FROM models")
      .toArray()
      .map((row) => ({ modelName: row.modelName, data: JSON.parse(row.data) as AnyRecord }));
    const lastSyncId =
      sql.exec<{ id: number | null }>("SELECT MAX(id) AS id FROM sync_actions").one().id ?? 0;
    engine.load(rows, lastSyncId);
    if (engine.isEmpty) seed(engine, name, SAMPLE_ME, utcOffsetMinutes);
    refreshSeedPeople(engine, name, SAMPLE_ME);
    engine.replanAll();
    void this.ctx.storage.setAlarm(nextPlanningMs(Date.now()));
    this.#engine = engine;
    return engine;
  }

  // Each morning, reschedule everyone for what time has changed: closer due dates and slots that passed.
  async alarm(): Promise<void> {
    const [row] = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'workspace'")
      .toArray();
    if (row === undefined || !isWorkspaceName(row.value)) return;
    const loaded = this.#engine;
    const engine = this.#load(row.value, undefined);
    // Loading already looked over the schedules.
    if (loaded !== undefined) engine.replanAll();
    await this.ctx.storage.setAlarm(nextPlanningMs(Date.now()));
  }

  #broadcast(actions: SyncAction[]): void {
    const packet: SyncMessage = { type: "delta", lastSyncId: actions.at(-1)?.id ?? 0, actions };
    const message = JSON.stringify(packet);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A socket closing mid-send reconnects and catches up by sync id.
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const name = param(request, "X-Workspace", "workspace") ?? "local";
    if (!isWorkspaceName(name))
      return Response.json({ error: `Unknown workspace: ${name}` }, { status: 400 });
    const { pathname } = new URL(request.url);
    if (pathname === "/sync/reset" && request.method === "POST") await this.#reset();
    const engine = this.#load(name, utcOffset(request));
    if (pathname === "/sync/reset") return Response.json({ lastSyncId: engine.lastSyncId });

    // The sync socket: a handshake with the current lastSyncId, then a delta packet per committed batch. It
    // hibernates while idle, so open connections cost next to nothing.
    if (pathname === "/sync/ws") {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      const handshake: SyncMessage = { type: "handshake", lastSyncId: engine.lastSyncId };
      server.send(JSON.stringify(handshake));
      return new Response(null, { status: 101, webSocket: client });
    }

    this.#app ??= createWorkspaceApp(engine);
    return this.#app.fetch(request);
  }

  // Clients ping to keep the connection alive through proxies.
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === "ping") socket.send("pong");
  }

  webSocketClose(socket: WebSocket, code: number): void {
    socket.close(code, "closing");
  }
}

const app = new Hono<{ Bindings: Env }>();

// The desktop renderer runs on its own origin, so it needs CORS to reach the API.
app.use(cors());

// With an API_TOKEN secret set (the hosted API), every request needs it: as a bearer token, or on the sync socket,
// which can't send headers, as a `token` query parameter. Locally it's unset and the API is open.
app.use(async (c, next) => {
  const token = c.env.API_TOKEN;
  if (!token) return next();
  const given = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? c.req.query("token");
  if (given !== token) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

// Each workspace lives in its own Durable Object, picked with X-Workspace (or `workspace` on the socket).
app.all("*", async (c): Promise<Response> => {
  const name = param(c.req.raw, "X-Workspace", "workspace") ?? "local";
  if (!isWorkspaceName(name)) return c.json({ error: `Unknown workspace: ${name}` }, 400);
  if (name === "sample" && c.env.SAMPLE_WORKSPACE !== "on")
    return c.json({ error: "The sample workspace is only served locally" }, 404);
  const { exports } = c.executionCtx as ExecutionContext;
  return exports.Workspace.getByName(name).fetch(c.req.raw);
});

export default app;
