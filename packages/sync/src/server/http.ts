import type {
  BuiltInTransaction,
  LoadRequest,
  Models,
  TransactionBatch,
  TransactionEnvelope,
} from "../protocol";
import { encodeBootstrap } from "../wire";
import { SyncError, type Session, type SyncServer } from "./server";

// Checks a request body is a well-formed batch: the product's own schemas for its transactions, and the built-in delete,
// archive and unarchive. Answers the batch, or why it isn't one.
export type ParseBatch<M extends Models, T extends TransactionEnvelope> = (
  body: unknown,
) => TransactionBatch<T | BuiltInTransaction<M>> | { error: string };

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

const MAX_BODY_BYTES = 1_000_000;
const MAX_LOAD_REQUESTS = 100;

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new SyncError(413, "The request is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new SyncError(400, "The body isn't JSON");
  }
}

function loadRequests(body: unknown): LoadRequest[] {
  const requests = (body as { requests?: unknown } | null)?.requests;
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > MAX_LOAD_REQUESTS)
    throw new SyncError(400, "Expected 1 to 100 requests");
  return requests.map((request: unknown) => {
    const { modelName, key, value } = (request ?? {}) as Record<string, unknown>;
    if (
      typeof modelName !== "string" ||
      (key !== undefined && typeof key !== "string") ||
      (value !== undefined && typeof value !== "string") ||
      (key === undefined) !== (value === undefined)
    )
      throw new SyncError(400, "A request is a model, and optionally a key and its value");
    return { modelName, key, value } as LoadRequest;
  });
}

// The sync protocol's HTTP routes, for one workspace and an authenticated session:
//   GET  /sync/bootstrap[?groups=a,b]  the models that load at start, as lines (`encodeBootstrap`); only those groups'
//                                      when it joins them
//   GET  /sync/deltas?after=N         the actions after N, or a request to bootstrap afresh
//   POST /sync/batch                  `{ requests }`: lazy and partial models (`LoadRequest`)
//   POST /sync/transactions           a batch, all or nothing; answers the lastSyncId that completes it
// Answers undefined for any other route.
export async function handleSyncRequest<M extends Models, T extends TransactionEnvelope>(
  server: SyncServer<M, T>,
  request: Request,
  session: Session,
  parse: ParseBatch<M, T>,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/sync/bootstrap" && request.method === "GET") {
      const groups = url.searchParams.get("groups");
      const lines = encodeBootstrap(
        server.bootstrap(session, groups === null ? undefined : groups.split(",")),
      );
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          pull(controller) {
            const next = lines.next();
            if (next.done) controller.close();
            else controller.enqueue(encoder.encode(next.value));
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    }
    if (url.pathname === "/sync/deltas" && request.method === "GET") {
      const after = Number(url.searchParams.get("after"));
      if (!Number.isInteger(after) || after < 0) return json({ error: "Bad `after`" }, 400);
      return json(server.deltas(session, after));
    }
    if (url.pathname === "/sync/batch" && request.method === "POST")
      return json(server.load(session, loadRequests(await readJson(request))));
    if (url.pathname === "/sync/transactions" && request.method === "POST") {
      const batch = parse(await readJson(request));
      if ("error" in batch) return json({ error: batch.error }, 400);
      server.execute(batch, session);
      return json({ lastSyncId: server.lastSyncId });
    }
  } catch (error) {
    if (error instanceof SyncError) return json({ error: error.message }, error.status);
    throw error;
  }
  return undefined;
}
