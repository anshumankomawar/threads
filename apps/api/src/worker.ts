import { DurableObject } from "cloudflare:workers";
import type { Hello } from "protocol";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { ComposeRequest } from "models";
import { threadsServer } from "models/server";
import {
  handleRequest,
  signSession,
  sqliteStorage,
  verifySession,
  type Session,
  type Socket,
  type SyncServer,
} from "server";
import { registry } from "sync";
import { createAuth, personFor, SIGNED_IN_PAGE } from "./auth.ts";
import { workersAiComposer } from "./compose.ts";
import { Triager, workersAiClassifier } from "./triage.ts";

const WORKSPACES = ["local", "sample"];
const ADMIN: Session = { admin: true };
// The Worker passes the session it resolved to the workspace's object in this header, replacing any the request came
// with. Only the Worker reaches the objects, so they trust it.
const SESSION_HEADER = "X-Threads-Session";
const SESSION_MS = 30 * 24 * 60 * 60_000;

// Session tokens are signed with a key derived from the API token, so there's no second secret to manage.
const sessionSecret = (apiToken: string): string => `${apiToken}:sessions`;

async function same(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(x, y);
}

// Who a token is; undefined when it's no one. Hosted (API_TOKEN set), the API token is the admin and a session token
// (POST /auth/token) is its person. Locally the API is open: the token is a user id, and no token is the admin.
async function authenticate(
  env: Env,
  token: string,
  workspace: string,
): Promise<Session | undefined> {
  if (!env.API_TOKEN) return token === "" ? ADMIN : { userId: token };
  if (token === "") return undefined;
  if (await same(token, env.API_TOKEN)) return ADMIN;
  const claims = await verifySession(sessionSecret(env.API_TOKEN), token, workspace);
  return claims && { userId: claims.userId };
}

// A socket's attachment, which survives hibernation: who said Hello, and the groups the server last sent it.
type Attachment = { session: Session; groups?: string[] };

// One workspace: its `SyncServer` over this object's SQLite storage, and the WebSockets of every client connected to it.
export class Workspace extends DurableObject<Env> {
  #server: SyncServer | undefined;
  // Sorts inboxes with Workers AI after each change. Without AI (`THREADS_LOCAL_AI=off`) items stay unsorted.
  #triager: Triager | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (!env.API_TOKEN) void ctx.blockConcurrencyWhile(() => this.#startOverOnNewModels());
  }

  // Locally (no API_TOKEN), data written under other models is thrown away and the workspace seeds again, so changing
  // the models never needs a reset by hand; clients notice and load afresh. Hosted data is never thrown away.
  async #startOverOnNewModels(): Promise<void> {
    const { sql } = this.ctx.storage;
    sql.exec("CREATE TABLE IF NOT EXISTS schema (hash TEXT NOT NULL)");
    const stored = sql.exec<{ hash: string }>("SELECT hash FROM schema").toArray()[0]?.hash;
    if (stored === registry.schemaHash) return;
    await this.ctx.storage.deleteAll();
    sql.exec("CREATE TABLE IF NOT EXISTS schema (hash TEXT NOT NULL)");
    sql.exec("INSERT INTO schema (hash) VALUES (?)", registry.schemaHash);
  }

  // The object is named by its workspace (`getByName`).
  get #workspace(): string {
    return this.ctx.id.name!;
  }

  // Loaded from storage on first use; a new workspace is seeded.
  #load(): SyncServer {
    if (this.#server !== undefined) return this.#server;
    const server = threadsServer(sqliteStorage(this.ctx.storage), () => this.#sockets());
    if (server.deltas(ADMIN, 0).lastSyncId === 0) server.action(ADMIN, "seed", this.#workspace);
    const { AI: ai } = this.env as { AI?: Ai };
    if (ai !== undefined)
      this.#triager = new Triager(server, workersAiClassifier(ai), {
        onFailure: (retryAtMs) => void this.ctx.storage.setAlarm(retryAtMs),
      });
    this.#server = server;
    // Anything left unsorted, such as a fresh seed.
    this.#sort();
    return server;
  }

  #sort(): void {
    if (this.#triager !== undefined) this.ctx.waitUntil(this.#triager.kick());
  }

  #sockets(): Socket[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      return attachment === null ? [] : [this.#socket(ws, attachment)];
    });
  }

  #socket(ws: WebSocket, attachment: Attachment): Socket {
    return {
      session: attachment.session,
      get groups() {
        return attachment.groups;
      },
      set groups(groups) {
        attachment.groups = groups;
        ws.serializeAttachment(attachment);
      },
      send(message) {
        // A socket that's closing throws; it reconnects with a Hello.
        try {
          ws.send(JSON.stringify(message));
        } catch {}
      },
    };
  }

  // Retries sorting after the model failed.
  async alarm(): Promise<void> {
    this.#load();
    this.#sort();
  }

  async fetch(request: Request): Promise<Response> {
    const server = this.#load();
    // The sync socket hibernates while idle, so open connections cost next to nothing. It counts once it says Hello.
    if (new URL(request.url).pathname === "/sync/socket") {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      const { 0: client, 1: socket } = new WebSocketPair();
      this.ctx.acceptWebSocket(socket);
      return new Response(null, { status: 101, webSocket: client });
    }
    const response = await handleRequest(
      server,
      request,
      JSON.parse(request.headers.get(SESSION_HEADER)!),
    );
    // A commit may have new inbox items to sort.
    if (request.method === "POST") this.#sort();
    return response;
  }

  // The only message a client sends is its Hello; the server then sends what it missed and every commit after.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (ws.deserializeAttachment() !== null) return;
    const hello = JSON.parse(message as string) as Hello;
    const session = await authenticate(this.env, hello.token, this.#workspace);
    if (session === undefined) return ws.close(4401, "Unauthorized");
    const attachment: Attachment = { session };
    ws.serializeAttachment(attachment);
    this.#load().hello(this.#socket(ws, attachment), hello.lastSyncId);
  }

  webSocketClose(ws: WebSocket, code: number): void {
    ws.close(code, "closing");
  }
}

type Ctx = Context<{ Bindings: Env }>;

const tokenOf = (c: Ctx): string => c.req.header("Authorization")?.replace(/^Bearer\s*/, "") ?? "";
// The socket can't send headers, so it names its workspace with `?workspace=`.
const workspaceOf = (c: Ctx): string =>
  c.req.header("X-Workspace") ?? c.req.query("workspace") ?? "local";

const app = new Hono<{ Bindings: Env }>();

// The desktop renderer runs on its own origin, so it needs CORS to reach the API.
app.use(cors());

// Signing in (src/auth.ts): Better Auth's own routes, which the desktop app's main process calls, and where Google
// sends the browser back.
app.on(["GET", "POST"], "/api/auth/*", async (c) => (await createAuth(c.env)).handler(c.req.raw));

// Where the browser lands after signing in with Google, to hand the app its one-time code.
app.get("/", (c) => c.html(SIGNED_IN_PAGE));

// Trades a signed-in Better Auth session (its cookie) for the token the sync API takes, as the Person the email is
// invited as: hosted, a signed session token; locally, their id.
app.post("/auth/token", async (c) => {
  const auth = await createAuth(c.env);
  const signedIn = await auth.api.getSession({ headers: c.req.raw.headers });
  if (signedIn === null) return c.json({ error: "Not signed in" }, 401);
  const { email } = signedIn.user;
  const personId = personFor(c.env.INVITES, email);
  if (personId === undefined) return c.json({ error: "This email isn't invited to Threads" }, 403);
  const token = c.env.API_TOKEN
    ? await signSession(sessionSecret(c.env.API_TOKEN), {
        userId: personId,
        workspace: "local",
        expiresAtMs: Date.now() + SESSION_MS,
      })
    : personId;
  return c.json({ personId, email, token });
});

// Drafting a new thread from what you typed (src/compose.ts). It reads and writes nothing, so it runs here,
// outside any workspace.
app.post("/ai/compose", async (c) => {
  if ((await authenticate(c.env, tokenOf(c), workspaceOf(c))) === undefined)
    return c.json({ error: "Unauthorized" }, 401);
  const { AI: ai } = c.env as { AI?: Ai };
  if (ai === undefined) return c.json({ error: "No AI here" }, 503);
  const request = await c.req.json<ComposeRequest>();
  if (!(request.text?.length <= 4000 && request.people?.length <= 500))
    return c.json({ error: "Too long" }, 400);
  try {
    return c.json(await workersAiComposer(ai)(request));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "The model failed" }, 502);
  }
});

// The sync protocol goes to the workspace's object, with the session; the socket authenticates with its Hello.
app.on(["GET", "POST"], ["/sync/*", "/actions/*"], async (c) => {
  const workspace = workspaceOf(c);
  if (
    !WORKSPACES.includes(workspace) ||
    (workspace === "sample" && c.env.SAMPLE_WORKSPACE !== "on")
  )
    return c.json({ error: `Unknown workspace: ${workspace}` }, 404);
  const forwarded = new Request(c.req.raw);
  if (c.req.path !== "/sync/socket") {
    const session = await authenticate(c.env, tokenOf(c), workspace);
    if (session === undefined) return c.json({ error: "Unauthorized" }, 401);
    forwarded.headers.set(SESSION_HEADER, JSON.stringify(session));
  }
  const { exports } = c.executionCtx as ExecutionContext;
  return exports.Workspace.getByName(workspace).fetch(forwarded);
});

export default app;
