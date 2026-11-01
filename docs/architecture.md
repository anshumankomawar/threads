# Architecture

How data moves through threads, and how to change it without breaking sync. Read this before touching models,
the API, or anything in `apps/desktop/src/renderer/src/sync`.

The design follows Linear's sync engine (LSE), as documented in the reverse-engineered write-up at
https://github.com/wzhudev/reverse-linear-sync-engine. Use the write-up for reference. Never copy from the Linear
bundles in that repo (`code/*.js`); they are Linear's proprietary code.

## The product principle: the thread is the atomic unit

Everything in the app is a thread: an ask, a meeting, a focus block, a side discussion. Don't invent new kinds of
objects or special thread types for a new use case; express it with what a thread already has (people, schedule,
status, entries) or a small field on it, and keep the code and the UX consolidated around that one unit. Branching
is the model: a side discussion is an ordinary thread with `branchedFromId`, linked from a message by
`[[thread:<id>]]`, not a "sub-thread" type. When a change seems to need a new type, look for the thread-shaped way
first, and prefer removing distinctions over adding them.

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
| `apps/api/src/scheduler.ts`                          | `planSchedule`: where one person's threads go; `WORKING_HOURS`                                                                                                    |
| `packages/model/src/score.ts`                        | `threadScore`, `TAGS`, effort options: how important a thread is, shared by the API and the desktop app                                                           |
| `apps/api/src/worker.ts`                             | The `Workspace` Durable Object (SQLite storage, WebSocket, broadcast, morning alarm) and the Worker entry (token, routing)                                        |
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
  `attendeeIds`. Has `status` (`open`, `blocked`, `closed`), `priority`, `dueAtMs`, `effortHours`, `tagIds`, `schedule`,
  `createdAtMs`, `updatedAtMs`.
- **Entry**: one item in a thread's log, referencing `threadId`. Kinds: `message` (`authorId`, `text`),
  `event` (activity line: `actorId`, `text`), `resolution`, `call` (`link`), `notes`.

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

A **transaction** is a create of a `Thread` or `Entry`, an update of a `Thread`, or a `move` of messages into another
thread (`MoveTransaction`; entries are otherwise append-only).
Ids for new models are made on the client (`crypto.randomUUID()`), so later transactions in the same batch can refer to them.

## The write path

1. The UI calls a `SyncClient` method (`createThread`, `updateThread`, `addEntry`).
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

## Thread links and branching

- A message links another thread with the token `[[thread:<id>]]` in its text (`threadLink`, `splitThreadLinks`,
  `plainThreadLinks` in `packages/model/src/model.ts`). Renderers show it as a chip with the linked thread's current
  title (`ThreadLinkChip` via `ThreadLinksContext`); previews show `#<title>`.
- Typing `#` in a reply opens the thread menu (the `threadLink` Tiptap node in `components/threadLinkNode.ts`, built
  on `@tiptap/suggestion`; the menu renders in `ReplyBlock`). It lists threads whose title matches, from
  `ThreadLinksContext.search`, then "New thread “…”", which creates a branch titled by what you typed and links it.
- Messages move between threads: right-click a message (Select, Move to thread…), ⌘-click to add to the selection,
  shift-click for a range; the selection bar and `MovePalette` pick an existing thread or a new branch. The `move`
  transaction changes each message's `threadId`; the server adds one activity line to the source thread, timed at the
  first moved message so it sits where they were ("moved 3 messages to <link>"). A new branch opens with the moved
  messages instead of an opening message (`movedEntryIds`), so the thread header only absorbs a first message whose
  first line is the title.
- A branch is an ordinary `response` thread with `branchedFromId` set, between the same people as its parent
  (`createBranch` in `App.tsx`), shown in its byline as "Branched from". No palette: change people in the branch.
- Clicking a link opens the thread in the split view beside the current one (`splitThreadId` in `App.tsx`).

## Inbox, outbox and slots

- A response is waiting on one person (`waitingOn` in `model.ts`, `Batch.waitingOn` on the server): the assignee,
  until the assignee writes, then whoever asked. That person has it in their inbox; the other has it in their outbox.
- `buildDay` in `inbox.ts` lays this out: a response waiting on you is on the timeline on its slot's day and in your
  inbox until then; responses waiting on others are the outbox. The schedule can step to other days (`dayMs`).
- Closing is a status change; nothing else closes a thread.

## Scoring and scheduling

Responses are scheduled automatically. Clients can't set a response's time; meetings and focus blocks keep theirs. A
response holds `blocks`, any number of them, each as long as the free time allows; `schedule` is its next one.

- **The score** (`threadScore` in `packages/model/src/score.ts`) rates a thread from 1 to 100: its due date, priority,
  estimated effort, most important tag (`TAGS`) and the level of the person waiting on the answer (`askerId`). It's
  computed when needed and never stored, because it changes as due dates approach and saving it would fill the sync
  log. Client and server share the function, so the inbox sorts by the same number the schedule uses.
- **The plan** (`planSchedule` in `apps/api/src/scheduler.ts`) lays out one person's open responses around their
  meetings and focus blocks, in `WORKING_HOURS`, on the next five weekdays. It's pure and has no randomness. In order,
  each thread takes free half hours until it has the time it needs, breaking only around fixed time and the end of the
  day, and carrying over to the next working day. A thread only moves ahead of another by outscoring it by 10. Time
  under way or starting within 30 minutes stays put, but only that stretch; the rest of a long block can give way.
  What doesn't fit stays in the inbox and waits for a later run.
- **How much time a thread needs** (`SyncEngine.#plan`): the assignee gets its `effortHours`, less `workedMinutes` and
  blocks that have ended, which count as work done. Anyone else it's waiting on, a thread with no estimate, or one with
  its estimate used up gets 30 minutes.
- **When it runs** (`SyncEngine.#replanAfter`): after every batch, for whoever the touched threads are waiting on,
  and every attendee of a touched meeting. A response handed to someone gives up its blocks, adding the assignee's time
  so far to `workedMinutes`. Closing a thread reschedules nobody, so its time stays a gap until the next change. Block
  moves are side effects in the same delta packet as the change that caused them, with no activity lines; only threads
  whose blocks change are written.
- **The morning run** (`SyncEngine.replanAll`, from the `Workspace` Durable Object's `alarm`) looks over every schedule
  half an hour before the working day, for closer due dates and blocks that passed with the thread still open. It also
  runs whenever a workspace loads.

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

## Following Linear's sync engine

The reference is the write-up at https://github.com/wzhudev/reverse-linear-sync-engine (`README.md` is the full
study, `SUMMARY.md` the overview). When adding a feature below, read the named chapter first and keep our names and
structure aligned with it. Do not copy from `code/*.js` in that repo: those are Linear's minified production
bundles, their proprietary code.

### How our names map to LSE

| LSE                                                                                                                          | Ours                                                                       | Notes                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ModelRegistry`, `__schemaHash`                                                                                              | `ModelRegistry`, `SCHEMA_HASH` (`packages/model/src/sync.ts`)              | Plain records plus a registry instead of decorators (`@ClientModel`, `@Property`); same metadata, no build-tool risk |
| Object pool (MobX-observable models)                                                                                         | `ObjectPool` (MobX maps of records)                                        | Records are replaced whole, so only the maps are observable                                                          |
| `SyncClient`                                                                                                                 | `SyncClient`                                                               | Same role: bootstrap, socket, `applyDelta`, `lastSyncId`                                                             |
| `TransactionQueue`: `createdTransactions`, `queuedTransactions`, `executingTransactions`, `completedButUnsyncedTransactions` | Same names in `transactions.ts`                                            | Batching by microtask (`batchIndex`), persisted in `__transactions`                                                  |
| `CreationTransaction`, `UpdatingTransaction`                                                                                 | `CreationTransaction`, `UpdateTransaction`                                 | `rebase`, `rollback`, `serialize`, `fromSerializedData` as in the write-up                                           |
| GraphQL mutations returning `lastSyncId`                                                                                     | `POST /sync/transactions` with JSON `TransactionInput`s                    | One endpoint, all or nothing per batch                                                                               |
| Sync actions `I U A D C G S V`                                                                                               | `I U D`                                                                    | Archive (`A`), unarchive (`V`), covering (`C`) and sync-group changes (`G`, `S`) not used yet                        |
| `lastSyncId` global across all of Linear                                                                                     | `lastSyncId` per workspace (one Durable Object each)                       | Gaps mean a missed packet, never another workspace's change                                                          |
| Handshake with `lastSyncId`, `userSyncGroups`                                                                                | `{ type: "handshake", lastSyncId }`                                        | No sync groups yet                                                                                                   |
| `firstSyncId`, `subscribedSyncGroups` in database meta                                                                       | `lastSyncId`, `schemaHash` in `meta`                                       | Add `firstSyncId` with sync groups                                                                                   |
| Server side effects (e.g. `IssueHistory`) in delta packets                                                                   | Activity `Entry`s, call links, status changes added by `SyncEngine.#apply` | Same principle: the delta can carry more than the transaction                                                        |
| Last-writer-wins rebase of `UpdateTransaction`s                                                                              | `UpdateTransaction.rebase` called from `applyDelta`                        | Same                                                                                                                 |

## Not built yet

Each of these is left out until there's a need. To add one, follow its steps, keep the invariants above, and update
this document in the same change.

### Undo and redo

LSE (write-up, Chapter 5 "Undo & Redo"): undo is transaction-based. The UI registers an undoable operation; the
transactions queued while it runs go on an undo stack. Undoing one calls its `undoTransaction`, which reverts the
model and returns the inverse transaction for redo. An undo is itself a new transaction sent to the server, so other
clients see it like any other change.

Here:

1. Give `UpdateTransaction` an `undoTransaction()` that returns a new `UpdateTransaction` setting its `original`
   values back (and the redo is the same move the other way). Creation's inverse needs deletion (below), so start
   with updates.
2. Add an `UndoQueue` on `SyncClient` with `addOperation(label, fn)`: it records the transactions `fn` enqueues
   (listen in `TransactionQueue.enqueue` while an operation is open), and `undo()` / `redo()` enqueue their
   inverses without recording them.
3. Wrap the UI actions in `App.tsx` that should be undoable in `addOperation`, and bind ⌘Z / ⇧⌘Z.
4. Tests in `apps/desktop/tests/sync.test.ts`: undo restores the value locally and sends an update; redo reapplies.

### Deleting and archiving

LSE: `DeletionTransaction`, `ArchivalTransaction`, `UnarchiveTransaction`, with sync actions `D`, `A`, `V`. Model
metadata says what happens to dependents (`onDelete`, `onArchive`; a `backReference` is deleted with its owner).

Here:

1. Add `type: "delete"` (and `"archive"`/`"unarchive"` if threads should be archived rather than removed) to
   `TransactionInput` in `sync.ts` and to the zod union in `engine.ts`.
2. In `SyncEngine`, let `Batch` stage deletions (a write whose `data` is `null` already becomes a `D` action in
   `write`). Cascade in `#apply`: deleting a thread deletes its entries. For archiving, add an `archivedAtMs` field
   and an `A`/`V` action, or treat it as an update, and decide whether bootstraps include archived models.
3. Client: a `DeletionTransaction` that removes the model from the pool and restores it on rollback; `applyDelta`
   already deletes on `D`. Handle a delete arriving for a model with pending updates (drop those updates).
4. Add `onDelete` / cascade info to `ModelRegistry`, bump the schema version, and add tests on both sides.

### Sync groups (who sees what)

LSE (Chapter 2, "SyncGroup"; Chapter 4, "Applying Deltas"): every model belongs to sync groups (a user, a team, a
role). A client subscribes to its groups (`subscribedSyncGroups`) and only receives models and delta packets for
them. Joining a group triggers a partial bootstrap of its models; leaving removes them. `firstSyncId` records where
a full bootstrap started.

Here this needs real identities first: today the API token admits everyone and View As is only a UI choice.

1. Add accounts: Cloudflare Access (or another auth layer) so each request carries a user, and D1 for global data
   (users, orgs, memberships, teams).
2. Decide the unit: one Durable Object per org, with teams as sync groups inside it, matches LSE's shape.
3. Tag models with their group (for example `teamId` on threads), filter `/sync/bootstrap` and `/sync/deltas`
   by the caller's groups, and send each socket only the actions for its groups (store the groups on the socket
   with `serializeAttachment`).
4. Add `G`/`S` actions (or a group-change message) so a client joining a team bootstraps that team's models and one
   leaving drops them. Add `firstSyncId` and `subscribedSyncGroups` to the client's `meta`.

### Lazy and partial loading

LSE (Chapter 2, "Bootstrapping", "Lazy Hydration"): each model has a `loadStrategy`: `instant` (bootstrapped),
`lazy` (fetched all at once when first needed), `partial` (fetched a subset at a time, e.g. document contents),
`explicitlyRequested`, `local`. Partial models are found through partial indexes (for example, entries by
`threadId`), and LSE supports full, partial and local bootstrapping. Properties can be lazy too, hydrated on access.

Here every model is `instant`. Add this when bootstraps get slow:

1. Mark large models (likely `Entry`) as `partial` in `ModelRegistry`.
2. Leave them out of `/sync/bootstrap`; add a route that returns them by index (`/sync/models/Entry?threadId=`).
3. In `SyncClient`, track which index values are loaded (in IndexedDB too); opening a thread loads its entries if
   needed. `applyDelta` stores actions for unloaded parents in IndexedDB but needn't put them in the pool.
4. The UI has to handle a thread whose entries are still loading.

### Smaller gaps

- **Batch limits**: LSE caps how many transactions it moves to executing and the size of a request. Ours caps a
  batch at 100 transactions; add a size cap if batches get large.
- **Ephemeral properties** (LSE's `ephemeralProperty`, not persisted): useful for presence such as "who's viewing".
  Send those over the socket as their own messages; don't put them in the sync log.
- **Schema migrations**: today a schema change makes clients rebuild their caches from the server, which is fine at
  this size. LSE migrates IndexedDB in place; add that only if rebuilding gets slow.
