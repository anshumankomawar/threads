import { DurableObject } from "cloudflare:workers";
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { AnyRecord, ModelName, ModelRecords } from "model";
import {
  broadcast,
  isAdmin,
  receive,
  signSession,
  sqliteStorage,
  verifySession,
  type HubSocket,
  type Session,
} from "sync/server";
import { z } from "zod";
import { composeRequest, openSession, serveWorkspace } from "./app.ts";
import { createAuth, personFor } from "./auth.ts";
import { workersAiComposer } from "./compose.ts";
import {
  ensureOrganization,
  isWorkspaceName,
  refreshSeedPeople,
  SAMPLE_ME,
  seed,
  SyncEngine,
  type WorkspaceName,
} from "./engine.ts";
import { Triager, workersAiClassifier } from "./triage.ts";

// Request details a Workspace object needs. The desktop app sends them as headers; a browser WebSocket can't set
// headers, so the sync socket passes them as query parameters instead.
function param(request: Request, header: string, query: string): string | null {
  return request.headers.get(header) ?? new URL(request.url).searchParams.get(query);
}

// The Worker checks who's asking and passes the session to the workspace's object in this header, replacing any the
// request came with. Only the Worker reaches the objects, so they trust it.
const SESSION_HEADER = "X-Threads-Session";

// Past this many actions in the log, it's trimmed back to the last `KEEP_ACTIONS`; a client further behind than that
// bootstraps afresh.
const KEEP_ACTIONS = 10_000;
const COMPACT_AT = 12_000;

// What a socket remembers through hibernation: who it is and the sync groups it was last told about.
type SocketAttachment = { session: Session; groups: string[] };

// One workspace: its sync engine (the sync package's server, running Threads' rules) with its models, log and executed
// transactions in this object's SQLite storage, and the WebSockets of every client connected to it. Each committed
// batch goes out to all of them, each seeing what its session may.
export class Workspace extends DurableObject<Env> {
  #engine: SyncEngine | undefined;
  #kept: { modelName: ModelName; data: AnyRecord }[] = [];
  // Sorts inboxes with Workers AI after each change.
  #triager: Triager | undefined;

  // Starts the workspace over: deletes everything, so the next request seeds it afresh with a new epoch. Connected
  // clients are dropped; they reconnect, see the new epoch and rebuild.
  async #reset(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) socket.close(1012, "Workspace reset");
    // A wipe is for threads; the organization, its labels and its groups stay.
    this.#kept = this.ctx.storage.sql
      .exec<{ modelName: ModelName; data: string }>(
        "SELECT modelName, data FROM models WHERE modelName IN ('Organization', 'Label', 'Group')",
      )
      .toArray()
      .map((row) => ({ modelName: row.modelName, data: JSON.parse(row.data) as AnyRecord }));
    await this.ctx.storage.deleteAll();
    this.#engine = undefined;
    this.#triager = undefined;
  }

  // The workspace's engine, loaded from storage on first use. A new workspace is seeded.
  #load(name: WorkspaceName): SyncEngine {
    if (this.#engine !== undefined) return this.#engine;
    const storage = sqliteStorage<ModelRecords>(this.ctx.storage);
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('workspace', ?)",
      name,
    );
    // The engine's events go to the Worker's logs (observability is on), one JSON line each.
    const engine = new SyncEngine({
      storage,
      onEvent: (event) => console.log(JSON.stringify({ workspace: name, ...event })),
    });
    engine.onCommit = (actions) => broadcast(engine, this.#sockets(), actions);
    if (engine.isEmpty) seed(engine, name, SAMPLE_ME);
    refreshSeedPeople(engine, name, SAMPLE_ME);
    ensureOrganization(engine, name);
    this.#engine = engine;
    // Local dev without Cloudflare access has no AI (`THREADS_LOCAL_AI=off`), so threads wait under "Sorting".
    const { AI: ai } = this.env as { AI?: Ai };
    this.#triager =
      ai === undefined
        ? undefined
        : new Triager(engine, workersAiClassifier(ai), {
            // Try again in a minute, even if nothing else changes.
            onFailure: (retryAtMs) => void this.ctx.storage.setAlarm(retryAtMs),
          });
    // Anything left unsorted, such as a fresh seed or threads the model failed on before a restart.
    this.#sort();
    return engine;
  }

  // The connected clients, as the engine's broadcast needs them.
  #sockets(): (HubSocket & { raw: WebSocket })[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment === null) return [];
      return [
        {
          raw: socket,
          session: attachment.session,
          groups: attachment.groups,
          setGroups: (groups) => socket.serializeAttachment({ ...attachment, groups }),
          send: (message) => socket.send(message),
        },
      ];
    });
  }

  #sort(): void {
    if (this.#triager !== undefined) this.ctx.waitUntil(this.#triager.kick());
  }

  // The workspace this object is, as recorded when it first loaded, for work that arrives without a request: the retry
  // alarm, and socket messages after hibernation.
  #stored(): SyncEngine | undefined {
    if (this.#engine !== undefined) return this.#engine;
    const [row] = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'workspace'")
      .toArray();
    return row === undefined || !isWorkspaceName(row.value) ? undefined : this.#load(row.value);
  }

  // Retries sorting after the model failed.
  async alarm(): Promise<void> {
    const loaded = this.#engine !== undefined;
    if (this.#stored() !== undefined && loaded) this.#sort();
  }

  async fetch(request: Request): Promise<Response> {
    const name = param(request, "X-Workspace", "workspace") ?? "local";
    if (!isWorkspaceName(name))
      return Response.json({ error: `Unknown workspace: ${name}` }, { status: 400 });
    const session = JSON.parse(request.headers.get(SESSION_HEADER) ?? "null") as Session | null;
    if (session === null) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { pathname } = new URL(request.url);
    if (pathname === "/sync/reset" && request.method === "POST") {
      if (!isAdmin(session)) return Response.json({ error: "Forbidden" }, { status: 403 });
      await this.#reset();
    }
    const engine = this.#load(name);
    if (pathname === "/sync/reset") {
      if (this.#kept.length > 0) engine.restore(this.#kept);
      this.#kept = [];
      return Response.json({ lastSyncId: engine.lastSyncId });
    }

    // The sync socket: a handshake with where the server stands, then a delta packet per committed batch. It
    // hibernates while idle, so open connections cost next to nothing.
    if (pathname === "/sync/ws") {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        session,
        groups: engine.groupsOf(session),
      } satisfies SocketAttachment);
      server.send(JSON.stringify(engine.handshake(session)));
      return new Response(null, { status: 101, webSocket: client });
    }

    const response = await serveWorkspace(engine, request, session);
    if (pathname === "/sync/transactions" && response.ok) {
      // New or changed threads may need sorting into someone's buckets.
      this.#sort();
      if (engine.lastSyncId - engine.minSyncId > COMPACT_AT)
        engine.compact({ keepActions: KEEP_ACTIONS });
    }
    return response;
  }

  // Clients ping to keep the connection alive through proxies, and send ephemeral values (who's looking at what), which
  // go to every other client that can see the record and are never stored.
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === "ping") return socket.send("pong");
    const engine = this.#stored();
    if (engine === undefined || typeof message !== "string") return;
    const sockets = this.#sockets();
    const from = sockets.find((candidate) => candidate.raw === socket);
    if (from !== undefined) receive(engine, sockets, from, message);
  }

  webSocketClose(socket: WebSocket, code: number): void {
    socket.close(code, "closing");
  }
}

// How long a session token lasts.
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

// Who a request is from. With an API_TOKEN secret set (the hosted API), it needs a token: the API token itself is an
// admin session (it sees everything and acts as anyone, for operators and the app's View As), and a session token
// (minted by POST /auth/session) is that one person. The socket, which can't send headers, passes it as `token`.
// Locally the secret is unset and the API is open (`openSession`). Undefined means not signed in.
async function authenticate(c: Context<{ Bindings: Env }>, workspace: string) {
  const apiToken = c.env.API_TOKEN;
  if (!apiToken) return openSession(c.req.raw);
  const given = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? c.req.query("token");
  if (given === undefined || given === "") return undefined;
  if (await same(given, apiToken)) return { admin: true } satisfies Session;
  const claims = await verifySession(sessionSecret(apiToken), given, workspace);
  return claims === undefined ? undefined : ({ userId: claims.userId } satisfies Session);
}

const app = new Hono<{ Bindings: Env }>();

// The desktop renderer runs on its own origin, so it needs CORS to reach the API.
app.use(cors());

// A session token for one person in one workspace, for an admin to hand out. Until there's a sign-in, the app mints
// its own with the API token for whoever it's viewing as.
app.post(
  "/auth/session",
  zValidator("json", z.object({ workspace: z.string(), personId: z.string().min(1) })),
  async (c) => {
    const { workspace, personId } = c.req.valid("json");
    const session = await authenticate(c, workspace);
    if (session === undefined) return c.json({ error: "Unauthorized" }, 401);
    if (!isAdmin(session)) return c.json({ error: "Only an admin hands out sessions" }, 403);
    const expiresAtMs = Date.now() + SESSION_MS;
    const apiToken = c.env.API_TOKEN;
    // Locally there's no secret and no need for a token: `X-User` says who you are.
    if (!apiToken) return c.json({ token: null, expiresAtMs });
    const token = await signSession(sessionSecret(apiToken), {
      userId: personId,
      workspace,
      expiresAtMs,
    });
    return c.json({ token, expiresAtMs });
  },
);

// Signing in (src/auth.ts): Better Auth's own routes, which the sign-in page (apps/web) calls.
app.on(["GET", "POST"], "/api/auth/*", async (c) => (await createAuth(c.env)).handler(c.req.raw));

// Trades a signed-in Better Auth session (the sign-in page's cookie) for the Threads session token the sync API takes,
// as the Person the email is invited as. Locally there are no tokens (`X-User` says who you are), so it's null there.
app.post("/auth/token", async (c) => {
  const auth = await createAuth(c.env);
  const signedIn = await auth.api.getSession({ headers: c.req.raw.headers });
  if (signedIn === null) return c.json({ error: "Not signed in" }, 401);
  const personId = personFor(c.env, signedIn.user.email);
  if (personId === undefined) return c.json({ error: "This email isn't invited to Threads" }, 403);
  const workspace = "local";
  const expiresAtMs = Date.now() + SESSION_MS;
  const apiToken = c.env.API_TOKEN;
  const token = apiToken
    ? await signSession(sessionSecret(apiToken), { userId: personId, workspace, expiresAtMs })
    : null;
  return c.json({ personId, email: signedIn.user.email, workspace, token, expiresAtMs });
});

// Drafting a new thread from what you typed (src/compose.ts). It reads and writes nothing, so it runs here, outside
// any workspace.
app.post("/ai/compose", zValidator("json", composeRequest), async (c) => {
  if ((await authenticate(c, "local")) === undefined) return c.json({ error: "Unauthorized" }, 401);
  const { AI: ai } = c.env as { AI?: Ai };
  if (ai === undefined) return c.json({ error: "No AI here" }, 503);
  try {
    return c.json(await workersAiComposer(ai)(c.req.valid("json")));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "The model failed" }, 502);
  }
});

// Each workspace lives in its own Durable Object, picked with X-Workspace (or `workspace` on the socket).
app.all("*", async (c): Promise<Response> => {
  const name = param(c.req.raw, "X-Workspace", "workspace") ?? "local";
  if (!isWorkspaceName(name)) return c.json({ error: `Unknown workspace: ${name}` }, 400);
  if (name === "sample" && c.env.SAMPLE_WORKSPACE !== "on")
    return c.json({ error: "The sample workspace is only served locally" }, 404);
  const session = await authenticate(c, name);
  if (session === undefined) return c.json({ error: "Unauthorized" }, 401);
  const forwarded = new Request(c.req.raw);
  forwarded.headers.set(SESSION_HEADER, JSON.stringify(session));
  const { exports } = c.executionCtx as ExecutionContext;
  return exports.Workspace.getByName(name).fetch(forwarded);
});

export default app;
