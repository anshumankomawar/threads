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

In the spec's style, in `packages/models/src/models.ts`. There are two kinds of sync group: `workspace:<id>` for
everything a workspace's members share, and `user:<id>` for a person's own rows. A session's groups are
`workspace:<id>` when it's a member of the workspace, and `user:<me>`.

| Model           | Key fields                                                                                                        | Sync group                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Workspace       | name                                                                                                              | its own `workspace:<id>`          |
| User            | name, email, avatarUrl, workspaceIds                                                                              | `workspace:<id>` per workspaceIds |
| WorkspaceMember | workspace, user, role (admin, member), title, level, manager (a WorkspaceMember), reports                         | `workspace:<id>`                  |
| Label           | workspace, name                                                                                                   | `workspace:<id>`                  |
| Thread          | title, state (open, resolved, blocked), owner, workspace, dueAt, priority, labelIds, branchedFrom, blocks, isOpen | `workspace:<id>`                  |
| Message         | thread, author, body, toIds, workspaceId                                                                          | `workspace:<id>`                  |
| InboxItem       | user, thread, bucket, doneAt, snoozedUntil, seenAt, reason, manual                                                | `user:<id>`                       |
| Bucket, Draft   | user, name, description, position / text, draft                                                                   | `user:<id>`                       |

- **User** is the person, across workspaces. The server keeps `workspaceIds` (an effect of WorkspaceMember create and
  delete), so members of any workspace they share see them.
- **WorkspaceMember** is their place in one workspace: role, job title, level and manager. The org chart on a profile
  reads members and their managers.
- **Thread** is the only unit of work, and every member of the workspace sees every thread. `labelIds` lists its
  Labels; a label's page is its threads. `branchedFrom` is a branch, linked from a message by `[[thread:<id>]]`;
  `blocks` (made with `/blocked`) keeps that thread blocked until this one is resolved.
- **Message** has `toIds` (who it was sent to; none is a note) and its thread's `workspaceId`, because a row computes
  its own group. Messages are created once; their author may delete them.
- **InboxItem** has `bucket` (one of the person's own Buckets, or none until sorted), `reason` and `manual` (placed by
  hand), and `seenAt` (unread is a message by someone else after it).
- **Bucket** is a person's inbox bucket: a name and a description the model sorts by. **Draft** is an unsent ⌘⇧N
  message.

The local workspace seeds 22 people and the sample workspace 7, each a member and an admin; the sample also has labels
and threads.

## Server rules (`packages/models/src/rules.ts`)

Permission hooks: you edit only your own User row, and never its `workspaceIds`; members write the workspace, its
labels, threads and messages; only admins change memberships and roles; a message's author is you, and only the author
deletes it; you write only your own Bucket, Draft and InboxItem rows. Effects, in the same commit: a membership adds
its workspace to the person's `workspaceIds` (its removal takes it out); a new thread gives its owner an InboxItem; a
message gives each of its `toIds` an InboxItem (or clears `doneAt`/`snoozedUntil`), and its `workspaceId` must be its
thread's; when an owner sends their thread to someone and nobody else has sent them anything there, their own item is
marked done, so it's in their Sent until someone writes to them; a thread made with `blocks` blocks that one, and
resolving the last open blocker reopens it; a new user gets the default buckets.

After each commit the Durable Object sorts unsorted, unplaced InboxItems into their owners' buckets with Workers AI and
writes the answers as ordinary transactions (`apps/api/src/triage.ts`); a failure retries in a minute by alarm.

## Sessions

Every request carries `X-Workspace` (`local`, or `sample` when `SAMPLE_WORKSPACE` is on) and a bearer token; the socket
sends the token in its `Hello`. Hosted, the `API_TOKEN` is the admin (sees everything, acts as anyone) and
`POST /auth/session { workspace, personId }` mints a person's signed session token. Locally there's no secret: the
token is the person's id, and an empty token is the admin. The desktop app loads once as the admin to find who's
there, then reloads as the first person; switching source or person (⌘U, ⌘K) reloads with the new session.

### Signing in

People sign in on the sign-in page (`apps/web`, a plain page with no framework) with Google or a one-time code sent to
their email, through [Better Auth](https://www.better-auth.com) in the Worker (`apps/api/src/auth.ts`):

- **Better Auth keeps its own users and sessions** in a D1 database (`AUTH_DB`), apart from the workspaces. Its tables
  are made the first time the Worker signs anyone in (`getMigrations`), so there's no migration step to run.
- **Only invited emails get in.** `INVITES` (a secret: `email=personId` pairs, separated by commas) is the invite list
  and says which Person each email is. An uninvited email can't get an account by either route (a `user.create` hook
  refuses it), and asking for a code for one looks the same as for an invited one but sends nothing.
- **Codes** go out through Resend when `RESEND_API_KEY` is set; without it they're only written to the Worker's log,
  which is allowed locally only (no `API_TOKEN`).
- **From a Better Auth session to the sync API's token**: `POST /auth/token`, with the sign-in page's cookie, answers the
  invited person and their token: hosted, a signed session token, as `POST /auth/session` mints; locally, their id.
- **The page** proxies `/api` and `/auth` to the API in development (`THREADS_API` points it elsewhere), so the cookie is
  same-origin and Google redirects back to it, at `<BETTER_AUTH_URL>/api/auth/callback/google`
  (`http://localhost:5180/api/auth/callback/google` locally).
- **Settings**: `INVITES`, `BETTER_AUTH_SECRET` (local default otherwise), `BETTER_AUTH_URL` (the page's origin,
  `http://localhost:5180` by default), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Google is offered only with both),
  and `RESEND_API_KEY`. Locally they go in `apps/api/.dev.vars`; hosted, they're secrets.
- **The desktop app** signs in through this page with Better Auth's Electron plugin (`apps/desktop/src/main/signIn.ts`):
  ⌘K, Sign in, opens the page in the browser with the app's request (`client_id`, `state`, `code_challenge`, PKCE), which
  goes along with the sign-in. Signed in, the page sends you back on `threads:/auth/callback#token=…` with a one-time
  code, and shows the code to paste into the app (⌘K, Sign in) in case the link doesn't open it, which can happen in
  development; an already signed-in page asks for a fresh code (`/electron/transfer-user`). The main process trades the
  code for the app's own session (`/electron/token`) and keeps it encrypted with the OS keychain (`safeStorage`); the
  window only ever gets the Threads token, from `POST /auth/token` (`window.threads.signedIn()`). Signed in, you're that
  person and ⌘U is off; signing out returns to View As. The sign-in page talks to the local API, so this is the Local
  source's for now; `THREADS_SIGN_IN_URL` points the app at another sign-in page. The plugin's content security policy is
  left off, since it would keep the window from reaching the API.
- **Not yet**: a hosted sign-in page (and its `BETTER_AUTH_URL`), so the Cloudflare source signs in too; then the app
  stops holding the API token, and ⌘U is for development only.

## Running and testing

- `vp run api#dev` serves the API on `http://127.0.0.1:3030` (needs `cf` logged in to the Threads account for Workers
  AI; `THREADS_LOCAL_AI=off` leaves sorting out). A new workspace seeds itself. State lives in
  `apps/api/.cloudflare/state`; delete its `v3/do` (API stopped) to start over.
- `vp run desktop#dev` starts the app. Cloudflare is offered when `apps/desktop/.env.local` sets `VITE_API_URL` and
  `VITE_API_TOKEN` (never commit the token). Use the cf CLI, never Wrangler; deploy with `vp run api#deploy`.
- `vp test` in `packages/sync` (unit tests), `packages/testing` (the deterministic simulation), `packages/server`,
  `packages/models` (the rules) and `apps/api`. `vp check` at the root.

## Changing the model

Add or change a field with the decorators in `models.ts`; the registry's schema hash changes, so clients wipe their
local data and bootstrap again. Permission and side effects go in `rules.ts`. A rule that needs data reads it from the
server's `db`; an effect writes through `db.write`, so its writes are numbered, logged and broadcast like any other.
