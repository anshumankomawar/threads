import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  MODEL_NAMES,
  SCHEMA_HASH,
  type BootstrapResponse,
  type DeltasResponse,
  type Person,
  type TransactionBatchResponse,
} from "model";
import { z } from "zod";
import {
  EngineError,
  isWorkspaceName,
  seed,
  SyncEngine,
  transactionBatch,
  WORKSPACES,
  type WorkspaceName,
} from "./engine.ts";

function validate<Target extends "json" | "query", Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: z.prettifyError(result.error) }, 400);
  });
}

// Answers an engine error with its status, and rethrows anything else.
function fail(c: Context, error: unknown): Response {
  if (error instanceof EngineError) return c.json({ error: error.message }, error.status);
  throw error;
}

// The sync protocol for one workspace: bootstrap, catch-up deltas and transactions. The WebSocket that pushes
// delta packets lives with the Durable Object (src/worker.ts).
export function createWorkspaceApp(engine: SyncEngine) {
  const app = new Hono();

  // Everything a client needs to start: all models and the sync id they're current to.
  app.get("/sync/bootstrap", (c) => {
    const models = Object.fromEntries(
      MODEL_NAMES.map((name) => [name, [...engine.models[name].values()]]),
    ) as BootstrapResponse["models"];
    return c.json({
      lastSyncId: engine.lastSyncId,
      schemaHash: SCHEMA_HASH,
      models,
    } satisfies BootstrapResponse);
  });

  // The sync actions after a client's lastSyncId, for catching up.
  app.get(
    "/sync/deltas",
    validate("query", z.object({ after: z.coerce.number().int().min(0) })),
    (c) =>
      c.json({
        lastSyncId: engine.lastSyncId,
        actions: engine.actionsAfter(c.req.valid("query").after),
      } satisfies DeltasResponse),
  );

  // A batch of transactions, executed all or nothing. The changes reach clients as a delta packet; the response
  // carries the sync id the client waits for before treating the batch as complete.
  app.post("/sync/transactions", validate("json", transactionBatch), (c) => {
    const { actorId, transactions, utcOffsetMinutes } = c.req.valid("json");
    try {
      engine.execute(actorId, transactions, utcOffsetMinutes);
    } catch (error) {
      return fail(c, error);
    }
    return c.json({ lastSyncId: engine.lastSyncId } satisfies TransactionBatchResponse);
  });

  return app;
}

export type AppOptions = {
  now?: () => number;
  // Who the sample threads are addressed to.
  me?: Person;
};

// Every workspace in memory, picked per request with the X-Workspace header, for tests. The deployed Worker keeps
// each workspace in a Durable Object instead (src/worker.ts).
export function createApp({ now = Date.now, me = { id: "you", name: "You" } }: AppOptions = {}) {
  const apps = Object.fromEntries(
    WORKSPACES.map((name) => {
      const engine = new SyncEngine({ now });
      seed(engine, name, me, undefined, now());
      return [name, createWorkspaceApp(engine)];
    }),
  ) as Record<WorkspaceName, Hono>;
  const app = new Hono();
  app.use(cors());
  app.all("*", (c) => {
    const name = c.req.header("X-Workspace") ?? "local";
    if (!isWorkspaceName(name)) return c.json({ error: `Unknown workspace: ${name}` }, 400);
    return apps[name].fetch(c.req.raw);
  });
  return app;
}
