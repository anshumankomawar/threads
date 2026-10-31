import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Person, Thread } from "model";
import {
  createWorkspaceApp,
  emptyStore,
  isWorkspaceName,
  seedStore,
  type WorkspaceName,
} from "./app.ts";
import type { Inbox, Store, Write } from "./model.ts";

// Who the sample threads are addressed to on the hosted API, where there's no OS user to borrow.
const SAMPLE_ME: Person = { id: "you", name: "You" };

type Row = { kind: Write["kind"]; key: string; value: string };

// One workspace's people and threads, saved in this object's SQLite storage. The store is loaded into memory on
// first use and every change is written through to storage before it lands in memory.
export class Workspace extends DurableObject<Env> {
  #app: Hono | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (kind, key))",
      );
    });
  }

  #save(write: Write): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO records (kind, key, value) VALUES (?, ?, ?)",
      write.kind,
      write.key,
      JSON.stringify(write.value),
    );
  }

  // Loads the stored workspace, or seeds it the first time.
  #load(name: WorkspaceName): Store {
    const rows = this.ctx.storage.sql.exec<Row>("SELECT kind, key, value FROM records").toArray();
    if (rows.length === 0) {
      const store = seedStore(name, SAMPLE_ME, Date.now());
      for (const value of store.people.values())
        this.#save({ kind: "person", key: value.id, value });
      for (const value of store.threads.values())
        this.#save({ kind: "thread", key: value.id, value });
      return store;
    }
    const store = emptyStore();
    for (const row of rows) {
      const value: unknown = JSON.parse(row.value);
      if (row.kind === "person") store.people.set(row.key, value as Person);
      else if (row.kind === "thread") store.threads.set(row.key, value as Thread);
      else store.inboxes.set(row.key, value as Inbox);
    }
    return store;
  }

  // Answers one API request for this workspace.
  handle(name: WorkspaceName, request: Request): Promise<Response> | Response {
    this.#app ??= createWorkspaceApp(this.#load(name), { onWrite: (write) => this.#save(write) });
    return this.#app.fetch(request);
  }
}

const app = new Hono<{ Bindings: Env }>();

// The desktop renderer runs on its own origin, so it needs CORS to reach the API.
app.use(cors());

// With an API_TOKEN secret set (the hosted API), every request needs it as a bearer token. Locally it's unset
// and the API is open.
app.use(async (c, next) => {
  const token = c.env.API_TOKEN;
  if (token && c.req.header("Authorization") !== `Bearer ${token}`)
    return c.json({ error: "Unauthorized" }, 401);
  await next();
});

// Each workspace lives in its own Durable Object, picked with the X-Workspace header.
app.all("*", async (c): Promise<Response> => {
  const name = c.req.header("X-Workspace") ?? "local";
  if (!isWorkspaceName(name)) return c.json({ error: `Unknown workspace: ${name}` }, 400);
  const { exports } = c.executionCtx as ExecutionContext;
  const stub = exports.Workspace.getByName(name);
  const response: Response = await stub.handle(name, c.req.raw);
  return response;
});

export default app;
