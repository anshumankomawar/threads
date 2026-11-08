# Arc Glass

Arc's native macOS client: a SwiftUI app over a Swift port of the sync engine, on a pane of frosted glass.

```sh
swift run Glass        # opens it against the local API (vp run api#dev), as "you" in the sample workspace
swift test             # the engine against a fake server, and a live round trip when the local API is up
```

Environment: `ARC_API` (default `http://127.0.0.1:3030`), `ARC_WORKSPACE` (`sample`), `ARC_TOKEN` (`you`; hosted, a
session token from `POST /auth/token`). Local data is one SQLite file per workspace in
`~/Library/Application Support/Arc Glass/`.

## `Sources/Sync`: the engine

The classes of `docs/sync-engine-v1-spec.md`, one Swift file per TypeScript module in `packages/sync`:

| Swift                | TypeScript          | What                                                                                                                                 |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Protocol.swift`     | `packages/protocol` | The wire types: `Row` (a `[String: JSON]`), `TxRecord`, `SyncAction`, the requests and messages, `FieldMeta`, `ModelMeta`.           |
| `Registry.swift`     | `registry.ts`       | Every model's metadata and constructor; `sees`.                                                                                      |
| `Model.swift`        | `model.ts`          | `Model`: values in `data`, unsaved edits in `original`, `save` / `archive` / `delete`; one `@Observable` version per row.            |
| `Pool.swift`         | `pool.ts`           | `ObjectPool`: by id, by model, by indexed field; each list its own observable.                                                       |
| `Transactions.swift` | `transactions.ts`   | `TransactionQueue`: outbox first, in order, related transactions apart, 40 a request, retry on network error, rollback on rejection. |
| `SyncClient.swift`   | `sync-client.ts`    | `SyncClient`: bootstrap (full or from SQLite), `applyDelta` in the spec's order, gaps, regroup, the socket's Hello.                  |
| `LocalDB.swift`      | `local-db.ts`       | `SQLiteLocalDB` (a table per model, `_meta`, `_outbox`) and the tests' `MemoryLocalDB`.                                              |
| `Transport.swift`    | `http.ts`           | `HTTPTransport`: the endpoints over URLSession and one WebSocket.                                                                    |
| `Store.swift`        | `store.ts`          | `Store`: `create`, `find`, `all`, `where`, `action`, `subscribe`, `connection`, `pendingCount`, `ready`.                             |
| `Filter.swift`       | `filter.ts`         | Linear-shaped filters (`and`, `or`, `eq`, `contains`, `null`, `$me`).                                                                |
| `Text.swift`         | `models/text.ts`    | `[[person:…]]`, `[[thread:…]]`, `[[subspace:…]]`, `[[date:…]]` tokens.                                                               |
| `Models.swift`       | `models/models.ts`  | Threads' thirteen models, with the same fields, names and sync groups the server knows.                                              |

Where the TypeScript has a per-field signal, a Swift model has one observable `version` bumped on every write: a
SwiftUI view that read any field of a row re-renders when the row changes. Coarser than the original, fine at this
size. Rows are stored exactly as the server sends them (dates as milliseconds), so the local database and the wire
agree without conversion.

## `Sources/Glass`: the app

Mail's three columns from `apps/desktop` on the `solid-email` branch (`components/Mail.tsx`, `ThreadView.tsx`,
`mail.ts`, `session.ts`), at the same measurements:

- `Session.swift`: which mailbox and thread are chosen, and the derived lists (`inbox` by bucket, `sent`, `listed`,
  `unread`), as `mail.ts` and `session.ts` compute them.
- `Sidebar.swift`, `ThreadList.swift`, `ReadingPane.swift`: the columns. `Theme.swift` holds the desktop app's tokens
  over glass; `GlassWindow.swift` the window, frost and dot grid; `Identicon.swift` the same identicon as the app's.

J / K move through the list, ⌘E marks done, ⇧⌘E resolves, Return sends a reply. Not here yet: ⌘K, ⌘N, Peek, drafts,
the context menus, Google sign-in (the token comes from the environment).
