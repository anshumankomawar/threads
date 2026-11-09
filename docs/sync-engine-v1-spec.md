# Sync Engine v1 Spec

## Summary

We are building our own Linear-style sync engine, so product builders write plain models and UI and never touch networking, caching or loading state. A builder's whole job is conversation.state = "resolved"; conversation.save() and a Solid component that reads conversation.state. The v1 prototype targets a working real-time demo with 2 to 3 clients in about 3 weeks.

## Goals for v1

- Edits appear instantly, survive a reload, and reach every other client within a few hundred milliseconds.
- One model definition drives the database table, the local copy, permissions and live sync.
- The server decides the order of every change (one sync id counter); no CRDTs.
- A simulation test suite proves every client ends in the same state under random delays, drops and reconnects.

## Not in v1

- Lazy loading of single models by index (Linear's `partial` load strategy, e.g. one issue's comments). A session loads
  its sync groups at startup; v2 below adds loading groups as they change and groups it follows.
- Long offline sessions (the outbox covers reloads and short drops only).
- Schema migrations on the client (a schema change clears local data and reloads).
- Search, attachments, native mobile.

## Why SolidJS 2

Solid 2 replaces MobX and most of the glue Linear needs between React and its sync engine, because fine-grained reactivity is built into the framework. The engine core does not change; only the layer that connects data to the screen gets thinner.

| Job                                   | React + MobX (Linear)                           | Solid 2 (us)                                  |
| ------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Tell the UI a field changed           | MobX observables, observer() on every component | A per-field signal inside the model           |
| Update the screen                     | Re-run the component, diff, patch               | Update the one text node that reads the field |
| Group many writes                     | runInAction()                                   | Automatic: all writes in a tick render once   |
| Load lazy data                        | useEffect + hydrate() + isHydrated checks       | Async memo + <Loading> boundary               |
| Derived views (inbox buckets, counts) | MobX computed                                   | createProjection / createStore(fn)            |
| Free unused models                    | Custom bookkeeping                              | unobserved callback                           |
| Performance tuning                    | React.memo, useMemo, useCallback                | None needed: components run once              |

Two Solid 2 rules the engine must respect

- Writes are batched: a signal shows its new value only after the batch runs. So model values live in a plain object the engine reads instantly, and the signal only says "this changed".
- Writing a signal while a component renders throws in dev. So lazy loads are scheduled for just after the read (a microtask) or exposed as async memos, never started inside a getter.

Risks we accept

- Solid 2 is at release candidate (latest tag solid-js@2.0.0-rc.21). We pin exact versions, and the engine imports Solid's reactive core (`@solidjs/signals`) at the same version solid-js uses, so the app and the engine share one.
- We do not use createOptimisticStore or action() for saving edits. They revert optimistic values and refetch, while we confirm edits by sync id and keep an outbox; their concurrency edge cases are also still being fixed.
- Smaller ecosystem and hiring pool; no mature React Native equivalent for mobile.
- Developers must not destructure models or props (const { title } = conversation loses reactivity).

## Architecture

The engine has Solid built in, the way Linear's engine has MobX: models hold Solid signals, and components read them directly. The server is generic over every model.
An edit changes the object pool at once and goes up through the transaction queue; the server numbers it in sync_actions and broadcasts it back to every client, where the sync client writes it to IndexedDB and confirms the original transaction.

Packages, in a Bun monorepo:

- `packages/protocol`: the wire types and model metadata, shared by client and server. Types only.
- `packages/sync`: the client engine, with Solid built in: models and decorators, registry, pool, transaction queue, sync client, IndexedDB, `createStore`, `httpTransport`.
- `packages/models`: the product's models; `models/server` has its server rules and seed data.
- `packages/server`: the generic server, over a Durable Object's SQLite or memory.
- `packages/testing`: the simulation harness, the in-memory LocalDB and fake transports.
- `apps/api` runs the server on Cloudflare; `apps/desktop` is the Electron app.

## Developer API

This is the whole surface product builders use: about 10 decorators and 15 methods, mirroring what Linear's feature code calls (save, findById, hydrate, undoQueue.addOperation, store.mutate). Everything else is engine-internal.

### Defining models

```ts
@ClientModel("Conversation")
export class Conversation extends Model {
  @Property() title!: string;
  @Property({ enum: ["open", "resolved"] }) state!: "open" | "resolved";
  @Property({ indexed: true }) teamId!: string;
  @Reference(() => User, "ownedConversations", { nullable: true }) owner?: User; // also creates ownerId
  @Reference(() => Team, "conversations") team!: Team;
  @OneToMany(() => Message, "conversation") messages!: Collection<Message>;
  @Computed get isOpen() {
    return this.state === "open";
  }
}
```

| Decorator                         | Purpose                                                        | Key options                                      |
| --------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| @ClientModel(name)                | Registers the model; adds id, createdAt, updatedAt, archivedAt | syncGroup?: (m) => string[]                      |
| @Property(opts?)                  | Stored, reactive field                                         | enum, indexed, serializer, nullable              |
| @Ephemeral()                      | Reactive, never stored or synced                               | none                                             |
| @Reference(() => T, back?, opts?) | Many-to-one; creates xxxId too                                 | nullable, indexed, onDelete: "cascade" "setNull" |
| @OneToMany(() => T, foreignKey)   | Back-reference collection                                      | none in v1                                       |
| @Computed                         | Derived value, cached until inputs change                      | none                                             |

### Using models

```ts
interface Model {
  readonly id: string; // client-generated UUID
  readonly createdAt: Date;
  readonly updatedAt: Date;
  archivedAt?: Date;
  readonly isPersisted: boolean; // server has confirmed the create

  save(): Transaction; // update; no-op if nothing changed
  archive(): Transaction;
  unarchive(): Transaction;
  delete(): Transaction;
  discardChanges(): void; // revert unsaved field edits
  readonly changedFields: string[];
}

interface Transaction {
  readonly id: string; // idempotency key, sent to the server
  readonly status: "queued" | "sending" | "awaitingSync" | "done" | "rejected";
  result(): Promise<void>; // resolves when its own sync id comes back
}

interface Collection<T extends Model> extends Iterable<T> {
  readonly length: number;
  filter(fn: (m: T) => boolean): T[];
  sorted(by: keyof T, dir?: "asc" | "desc"): T[];
}
```

Creation is explicit, unlike Linear's easy-to-miss save(true):

```ts
const c = store.create(Conversation, { title: "Office internet quotes", team, owner: marcus });
await c.transaction.result();
```

### The store

```ts
interface Store {
  create<T extends Model>(
    type: ModelClass<T>,
    fields: Partial<T>,
  ): T & { transaction: Transaction };
  findById<T extends Model>(type: ModelClass<T>, id: string): T | undefined; // instant, from memory
  all<T extends Model>(type: ModelClass<T>, opts?: { includeArchived?: boolean }): T[];
  where<T extends Model>(type: ModelClass<T>, index: keyof T, value: unknown): T[]; // uses @Property({indexed})
  view<R>(fn: () => R): () => R; // a derived, incrementally updated view (inbox buckets, counts)

  action<A extends keyof ServerActions>(name: A, args: ServerActions[A]): Promise<void>;
  undo: UndoQueue;

  readonly connection: () => "connecting" | "live" | "offline";
  readonly pendingCount: () => number; // unsent + awaiting-sync transactions
  ready(): Promise<void>; // bootstrap finished
}

interface UndoQueue {
  group(label: string, fn: () => void): void; // every save() inside = one undo step
  undo(): string | null; // the step undone's label, or null if there was none
  redo(): string | null;
  readonly nextUndo: () => string | null; // what undo would undo, by its label
  readonly nextRedo: () => string | null;
}
```

### Undo and redo

Built on transactions, as Linear's undo queue is (`undo.ts`):

- `group(label, fn)` listens to the transaction queue while `fn` runs (as Linear's `undoQueue.addOperation` subscribes
  to its transaction-queued signal); every transaction queued in that time, from `save()`, `create`, `archive` or
  `delete`, is one undo step. A group inside another is part of it. Edits outside a group (marking a thread seen as
  you open it) aren't undoable.
- Undoing a step reverses its changes, last first, each with a new transaction that's queued, saved to the outbox
  and synced like any other: an update's fields go back to their old values, a create is deleted, a delete is made
  again with its id and fields, and an archive is unarchived (and the reverse). Those reversals are the redo step;
  redo reverses them in turn. Undo and redo record no step themselves, and a new step clears what could be redone.
- A change is only reversed where it still holds: a field changed since (by someone else, or a later edit) is left
  as it is, a model that's gone is skipped, and so is a rejected transaction, which the queue has already rolled back.
  A step with nothing left to reverse is dropped, and the one before it is undone instead. A step keeps its own copy
  of each change's old values (so the server echoing a pending edit back can't make it undo to itself), and the queue
  tells it when a refused transaction's rollback changes one: undoing never brings back a value the server refused.
- The stacks are this session's, in memory, at most 100 steps.

### Server actions

For logic that must run on the server (AI suggestions, "resolve for everyone" with notifications), builders call a named action instead of editing fields. Like Linear's store.mutate, it resolves only after the resulting sync id has arrived, so the UI is already up to date.

```ts
await store.action("resolveConversation", { conversationId: c.id, note: "Brightline signed" });
```

### In a Solid component

```tsx
function ConversationRow(props: { conversation: Conversation }) {
  return (
    <div class={props.conversation.isOpen ? "open" : "done"}>
      {props.conversation.title}
      <button
        onClick={() => {
          props.conversation.state = "resolved";
          props.conversation.save();
        }}
      >
        Resolve
      </button>
    </div>
  );
}
```

No hooks, no loading flags, no fetch calls.

## Engine internals

Five internal pieces sit behind the developer API: the model registry, object pool, transaction queue, sync client and local database. Their classes in `packages/sync` (`ModelRegistry`, `ObjectPool`, `TransactionQueue`, `SyncClient`) and the `LocalDB` interface are the contracts tests are written against; the wire types and model metadata are in `packages/protocol`, exactly as specified.

The registry is shared code: the server reads the same metadata to validate mutations and build tables.

Transactions and queue rules, taken from Linear's queue: save to the outbox before sending; send in order; never run two transactions for the same model (or a model and one it references) at once; at most 40 in flight per request; on a network error put the batch back at the front; on a rejection roll back and reject result(), and drop (and roll back) what waits on a refused create, directly or through another create that does (a message in a refused conversation), before sending anything else; a transaction is done only when lastSyncId reaches its sync id. Only a transaction's own refusal, or a 400, 403, 404 (an unknown workspace), 409, 413 or 422 for the whole request, is a rejection: a 401, 408 or 429 (like a 5xx or a dropped connection) is retried after a backoff, with the edits kept. A refused create of a model the local database still has (undoing a delete the server refused or hadn't run yet) leaves the server's copy in place. After a reload the outbox is replayed ahead of anything queued while loading. A transaction queued before the local database is open waits for it to be saved; one already in the outbox as it's read isn't replayed twice. Before the app starts over as another person (or signs out) it waits, a few seconds at most, for what's pending to be sent.

applyDelta order: drop a packet older than lastSyncId; if its groups differ from the ones the local data holds, change
groups (v2) instead; check the first sync id equals lastSyncId + 1 (otherwise fetch the gap); write each action to the local database; update the object pool; call queue.onDelta to rebase pending edits on top; advance lastSyncId; resolve waiters.

LocalDB: IndexedDB via a thin wrapper (Dexie or idb): one database per workspace, one table per model, plus _meta and _outbox. Rows the server sends are written in one IndexedDB transaction with the position they bring the data to, and a full load replaces every table and the position in one too (the outbox stays), so a crash part way never leaves rows a position doesn't account for, or a database without a position that the next start would clear outbox and all. The object pool drops a list once it's empty and a signal once nothing reads it. The test suite swaps in an in-memory version.

Reactivity: the engine uses `@solidjs/signals` directly. Each field has a signal that carries no value (`equals: false`): reading the field subscribes, writing it announces the change. Field values always live in model.__data, so engine code never sees stale values from batching. store.view and @Computed are createMemo, owned by nothing (createRoot) and lazy; read outside a tracking scope they compute from the current values. Tests, the server and the simulation run the same real signals in Node.

## Wire protocol and server API

The server is generic: one mutation endpoint handles every model from registry metadata, and one change-log table is the source of every delta. Plain JSON over HTTP and one WebSocket; no GraphQL.

The change log:

```sql
create table sync_actions (
  id           bigserial primary key,        -- the sync id: one global order
  tx_id        uuid not null,                -- client transaction id (idempotency)
  model        text not null,
  model_id     uuid not null,
  action       char(1) not null,             -- I insert, U update, A archive, R unarchive, D delete
  data         jsonb,                        -- full row after the change (null for D)
  sync_groups  text[] not null,              -- who may receive it
  created_at   timestamptz not null default now()
);
create unique index on sync_actions (tx_id, model_id);
create index on sync_actions using gin (sync_groups);
```

Each model also has a normal table. A mutation writes the model row and its sync_actions row in the same transaction, then sends NOTIFY sync, '<id>'. (We run this in Durable Object SQLite; the object is the only writer and broadcasts instead of NOTIFY.)

Endpoints:

| Method | Path                    | Purpose                                                                                        |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | /sync/bootstrap         | All rows in the user's sync groups + lastSyncId + schemaHash (partial: v2); streamed as NDJSON |
| GET    | /sync/deltas?after=<id> | Sync actions after id in the user's groups; for reconnects and gaps                            |
| POST   | /sync/mutate            | A batch of transactions; returns one sync id per transaction                                   |
| POST   | /actions/<name>         | Named server action; returns the highest sync id it produced                                   |
| WS     | /sync/socket            | Live delta packets                                                                             |

Server mutation rules

1. Authenticate; load the user's sync groups.
2. For each transaction in order: skip if tx_id already exists (return its stored sync id); validate fields against the registry; run the model's permission hook; apply the write; insert the sync_actions row with the row's sync groups.
3. Commit once per request, then NOTIFY.
4. A rejected transaction does not stop later independent ones; the client rolls back only the rejected one.

Sync groups: A sync group is a string tag on every row, computed by the model's syncGroup function. A client receives a delta only if it shares at least one group with it. v1 uses two kinds: user:<id> (personal rows: inbox state, drafts, preferences) and workspace:<id> (everything a workspace's members share: people, conversations, messages, settings). Permission hooks check writes; sync groups control reads. Both come from the same model definition.

## v2: changing sync groups, and following groups

Groups change all the time once they follow membership (joining or leaving a subspace, a subspace turning private), so
a change no longer means loading everything again. This follows Linear's client, which partially bootstraps the groups
it gained and deletes the rows of the groups it lost.

- **Every packet says the session's groups.** Socket packets and `GET /sync/deltas` carry `groups`: the session's sync
  groups as of `lastSyncId`. There's no separate groups-changed message, so a packet can't be read against the wrong
  groups, and the latest one is always right.
- **Changing groups.** A client whose groups differ from a packet's asks `GET /sync/bootstrap?holds=<its groups>&after=<
  lastSyncId>` and gets, as of one sync id, the session's groups, the rows of the ones it doesn't hold, and in the
  `BootstrapEnd` every action after `lastSyncId` it sees. It deletes what those groups no longer cover from its local
  database (not just the pool, so rolling back a pending delete can't bring a row back), applies the actions, then the
  rows, and holds exactly the groups the server sent. A full bootstrap happens only for a fresh database, a new schema,
  or a server behind the client.
- **Following groups.** `store.subscribe(group)` follows a group the session may read without being in it (`mayRead` on
  the server, e.g. an open subspace you aren't a member of). The client keeps its subscriptions in `_meta`, sends them
  in every request (`?subscribed=`) and in its Hello, and says hello again on the same socket when they change; the
  server adds them to the session's groups, so they arrive as a groups change like any other. Subscriptions are kept, so
  a followed group stays loaded.
- **`_meta`** holds `{ lastSyncId, groups, subscribed }`.
- **Simulation.** Clients also subscribe to teams (one of them private, which they may not read), and the ordering check
  starts over at every change of groups.

## Example data model

| Model        | Key fields                                                                    | Sync group     | Conflicts                              |
| ------------ | ----------------------------------------------------------------------------- | -------------- | -------------------------------------- |
| Workspace    | name                                                                          | workspace:<id> | Rare; last writer wins                 |
| User         | name, email, avatarUrl                                                        | workspace:<id> | Rare                                   |
| Team         | name, workspaceId                                                             | workspace:<id> | Rare                                   |
| Conversation | title, state (open, resolved), ownerId, teamId, dueAt                         | team:<teamId>  | Per field, last writer wins            |
| Message      | conversationId, authorId, body                                                | team:<teamId>  | None: created once, never edited in v1 |
| InboxItem    | userId, conversationId, bucket (needsYou, waiting, fyi), doneAt, snoozedUntil | user:<userId>  | None: one owner                        |

```ts
@ClientModel("InboxItem", { syncGroup: (r) => [`user:${r.userId}`] })
export class InboxItem extends Model {
  @Reference(() => User) user!: User;
  @Reference(() => Conversation, "inboxItems") conversation!: Conversation;
  @Property({ enum: ["needsYou", "waiting", "fyi"], indexed: true }) bucket!: string;
  @Property({ nullable: true }) doneAt?: Date; // "Done for me"
  @Property({ nullable: true }) snoozedUntil?: Date;
}

// "Needs you" view, updated incrementally
const needsYou = store.view(() =>
  store.where(InboxItem, "bucket", "needsYou").filter((i) => !i.doneAt && !i.snoozedUntil),
);
```

The server keeps InboxItem rows up to date: when a message arrives, a server worker sets the bucket for each participant. AI suggestions ("this looks resolved") are written by the same worker as ordinary sync actions, so they appear live with no special path.

## Testing: deterministic simulation

The real engine code runs against a fake network, fake clock and in-memory databases, driven by a random seed; any failure replays exactly from its seed.

1. One seeded random source drives every decision.
2. Real engine, fake world: the sync client, queue and server code are the real modules; only the network (a message queue the simulator controls), the clock, and the local database (in-memory LocalDB) are swapped; models run on the real Solid signals.
3. Several clients, one server: 2 to 5 clients, including two "tabs" of the same user.
4. Random steps: a client edits a random model, creates or deletes one, calls a server action; the network delivers, delays, duplicates or drops a message; a client disconnects, reconnects, reloads (keeping only its local database); the server rejects a transaction.
5. Quiesce (heal the network, deliver everything), then check the invariants.
6. On failure, print the seed and the step log; shrink it (fast-check does this).

Invariants checked after every run

- Convergence: every client's object pool and local database equal the server's rows in that client's sync groups.
- No lost writes: every transaction either reached the server once or was rejected and rolled back; none applied twice (idempotency).
- Ordering: each client applied sync ids in strictly increasing order with no gaps.
- Local database purity: a client's IndexedDB never holds a value the server did not approve.
- Permissions: no client ever holds a row outside its sync groups.
- Completion: every result() promise settled; nothing is stuck in the queue.

```ts
import fc from "fast-check";
test("clients converge under random faults", () => {
  fc.assert(
    fc.property(fc.integer(), (seed) => {
      const sim = new Simulation({ seed, clients: 4, steps: 500 });
      sim.run(); // random edits + network faults
      sim.quiesce(); // heal network, deliver all
      sim.checkInvariants();
    }),
    { numRuns: 2000 },
  );
});
```

Other layers: unit tests for the registry, rebase and rollback logic; reactivity tests (a field write updates only what read it, writes in one tick run it once).
