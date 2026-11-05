# sync

A sync engine built after Linear's (LSE), as described in
[the reverse-engineering study](https://github.com/wzhudev/reverse-linear-sync-engine). Clients change data by
sending **transactions**. One **server** per workspace runs them, numbers every resulting change with a **sync id**,
logs it, and pushes it to every client as a **delta packet**. Clients apply packets in order, so everyone converges.
Your own edits show immediately and are reconciled when the server's version arrives.

It knows nothing about any product. A product gives it:

1. **A schema** (`defineSchema`): its models, their references, how each loads, and which **sync groups** each record
   is in.
2. **Server rules** (`apply`): for each transaction, check it and stage the writes and side effects.
3. **Client predictions** (`ClientMutations`): how each transaction changes models, so it shows before the server
   confirms it, and how to undo it.
4. **Wiring**: storage for the server (SQLite in a Durable Object, or memory), sockets, and a transport for the client.

Everything else is the engine's.

## The pieces

| Import        | What                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`        | The wire protocol (`SyncAction`, `SyncMessage`, …), `defineSchema`, `ClientMutations`, the bootstrap stream                                   |
| `sync/server` | `SyncServer`, `Batch`, storage (`memoryStorage`, `sqliteStorage`), `broadcast` and `receive` for sockets, `handleSyncRequest`, session tokens |
| `sync/client` | `SyncClient`, `ObjectPool`, `TransactionQueue`, `UndoQueue`, the local database (`openIndexedDb`, `memoryDatabase`), `setReactivity`          |

## What it guarantees

- **One writer, one order.** Every change goes through `SyncServer.write`: staged, numbered, saved, applied in memory,
  then broadcast, in that order. A batch is all or nothing.
- **Exactly once.** The server remembers executed transaction ids (for 30 days, then they're compacted away), so a
  client resending after a lost response doesn't run anything twice.
- **Optimistic, then confirmed (LSE's rebase and rollback).** A client shows its change at once, remembering the values
  it replaced (`original`). When newer server data for one of its models arrives first, the change is rebased onto it:
  `original` becomes the server's values and the change stays on top (last writer wins). If the server refuses the
  batch, each transaction rolls back, newest first; then what it touched is checked against the server's copy, which
  settles the rare case rollback alone can't (the record left your view while the change was out). If the server
  deletes or inserts a model, unsent changes to it, or an unsent creation with its id, are dropped (`modelDeleted`,
  `modelUpserted`).
- **A refused creation takes its dependents with it.** Changes still waiting that touch what a refused creation would
  have made are dropped with it, never sent to be refused in turn.
- **Last writer wins.** An update sets whole values, lists included, and the later one wins, as in LSE.
- **Survives restarts.** The client's cache holds only server-confirmed data, plus unsent transactions (with when they
  were made), which are replayed on start.
- **Never stuck.** At every (re)connect the handshake says where the server is, and the client fetches what it missed
  (LSE compares `lastSyncId` the same way). A socket delivers packets in order and can't drop one without closing, so
  that's the only place anything can be missed. If the log no longer reaches back that far (compacted), or the server's
  data started over (a new `epoch`), the client bootstraps afresh and replays its unsent changes on top. If anything
  fails mid-way (the server unreachable during a catch-up, say), the client drops the connection, skips whatever was
  queued behind the failure, and starts again from a new handshake, so no change or group change is ever skipped.
- **Who sees what.** Every record is in sync groups (`syncGroupsOf`, or its parent's through `syncGroupsFrom`); every
  session sees its groups (`groupsFor`). Bootstrap, catch-up, loads and packets are filtered per session. A record that
  moves out of your groups arrives as a delete, and one that moves in as an insert, and records whose groups come from
  it move with it. When your groups change, the client loads the new groups' records (a partial bootstrap) and drops
  the ones you no longer see, from its database and its pool, judged by the server's copy where it has one.
- **A bad batch never blocks a client.** A rule that crashes (throws anything but a `SyncError`) refuses its batch with
  a 422 instead of failing the request, so the client rolls it back rather than retrying forever. Sends that fail back
  off (2 s doubling to a minute, with jitter); five server failures in a row and the change is `stuck`: the client
  reports it and holds everything behind it until the user calls `retryStuck()` or `discardStuck()`. Being offline is
  never "stuck".
- **Out-of-date apps stop cleanly.** Every response says which schema the server runs, and every batch which one the
  client was built with. A client built for another schema goes to `status: "outdated"` and stops syncing (what's on
  screen stays readable, unsent changes stay saved); the server refuses its batches with a 426.
- **Rules only see what the actor can see.** `batch.find` returns a record only if the acting session's groups include
  it, so a rule that looks up whatever a transaction names with it can't be used to change, or learn of, a record by
  guessing its id. (`batch.get` reads anything, for side effects and for checking an id is free.)
- **Who's acting.** A user's session acts only as that user. An admin session sees everything and may act as anyone.
  `signSession` / `verifySession` make and check signed session tokens; whatever signs people in mints them.
- **Loading on demand.** A model loads `instant` (at bootstrap), `lazy` (all at once, the first time it's asked for) or
  `partial` (a slice at a time by one of its `partialIndexes`, such as a thread's entries by `threadId`).
  `client.hydrate(...)` loads from the local database when it holds the slice, else from the server, batching a tick's
  requests into one. A loaded slice stays current; records outside loaded slices stay in the database, not the pool.
- **Delete, archive, unarchive** work on any model. Deleting cascades to the records that belong to it (its
  `backReferences`), nulls references to it, and takes it out of reference arrays. The product's `apply` decides who may.
- **Undo and redo.** `client.undoQueue.addOperation(label, edit)` records the transactions an edit makes as one step.
  Undoing queues each one's undo as a new transaction, so it syncs like any other change.
- **Ephemeral values.** `client.setEphemeral(...)` tells everyone who can see a record something that's never stored,
  such as that you're looking at it.
- **Bounded and observable.** `compact` trims the log; batches are capped by count and size; a bootstrap streams as
  lines and is checked for completeness. `onEvent` on both sides reports commits, refusals, compaction, bootstraps,
  catch-ups, gaps, group changes and loads.

## What a product must respect

- In `apply`, look up whatever a transaction names with `batch.find`, not `batch.get`.
- Throw `SyncError` for a refusal; anything else is treated as a bug in the rule and refused with a 422.
- Write only through `apply` (or `SyncServer.write` for server-made changes such as seeding). Never write to storage
  directly.
- Make side effects in `apply`, staged on the batch, with ids derived from the transaction (`${transaction.id}:…`), so
  a resend can't duplicate them.
- A record's sync groups come from its own fields, or its parent's through `syncGroupsFrom`.
- Bump the schema's `version` when a record's shape changes, so clients discard caches built under the old one.
- `ClientMutations.change` must work from any starting record, since pending changes are replayed on newer server data.
- A transport's `connect` calls its handlers only after it returns, as a WebSocket's events do.

## Tests

`vp test` here runs the engine end to end with a small product: private notes, teams, comments (partial, seen by
whoever sees their note), stickers (lazy) and tags (a list). It covers groups, joining and leaving, sessions, deletes and
cascades, archiving, refusals, rebasing, last writer wins, loading, undo, ephemeral values, gaps, compaction, resets,
restarts, the bootstrap stream, events, session tokens and the SQLite storage over Node's SQLite. `convergence.test.ts`
runs several clients making random conflicting changes while connections drop, clients go offline and restart, undo, and
the log is compacted under them, and checks every client ends up exactly where the server says it should.
