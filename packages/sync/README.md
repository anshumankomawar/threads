# sync

A sync engine after Linear's (LSE). Clients change data by sending **transactions**. One **server** per workspace runs
them, numbers every resulting change with a **sync id**, logs it, and pushes it to every client as a **delta packet**.
Clients apply packets in order, so everyone converges. Your own edits show immediately and are reconciled when the
server's version arrives.

It knows nothing about any product. A product gives it:

1. **A schema** (`defineSchema`): its models, their references, and which **sync groups** each record is in.
2. **Server rules** (`apply`): for each transaction, check it and stage the writes and side effects.
3. **Client predictions** (`ClientMutations`): how each transaction changes models, to show it before the server
   confirms.
4. **Wiring**: storage for the server (SQLite in a Durable Object, or memory), sockets, and an HTTP transport for the
   client.

Everything else is the engine's.

## The pieces

| Import        | What                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `sync`        | The wire protocol (`SyncAction`, `SyncMessage`, …), `defineSchema`, `ClientMutations`                               |
| `sync/server` | `SyncServer`, `Batch`, storage (`memoryStorage`, `sqliteStorage`), `broadcast`, `handleSyncRequest`, session tokens |
| `sync/client` | `SyncClient`, `ObjectPool`, `TransactionQueue`, the local database (`openIndexedDb`, `memoryDatabase`)              |

## What it guarantees

- **One writer, one order.** Every change goes through `SyncServer.write`: staged, numbered, saved, applied in memory,
  then broadcast, in that order. A batch is all or nothing.
- **Exactly once.** The server remembers executed transaction ids (for 30 days, then they're compacted away), so a
  client resending after a lost response doesn't run anything twice.
- **Optimistic, then confirmed.** A client applies its change at once. If newer server data for that model arrives while
  the change is pending, the change is rebased on top of it (last writer wins). If the server refuses the batch, it's
  rolled back. If the server deletes a model, unsent changes to it are dropped.
- **Survives restarts.** The client's cache holds only server-confirmed data, plus unsent transactions, which are
  replayed on start.
- **Never stuck.** A packet that skips ahead triggers a catch-up from the log. If the log no longer reaches back that
  far (compacted), or the server's data started over (a new `epoch`), the client bootstraps afresh and replays its
  unsent changes on top.
- **Who sees what.** Every record is in sync groups (`syncGroupsOf`); every session sees its groups (`groupsFor`).
  Bootstrap, catch-up and packets are filtered per session. A record that moves out of your groups arrives as a delete,
  and one that moves in as an insert. When your groups change, the client loads the new groups' records (a partial
  bootstrap) and drops the ones you no longer see.
- **Who's acting.** A user's session acts only as that user. An admin session sees everything and may act as anyone.
  `signSession` / `verifySession` make and check signed session tokens; whatever signs people in mints them.
- **Delete, archive, unarchive** work on any model. Deleting cascades to the records that belong to it (its
  `backReferences`), nulls references to it, and takes it out of reference arrays. The product's `apply` decides who may.
- **Bounded growth.** `compact` trims the log; a client behind the trimmed point bootstraps afresh.

## What a product must respect

- Write only through `apply` (or `SyncServer.write` for server-made changes such as seeding). Never write to storage
  directly.
- Make side effects in `apply`, staged on the batch, with ids derived from the transaction (`${transaction.id}:…`), so
  a resend can't duplicate them.
- A record's sync groups must come from its own fields: changing one record doesn't revisit others.
- Bump the schema's `version` when a record's shape changes, so clients discard caches built under the old one.
- `ClientMutations.change` must work from any starting record, since rebasing reruns it on newer server data.

## Not here yet

Lazy and partial loading of models (every model loads at bootstrap), undo and redo, streaming large bootstraps, and
ephemeral data such as presence. See `docs/architecture.md` in the repo.

## Tests

`vp test` here runs the engine end to end with a small product (private notes, teams, comments): groups, joining and
leaving, sessions, deletes and cascades, archiving, refusals, rebasing, gaps, compaction, resets, restarts, session
tokens, and the SQLite storage over Node's SQLite.
