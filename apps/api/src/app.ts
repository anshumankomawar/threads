import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Person } from "model";
import { handleSyncRequest, type Session } from "sync/server";
import { z } from "zod";
import {
  ensureOrganization,
  isWorkspaceName,
  parseBatch,
  seed,
  SyncEngine,
  WORKSPACES,
  type WorkspaceName,
} from "./engine.ts";

// What the app sends to draft a thread (POST /ai/compose, in src/worker.ts).
export const composeRequest = z.object({
  author: z.object({ id: z.string(), name: z.string() }),
  people: z.array(z.object({ id: z.string(), name: z.string() })).max(500),
  text: z.string().min(1).max(4000),
});

// Who a request is from where there's no auth (local development, tests): the person in `X-User` (`user` on the
// socket, which can't send headers), or an admin session that sees everything and acts as anyone.
export function openSession(request: Request): Session {
  const userId =
    request.headers.get("X-User") ?? new URL(request.url).searchParams.get("user") ?? "";
  return userId === "" ? { admin: true } : { userId };
}

// The sync protocol for one workspace and session: bootstrap, catch-up deltas and transactions (the engine's routes,
// `handleSyncRequest`). The WebSocket that pushes delta packets lives with the Durable Object (src/worker.ts).
export async function serveWorkspace(
  engine: SyncEngine,
  request: Request,
  session: Session,
): Promise<Response> {
  return (
    (await handleSyncRequest(engine, request, session, parseBatch)) ??
    Response.json({ error: "Not found" }, { status: 404 })
  );
}

export type AppOptions = {
  now?: () => number;
  // Who the sample threads are addressed to.
  me?: Person;
};

// Every workspace in memory, picked per request with the X-Workspace header and open to anyone, for tests. The
// deployed Worker keeps each workspace in a Durable Object and checks who's asking (src/worker.ts).
export function createApp({ now = Date.now, me = { id: "you", name: "You" } }: AppOptions = {}) {
  const engines = Object.fromEntries(
    WORKSPACES.map((name) => {
      const engine = new SyncEngine({ now });
      seed(engine, name, me, now());
      ensureOrganization(engine, name);
      return [name, engine];
    }),
  ) as Record<WorkspaceName, SyncEngine>;
  const app = new Hono();
  app.use(cors());
  app.all("*", async (c) => {
    const name = c.req.header("X-Workspace") ?? "local";
    if (!isWorkspaceName(name)) return c.json({ error: `Unknown workspace: ${name}` }, 400);
    return serveWorkspace(engines[name], c.req.raw, openSession(c.req.raw));
  });
  return app;
}
