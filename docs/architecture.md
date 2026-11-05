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

Each workspace has exactly one writer: a Cloudflare Durable Object running the sync engine's server. Clients never
write data directly. They send **transactions**; the server validates them, adds side effects, and numbers every
resulting change with the next **sync id** (a per-workspace counter that only goes up). The numbered changes, **sync
actions**, are saved to a log and pushed to every connected client as a **delta packet**, filtered to what that
client's session may see. Clients apply packets in sync id order, so everyone converges on the same data. Clients
show their own edits immediately (optimistically) and reconcile when the server's version arrives.

```
Desktop app                                              Cloudflare
───────────                                              ──────────
React UI ──reads──▶ ObjectPool (MobX)                    Worker (Hono): who's asking (session), route by workspace
   │ edits              ▲                                          │
   ▼                    │ applies deltas                           ▼
TransactionQueue ───────┼───── POST /sync/transactions ──▶ Durable Object "Workspace"
   │ saves              │                                    SyncEngine = SyncServer + Threads' rules
   ▼                    │                                    SQLite: models, sync_actions, transactions, meta
IndexedDB ◀─ SyncClient ◀────── delta packets (WebSocket) ◀──┘
```

## The sync engine is a black box: `packages/sync`

The engine is its own package and knows nothing about threads. **Read `packages/sync/README.md`** for what it
guarantees and what a product must respect. It has three parts:

- `sync`: the wire protocol, `defineSchema` and the streamed bootstrap.
- `sync/server`: `SyncServer` (batches, sync ids, the log, groups, deletes, loading, compaction, events), storage
  (`sqliteStorage` for the Durable Object, `memoryStorage` for tests), `broadcast` and `receive` for sockets, the HTTP
  routes (`handleSyncRequest`) and session tokens.
- `sync/client`: `SyncClient` (bootstrap, socket, applying deltas, following groups, gaps, loading, ephemeral values),
  the `TransactionQueue`, the `UndoQueue`, the `ObjectPool` and the local database.

Threads plugs into it in three places, and product work happens only there:

1. **The schema** (`threadsSchema` in `packages/model/src/sync.ts`): the models, their references, and (by default)
   everything in the workspace's one sync group.
2. **The rules** (`SyncEngine.#apply` in `apps/api/src/engine.ts`, a `SyncServer` subclass): what each transaction
   may do and its side effects. Plus inbox sorting, which runs on the engine like any other writer.
3. **The predictions** (`threadsMutations` in `packages/model/src/sync.ts`): how each transaction looks on the client
   before the server confirms it. `ThreadsClient` (`apps/desktop/src/renderer/src/sync/syncClient.ts`) adds the
   app's reads (threads with people resolved) and change methods (`createThread`, `addEntry`, …) on `SyncClient`.

Change `packages/sync` only to change how syncing works, and keep its tests (`vp test` there) passing.

## Where things live

| Path                                               | What it is                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/sync`                                    | The sync engine (see above and its README)                                                                                                        |
| `packages/model/src/model.ts`                      | The app's view types (`Thread` with nested `Entry`s and `Person`s), labels, inbox rules                                                           |
| `packages/model/src/sync.ts`                       | Threads on the engine: records, `threadsSchema`, `SCHEMA_HASH`, `TransactionInput`, `threadsMutations`, records ↔ `Thread` conversion             |
| `packages/model/src/sample.ts`                     | Seed data: local people, the sample team and threads                                                                                              |
| `apps/api/src/engine.ts`                           | `SyncEngine`: the engine's server with Threads' validation (zod), rules and side effects (`#apply`), sync groups, seeding, inbox sorting requests |
| `apps/api/src/triage.ts`                           | `Triager` and the Workers AI classifier: sorting each inbox into its owner's buckets                                                              |
| `packages/model/src/score.ts`                      | `threadScore`, `SEEDED_LABELS`, effort options: how important a thread is, which orders it within its bucket                                      |
| `apps/api/src/worker.ts`                           | The Worker entry (sessions: `authenticate`, `POST /auth/session`) and the `Workspace` Durable Object (storage, sockets, sorting, retry alarm)     |
| `apps/api/src/app.ts`                              | One workspace's routes (`serveWorkspace`), local sessions (`openSession`); `createApp` runs all workspaces in memory for tests                    |
| `apps/desktop/src/renderer/src/sync/syncClient.ts` | `ThreadsClient`: the engine's client with the app's reads and changes                                                                             |
| `apps/desktop/src/renderer/src/api.ts`             | Data sources (Cloudflare / Local / Sample), sessions, and the HTTP + WebSocket transport                                                          |

## Models

Data is normalized into flat records linked by id, like database rows:

- **Person**: `id`, `name`, optional `level`, `role`, `managerId` (builds the org tree), and `buckets` (their inbox
  buckets, each `{ id, name, description }`; `bucketsOf` falls back to `DEFAULT_BUCKETS`). Seeds refresh who people
  are but keep their `buckets`.
- **Thread**: one ask, visible to the whole organization. References people by id: `createdById` (its one owner,
  whoever made it) and `assigneeIds` (everyone it's assigned to; groups are assigned through their label in
  `labelIds`). Has `status` (`open`,
  `blocked`, `closed`, `archived`; `isDone` is closed or archived), `priority`, `dueAtMs`, `effortHours`, `labelIds`,
  `createdAtMs`, `updatedAtMs`, and per person, by id: `seenBy`, `doneBy`, `snoozedUntil` and `triage` (their bucket;
  see below). There are no kinds of thread.
- **Entry**: one item in a thread's log, referencing `threadId`. Kinds: `message` (`authorId`, `text`, `sentToIds`:
  who it was sent to, none for a note), `event` (activity line: `actorId`, `text`), `resolution`.
- **Sprint**: a stretch of a group's work, referencing `groupId`, with `name`, `startMs`, `endMs`, `threadIds` (the
  threads in it) and `closed`. It lists its threads; threads have nothing about sprints. See "Boards and sprints".
- **A thread's description** is not a field: it's the message the thread was opened with, and it has the thread's
  own id (`descriptionOf`). The thread view shows it in the heading under the title; it's otherwise an ordinary
  message (a note: the thread reaches its assignees by their being assigned), and it counts as "opened" in notifications. The new-thread form asks for a
  title, then an optional description (`createThread` sends the message with `id: threadId` only when there is one).
  The server lets only its owner (`createdById`) write it, only as a message, keeps it out of moves, and lets no entry take
  another thread's id.

The UI never works with records. `toThreads()` resolves references into the nested `Thread` shape from
`model.ts`, which is what components receive. Keep components on that shape; convert at the edge.

`threadsSchema` lists each model's references (and back references: a thread's entries belong to it). `SCHEMA_HASH`
is a hash of it plus its `version`; clients whose cache was built under a different hash discard it and do a full
bootstrap.

## The protocol

All routes take the workspace in `X-Workspace` (`local` or `sample`; the socket uses `?workspace=`).

| Route                      | Purpose                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /sync/bootstrap`      | The `instant` models the session sees, streamed as lines, with `epoch`, `lastSyncId` and `syncGroups`; `?groups=a,b` for only those |
| `POST /sync/batch`         | `{ requests }`: lazy models whole, or partial models by an index (LSE's batch loader)                                               |
| `GET /sync/deltas?after=N` | The actions after N the session sees, or `fullBootstrapRequired` once the log no longer reaches back to N                           |
| `POST /sync/transactions`  | `{ actorId, utcOffsetMinutes, transactions }`, executed all or nothing; answers `{ lastSyncId }`                                    |
| `GET /sync/ws` (WebSocket) | A handshake (`epoch`, `lastSyncId`, `minSyncId`, `syncGroups`), then one packet per committed batch                                 |
| `POST /auth/session`       | An admin mints a person's session token (hosted only)                                                                               |
| `POST /sync/reset`         | Admin only: wipe the workspace's threads (a development tool)                                                                       |

A **sync action** is `{ id, modelName, modelId, action: "I" | "U" | "D" | "A" | "V", data }`. All but deletes carry the
whole record. On the socket the client can also send, and receive, **ephemeral values** (never stored or logged).
A **delta packet** is `{ lastSyncId, actions, syncGroups? }`: one committed batch, holding only the actions this
session may see (possibly none, so its position keeps up), and
`syncGroups` when the session's groups just changed.

A **transaction** is a create of a `Thread`, `Entry`, `Label`, `Group` or `Sprint`, an update of a `Thread`, `Group`,
`Sprint`, the `Organization` or a `Person` (only your own: `PersonChanges`; anyone else's is refused with 403), a
`move` of messages into another thread, or one of the engine's own: `delete`, `archive`,
`unarchive`. Threads allows only deleting your own messages (not a description); a thread is archived with its status.
Updates set whole values, lists included (a group's `memberIds`, a sprint's `threadIds`, a thread's `labelIds`); the
later change wins, as in LSE.
Ids for new models are made on the client (`crypto.randomUUID()`), so later transactions in the same batch can refer
to them.

### Who's asking: sessions

Every request runs as a **session** (`authenticate` in `worker.ts`), which the Worker passes to the workspace's object:

- **A person's session** acts only as them (`actorId` must be them, or 403) and sees only their sync groups. On the
  hosted API it's a signed **session token** (`s1.…`, from `signSession`, checked with `verifySession`, signed with a
  key derived from `API_TOKEN`, valid 30 days, for one workspace).
- **The admin session** sees everything and acts as anyone: the `API_TOKEN` itself on the hosted API, or no `X-User`
  locally.
- **Locally** (no `API_TOKEN`) the API is open: `X-User: <personId>` (`?user=` on the socket) is that person's session.

The desktop app doesn't sign in yet: it holds the API token and trades it for the session of whoever it views as
(`POST /auth/session`, in `api.ts`), so it's as if each person signed in. Signing in (below) mints the same tokens.

### Signing in

People sign in on the web sign-in page (`apps/web`) with Google or a one-time code sent to their email, through
[Better Auth](https://www.better-auth.com) running in the Worker (`apps/api/src/auth.ts`):

- **Better Auth keeps its own users and sessions** in a D1 database (`AUTH_DB`), apart from the workspaces. Its tables
  are made the first time the Worker signs anyone in (`getMigrations`), so there's no migration step to run.
- **Only invited emails get in.** `INVITES` (a secret: `email=personId` pairs, separated by commas) is the invite list
  and says which `Person` each email is. An uninvited email can't get an account by either route (a `user.create`
  hook refuses it), and asking for a code for one looks the same as for an invited one but sends nothing, so the form
  can't be used to find out who's invited.
- **Codes** are sent through Resend when `RESEND_API_KEY` is set. Without it they're only written to the Worker's log,
  which is allowed locally only (no `API_TOKEN`); the hosted API refuses rather than silently dropping them.
- **From a Better Auth session to a Threads session**: `POST /auth/token`, with the sign-in page's cookie, answers the
  invited person and, on the hosted API, their signed session token (`signSession`, as `POST /auth/session` mints).
  Locally it answers `token: null`, since `X-User` says who you are there.
- **The sign-in page** proxies `/api` and `/auth` to the API in development (`THREADS_API` points it elsewhere), so the
  cookie is same-origin and Google redirects back to it: Google's redirect URI is
  `<BETTER_AUTH_URL>/api/auth/callback/google` (`http://localhost:5173/api/auth/callback/google` locally).
- **Settings**: `INVITES`, `BETTER_AUTH_SECRET` (local default otherwise), `BETTER_AUTH_URL` (the sign-in page's
  origin; `http://localhost:5173` by default), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Google sign-in is offered
  only with both), and `RESEND_API_KEY`. Locally they go in `apps/api/.dev.vars` (gitignored); hosted, they're secrets.
- **Not yet**: the desktop app still uses the API token and View As. Signing it in means opening the sign-in page in
  the system browser and receiving the token on a `threads://` link (Better Auth's Electron plugin), then using only
  that token and dropping View As outside development.

### Sync groups

Each record is in sync groups (`syncGroupsOf` in the schema) and each session sees some (`groupsFor`). In Threads every
record is in the workspace's one group (`workspace`), and everyone in the workspace (a `Person`) is in it, so members
see everything and anyone else sees nothing. The engine is ready for more (private threads, teams): a record's groups
come from its own fields; moving out of a session's groups arrives as a delete, moving in as an insert; and a session
whose groups change loads the new ones' records and drops the rest.

## The write path

1. The UI calls a `ThreadsClient` method (`createThread`, `addEntry`, `deleteMessage`, …), which calls
   `SyncClient.transact`.
2. The queue applies the transaction to the `ObjectPool` straight away, through `threadsMutations`, and remembers the
   values it replaced (`original`, for rollback) and each model as it was (`before`, for undo).
3. Transactions made in the same tick share a `batchIndex`. At the end of the tick they move from
   `createdTransactions` to `queuedTransactions` and are saved to IndexedDB's `__transactions`.
4. `dequeue` sends the next batch (same `batchIndex` and `actorId`, at most 100 transactions and about 500 KB) to
   `POST /sync/transactions`; it sits in `executingTransactions`.
5. The server checks the session, skips transaction ids it has already executed, and runs each one through
   `SyncEngine.#apply`, which stages writes and side effects in a `Batch`. Then `write` numbers each staged write with
   the next sync id, persists them (models, log with each record's groups, transaction ids) in one SQLite transaction,
   applies them in memory, and broadcasts a packet to each socket.
6. On success the client moves the batch to `completedButUnsyncedTransactions` with `syncIdNeededForCompletion =
   lastSyncId` and deletes it from `__transactions`. When the client's position reaches that id, it's done.
7. On a refusal (4xx → `RejectedError`) the batch rolls back, newest first, and then what it touched is checked against
   the server's copy in IndexedDB (with other pending changes on top), which settles the rare case rollback alone
   can't, and changes still waiting on a refused creation are dropped with it. On a network or 5xx error, or a 401
   (signed out; the transport renews the session first), it goes back to the front of the queue and is retried, backing
   off with jitter; after five 5xx in a row it's **stuck**, and the app shows Retry and Discard (`client.stuck`,
   `retryStuck`, `discardStuck`). A 426 means the app is out of date: syncing stops and the app says so
   (`status: "outdated"`). A rule that crashes is refused with a 422 rather than failing the request.

## The read path

- **Delta packets** are applied one at a time. If the packet's `lastSyncId` is already applied, it's skipped. Otherwise
  each action is written to IndexedDB, then set in the pool with any pending transactions for that model rebased on top
  (their `original` becomes the server's value; last writer wins). A delete drops unsent changes to that model, and an
  insert an unsent creation with its id (`modelUpserted`). Then the position advances and waiting transactions
  complete. A socket can't lose a packet without closing, and every reconnect handshakes, so missed changes are caught
  up there. If any step fails (the server unreachable mid catch-up), the client drops the connection, skips what was
  queued behind it, and starts again from a new handshake.
- **Startup**: with a cache under the current schema hash, load models from IndexedDB, replay saved transactions,
  connect. The handshake then decides: another `epoch` (the server's data started over), a server behind the cache,
  or a cache behind the log's start (`minSyncId`, after compaction) → full bootstrap, keeping unsent changes on top;
  changed groups → load or drop what that changes; server ahead → catch up. Without a usable cache → full bootstrap
  first.
- **A gap that can't be filled** (`fullBootstrapRequired`) is a full bootstrap too: a client is never stuck.
- **Loading**: every Threads model loads `instant` today. The engine also loads `lazy` and `partial` models on demand
  (`client.hydrate`), keeping a slice current once loaded; see `packages/sync/README.md`.
- **Reconnect**: the socket reconnects with backoff (1s doubling to 10s); each reconnect handshakes and catches up.
- **Compaction**: past 12,000 actions the server trims its log to the last 10,000 and forgets executed transaction ids
  older than 30 days.

## Invariants

Breaking any of these breaks sync. Agents: check your change against this list. The engine enforces 1–4 and 6–7
itself; the rest are yours.

1. **One writer per workspace.** Every server-side change goes through `SyncServer.write` (client transactions via
   `execute`, seeds and sorting via `write`). Never write to SQLite or `engine.models` directly.
2. **Every change gets a sync id and lands in the log.** No out-of-band updates. If clients need to see it, it's a
   sync action.
3. **Persist first.** `write` saves to storage before applying in memory or broadcasting.
4. **Batches are atomic.** Validation errors throw `SyncError` before anything is written. In `#apply`, look up whatever
   a transaction names with `batch.find` (only what the actor can see), not `batch.get`. Don't write in `#apply`;
   stage with `batch.put` / `batch.delete` and let `write` commit.
5. **Side effects live on the server.** Activity lines, closing a thread on resolution, assigning whoever's
   @mentioned, bumping `updatedAtMs`: all in `SyncEngine.#apply`. Clients don't send them and don't predict them.
6. **Side-effect ids are deterministic** (`${transaction.id}:${index}`, `${threadId}:blocks`), so a resent
   transaction can't create duplicates.
7. **IndexedDB `models` holds only server-confirmed data.** Local edits live in the pool and `__transactions`.
8. **The pool is the only thing the UI reads.** Components get resolved `Thread`/`Person` objects from
   `ThreadsClient.threads`/`people`; they never fetch.
9. **Clients make ids for new models.** Don't let the server assign ids for client-created models.
10. **Times shown in text use the actor's time zone.** The server runs in UTC; use `utcOffsetMinutes` (activity
    lines) and `X-UTC-Offset` (seeding).
11. **No REST endpoints.** The API is the sync protocol only. New capabilities are new transaction types or models.
    The exceptions are stateless AI helpers that read and write no data, such as `POST /ai/compose` (they run in the
    Worker entry, outside any workspace, and whatever they produce reaches the data as ordinary transactions), and
    `POST /auth/session`, which signs people in.
12. **A record's sync groups come from its own fields** (or its parent's, through `syncGroupsFrom`), and the client must
    be able to predict every transaction from any starting record (`threadsMutations`), since pending changes are
    rebased onto newer server data.

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

## Owners, assignees and the global list

Every thread is the organization's: everyone can see it, and anyone can close it. It has one **owner**, whoever made
it (`createdById`, `Thread.owner`), and any number of **assignees**: picked when it's made (`assigneeIds` on create), and
anyone @mentioned in a message since, which the server adds (`SyncEngine.#apply`, alongside the group's label for a
group mention). Assignees aren't removed yet. The thread is in each assignee's inbox until they mark it done, and in its
owner's outbox (Sent) until it's closed. A thread nobody else is on (no assignees, nothing sent to anyone) is its
owner's own to-do, in their inbox (`isPersonal`, `assignedIds` in `model.ts`).

People and groups are filters on one global list: All threads in the sidebar's Groups tab (`LabelView` with no label)
narrows by person (owner or assignee), by group or label, and to closed threads too; a group's or label's page is the
same list with its label applied (`threadsWithLabel` in `groups.ts`).

## @groups

`@` offers groups as well as people, in replies and in the new-message panel. A group mention is `[[group:<id>]]` in
the text (`groupMention`; the @ menus and drafts name it `group:<id>`, `mentionToken`), shown as @Name. Sending
expands it to the group's members as they are then (`recipientsOf` in `compose.ts`), less you, into `sentToIds`, so each
of them has the thread in their inbox; someone who joins later sees the group's threads on its page but gets only
what's sent after. Mentioning a group assigns it the thread through its label (the server adds it). Anyone in the group
can close it, and each marks it done for themselves (⌘E).

## Writing a thread as one message (⌘⇧N)

`ComposePanel` takes one message written as you'd say it ("@Anshu @Arjun can you review this CR. @Omar can you also
track this"). While you type, the app sends it with the names of the people it @mentions to `POST /ai/compose`
(`apps/api/src/compose.ts`, Workers AI's Llama 3.1 8B, for speed), which drafts a title, any shared context, and an ask per distinct request with the people it's for; the
panel previews that draft. Enter makes the thread from it with ordinary transactions (`composeThread` in `App.tsx`):
the title and context as the thread and its description, and each ask as a message sent to its people, opening with
their @mentions, which assigns them (a message that @mentions everyone it went to doesn't also
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
  something there, else (for its owner) its assignees or (for anyone else) its owner (`replyTo` in `model.ts`), plus
  anyone @mentioned (`mentionNode.ts`), who's assigned the thread. The To
  line only shows once someone's mentioned, to add or take people off. With nobody to send to, it's a note: in the
  thread for anyone who opens it, but nobody is told (`sentToIds` empty). Sent messages show who they went to, notes say "Note". The server checks the people
  exist and that only messages are sent. Who's on a thread is derived: its owner, its assignees, and everyone who's
  written in it or been sent something (`participants`).
- **Your inbox** (`inboxReason` in `model.ts`, shared by the server's sorting and the app's `buildInbox`): an open
  thread is in it when it's assigned to you (`assigned`: you're one of its assignees, or it's your own to-do), or
  someone sent you something since you last marked it done (`sent`), and you haven't snoozed it. Closing takes it out
  for everyone, and a closed thread takes no more replies.
- **Done and snooze are each person's own** (`doneBy`, `snoozedUntil`), set with the scoped changes `done` and
  `snoozeUntilMs`. Scoped changes (also `seen` and `bucketId`) are about whoever sends them: `applyScopedChanges` in
  `sync.ts` applies them on the server and, optimistically, in the app (`UpdateTransaction`), and they're quiet: no
  activity line, and the thread doesn't count as updated.
- **Keys** (`inboxKeysRef` in `App.tsx`; never with a dialog open, and only ⌘E while typing): J/K open the next or
  previous thread in your inbox, ⌘E marks the open one done for you (it never closes it: closing is
  always by hand, by anyone, with `/close`, the status or right-click; it comes back when someone else sends you
  something new or, when it's assigned to you, does anything there) and opens the next, H snoozes it until 9 tomorrow, R puts the cursor in the
  reply, and Escape leaves the reply. ⌘E and H offer Undo. A thread in your inbox opens at its top without taking the
  cursor, so the keys work until you choose to reply.
- **Sent** (the sidebar's Sent tab), your outbox: every open thread you own that anyone else is on, with who's on it
  ("Sam +2"), until it's closed. When someone sends you something on it, it's in your inbox instead.
- Something sent to you also shows as a toast (`MentionToasts`); several at once share one toast. When one needs real
  work, `/task` turns it into a task of your own: a new thread assigned to you, branched from where you were asked,
  with "Taking this on in <link>" sent back to whoever asked.
- The thread page has no owner or assignee line above the title. The details panel's Activity section lists a thread's
  activity lines as its audit log.
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
- **A wipe** (`#reset` in `worker.ts`) clears threads but keeps the organization, labels and groups. Sprints go with
  the threads.

## Boards and sprints

A board and a sprint are ways of looking at threads; neither changes one.

- **The board** is a layout of the global list (List or Board beside New thread, remembered on this device): whatever
  the page and its filters show, in a column per status (Open, Blocked, Closed; `Board.tsx`, `boardColumns` in
  `sprints.ts`). Dragging a card to another column is the same status change as in the thread, with the same activity
  line, and leaves you on the board rather than moving on through your inbox.
- **Sprints exist only in a group** (`Sprint`, `groupId`). The server enforces it (`checkSprint` in `#apply`): the group
  must exist (and not be archived, to start one), only its members plan its sprints, only threads with the group's label
  go in one, a thread is in at most one open sprint of a group at a time (reopening a sprint is checked too), and a
  sprint runs from a day to a year. A thread taken out of the group (its label removed) leaves the group's open sprints
  as a side effect; closed sprints keep their record. Threads go in a sprint by changing the sprint's `threadIds` (the
  whole list, like a group's members), never by changing the thread, so a thread made and added in one batch works.
- **In the app**: each sprint has its own page (`SprintView`, the `{ sprint }` page), opened from its group's Sprints
  button (which lists them, with "New sprint") or ⌘K ("Platform › Sprint 2"). The group's page itself shows no sprint.
  A sprint's page has its name (renamed in place) and dates, its group (linking back), a summary ("3 threads · 1
  blocked"), each assignee's load (open threads and estimated hours; a shared thread counts in full for each of its
  assignees), and its threads as a list or a board, with adding the group's threads, closing or reopening it, and, once
  closed with unfinished threads, starting the next with them. "New sprint" is numbered after the others and runs two
  weeks, from today or from where the latest ends (`nextSprint`). A thread made on an open sprint's page starts with
  the group's label and goes in the sprint, if it keeps the label. A thread's right-click menu adds it to, or takes it
  out of, the open sprints of your groups it's in. Starting and closing sprints show in the group's activity.

## Profiles

- **Your own** (`ProfileView`) is you, your inbox counts and the org tree, with the organization's rename.
- **Anyone else's** (`PersonView`, the `{ person }` page) opens in the main area like a group's page. It shows who they are,
  their manager and the chain above, their reports, and the groups you're both in, each linking on. Then **the threads
  you're both in** (`sharedThreads` in `profile.ts`), in three lists by who it's assigned to: you, them, and everything
  else. Closed threads hide behind an "N closed" chip, as on a group's page, and show right under it when it's on, so
  they appear where you clicked; archived ones never show.
  "New thread to them" opens the new-thread palette with them first to pick.
- **Being in a thread** is one rule, `involves` in `model.ts`: you own it, it's assigned to you, something was sent to
  you, or you've written in it beyond its description. It's the same rule as for notifications (`activityFor`).
  `participants` is wider, counting every author.
- **What a profile shows is not access.** Every client has every thread, so a profile shows only what you share, never
  their whole inbox, but it doesn't hide anything from the client (see Sync groups).
- **Getting there**: the People section and tab of ⌘K (by name, level or role), names in the org tree, a group's member
  chips, a message's author, an @mention, and the people on a profile. Your own name opens your own profile.

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
  estimated effort, most important seeded label (`SEEDED_LABELS`) and its owner's level. It's computed when needed and
  never stored, because it changes as due dates approach. Within a bucket, blocked threads come last and the rest go
  by score. Closing a thread from your inbox
  opens the next one (`inbox.order`).

## How to make common changes

### Add a field to an existing model

1. Add it to the record type in `sync.ts` (and to `Thread`/`Entry`/`Person` in `model.ts` if the UI needs it), and
   map it in `toThread`/`toEntry` and `fromThread`.
2. If clients can set it: add it to `ThreadChanges` (or the relevant create type) in `sync.ts` and to the zod
   schema in `engine.ts` (`threadChanges`, `threadCreate`, ...).
3. If changing it should leave an activity line, add a case to `describeChanges` in `engine.ts`.
4. Bump `threadsSchema.version` in `sync.ts` (`"records:vN"`) so clients rebuild their caches.
5. Add the UI: call `client.updateThread(id, { field }, me)` from `App.tsx`'s actions.
6. Tests: an API test in `apps/api/tests/app.test.ts`; a client test in `apps/desktop/tests/sync.test.ts` if the
   client logic changes.

### Add a new model

1. Add the record type to `ModelRecords` and the model to `threadsSchema.models` (with its references) in `sync.ts`.
   Bump the schema version. The engine makes its maps, storage and pool from the schema.
2. If clients create or update it: add `TransactionInput` variants and zod schemas, an `#apply` branch in
   `engine.ts`, the prediction in `threadsMutations`, and a `ThreadsClient` method that calls `#enqueue`.
3. Expose it to the UI as a computed getter on `ThreadsClient` (resolve references there, like `threads`).
4. Seed it in `seed()` if workspaces should start with some.

### Add a side effect

Put it in `SyncEngine.#apply` next to the transaction that causes it, staged with `batch.put`, with a
deterministic id. It reaches clients automatically in the same delta packet.

### Add validation or a business rule

Shape checks go in the zod schemas (`engine.ts`); rules that need data (does this person exist, is this a message)
go in `#apply` and throw `SyncError(400 | 403 | 404 | 409, message)`. The whole batch is refused and the client rolls
back.

### Change sample or local seed data

Edit `packages/model/src/sample.ts`. A sample thread's first message is its description (it gets the thread's id).
Existing workspaces keep their stored threads; seeded **people** refresh automatically on load (`refreshSeedPeople`). To see new sample threads, reset the local Worker's state (delete
`apps/api/.cloudflare/state/v3/do` with the API stopped); clients notice and rebuild.

## Testing and running

- `vp test` in `packages/sync`: the engine end to end with a small test product (groups, sessions, deletes, gaps,
  compaction, resets, restarts, SQLite storage).
- `vp test` in `apps/api`: Threads' rules over in-memory engines (`createApp`), including sessions (`access.test.ts`).
- `vp test` in `apps/desktop`: `ThreadsClient` against the engine's server and an in-memory database, plus UI logic.
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

| LSE                                                                                                                | Ours (`packages/sync`)                                                                           | Notes                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `ModelRegistry`, `__schemaHash`                                                                                    | `defineSchema`, `schemaHash` (`threadsSchema`, `SCHEMA_HASH`)                                    | Plain records plus a schema instead of decorators; same metadata                                                       |
| `loadStrategy` (`instant`, `lazy`, `partial`), partial indexes                                                     | `loadStrategy`, `partialIndexes`                                                                 | `explicitlyRequested` and `local` aren't needed                                                                        |
| `backReference`, `referenceArray`                                                                                  | `backReferences`, `referenceArrays`                                                              | Deleting cascades to back references, nulls references and filters arrays                                              |
| `ephemeralProperty`                                                                                                | `setEphemeral` / `ephemeralOf`                                                                   | Relayed over the socket to sessions that see the record; never stored                                                  |
| Object pool, `hydrate`, `BatchModelLoader`, the partial index store                                                | `ObjectPool`, `SyncClient.hydrate`, a tick's loads in one `POST /sync/batch`, the `loaded` store | Loaded slices stay current through deltas                                                                              |
| `SyncClient`, `applyDelta`, `updateLock`                                                                           | `SyncClient`, `applyDelta`, `#updateLock`                                                        | Same role                                                                                                              |
| `TransactionQueue` and its four stages, `transactionQueuedSignal`                                                  | Same names, `onEnqueued`                                                                         | Batching by microtask, persisted in `__transactions`, capped by count and size                                         |
| `CreationTransaction`, `UpdatingTransaction`, `DeletionTransaction`, `ArchivalTransaction`, `UnarchiveTransaction` | One `Transaction` with a `kind` of the same names                                                | Its effect comes from the product's `ClientMutations`; creations don't replay over a server copy                       |
| `rebase`, `rollback`, `original`                                                                                   | `Transaction.rebase`, `Transaction.rollback`, `original`                                         | As described; after a rollback the client also checks the server's copy, for the rare case rollback alone can't settle |
| `undoTransaction`, `UndoQueue.addOperation`                                                                        | `Transaction.undoTransaction`, `UndoQueue.addOperation`                                          | The product's `inverse` says how its transactions undo                                                                 |
| GraphQL mutations returning `lastSyncId`                                                                           | `POST /sync/transactions` with JSON transactions                                                 | One endpoint, all or nothing per batch                                                                                 |
| Streamed bootstrap with `returnedModelsCount`                                                                      | `encodeBootstrap` / `decodeBootstrap` (counts on the last line)                                  |                                                                                                                        |
| Sync actions `I U A D C G S V`                                                                                     | `I U D A V`                                                                                      | Group changes ride on the packet (`syncGroups`) instead of `G`/`S`; dependents are re-logged rather than `C`           |
| `lastSyncId` global across all of Linear                                                                           | `lastSyncId` per workspace (one Durable Object each)                                             | Missed changes are found by comparing it at the handshake, as in LSE                                                   |
| `databaseVersion`                                                                                                  | `epoch`                                                                                          | Changes when a workspace's data starts over                                                                            |
| `userSyncGroups`, partial bootstrap on joining a group, `DependentsLoader`                                         | `syncGroups`, `groupsFor`, `bootstrap(session, onlyGroups)`, `syncGroupsFrom`                    | Joining reloads held slices too; leaving drops what's no longer visible                                                |
| `firstSyncId`                                                                                                      | `minSyncId` (the log's start, after compaction)                                                  |                                                                                                                        |
| `TransactionQueue.modelUpserted`                                                                                   | `TransactionQueue.modelUpserted` (and `modelDeleted` for changes to deleted models)              | Cancels an unsent creation whose id the server just inserted                                                           |
| Server side effects (e.g. `IssueHistory`) in delta packets                                                         | Activity `Entry`s, status changes added by `SyncEngine.#apply`                                   | Same principle: the delta can carry more than the transaction                                                          |

Where we differ: a plain schema says what LSE's decorators and property types say; sync ids count per workspace, since
each is its own Durable Object; and where the write-up says it doesn't know (how `G` differs from `S`, what `C`
carries), group changes ride on the packet and dependents are re-sent as updates. After a rollback, the client also
checks the server's copy, which the write-up doesn't mention.

## Not built yet

These are outside the engine. To add one, keep the invariants above and update this document in the same change.

### Sign-in

Signing in on the web is built (see "Signing in"); the desktop app doesn't use it yet. To finish it: open the sign-in
page in the system browser, receive the token from `POST /auth/token` on a `threads://` link (Better Auth's Electron
plugin), give the app only that token, never the API token, and drop View As outside development.

### Using the engine's newer features in the app

- **Undo**: `ThreadsClient.undoQueue` works (`threadsMutations.inverse` undoes updates, moves and new messages), but no
  key is bound: wrap the app's edits in `undoQueue.addOperation` and bind ⌘Z / ⇧⌘Z (the Done and Snooze toasts can use
  it too).
- **Partial loading**: mark `Entry` `partial` by `threadId` once bootstraps get slow. The inbox, notifications and
  profiles read every thread's entries today, so they'd need what they show (latest message, who sent what) kept on the
  thread first.
- **Presence**: `setEphemeral` / `ephemeralOf` can show who's viewing a thread.

### Schema migrations

A schema change makes clients rebuild their caches from the server, which is fine at this size. Records the server
stored under an older shape are brought up to date as it loads them (`upgrade` in `engine.ts`). LSE migrates IndexedDB
in place; add that only if rebuilding gets slow.
