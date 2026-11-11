# Architecture

Threads runs on its own Linear-style sync engine, built to [the Sync Engine v1 spec](sync-engine-v1-spec.md). Its
developer API, interfaces, wire protocol, tables, queue rules and invariants are the spec's, exactly; read it first.
This page says where each piece lives and what Threads adds.

```
Desktop (Solid 2)                                     Cloudflare
──────────────────                                    ──────────
components read models ─▶ object pool (per-field signals)  Worker: sessions, /ai/compose, routes by workspace
   │ thread.save()              ▲ applyDelta                          │
   ▼                            │                                     ▼
transaction queue ── POST /sync/mutate ──────────────────▶ Durable Object "Workspace" (one per workspace)
   │ outbox                     │                            SyncServer + Threads' rules, SQLite: sync_actions + a
   ▼                            │                            table per model; broadcasts each commit to sockets
IndexedDB ◀── sync client ◀──── delta packets (WS /sync/socket) ◀──┘
```

## Packages

| Path                | What it is                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | The spec's wire types (`Row`, `TxRecord`, `SyncAction`, the requests and messages) and model metadata (`FieldMeta`, `ModelMeta`). Types only.                                                                                                     |
| `packages/sync`     | The client engine, with Solid built in (`@solidjs/signals`, the version solid-js uses): `Model`, the decorators, `registry` (shared with the server), the pool, transaction queue, sync client, `indexedLocalDB`, `createStore`, `httpTransport`. |
| `packages/models`   | Threads' models (`models.ts`), text tokens (`text.ts`), compose types; `models/server` has the server rules (`rules.ts`) and seed data (`seed.ts`).                                                                                               |
| `packages/server`   | The generic server: `SyncServer` (bootstrap, deltas, mutate, actions, sockets) over `sqliteStorage` (Durable Object) or `memoryStorage`, `handleRequest` for the HTTP routes, session tokens.                                                     |
| `packages/testing`  | The deterministic simulation (`World`, and its test), `memoryLocalDB`, and the fake transport the engine's unit tests use.                                                                                                                        |
| `apps/api`          | The Worker and the `Workspace` Durable Object, inbox sorting with Workers AI (`triage.ts`), `/ai/compose` (`compose.ts`).                                                                                                                         |
| `apps/desktop`      | The Electron app. The renderer imports the store from `session.ts` and reads models directly; StyleX for styles.                                                                                                                                  |

A field's signal carries no value: its value lives in `model.__data`, where the engine reads it at once, and the signal only says it changed. Views (`store.view`, `@Computed`) are memos owned by nothing. The same signals run in Node, so the server and the tests import `sync` as the app does.

## Threads' models

In the spec's style, in `packages/models/src/models.ts`. There are three kinds of sync group: `workspace:<id>` for
what a workspace's members share, `subspace:<id>` for what's in a subspace, and `user:<id>` for a person's own rows. A
session's groups are `workspace:<id>` when it's a member of the workspace, `subspace:<id>` for each subspace it's in,
and `user:<me>`. It also follows any open subspace it opens (spec v2: `Store.subscribe`), so a subspace you aren't in
loads only when you look at it.

| Model           | Key fields                                                                                                                                               | Sync group                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Workspace       | name                                                                                                                                                     | its own `workspace:<id>`                                     |
| User            | name, email, avatarUrl, workspaceIds                                                                                                                     | `workspace:<id>` per workspaceIds                            |
| WorkspaceMember | workspace, user, role (admin, member)                                                                                                                    | `workspace:<id>`                                             |
| Label           | workspace, name                                                                                                                                          | `workspace:<id>`                                             |
| Subspace        | workspace, name, visibility (open, private), members                                                                                                     | `workspace:<id>`, private: its own `subspace:<id>`           |
| SubspaceMember  | subspace, user                                                                                                                                           | `subspace:<id>` and `user:<id>`                              |
| View            | owner, workspace, name, filter, shared                                                                                                                   | `user:<owner>`, shared: `workspace:<id>`                     |
| Thread          | title, description, state (open, resolved, blocked), owner, assigneeIds, workspace, dueAt, priority, labelIds, subspaceIds, branchedFrom, blocks, isOpen | `subspace:<id>` per subspaceIds, or `workspace:<id>` in none |
| Message         | thread, author, body, workspaceId, subspaceIds                                                                                                           | as its thread                                                |
| Activity        | thread, actor, text, workspaceId, subspaceIds                                                                                                            | as its thread                                                |
| InboxItem       | user, thread, bucket, doneAt, snoozedUntil, seenAt, reason, manual                                                                                       | `user:<id>`                                                  |
| Bucket, Draft   | user, name, description, position / text, draft                                                                                                          | `user:<id>`                                                  |

- **User** is the person, across workspaces. The server keeps `workspaceIds` (an effect of WorkspaceMember create and
  delete), so members of any workspace they share see them.
- **WorkspaceMember** is their place in one workspace and their role there (everyone is an admin for now). A person's
  page shows their role; your own lists the workspace's members.
- **Thread** is the only unit of work. In no subspace, every member of the workspace sees it; in subspaces
  (`subspaceIds`, the chip in its header), their members and their followers do, and when one is private only its
  members. `labelIds` lists its Labels. `branchedFrom` is a branch, linked from a message by `[[thread:<id>]]`;
  `blocks` (made with `/blocked`) keeps that thread blocked until this one is resolved.
- **Making a thread**: `createThread` (`components/Palettes.tsx`) is the only way, from ⌘N (title, description, assignee,
  and labels on Tab), ⌘⇧N (written as one message; the model drafts it and you can edit the draft), `/blocked` and a `#`
  branch. A thread assigned to someone else from the start is in their inbox and its owner’s Outbox.
- **Assignees**: a thread has one owner and any number of assignees. `@mention`ing someone in a message assigns them
  (the server reads the mentions), and the thread stays in their inbox until they mark it done or it's resolved. A
  message that mentions nobody tells nobody. Mentioning them again brings it back.
- **Message** and **Activity** carry their thread's `workspaceId` and `subspaceIds`, because a row computes its own
  group; moving a thread moves them with it. Messages are created once; their author may delete them.
- **Subspace** is a space of the workspace with its own members, like a team: open (anyone joins, and anyone may follow
  it) or private (only its members see it, its threads or who's in it). `@mention`ing one assigns everyone in it now.
  **SubspaceMember** is one person in one; your own always load, so the app knows which subspaces you're in.
- **View** is a saved filter over threads, in Linear's shape (`{ and: [{ field: { eq | contains | … : value } }] }`,
  evaluated on the client by `matches` in `sync`; `$me` is you). Yours, or shared with the workspace. A label's, a
  subspace's and a person's pages are the same view page with a fixed filter, and any of them can be saved as a view.
- **Activity** is a line in a thread saying what someone changed (status, priority, due date, labels, title, or being
  blocked and unblocked). Only the server writes these, from the changes themselves (`rules.ts`), so no client can forget
  one or forge one.
- **InboxItem** has `bucket` (one of the person's own Buckets, or none until sorted), `reason` and `manual` (placed by
  hand), and `seenAt` (unread is a message by someone else after it).
- **Bucket** is a person's inbox bucket: a name and a description the model sorts by. **Draft** is an unsent ⌘⇧N
  message.

The local workspace seeds 22 people and the sample workspace 7, each a member and an admin; the sample also has an open
subspace (Engineering), a private one (Leadership), labels and threads.

## Server rules (`packages/models/src/rules.ts`)

Permission hooks: you edit only your own User row, and never its `workspaceIds`; members write the workspace, its
labels, threads and messages; only admins change memberships and roles; a message's author is you, and only the author
deletes it; you write only your own Bucket, Draft, InboxItem and View rows; a thread or message in a subspace is
written only by someone who may see it; anyone in the workspace makes a subspace and its members change it; members add
and remove anyone, and you join an open subspace (or one nobody's in yet: its maker) and leave any; only the server
writes Activity. Effects, in the same commit: a membership adds
its workspace to the person's `workspaceIds` (its removal takes it out); a new thread gives its owner an InboxItem; a
message's `@mentions` (and everyone in an `@mentioned` subspace) become assignees and each gets an InboxItem (or clears `doneAt`/`snoozedUntil`), and its
`workspaceId` and `subspaceIds` must be its thread's; a thread moved between subspaces moves its messages and activity;
a deleted subspace's threads leave it and its memberships go; assigning from the thread does the same and unassigning marks their item done; an
owner who hasn't been mentioned has their own item marked done when they mention someone else, so it’s in their Outbox; a
deleted bucket's items are sorted again; a thread made with `blocks` blocks that one, and
resolving the last open blocker reopens it; a new user gets the default buckets.

After each commit the Durable Object sorts unsorted, unplaced InboxItems into their owners' buckets with Workers AI and
writes the answers as ordinary transactions (`apps/api/src/triage.ts`); a failure retries in a minute by alarm.

## Sessions

Every request carries `X-Workspace` (`local`, or `sample` when `SAMPLE_WORKSPACE` is on) and a bearer token; the socket
sends the token in its `Hello`. Hosted, the `API_TOKEN` is the admin (sees everything, acts as anyone) and
a person's token is a signed session from `POST /auth/token` (below). Locally there's no secret: the token is the
person's id, and an empty token is the admin. Switching source or person (⌘U, ⌘K) reloads with the new session.

### Signing in

The desktop app signs in only with Google, through [Better
Auth](https://www.better-auth.com) in the Worker (`apps/api/src/auth.ts`) and its Electron plugin in the app's main
process (`apps/desktop/src/main/signIn.ts`). There's no separate sign-in site: the API is all there is.

- **The welcome screen**: signed out of Local or Cloudflare, or signed in with no workspace yet, the whole window is the
  welcome screen (`components/Welcome.tsx`; `main.tsx` loads it instead of the app, so no store is made): logging in,
  then joining a workspace you're invited to or one open to your company's domain, or making one and inviting your
  team. Sample has none: it's viewed as anyone (⌘U).
- **Google** (Continue with Google) opens the browser straight at Google (`/api/auth/electron/
  init-oauth-proxy`, with the app's PKCE request), which returns to the API (`<BETTER_AUTH_URL>/api/auth/callback/google`),
  which lands the browser on the API's own page at `/` (`SIGNED_IN_PAGE`). That page opens the app on
  `com.threads.arc://auth/callback#token=…` with a one-time code, and shows the code to paste into the app in case the link
  doesn't open it, which can happen in development. The main process trades the code for its session
  (`/electron/token`). The browser has to use one origin for the whole round trip (its cookies are that host's), so it's
  exactly `BETTER_AUTH_URL`: `http://127.0.0.1:3030` locally, never `localhost`.
- **The session** stays in the main process, encrypted with the OS keychain (`safeStorage`) before it's written to disk.
  The window only ever gets the Threads token, from `POST /auth/token` (`window.threads.signedIn()`): hosted, a signed
  session token; locally, the person's id. Signed in, you're that person and ⌘U is off;
  signing out returns to View As. Calls from the main process carry `origin: com.threads.arc:/`, which the API trusts.
- **Workspaces are in a directory** (`apps/api/src/directory.ts`), in the same D1 database: each workspace (and the
  company domain anyone at may join it from, if its maker allowed that), its members (an email and the Person they are
  there) and who's invited. Anyone can log in. `GET /onboarding` says where you can go, `POST /workspaces` makes one,
  `POST /workspaces/:id/join` joins one and `/workspaces/:id/invites` lists and adds invites (no email is sent; they see
  it when they log in). Each of these, and `POST /auth/token`, runs the workspace's `admit` action (`rules.ts`), which
  makes whatever's missing of the member's Workspace, Person and membership in its Durable Object, so the directory is
  the one record of who's a member. The window reaches these routes through the main process
  (`window.threads.call`), which holds the session; `/auth/token` takes `{ workspace }` and answers 409 when you have
  none yet. The app remembers the workspace you were last in, per source; ⌘K switches, invites, and makes or joins
  another.
- **Better Auth keeps its own users and sessions** in a D1 database (`AUTH_DB`), apart from the workspaces. Its tables
  are made the first time the Worker signs anyone in (`getMigrations`), so there's no migration step to run.
- **Settings**: `BETTER_AUTH_SECRET` (local default otherwise), `BETTER_AUTH_URL` (the API's own origin,
  `http://127.0.0.1:3030` by default), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Google is offered only with both;
  its redirect URI is `<BETTER_AUTH_URL>/api/auth/callback/google`). Locally they go in
  `apps/api/.dev.vars`; hosted, they're secrets.
- **The plugin's content security policy is left off**, since it would keep the window from reaching the API.
- **Per data source**: the main process keeps the chosen source in a `source` file in the app's data folder
  (`window.threads.source` / `useSource`), and signs in against that source's API with its own saved session. Choosing
  another source restarts the app, since Better Auth's client is made once, before the app is ready; in development
  the app exits with code 75 and `dev` in `package.json` starts it and its dev server again. The app never holds the
  API token.

## Running and testing

- `vp run api#dev` serves the API on `http://127.0.0.1:3030` (needs `cf` logged in to the Threads account for Workers
  AI; `THREADS_LOCAL_AI=off` leaves sorting out). The sample workspace seeds itself; any other is made by its first
  member. State lives in
  `apps/api/.cloudflare/state`. A local workspace whose data was written under other models starts over by itself
  (the `Workspace` object keeps the schema hash in a `schema` table), so changing the models needs no reset by hand;
  hosted data is never thrown away. Deleting `v3/do` (API stopped) still starts over on demand.
- `vp run desktop#dev` starts the app. Cloudflare is offered when `apps/desktop/.env.local` sets `VITE_API_URL`. Closing its window only hides it: the app keeps running, synced, until
  you quit it (⌘Q), and the Dock icon, opening it again or a sign-in link brings the window back. Use the cf CLI, never Wrangler; deploy with `vp run api#deploy`.
- `vp test` in `packages/sync` (unit tests), `packages/testing` (the deterministic simulation), `packages/server`,
  `packages/models` (the rules) and `apps/api`. `vp check` at the root.

## Changing the model

Add or change a field with the decorators in `models.ts`; the registry's schema hash changes, so clients wipe their
local data and bootstrap again. Permission and side effects go in `rules.ts`. A rule that needs data reads it from the
server's `db`; an effect writes through `db.write`, so its writes are numbered, logged and broadcast like any other.
