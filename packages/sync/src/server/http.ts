import type {
  BuiltInTransaction,
  Models,
  TransactionBatch,
  TransactionEnvelope,
} from "../protocol";
import { SyncError, type Session, type SyncServer } from "./server";

// Checks a request body is a well-formed batch: the product's own schemas for its transactions, `builtIn` for
// delete, archive and unarchive. Answers the batch, or why it isn't one.
export type ParseBatch<M extends Models, T extends TransactionEnvelope> = (
  body: unknown,
) => TransactionBatch<T | BuiltInTransaction<M>> | { error: string };

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

const MAX_BODY_BYTES = 1_000_000;

// The sync protocol's HTTP routes, for one workspace and an authenticated session:
//   GET  /sync/bootstrap[?groups=a,b]  every model the session sees (or only those groups', when it joins them)
//   GET  /sync/deltas?after=N         the actions after N, or a request to bootstrap afresh
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
      return json(server.bootstrap(session, groups === null ? undefined : groups.split(",")));
    }
    if (url.pathname === "/sync/deltas" && request.method === "GET") {
      const after = Number(url.searchParams.get("after"));
      if (!Number.isInteger(after) || after < 0) return json({ error: "Bad `after`" }, 400);
      return json(server.deltas(session, after));
    }
    if (url.pathname === "/sync/transactions" && request.method === "POST") {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) throw new SyncError(413, "The batch is too large");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: "The body isn't JSON" }, 400);
      }
      const batch = parse(body);
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
