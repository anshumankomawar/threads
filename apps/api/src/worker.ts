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
import type { Admission } from "models/server";
import { createAuth, SIGNED_IN_PAGE } from "./auth.ts";
import { d1, Directory, suggestedName, type Membership, type Who } from "./directory.ts";
import { workersAiComposer } from "./compose.ts";
import { Triager, workersAiClassifier } from "./triage.ts";

// The demo workspace (local development only), seeded rather than made by its first member.
const SAMPLE = "sample";
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

// A socket's attachment, which survives hibernation: who said Hello. A socket has one once it said hello.
type Attachment = { session: Session };

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

  // Loaded from storage on first use; the sample is seeded, every other workspace is made by `admit`.
  #load(): SyncServer {
    if (this.#server !== undefined) return this.#server;
    const server = threadsServer(sqliteStorage(this.ctx.storage), () => this.#sockets());
    if (server.deltas(ADMIN, 0).lastSyncId === 0 && this.#workspace === SAMPLE)
      server.action(ADMIN, "seed", this.#workspace);
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
      greeted: true,
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

  // The only message a client sends is its Hello, again whenever what it follows changes; the server then sends how its
  // groups changed or what it missed, and every commit after.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const hello = JSON.parse(message as string) as Hello;
    const resolved = await authenticate(this.env, hello.token, this.#workspace);
    if (resolved === undefined) return ws.close(4401, "Unauthorized");
    const session = "userId" in resolved ? { ...resolved, subscribed: hello.subscribed } : resolved;
    const attachment: Attachment = { session };
    ws.serializeAttachment(attachment);
    this.#load().hello(this.#socket(ws, attachment), hello.lastSyncId);
  }
}

type Ctx = Context<{ Bindings: Env }>;

const tokenOf = (c: Ctx): string => c.req.header("Authorization")?.replace(/^Bearer\s*/, "") ?? "";
// The socket can't send headers, so it names its workspace with `?workspace=`.
const workspaceOf = (c: Ctx): string =>
  c.req.header("X-Workspace") ?? c.req.query("workspace") ?? "";

const app = new Hono<{ Bindings: Env }>();

// The desktop renderer runs on its own origin, so it needs CORS to reach the API.
app.use(cors());

// Signing in (src/auth.ts): Better Auth's own routes, which the desktop app's main process calls, and where Google
// sends the browser back.
app.on(["GET", "POST"], "/api/auth/*", async (c) => (await createAuth(c.env)).handler(c.req.raw));

// Where the browser lands after signing in with Google, to hand the app its one-time code.
app.get("/", (c) => c.html(SIGNED_IN_PAGE));

// The directory of workspaces (directory.ts), once per isolate.
let directory: Directory | undefined;
const directoryOf = (env: Env): Directory => (directory ??= new Directory(d1(env.AUTH_DB)));

// Who's signed in with Better Auth (its cookie), or null.
async function signedIn(c: Ctx) {
  const auth = await createAuth(c.env);
  return (await auth.api.getSession({ headers: c.req.raw.headers }))?.user ?? null;
}
// Them as the directory knows them: their address and the Workspace domain Google vouches for (auth.ts).
const whoIs = (user: { email: string; hostedDomain?: string | null }): Who => ({
  email: user.email,
  domain: user.hostedDomain ?? null,
});

// Makes sure a member's person is in their workspace's own data (the `admit` action), as they signed in. Done again on
// every token, so one that fails here (the workspace's object briefly unreachable) is done then instead.
async function admit(
  c: Ctx,
  member: Membership,
  user: { name: string; email: string; image?: string | null },
): Promise<void> {
  const admission: Admission = {
    workspace: { id: member.id, name: member.name },
    person: {
      id: member.personId,
      name: user.name || user.email.split("@")[0],
      email: user.email,
      avatarUrl: user.image ?? undefined,
    },
    role: member.role,
  };
  const { exports } = c.executionCtx as ExecutionContext;
  const response = await exports.Workspace.getByName(member.id).fetch(
    new Request("https://workspace/actions/admit", {
      method: "POST",
      headers: { [SESSION_HEADER]: JSON.stringify(ADMIN) },
      body: JSON.stringify(admission),
    }),
  );
  if (!response.ok) throw new Error(`Couldn't admit to ${member.id}: ${await response.text()}`);
}
const admitSoon = (c: Ctx, member: Membership, user: Parameters<typeof admit>[2]): Promise<void> =>
  admit(c, member, user).catch((error: unknown) => console.error(error));

// Where you can go once signed in (directory.ts's Choices), and what to call a workspace you make.
app.get("/onboarding", async (c) => {
  const user = await signedIn(c);
  if (user === null) return c.json({ error: "Not signed in" }, 401);
  const choices = await directoryOf(c.env).choices(whoIs(user));
  return c.json({
    ...choices,
    email: user.email,
    name: user.name,
    suggestedName: suggestedName(user.hostedDomain ?? null),
  });
});

// Makes a workspace, with you its admin: `{ name, openToDomain }`.
app.post("/workspaces", async (c) => {
  const user = await signedIn(c);
  if (user === null) return c.json({ error: "Not signed in" }, 401);
  const { name, openToDomain } = await c.req.json<{ name?: string; openToDomain?: boolean }>();
  const trimmed = name?.trim().slice(0, 60);
  if (!trimmed) return c.json({ error: "A workspace needs a name" }, 400);
  const member = await directoryOf(c.env).create(whoIs(user), trimmed, openToDomain === true);
  await admitSoon(c, member, user);
  return c.json(member);
});

// Joins a workspace you're invited to, or one open to your company's domain.
app.post("/workspaces/:id/join", async (c) => {
  const user = await signedIn(c);
  if (user === null) return c.json({ error: "Not signed in" }, 401);
  const member = await directoryOf(c.env).join(c.req.param("id"), whoIs(user));
  if (member === undefined) return c.json({ error: "You can't join that workspace" }, 403);
  await admitSoon(c, member, user);
  return c.json(member);
});

// Who's invited to a workspace of yours and hasn't joined (GET), and inviting more (POST `{ emails }`). No email is
// sent: they see the workspace when they next sign in.
app.on(["GET", "POST"], "/workspaces/:id/invites", async (c) => {
  const user = await signedIn(c);
  if (user === null) return c.json({ error: "Not signed in" }, 401);
  const id = c.req.param("id");
  const dir = directoryOf(c.env);
  if ((await dir.membership(id, whoIs(user))) === undefined)
    return c.json({ error: "Not a member" }, 403);
  if (c.req.method === "POST") {
    const { emails } = await c.req.json<{ emails?: string[] }>();
    const valid = (emails ?? []).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
    if (valid.length === 0 || valid.length > 50) return c.json({ error: "No addresses" }, 400);
    await dir.invite(id, user.name || user.email, valid);
  }
  return c.json({ invited: await dir.invited(id) });
});

// Trades a signed-in Better Auth session for the token the sync API takes, in one of your workspaces (`{ workspace }`,
// or your first): hosted, a signed session token; locally, the person's id. 409 when you have none yet.
app.post("/auth/token", async (c) => {
  const user = await signedIn(c);
  if (user === null) return c.json({ error: "Not signed in" }, 401);
  const { workspace } = await c.req
    .json<{ workspace?: string }>()
    .catch(() => ({ workspace: undefined }));
  const { workspaces } = await directoryOf(c.env).choices(whoIs(user));
  const member = workspaces.find((w) => w.id === workspace) ?? workspaces[0];
  if (member === undefined) return c.json({ error: "No workspace yet" }, 409);
  await admit(c, member, user);
  const token = c.env.API_TOKEN
    ? await signSession(sessionSecret(c.env.API_TOKEN), {
        userId: member.personId,
        workspace: member.id,
        expiresAtMs: Date.now() + SESSION_MS,
      })
    : member.personId;
  return c.json({
    personId: member.personId,
    email: user.email,
    token,
    workspace: member.id,
    workspaces: workspaces.map(({ id, name }) => ({ id, name })),
  });
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

// The sync protocol goes to the workspace's object, with the session; the socket authenticates with its Hello. Who's
// asking is settled before the directory is: a stranger's guesses at workspace ids never reach D1.
app.on(["GET", "POST"], ["/sync/*", "/actions/*"], async (c) => {
  const workspace = workspaceOf(c);
  const forwarded = new Request(c.req.raw);
  if (c.req.path !== "/sync/socket") {
    const session = await authenticate(c.env, tokenOf(c), workspace);
    if (session === undefined) return c.json({ error: "Unauthorized" }, 401);
    forwarded.headers.set(SESSION_HEADER, JSON.stringify(session));
  }
  const known =
    workspace === SAMPLE
      ? c.env.SAMPLE_WORKSPACE === "on"
      : await directoryOf(c.env).exists(workspace);
  if (!known) return c.json({ error: `Unknown workspace: ${workspace}` }, 404);
  const { exports } = c.executionCtx as ExecutionContext;
  return exports.Workspace.getByName(workspace).fetch(forwarded);
});

export default app;
