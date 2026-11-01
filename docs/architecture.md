# Architecture

How data moves through threads, and how to change it without breaking sync. Read this before touching models,
the API, or anything in `apps/desktop/src/renderer/src/sync`.

The design follows Linear's sync engine (LSE), as documented in the reverse-engineered write-up at
https://github.com/wzhudev/reverse-linear-sync-engine. Use the write-up for reference. Never copy from the Linear
bundles in that repo (`code/*.js`); they are Linear's proprietary code.

## The idea in one paragraph

Each workspace has exactly one writer: a Cloudflare Durable Object running `SyncEngine`. Clients never write data
directly. They send **transactions**; the engine validates them, adds side effects, and numbers every resulting
change with the next **sync id** (a per-workspace counter that only goes up). The numbered changes, **sync
actions**, are saved to a log and broadcast to every connected client as a **delta packet**. Clients apply packets
in sync id order, so everyone converges on the same data. Clients show their own edits immediately (optimistically)
and reconcile when the server's version arrives.

```
Desktop app                                              Cloudflare
───────────                                              ──────────
React UI ──reads──▶ ObjectPool (MobX)                    Worker (Hono): token check, route by workspace
   │ edits              ▲                                          │
   ▼                    │ applies deltas                           ▼
TransactionQueue ───────┼───── POST /sync/transactions ──▶ Durable Object "Workspace"
   │ saves              │                                    SyncEngine (single writer)
   ▼                    │                                    SQLite: models, sync_actions, transactions
IndexedDB ◀─ SyncClient ◀────── delta packets (WebSocket) ◀──┘
```

## Where things live

| Path                                                 | What it is                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/model/src/model.ts`                        | The app's view types (`Thread` with nested `Entry`s and `Person`s), labels, `waitingOn`                                                                           |
| `packages/model/src/sync.ts`                         | The sync protocol: records, `ModelRegistry`, `SCHEMA_HASH`, `SyncAction`, `TransactionInput`, records ↔ `Thread` conversion, `threadFromCreate`/`entryFromCreate` |
| `packages/model/src/sample.ts`                       | Seed data: local people, the sample team and threads                                                                                                              |
| `apps/api/src/engine.ts`                             | `SyncEngine`: transaction validation (zod), business rules and side effects, sync ids, the log, seeding                                                           |
| `apps/api/src/worker.ts`                             | The `Workspace` Durable Object (SQLite storage, WebSocket, broadcast) and the Worker entry (token, routing)                                                       |
| `apps/api/src/app.ts`                                | HTTP routes for one workspace; `createApp` runs all workspaces in memory for tests                                                                                |
| `apps/desktop/src/renderer/src/sync/syncClient.ts`   | `SyncClient`: bootstrap, socket, applying deltas, rebasing, the change methods the UI calls                                                                       |
| `apps/desktop/src/renderer/src/sync/transactions.ts` | `CreationTransaction`, `UpdateTransaction`, `TransactionQueue`                                                                                                    |
| `apps/desktop/src/renderer/src/sync/database.ts`     | IndexedDB (and an in-memory version for tests)                                                                                                                    |
| `apps/desktop/src/renderer/src/sync/objectPool.ts`   | The observable in-memory models                                                                                                                                   |
| `apps/desktop/src/renderer/src/api.ts`               | Data sources (Cloudflare / Local / Sample) and the HTTP + WebSocket transport                                                                                     |

## Models

Data is normalized into flat records linked by id, like database rows:

- **Person**: `id`, `name`, optional `level`, `role`, `managerId` (builds the org tree).
- **Thread**: one ask, meeting or focus block. References people by id: `requesterId`, `assigneeId`,
  `attendeeIds`. Has `status`, `priority`, `dueAtMs`, `schedule`, `createdAtMs`, `updatedAtMs`.
- **Entry**: one item in a thread's log, referencing `threadId`. Kinds: `message` (`authorId`, `text`,
  `decision`), `event` (activity line: `actorId`, `text`), `resolution`, `call` (`link`), `notes`.

The UI never works with records. `toThreads()` resolves references into the nested `Thread` shape from
`model.ts`, which is what components receive. Keep components on that shape; convert at the edge.

`ModelRegistry` lists each model's references. `SCHEMA_HASH` is a hash of it plus a version suffix; clients whose
cache was built under a different hash discard it and do a full bootstrap.

## The protocol

All routes take the workspace in `X-Workspace` (`local` or `sample`; the socket uses `?workspace=`). The hosted API
also needs `Authorization: Bearer <API_TOKEN>` (`?token=` on the socket).

| Route                      | Purpose                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /sync/bootstrap`      | Every model plus the `lastSyncId` they're current to                                                                 |
| `GET /sync/deltas?after=N` | Sync actions with id > N, for catching up                                                                            |
| `POST /sync/transactions`  | `{ actorId, utcOffsetMinutes, transactions }`, executed all or nothing; answers `{ lastSyncId }`                     |
| `GET /sync/ws` (WebSocket) | First message `{ type: "handshake", lastSyncId }`, then `{ type: "delta", lastSyncId, actions }` per committed batch |

A **sync action** is `{ id, modelName, modelId, action: "I" | "U" | "D", data }`. Inserts and updates carry the
whole record.

A **transaction** is a create or update of a client-writable model (`Thread`, `Entry`). Ids for new models are
made on the client (`crypto.randomUUID()`), so later transactions in the same batch can refer to them.

## The write path

1. The UI calls a `SyncClient` method (`createThread`, `updateThread`, `addEntry`, `setDecision`).
2. It builds a `CreationTransaction` or `UpdateTransaction` and enqueues it. The transaction applies itself to the
   `ObjectPool` straight away; an update remembers the values it replaced (`original`).
3. Transactions made in the same tick share a `batchIndex`. At the end of the tick they move from
   `createdTransactions` to `queuedTransactions` and are saved to IndexedDB's `__transactions`.
4. `dequeue` sends the next batch (same `batchIndex` and `actorId`) to `POST /sync/transactions`; it sits in
   `executingTransactions`.
5. The server's `SyncEngine.execute` stages every write in a `Batch`, runs validation and side effects, then
   `write` numbers each staged write with the next sync id, persists them (models, log, transaction ids) in one
   SQLite transaction, applies them in memory, and broadcasts the delta packet.
6. On success the client moves the batch to `completedButUnsyncedTransactions` with
   `syncIdNeededForCompletion = lastSyncId` and deletes it from `__transactions`. When a delta with that id has been
   applied, the transaction is done.
7. On a refusal (HTTP 4xx → `RejectedError`) the batch rolls back, newest first. On a network or 5xx error it goes
   back to the front of the queue and is retried; the server ignores transaction ids it has already executed.

## The read path

- **Delta packets** are applied one at a time (`#updateLock`). For each action the client writes the confirmed
  record to IndexedDB, then sets it in the pool with any pending `UpdateTransaction`s for that model rebased on top
  (their `original` becomes the server's value; their change stays visible). Then `lastSyncId` advances and
  `progressQueue` completes waiting transactions.
- **Gaps**: if a packet's first id isn't `lastSyncId + 1`, the client fetches `/sync/deltas?after=lastSyncId`.
- **Startup**: with a cache under the current schema hash, load models from IndexedDB, replay saved transactions,
  connect. The handshake then decides: server ahead → fetch missed deltas; server behind (its data was reset) →
  full bootstrap; equal → nothing. Without a usable cache → `/sync/bootstrap` first.
- **Reconnect**: the socket reconnects with backoff (1s doubling to 10s); each reconnect handshakes and catches up.

## Invariants

Breaking any of these breaks sync. Agents: check your change against this list.

1. **One writer per workspace.** Every server-side change goes through `SyncEngine.write` (client transactions via
   `execute`, seeds via `seed`). Never write to SQLite or `engine.models` directly.
2. **Every change gets a sync id and lands in the log.** No out-of-band updates. If clients need to see it, it's a
   sync action.
3. **Persist first.** `write` saves to storage before applying in memory or broadcasting. Keep that order.
4. **Batches are atomic.** Validation errors throw `EngineError` before anything is written. Don't write in
   `#apply`; stage with `batch.put` and let `write` commit.
5. **Side effects live on the server.** Activity lines, call links, closing a thread on resolution, bumping
   `updatedAtMs`: all in `SyncEngine.#apply`. Clients don't send them and don't need to predict them.
6. **Side-effect ids are deterministic** (`${transaction.id}:${index}`, `${threadId}:call`), so a resent
   transaction can't create duplicates.
7. **IndexedDB `models` holds only server-confirmed data.** Local edits live in the pool and `__transactions`,
   never in `models`.
8. **The pool is the only thing the UI reads.** Components get resolved `Thread`/`Person` objects from
   `SyncClient.threads`/`people`; they never fetch.
9. **Clients make ids for new models.** Don't let the server assign ids for client-created models.
10. **Times shown in text use the actor's time zone.** The server runs in UTC; use `utcOffsetMinutes` (activity
    lines) and `X-UTC-Offset` (seeding).
11. **No REST endpoints.** The API is the sync protocol only. New capabilities are new transaction types or models.

## How to make common changes

### Add a field to an existing model

1. Add it to the record type in `sync.ts` (and to `Thread`/`Entry`/`Person` in `model.ts` if the UI needs it), and
   map it in `toThread`/`toEntry` and `fromThread`.
2. If clients can set it: add it to `ThreadChanges` (or the relevant create type) in `sync.ts` and to the zod
   schema in `engine.ts` (`threadChanges`, `threadCreate`, ...).
3. If changing it should leave an activity line, add a case to `describeChanges` in `engine.ts`.
4. Bump the `SCHEMA_HASH` version suffix in `sync.ts` (`"|records:vN"`) so clients rebuild their caches.
5. Add the UI: call `client.updateThread(id, { field }, me)` from `App.tsx`'s actions.
6. Tests: an API test in `apps/api/tests/app.test.ts`; a client test in `apps/desktop/tests/sync.test.ts` if the
   client logic changes.

### Add a new model

1. Add the record type and add it to `ModelRecords`, `MODEL_NAMES` and `ModelRegistry` in `sync.ts`. Bump the
   schema version.
2. Add its map to `emptyModels` in `engine.ts` and to `ObjectPool.maps`.
3. If clients create or update it: add `TransactionInput` variants, zod schemas, and an `#apply` branch in
   `engine.ts`; add a `SyncClient` method that enqueues a `CreationTransaction`/`UpdateTransaction`, and handle the
   new kind in `CreationTransaction.record()`.
4. Expose it to the UI as a computed getter on `SyncClient` (resolve references there, like `threads`).
5. Seed it in `seed()` if workspaces should start with some.

### Add a side effect

Put it in `SyncEngine.#apply` next to the transaction that causes it, staged with `batch.put`, with a
deterministic id. It reaches clients automatically in the same delta packet.

### Add validation or a business rule

Shape checks go in the zod schemas (`engine.ts`); rules that need data (does this person exist, is this a message)
go in `#apply` and throw `EngineError(400 | 404 | 409, message)`. The whole batch is refused and the client rolls
back.

### Change sample or local seed data

Edit `packages/model/src/sample.ts`. Existing workspaces keep their stored threads; seeded **people** refresh
automatically on load (`refreshSeedPeople`). To see new sample threads, reset the local Worker's state (delete
`apps/api/.cloudflare/state/v3/do` with the API stopped); clients notice and rebuild.

## Testing and running

- `vp test` in `apps/api`: the protocol over in-memory engines (`createApp`).
- `vp test` in `apps/desktop`: `SyncClient` against a fake server and in-memory database, plus UI logic.
- `vp check` at the root: format, lint, types.
- `vp run dev` at the root runs the local Worker and the app; see AGENTS.md for data sources and deploying.
- Deploy API changes with `vp run api#deploy` from the repo root (needs `cf auth login` on the Threads account and
  the token as a secrets file, or the secret may be dropped). Clients built against an older protocol need to pull
  and restart.

## Not built yet

Deliberately left out until there's a need; follow the LSE write-up when adding them.

- **Undo/redo**: transaction-based, each transaction producing its inverse.
- **Sync groups**: per-user or per-team visibility, which needs real accounts (Cloudflare Access, D1 for users and
  orgs).
- **Lazy and partial loading**: loading some models on demand, for workspaces too big to bootstrap whole.
- **Deletions and archiving**: the protocol supports `D` actions, but no transaction type deletes or archives yet.
