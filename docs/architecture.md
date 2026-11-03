# Architecture

How data moves through threads, and how to change it without breaking sync. Read this before touching models,
the API, or anything in `apps/desktop/src/renderer/src/sync`.

The design follows Linear's sync engine (LSE), as documented in the reverse-engineered write-up at
https://github.com/wzhudev/reverse-linear-sync-engine. Use the write-up for reference. Never copy from the Linear
bundles in that repo (`code/*.js`); they are Linear's proprietary code.

## The product principle: the thread is the atomic unit

Everything in the app is a thread: an ask, a side discussion, a back-and-forth between people. Don't invent new
kinds of objects or special thread types for a new use case; express it with what a thread already has (people,
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
| `apps/api/src/triage.ts`                             | `Triager` and the Workers AI classifier: sorting each inbox into its owner's buckets                                                                              |
| `packages/model/src/score.ts`                        | `threadScore`, `SEEDED_LABELS`, effort options: how important a thread is, which orders it within its bucket                                                      |
| `apps/api/src/worker.ts`                             | The `Workspace` Durable Object (SQLite storage, WebSocket, broadcast, sorting, retry alarm) and the Worker entry (token, routing)                                 |
| `apps/api/src/app.ts`                                | HTTP routes for one workspace; `createApp` runs all workspaces in memory for tests                                                                                |
| `apps/desktop/src/renderer/src/sync/syncClient.ts`   | `SyncClient`: bootstrap, socket, applying deltas, rebasing, the change methods the UI calls                                                                       |
| `apps/desktop/src/renderer/src/sync/transactions.ts` | `CreationTransaction`, `UpdateTransaction`, `TransactionQueue`                                                                                                    |
| `apps/desktop/src/renderer/src/sync/database.ts`     | IndexedDB (and an in-memory version for tests)                                                                                                                    |
| `apps/desktop/src/renderer/src/sync/objectPool.ts`   | The observable in-memory models                                                                                                                                   |
| `apps/desktop/src/renderer/src/api.ts`               | Data sources (Cloudflare / Local / Sample) and the HTTP + WebSocket transport                                                                                     |

## Models

Data is normalized into flat records linked by id, like database rows:

- **Person**: `id`, `name`, optional `level`, `role`, `managerId` (builds the org tree), and `buckets` (their inbox
  buckets, each `{ id, name, description }`; `bucketsOf` falls back to `DEFAULT_BUCKETS`). Seeds refresh who people
  are but keep their `buckets`.
- **Thread**: one ask. References people by id: `requesterId`, `assigneeId`, `createdById`. Has `status` (`open`,
  `blocked`, `closed`, `archived`; `isDone` is closed or archived), `priority`, `dueAtMs`, `effortHours`, `labelIds`,
  `createdAtMs`, `updatedAtMs`, and per person, by id: `seenBy`, `doneBy`, `snoozedUntil` and `triage` (their bucket;
  see below). There are no kinds of thread.
- **Entry**: one item in a thread's log, referencing `threadId`. Kinds: `message` (`authorId`, `text`, `sentToIds`:
  who it was sent to, none for a note), `event` (activity line: `actorId`, `text`), `resolution`.
- **A thread's description** is not a field: it's the message the thread was opened with, and it has the thread's
  own id (`descriptionOf`). The thread view shows it in the heading under the title; it's otherwise an ordinary
  message (a note: the thread reaches its assignee by being assigned), and it counts as "opened" in notifications. The new-thread form asks for a
  title, then an optional description (`createThread` sends the message with `id: threadId` only when there is one).
  The server lets only whoever made the thread (`createdById`) write it, only as a message, keeps it out of moves, and lets no entry take
  another thread's id.

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

A **transaction** is a create of a `Thread` or `Entry`, an update of a `Thread` or of a `Person` (only your own:
`PersonChanges`, today just `buckets`; anyone else's is refused with 403), or a `move` of messages into another
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
5. **Side effects live on the server.** Activity lines, closing a thread on resolution, bumping
   `updatedAtMs`: all in `SyncEngine.#apply`. Clients don't send them and don't need to predict them.
6. **Side-effect ids are deterministic** (`${transaction.id}:${index}`, `${threadId}:blocks`), so a resent
   transaction can't create duplicates.
7. **IndexedDB `models` holds only server-confirmed data.** Local edits live in the pool and `__transactions`,
   never in `models`.
8. **The pool is the only thing the UI reads.** Components get resolved `Thread`/`Person` objects from
   `SyncClient.threads`/`people`; they never fetch.
9. **Clients make ids for new models.** Don't let the server assign ids for client-created models.
10. **Times shown in text use the actor's time zone.** The server runs in UTC; use `utcOffsetMinutes` (activity
    lines) and `X-UTC-Offset` (seeding).
11. **No REST endpoints.** The API is the sync protocol only. New capabilities are new transaction types or models.
    The one exception is stateless AI helpers that read and write no data, such as `POST /ai/compose`: they run in
    the Worker entry, outside any workspace, and whatever they produce reaches the data as ordinary transactions.

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
  messages instead of a description (`movedEntryIds`), so moved messages always stay messages.
- A branch is an ordinary `response` thread with `branchedFromId` set, between the same people as its parent
  (`createBranch` in `App.tsx`), shown in its byline as "Branched from". No palette: change people in the branch.
- Clicking a link opens the thread in the split view beside the current one (`splitThreadId` in `App.tsx`).

## Writing a thread as one message (⌘⇧N)

`ComposePanel` takes one message written as you'd say it ("@Anshu @Arjun can you review this CR. @Omar can you also
track this"). While you type, the app sends it with the names of the people it @mentions to `POST /ai/compose`
(`apps/api/src/compose.ts`, Workers AI's Llama 3.1 8B, for speed), which drafts a title, any shared context, and an ask per distinct request with the people it's for; the
panel previews that draft. Enter makes the thread from it with ordinary transactions (`composeThread` in `App.tsx`):
the title and context as the thread and its description, the first person asked as its assignee, and each ask as a
message sent to its people, opening with their @mentions (a message that @mentions everyone it went to doesn't also
say "to …"). So it's still one thread, in each person's inbox and sorted for them by what they were
asked (the triage prompt reads the latest message sent to them). Without the model it falls back to the first
sentence as the title and one ask for everyone mentioned.

The preview edits in place (title, context, each ask's text and people); once edited, the model leaves it alone until
Redraft. ⌘S, Save draft, or closing with something written keeps it as a draft instead of sending: what you typed and
the preview as you left it (`SavedDraft` in `drafts.ts`). Drafts are unsent, so they aren't threads or sync data: they
live in this device's localStorage, per data source, and show in the sidebar's Drafts tab. Opening one shows it in
the main area like a thread, marked "Draft" (`DraftView`): the title, context and each ask as your message, all editing
in place and kept as you type, with Send and Delete; sending it removes it.

## Inbox, notes and sending (like email)

The model is Superhuman's, for threads: a thread is a reply thread with a title and an owner.

- **Sends and notes.** In the reply, Enter sends it (`ReplyBlock` in `ThreadView.tsx`) to whoever last sent you
  something there, else the other side (`replyTo` in `model.ts`), plus anyone @mentioned (`mentionNode.ts`). The To
  line only shows once someone's mentioned, to add or take people off. With nobody to send to, it's a note: in the
  thread for anyone who opens it, but nobody is told (`sentToIds` empty). Sent messages show who they went to, notes say "Note". The server checks the people
  exist and that only messages are sent. Who's on a thread is derived: whoever asked, whoever has it, and everyone
  who's written in it or been sent something (`participants`).
- **Your inbox** (`inboxReason` in `model.ts`, shared by the server's sorting and the app's `buildInbox`): an open
  thread is in it when it's yours to finish (`waitingOn`: its assignee, or whoever asked while nobody's assigned;
  `assigned`, until it's closed), or someone sent you something since you last marked it done (`sent`), and you
  haven't snoozed it. Messages never move a thread between people: a thread is a worklog. Closing takes it out for
  everyone, and a closed thread takes no more replies.
- **Done and snooze are each person's own** (`doneBy`, `snoozedUntil`), set with the scoped changes `done` and
  `snoozeUntilMs`. Scoped changes (also `seen` and `bucketId`) are about whoever sends them: `applyScopedChanges` in
  `sync.ts` applies them on the server and, optimistically, in the app (`UpdateTransaction`), and they're quiet: no
  activity line, and the thread doesn't count as updated.
- **Keys** (`inboxKeysRef` in `App.tsx`; never with a dialog open, and only ⌘E while typing): J/K open the next or
  previous thread in your inbox, ⌘E marks the open one done for you (it never closes it: closing is
  always by hand, by anyone, with `/close`, the status or right-click; it comes back when someone else sends you
  something new or, for your own work, does anything there) and opens the next, H snoozes it until 9 tomorrow, R puts the cursor in the
  reply, and Escape leaves the reply. ⌘E and H offer Undo. A thread in your inbox opens at its top without taking the
  cursor, so the keys work until you choose to reply.
- **Sent** (the sidebar's Sent tab, beside Inbox and Groups): what you asked others for, messages you sent that
  nobody has answered yet, and your blocked threads, by who has each. Each leaves when they answer or close it.
- Something sent to you also shows as a toast (`MentionToasts`); several at once share one toast. When one needs real
  work, `/task` turns it into a task of your own: a new thread assigned to you, branched from where you were asked,
  with "Taking this on in <link>" sent back to whoever asked.
- On behalf of: making a thread with `onBehalfOfId` makes that person its requester, so they track it and it counts
  as their ask in the score. `createdById` keeps who really made it, and the server adds "created this on behalf of
  ..." (`#apply`). The thread page has no requester or assignee line above the title. Anyone can pick anyone, since there are no real identities
  yet (View As). Any requester can be changed later (`requesterId`, "made ... the requester"). The maker isn't part of
  the thread: not in Sent, and writing the description doesn't count towards notifications (`involves` in
  `activity.ts`); replying does. The details panel's Activity section lists a thread's activity lines as its audit log.
- Notifications (`activityFor` in `activity.ts`, the bell in the sidebar's top bar, `Notifications.tsx`) list, per
  thread you're part of, the latest thing someone else did there in the past week: replies and the status lines worth
  knowing (closed, reopened, renamed, handed over, blocked, unblocked, moved). Sorting and routine edits stay out. It's derived from entries, with nothing stored;
  what's new counts against the same last-seen times as the unread dots, which live on this device ("Mark all read"
  moves them all to now).
- `/blocked` (the `/` menu, `components/slashCommands.ts`, then `BlockedPalette`) makes a blocker: an ordinary
  response to the chosen person, with `blocksId` (and `branchedFromId`) set to the thread you're in. The server
  marks that thread Blocked and adds "is blocked on <link>". When its last open blocker closes, the server sets it
  back to Open ("is unblocked, <link> is closed"). A blocked thread stays in its holder's inbox, last, labelled Blocked; the blocker is in their Sent.
- `buildInbox` in `inbox.ts` lays this out: your inbox, in your buckets, and Sent.
- Closing is a status change; nothing else closes a thread. Archiving is too: an archived thread is done like a closed
  one and also leaves every list and the notifications, but stays searchable. Right-clicking a thread in a list
  (`ThreadMenuContext` in `threadMenu.ts`) offers Open, Open beside, Close or Reopen, and Archive or Unarchive.

## Organization, groups and labels

- **The organization** (`Organization`, one record, `ORGANIZATION_ID`): one per workspace. Its name is empty until someone
  names it at first run (`OrganizationPrompt`, which can't be skipped); anyone can rename it from their profile, since
  there are no roles yet. `ensureOrganization` makes sure a workspace has it and the seeded labels.
- **Labels** (`Label`): how threads are filed. Names are unique across the
  organization; a label's id is `labelSlug(name)`, so "Back-end" and "back end" are one label, and making one that exists
  does nothing rather than refusing the batch (and any thread made in it). `SEEDED_LABELS` in `score.ts` are the only
  ones with a priority, so making a label can't move anything up an inbox. Labels aren't deleted.
- **Groups** (`Group`): a project, program or team. Anyone can make one and add anyone. Making one makes its label
  (`Label.groupId`), and **a thread is in a group because it has that label**: there's no `groupId` on a thread, so a
  thread can be in several, and the group page is just the threads with its label (`threadsWithLabel` in `groups.ts`).
  Other labels are manual and for filtering; a group doesn't hold any of its own besides that one. A group's name is
  unique among labels too. Renaming it renames the label but keeps the label's id, so its threads stay.
- **Who can change a group**: any member (rename, add or remove people, archive). Anyone else can only join. A group can't
  be left empty; archive it instead. Each change adds a line to its `activity`, and `targetIds` on an "added" line is who
  it's news for (`groupNoticesFor`, shown in the notifications). Membership decides what's in your sidebar, not what you
  can see: everyone can see everything until there are real identities (see Sync groups).
- **Inheriting**: a branch or blocker takes its parent's group labels on the server, so a project's blockers stay in the
  project. Its other labels don't carry over.
- **In the app**: the sidebar's Groups tab lists your groups, others', and plain labels; `LabelView` is the page for
  either. A thread made from one starts with its label. The new-thread palette's last step has the labels (⇧⇥), and a
  thread's label chip can find or make one.
- **A wipe** (`#reset` in `worker.ts`) clears threads but keeps the organization, labels and groups.

## Buckets, sorting and scoring

The inbox (the sidebar's Inbox tab) is grouped into your **buckets** and ordered within each by **score**. There's no schedule: the app helps you get through your work, not plan your hours.

- **Buckets** are per person (`Person.buckets`, edited as a whole list with `PersonChanges`; `DEFAULT_BUCKETS` until
  you make your own): a name, and a plain-language description of what goes in it, which is what the model reads. The
  sidebar edits them (`BucketPalette`: name, then description; a bucket's menu moves or deletes it).
- **Sorting** (`apps/api/src/triage.ts`): a thread's `triage` holds `{ bucketId, reason, manual, stale }` for each
  person whose inbox it's in. `SyncEngine.triageRequests` finds what needs it (`#needsTriage`: everyone in
  `inboxPeople` with no bucket of theirs, a bucket they no longer have, or a `stale` one), grouped per person with
  their buckets, each thread's title and description plus who last sent it to them and what, and the threads they
  placed by hand as examples. The `Triager` in the
  `Workspace` Durable Object sends them to Workers AI (`TRIAGE_MODEL`, Llama 3.3 70B with a JSON schema) 20 at a time
  and saves the answers with `SyncEngine.applyTriage`, as their own batch through `write`, so they reach clients like
  any other change. It runs after every transaction batch and when the workspace loads; on a failure the threads wait
  a minute (`RETRY_MS`) and an alarm retries them. The AI binding (`bindings.ai`) always runs on Cloudflare, local
  dev included, within the account's free daily allocation (`THREADS_LOCAL_AI=off` leaves it out for anyone without
  access to the account, and threads wait under "Sorting"); threads are only sorted when they arrive, change hands,
  are sent to someone new, are retitled or their owner's buckets change, so a team stays well inside it.
- **Placing by hand**: dragging a thread to another bucket, its Bucket chip, or "Move to …" in its menu sends the
  scoped change `bucketId` (only for a thread in your inbox, only into your own bucket). It sticks through
  retitles and bucket edits, and `null` ("Sort it for me") hands it back to the model.
- **Staying put**: retitling, or changing your buckets (other than reordering them), marks the model's choices
  `stale` (for that person, or for everyone on a retitle) instead of clearing them, so threads stay where they are until the model has looked again. Only a thread
  whose bucket was deleted waits under "Sorting".
- **The score** (`threadScore` in `packages/model/src/score.ts`) rates a thread from 1 to 100: its due date, priority,
  estimated effort, most important seeded label (`SEEDED_LABELS`) and the level of the person waiting on the answer
  (`askerId`). It's computed when needed and never stored, because it changes as due dates approach. Within a bucket,
  threads needing an assignee come first, blocked ones last, and the rest by score. Closing a thread from your inbox
  opens the next one (`inbox.order`).

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

Edit `packages/model/src/sample.ts`. A sample thread's first message is its description (it gets the thread's id).
Existing workspaces keep their stored threads; seeded **people** refresh automatically on load (`refreshSeedPeople`). To see new sample threads, reset the local Worker's state (delete
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

| LSE                                                                                                                          | Ours                                                           | Notes                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ModelRegistry`, `__schemaHash`                                                                                              | `ModelRegistry`, `SCHEMA_HASH` (`packages/model/src/sync.ts`)  | Plain records plus a registry instead of decorators (`@ClientModel`, `@Property`); same metadata, no build-tool risk |
| Object pool (MobX-observable models)                                                                                         | `ObjectPool` (MobX maps of records)                            | Records are replaced whole, so only the maps are observable                                                          |
| `SyncClient`                                                                                                                 | `SyncClient`                                                   | Same role: bootstrap, socket, `applyDelta`, `lastSyncId`                                                             |
| `TransactionQueue`: `createdTransactions`, `queuedTransactions`, `executingTransactions`, `completedButUnsyncedTransactions` | Same names in `transactions.ts`                                | Batching by microtask (`batchIndex`), persisted in `__transactions`                                                  |
| `CreationTransaction`, `UpdatingTransaction`                                                                                 | `CreationTransaction`, `UpdateTransaction`                     | `rebase`, `rollback`, `serialize`, `fromSerializedData` as in the write-up                                           |
| GraphQL mutations returning `lastSyncId`                                                                                     | `POST /sync/transactions` with JSON `TransactionInput`s        | One endpoint, all or nothing per batch                                                                               |
| Sync actions `I U A D C G S V`                                                                                               | `I U D`                                                        | Archive (`A`), unarchive (`V`), covering (`C`) and sync-group changes (`G`, `S`) not used yet                        |
| `lastSyncId` global across all of Linear                                                                                     | `lastSyncId` per workspace (one Durable Object each)           | Gaps mean a missed packet, never another workspace's change                                                          |
| Handshake with `lastSyncId`, `userSyncGroups`                                                                                | `{ type: "handshake", lastSyncId }`                            | No sync groups yet                                                                                                   |
| `firstSyncId`, `subscribedSyncGroups` in database meta                                                                       | `lastSyncId`, `schemaHash` in `meta`                           | Add `firstSyncId` with sync groups                                                                                   |
| Server side effects (e.g. `IssueHistory`) in delta packets                                                                   | Activity `Entry`s, status changes added by `SyncEngine.#apply` | Same principle: the delta can carry more than the transaction                                                        |
| Last-writer-wins rebase of `UpdateTransaction`s                                                                              | `UpdateTransaction.rebase` called from `applyDelta`            | Same                                                                                                                 |

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
  this size. Records the server stored under an older shape are brought up to date as it loads them (`upgrade` in
  `engine.ts`). LSE migrates IndexedDB in place; add that only if rebuilding gets slow.
