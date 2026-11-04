# Threads: components, APIs and schemas

A reference for rebuilding Threads by hand. It describes what the prototype on `prototype` does today (as of commit
`62fa901`, with the sync engine package and sessions added since): the data model and its schemas, every mutation and the rules and side effects the server applies, the HTTP
API, the logic the app derives from the data, the UI components, and the file structure. Section 11 lists what the
prototype leaves out that production needs.

**The sync engine is a black box here.** The prototype now has it as its own package, `packages/sync` (its README
says what it guarantees). To rebuild it, build it from Linear's sync engine as described in
[the reverse-engineering summary](https://github.com/wzhudev/reverse-linear-sync-engine/blob/main/SUMMARY.md) (object
pool, transactions, sync ids, delta packets, bootstrapping, rebasing, IndexedDB cache). Section 4 only states what
Threads needs from it: which models it syncs, which mutations clients send, and where the server's rules and side
effects plug in. `docs/architecture.md` describes the prototype's own implementation if you want to compare.

Contents:

1. [Product in one page](#1-product-in-one-page)
2. [File structure](#2-file-structure)
3. [Data model](#3-data-model)
4. [Sync contract](#4-sync-contract)
5. [Mutations: schemas, rules and side effects](#5-mutations-schemas-rules-and-side-effects)
6. [HTTP API](#6-http-api)
7. [Server services: AI sorting and drafting](#7-server-services-ai-sorting-and-drafting)
8. [Derived logic (shared and client)](#8-derived-logic-shared-and-client)
9. [UI components](#9-ui-components)
10. [Tooling, running, testing, deploying](#10-tooling-running-testing-deploying)
11. [Production gaps](#11-production-gaps)

---

## 1. Product in one page

- **Everything is a thread.** A thread is one ask: a title, an optional description, and a log of entries (messages,
  activity lines, a resolution). Side discussions are threads too, branched off another (`branchedFromId`). There are no
  thread types.
- **Ownership.** Whoever makes a thread owns it. Anyone can be assigned it (several people), and anyone @mentioned in a
  message is assigned automatically. A group can be assigned through its label.
- **Inbox like email.** A thread is in your inbox when it's assigned to you, or someone sent you a message on it since
  you last marked it done. ⌘E marks it done for you (never closes it); H snoozes it; closing is a status change anyone
  can make. Your **Sent** tab (outbox) is the open threads you own that someone else is on.
- **Notes and sending.** A message sent to nobody is a note. Sending (Enter) goes to whoever last sent you something,
  else the other side, plus anyone @mentioned.
- **Buckets.** Each person sorts their inbox into their own buckets, described in plain words. An AI model sorts each
  thread into one of the recipient's buckets; people can place threads by hand.
- **Score.** Within a bucket, threads are ordered by a 1–100 score from due date, priority, the owner's level, seeded
  labels and effort.
- **Organization, groups, labels.** One organization per workspace. Labels file threads; a group (team/project) owns
  one label, and a thread is in a group because it has that label. Groups run **sprints**, each with its own page.
- **Boards.** Any list of threads can show as a board with Open / Blocked / Closed columns.
- **Profiles.** Your profile shows the org tree; anyone else's shows the threads you share.
- **Writing a thread as one message (⌘⇧N).** You type "@Anshu @Arjun can you review this CR. @Omar track this", and
  an AI drafts the title, context and one ask per person; you edit and send. Unsent drafts stay on the device.
- **Blocking.** `/blocked` makes a new thread asking someone for what you need; your thread is Blocked until it closes.

---

## 2. File structure

A Bun + Vite+ (`vp`) monorepo. Apps under `apps/`, shared code under `packages/`.

```
threads/
├── package.json                 workspaces, root scripts (dev, ready), Bun 1.4.4 via devEngines
├── vite.config.ts               root Vite+ config (lint/format/check)
├── AGENTS.md / CLAUDE.md        working rules (prototype branch, running, Vite+ usage)
├── docs/
│   ├── architecture.md          the prototype's design and invariants (sync implementation included)
│   ├── component.md             this file
│   └── future-plans.md          parked ideas (empty today)
├── packages/
│   ├── sync/                    the sync engine (black box): protocol, schema, server, client; knows nothing of threads
│   ├── model/                   shared by API and app: types, schemas' TS shapes, pure logic, seed data
│   │   └── src/
│   │       ├── index.ts         re-exports everything below
│   │       ├── model.ts         domain types (Person, Thread, Entry, Label, Group, Sprint, ...) and inbox rules
│   │       ├── sync.ts          records, threadsSchema, SCHEMA_HASH, mutation (TransactionInput) types,
│   │       │                    threadsMutations (client predictions), record <-> Thread conversion
│   │       ├── score.ts         SEEDED_LABELS, EFFORT_OPTIONS, threadScore, levelPositions
│   │       ├── compose.ts       ComposeRequest / ComposeDraft (AI drafting types)
│   │       └── sample.ts        seed people (local + sample team), sample threads, sample group
│   └── ui/                      placeholder package (Vite+ template), unused
├── apps/
│   ├── api/                     Cloudflare Worker (Hono) + one Durable Object per workspace
│   │   ├── cloudflare.config.ts account, Worker name, Durable Object export, bindings (API_TOKEN, AI, ...)
│   │   ├── vite.config.ts       Cloudflare Vite plugin; dev server 127.0.0.1:3030
│   │   ├── src/
│   │   │   ├── worker.ts        Worker entry: CORS, sessions (authenticate, /auth/session), /ai/compose, routing;
│   │   │   │                    Workspace DO: the engine's SQLite storage and broadcast, sockets, reset, triage alarm
│   │   │   ├── app.ts           one workspace's sync routes (the engine's), local sessions; createApp for tests
│   │   │   ├── engine.ts        SyncEngine (extends the engine's SyncServer): zod schemas, rules and side effects
│   │   │   │                    (#apply), sync groups, seeding, upgrades
│   │   │   ├── triage.ts        Triager + Workers AI classifier (inbox sorting)
│   │   │   └── compose.ts       Workers AI composer (drafting a thread from one message)
│   │   └── tests/               app, access, assignees, groups, sprints, triage, compose
│   ├── desktop/                 Electron + React 19 + MobX + Tiptap
│   │   ├── electron.vite.config.ts, electron-builder.yml, build/ (mac entitlements)
│   │   ├── src/main/index.ts    window (vibrancy, hidden title bar, 110% zoom), menus, dev DevTools port 9333
│   │   ├── src/preload/         exposes window.user (OS username)
│   │   ├── src/renderer/src/
│   │   │   ├── main.tsx, App.tsx    root: state, routing between pages, actions, keyboard shortcuts
│   │   │   ├── api.ts           data sources (Cloudflare / Local / Sample), HTTP + WebSocket transport, composeDraft
│   │   │   ├── sync/            syncClient.ts: ThreadsClient, the engine's client with the app's reads and changes
│   │   │   ├── components/      UI (section 9)
│   │   │   ├── inbox.ts         buildInbox, scoreOf
│   │   │   ├── activity.ts      notifications (activityFor)
│   │   │   ├── groups.ts        list filtering, group lists, label lists, group notices
│   │   │   ├── sprints.ts       sprint and board helpers
│   │   │   ├── profile.ts       shared threads/groups for profiles
│   │   │   ├── org.ts           org tree helpers
│   │   │   ├── compose.ts       mention targets, recipients, offline draft fallback
│   │   │   ├── drafts.ts        unsent drafts in localStorage
│   │   │   ├── format.ts        dates, relative times, due labels, parseWhen
│   │   │   ├── listView.ts      list/board preference
│   │   │   ├── me.ts, threadLinks.ts, threadMenu.ts, threadIcon.ts   React contexts and small shared bits
│   │   │   └── assets/main.css  all styles (tokens on :root, dark only)
│   │   └── tests/               sync, inbox, activity, groups, sprints, profile, org, compose, format
│   └── web/                     placeholder Vite + React template, unused
```

Dependencies worth knowing: `hono` 4, `zod` 4, `@hono/zod-validator` (API); `react` 19, `mobx` 7 +
`mobx-react-lite`, `@tiptap/*` 3 (reply editor, mentions, `#` links, `/` commands), `@hugeicons/*` (icons),
`electron` 44, `electron-vite`, `electron-builder` (app); `cf` CLI and `@cloudflare/vite-plugin` (Workers).

---

## 3. Data model

All models are flat records linked by id. The UI never reads records directly; it reads resolved shapes (a `Thread`
with its people and entries nested). Ids for client-created models are made on the client (`crypto.randomUUID()`),
except labels, whose id is derived from the name.

### 3.1 Records (what's stored and synced)

**Person**

| Field       | Type             | Notes                                                               |
| ----------- | ---------------- | ------------------------------------------------------------------- |
| `id`        | string           |                                                                     |
| `name`      | string           |                                                                     |
| `level`     | string?          | `"l1"`…`"l8"`; higher is more senior. Feeds the score and org view. |
| `role`      | `"sde" \| "pm"`? |                                                                     |
| `managerId` | string?          | builds the org tree; none or unknown means top of the tree          |
| `buckets`   | `Bucket[]`?      | their inbox buckets; absent means `DEFAULT_BUCKETS`                 |

`Bucket = { id, name, description }`. `DEFAULT_BUCKETS`: "Messages that require action" (`action`) and "Messages to
read" (`read`). `MAX_BUCKETS = 12`. People are seeded, not created through the API (section 11).

**Thread** (`ThreadRecord`)

| Field                        | Type                                      | Notes                                                                  |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `id`                         | string                                    |                                                                        |
| `title`                      | string (1–200)                            |                                                                        |
| `createdById`                | Person id                                 | the **owner**                                                          |
| `assigneeIds`                | Person id[]                               | grows as people are @mentioned; nothing removes assignees yet          |
| `status`                     | `open \| blocked \| closed \| archived`   | closed and archived are "done" (`isDone`)                              |
| `priority`                   | `none \| low \| medium \| high \| urgent` |                                                                        |
| `dueAtMs`                    | number \| null                            |                                                                        |
| `effortHours`                | number \| null                            | ≥ 0.5, multiple of 0.5 (`EFFORT_OPTIONS`: 0.5, 1, 2, 4, 8, 16, 24, 40) |
| `labelIds`                   | Label id[]                                | a group's label puts the thread in the group                           |
| `triage`                     | `Record<personId, Triage>`                | which of each recipient's buckets it's in                              |
| `doneBy`                     | `Record<personId, ms>`                    | when each person last marked it done (⌘E)                              |
| `snoozedUntil`               | `Record<personId, ms>`                    | snoozed out of their inbox until then                                  |
| `seenBy`                     | `Record<personId, ms>`                    | when each person last opened it                                        |
| `branchedFromId`             | Thread id \| null                         | side discussion of another thread                                      |
| `blocksId`                   | Thread id \| null                         | this thread is what that thread is blocked on (`/blocked`)             |
| `createdAtMs`, `updatedAtMs` | number                                    |                                                                        |

`Triage = { bucketId, reason, manual, stale }`: chosen by the model with a short reason, or placed by hand (`manual`,
sticks). `stale` marks a model choice to re-check (after a retitle or bucket change) while it stays where it is.

**Entry** (`EntryRecord`), one item in a thread's log, append-only except `threadId` (moves):

| Kind         | Fields                                       | Notes                           |
| ------------ | -------------------------------------------- | ------------------------------- |
| `message`    | `authorId`, `text`, `sentToIds: Person id[]` | empty `sentToIds` is a **note** |
| `event`      | `actorId`, `text`                            | activity line, server-made only |
| `resolution` | `authorId`, `text`                           | closes the thread               |

All entries have `id`, `threadId`, `createdAtMs`. **A thread's description is the message whose id equals the thread's
id** (`descriptionOf`); there's no description field.

Message text is plain text with tokens: `[[thread:<id>]]` (a link to a thread, `#` in the editor), `[[person:<id>]]`
(a mention, `@`), `[[group:<id>]]` (a group mention). Helpers in `model.ts`: `threadLink`, `mention`, `groupMention`,
`splitThreadLinks` (text → parts for rendering), `plainThreadLinks` (text → plain string), `mentionsIn`,
`groupMentionsIn`, `withoutLeadingMentions`.

**Organization**: `{ id: "organization", name }`. One per workspace (`ORGANIZATION_ID`). Empty name means "not named
yet"; the app forces naming on first open.

**Label**: `{ id, name, groupId: string | null, createdById: string | null, createdAtMs }`. `id = labelSlug(name)`:
NFKC, lower case, runs of non-letters/digits → `-`, trimmed (`"Back-end"` and `"back end"` are one label). Names are
unique across the organization (labels and groups share the namespace). Ten **seeded labels** carry a priority for the
score: Incident 100, Security 95, Customer escalation 85, Compliance 80, Revenue 70, Launch 60, Bug 50, Planning 30, Tech
debt 20, Housekeeping 10. Labels people make have no priority. Labels are never deleted.

**Group**

| Field                        | Type              | Notes                                                                 |
| ---------------------------- | ----------------- | --------------------------------------------------------------------- |
| `id`, `name`                 | string            | name unique among labels                                              |
| `labelId`                    | Label id          | the group's own label, made with it; renaming keeps the id            |
| `memberIds`                  | Person id[]       | never empty                                                           |
| `createdById`                | Person id         |                                                                       |
| `archived`                   | boolean           |                                                                       |
| `activity`                   | `GroupActivity[]` | `{ actorId, text, targetIds, atMs }`; `targetIds` = who it's news for |
| `createdAtMs`, `updatedAtMs` | number            |                                                                       |

**Sprint**

| Field                                       | Type        | Notes                                                |
| ------------------------------------------- | ----------- | ---------------------------------------------------- |
| `id`                                        | string      |                                                      |
| `groupId`                                   | Group id    | sprints exist only in a group                        |
| `name`                                      | string 1–80 |                                                      |
| `startMs`                                   | number      | local midnight of the first day                      |
| `endMs`                                     | number      | local midnight after the last day; length 1–366 days |
| `threadIds`                                 | Thread id[] | the threads in it; **threads have no sprint field**  |
| `closed`                                    | boolean     | closed sprints keep their list as a record           |
| `createdById`, `createdAtMs`, `updatedAtMs` |             |                                                      |

### 3.2 References (for the sync engine's model registry)

| Model  | References                                                    | Reference arrays                           | Back references                                 |
| ------ | ------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Person | `managerId` → Person                                          |                                            |                                                 |
| Thread | `createdById` → Person, `branchedFromId`, `blocksId` → Thread | `assigneeIds` → Person, `labelIds` → Label | `entries` → Entry (`threadId`): deleted with it |
| Entry  | `threadId` → Thread, `authorId`/`actorId` → Person            | `sentToIds` → Person                       |                                                 |
| Sprint | `groupId` → Group, `createdById` → Person                     | `threadIds` → Thread                       |                                                 |

Organization, Label and Group have no registered references in the prototype (Group's `labelId`/`memberIds` could be).

### 3.3 Resolved shapes (what the UI reads)

`Thread` (in `model.ts`) is the record with people and entries resolved: `owner: Person`, `assignees: Person[]`, and
`entries: Entry[]` sorted oldest first (at the same instant messages come before the events they cause). `Entry` has
`author`/`actor` and `sentTo` as `Person` objects. An unknown person id resolves to `{ id, name: id }` rather than
breaking. Conversion: `toThread(record, entries, peopleById)`, `toThreads(...)`, and `fromThread` for seeding.

---

## 4. Sync contract

Use LSE as the engine. Threads needs exactly this from it:

- **One writer per workspace.** The prototype runs one Cloudflare Durable Object per workspace (SQLite tables:
  `models`, `sync_actions`, `transactions`, `meta`). Every change is numbered with the workspace's next sync id and
  broadcast as a delta packet to every connected client, the sender included.
- **Synced models**: Person, Thread, Entry, Organization, Label, Group, Sprint. All load at bootstrap (LSE `instant`).
  Entries are the obvious candidate for `partial` loading later.
- **Mutations** are LSE transactions, sent in batches (`{ actorId, utcOffsetMinutes, transactions[] }`, 1–200 per
  batch), **all or nothing**. Kinds: `create` (Thread, Entry, Label, Group, Sprint), `update` (Thread, Person, Group,
  Sprint, Organization) and one custom kind, `move` (re-parent messages into another thread). Section 5 has each one.
- **Server hook per transaction.** For each transaction the server validates its shape (zod), checks rules against
  current data, and **stages side-effect writes in the same batch** (activity entries, status changes, other models).
  Any failure refuses the whole batch with a status (400/403/404/409) and the client rolls back.
- **Side effects live on the server** and reach clients in the same delta packet. Clients never send activity lines.
- **Side-effect ids are deterministic** (`${transactionId}:${n}`, `${threadId}:blocks`, `${transactionId}:moved`,
  `${transactionId}:unblocked`), so a resent transaction can't duplicate them. Executed transaction ids are remembered and
  skipped on resend.
- **Optimistic updates.** Clients apply their own mutations at once. For thread updates the client applies the
  "scoped" fields (section 5.4) to the actor's own key exactly as the server does (`applyScopedChanges` is shared code).
  Creates are built with the same `threadFromCreate` / `entryFromCreate` / `labelFromCreate` / `groupFromCreate` /
  `sprintFromCreate` functions on both sides.
- **Schema versioning.** A hash of the schema plus its version (`SCHEMA_HASH`, now `records:v21`). A client whose
  cache was built under another hash rebuilds it. The server upgrades older stored records on load (`upgrade` in
  `engine.ts`).
- **Reset.** `POST /sync/reset` (admin only) wipes a workspace (keeping Organization, Labels and Groups) and reseeds with a
  new `epoch`; clients see the new epoch and rebuild, keeping their unsent changes.
- **Sessions and sync groups.** Every request runs as a person's session (acts only as them, sees their sync groups) or the
  admin session (sees everything). Every Threads record is in the workspace's one group, which every `Person` in it is in.
- **Engine-provided transactions.** `delete`, `archive` and `unarchive` on any model; Threads allows only deleting your own
  messages (section 5.12).
- **Asynchronous server writes.** The AI sorter writes triage results later, as its own batch, through the same writer.

---

## 5. Mutations: schemas, rules and side effects

Shared limits: ids are strings of 1–100 chars. `labelName` is trimmed 1–80 chars. The actor (`actorId` in the batch)
must be an existing Person, else 404 `User not found`.

### 5.1 Create Thread

```ts
ThreadCreate = {
  id: string;
  title: string;            // trimmed, 1–200
  assigneeIds?: string[];   // ≤ 50, each must exist (404)
  branchedFromId?: string | null; // must exist (404)
  blocksId?: string | null;       // must exist and not be done (404)
  labelIds?: string[];      // each must exist (404); send Label creates first in the same batch
}
```

- 409 if the id exists. The actor becomes the owner (`createdById`). Status `open`, priority `none`, no due/effort.
- **Inheritance:** a branch or blocker also gets its parent's **group** labels (not plain labels), so a project's
  blockers stay in the project.
- **Blocking:** with `blocksId`, the blocked thread becomes `blocked` and gets an event `is blocked on [[thread:<id>]]`
  (id `${newThreadId}:blocks`).
- A description is a separate Entry create with `id = threadId` in the same batch.

### 5.2 Create Entry

```ts
EntryCreate = {
  id: string;
  threadId: string;            // must exist (404)
  kind: "message" | "resolution";
  text: string;                // trimmed, ≥ 1
  sentToIds?: string[];        // ≤ 50, unique, each must exist; only for messages (400)
}
```

- 409 if the id exists. An id equal to its thread's id is the **description**: must be a message (400), and only the
  owner may write it (403). An entry may not take another thread's id (400).
- `sentToIds` drops the author. Empty means a note.
- **Side effects on the thread:** every `[[person:<id>]]` mentioned (existing people) is added to `assigneeIds`; every
  `[[group:<id>]]` mentioned adds that group's label to `labelIds`; a `resolution` sets `status: "closed"`;
  `updatedAtMs` bumps.
- The client expands a group mention into its current members for `sentToIds` (`recipientsOf`); the server doesn't.

### 5.3 Move messages (custom transaction)

```ts
{ id, type: "move", modelName: "Entry", entryIds: string[] /* 1–500 */, threadId: string }
```

- Destination must exist (404); every entry must be a message (404) from **one** source thread (400), not already in
  the destination (400), not a description (400), and not containing a link to the destination (400).
- Re-parents each message. Adds one event to the source: `moved N messages to [[thread:<dest>]]`, id
  `${transactionId}:moved`, timed at the earliest moved message so it sits where they were. Bumps both threads.
- Used for "Move to thread…" and for opening a new branch with moved messages instead of a description.

### 5.4 Update Thread

```ts
ThreadChanges = Partial<{
  title: string;                         // 1–200
  status: "open" | "blocked" | "closed" | "archived";
  priority: "none" | "low" | "medium" | "high" | "urgent";
  dueAtMs: number | null;
  effortHours: number | null;            // ≥ 0.5, multiple of 0.5
  labelIds: string[];                    // unique; each must exist
}> & ScopedChanges

ScopedChanges = {                        // about the sender only
  seen?: true;                           // seenBy[actor] = now
  done?: boolean;                        // doneBy[actor] = now, or remove
  snoozeUntilMs?: number | null;         // snoozedUntil[actor] = ms, or remove
  bucketId?: string | null;              // triage[actor] = manual placement, or hand back to the model
}
```

- Strict schema: unknown keys are refused. Anyone may change any thread (no permissions yet).
- **Scoped changes are quiet:** no activity line, and `updatedAtMs` doesn't change. `bucketId` (non-null) is only for a
  thread in the actor's inbox (400) and must be one of the actor's buckets (404).
- **Activity lines** (event entries, ids `${transactionId}:${n}`) for each field that actually changes, phrased for
  the actor, with dates in the actor's time zone (`utcOffsetMinutes`):
  - title: `renamed this to “…”`
  - status: `archived this`, `reopened this` (done → open), `unarchived this`, else `changed status to <Label>`
  - priority: `removed the priority` / `set priority to <Label>`
  - due: `removed the due date` / `set the due date to Fri, Nov 7`
  - effort: `removed the estimate` / `estimated this at 4h`
  - labels: `added this to <Group>` / `removed this from <Group>` / `labelled this <Label>` / `removed the <Label> label`
- If nothing but scoped fields changed, nothing else happens. Otherwise `updatedAtMs` bumps.
- **Retitling** marks every non-manual triage `stale` (re-sorted, staying put meanwhile).
- **Unblocking:** closing or archiving a thread whose `blocksId` thread is `blocked` and has no other open blockers
  sets that thread back to `open` with `is unblocked, [[thread:<id>]] is closed|archived` (actor: its owner, id
  `${transactionId}:unblocked`).
- **Leaving a group:** removing a group's label takes the thread out of that group's **open** sprints (closed sprints
  keep it).

### 5.5 Update Person (own profile only)

```ts
PersonChanges = { buckets?: Bucket[] } // 1–12 buckets; unique ids; name 1–40; description ≤ 500
```

- Only `modelId === actorId` (403 otherwise). No activity line.
- If the set of buckets changed (reordering doesn't count): for every thread the actor has a triage on, a placement into
  a deleted bucket is removed (re-sorted), and model placements in kept buckets become `stale`. Manual placements in
  kept buckets stay.

### 5.6 Create Label

```ts
LabelCreate = { id: string; name: string } // id must equal labelSlug(name), non-empty (400)
```

- If the same label exists already, it's a **no-op** (so a thread made with it in the same batch isn't refused). If the
  name collides with another label or group, 409.

### 5.7 Create Group

```ts
GroupCreate = { id: string; name: string; memberIds: string[] }
```

- 409 if the id exists; 400 if the name has no letters/digits; 409 if the name is taken; members must exist.
- The actor is always a member (first). Side effects: the group's Label (`id = labelSlug(name)`, `groupId`), and
  activity `created this group` plus `added A, B` (with `targetIds` = those added, for their notifications).

### 5.8 Update Group

```ts
GroupChanges = Partial<{ name: string; memberIds: string[]; archived: boolean }>;
```

- 404 if missing. `memberIds` unique (400), non-empty (400, "archive it instead"), each existing.
- **Permissions:** members can change anything; a non-member can only add themselves (join), 403 otherwise.
- Renaming checks the name (400/409) and renames the label, keeping its id (threads stay in the group).
- Activity lines: `joined`, `added …` (with targets), `left`, `removed …`, `renamed this to “…”`,
  `archived this`/`unarchived this`. A change producing no line is a no-op.

### 5.9 Create / Update Sprint

```ts
SprintCreate  = { id; groupId; name /* 1–80 */; startMs: int; endMs: int; threadIds?: string[] /* ≤ 500, unique */ }
SprintChanges = Partial<{ name; startMs; endMs; threadIds; closed: boolean }>
```

Rules (`checkSprint`), checked on create and every update:

- The group must exist (404); the actor must be a member (403); a new sprint needs a non-archived group (400).
- Length between 1 day and 366 days (400).
- Every **newly added** thread must exist (404) and carry the group's label (400). Threads already in it aren't
  re-checked.
- While the sprint is open, none of its threads may be in another open sprint of the same group (409). This also
  applies when reopening.
- `threadIds` is replaced as a whole list (concurrent adds: last writer wins).
- Side effects: group activity `started <name>` on create, `closed <name>` / `reopened <name>` when `closed` flips.

### 5.10 Update Organization

```ts
OrganizationChanges = { name: string }; // trimmed 1–100
```

### 5.11 Errors

`SyncError(status, message)` with 400 (bad input or rule), 403 (not allowed, or acting as someone else), 404 (missing),
409 (conflict), 413 (batch too large). Shape errors from zod are 400 with a readable message. The whole batch is refused on
the first error.

### 5.12 Delete a message (the engine's `delete`)

`{ id, type: "delete", modelName: "Entry", modelId }`. Only your own message, and not a thread's description (its id is
the thread's); anything else is refused (400/403). No activity line. Other models can't be deleted, and `archive` /
`unarchive` are refused: a thread is archived with its status.

---

## 6. HTTP API

Base: local `http://127.0.0.1:3030`; hosted `https://threads-api.threads-app.workers.dev`.

| Header / param                              | Meaning                                                           |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `X-Workspace` (`?workspace=` on the socket) | `local` (the real workspace) or `sample` (demo team, local only)  |
| `Authorization: Bearer <token>` (`?token=`) | hosted: the API token (admin session) or a person's session token |
| `X-User` (`?user=`)                         | local only: whose session; none is the admin session              |
| `X-UTC-Offset` (`?utcOffset=`)              | minutes; used when seeding a fresh workspace                      |

| Route                      | Body / query                                     | Response                                                                                                                                                       |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /sync/bootstrap`      | `?groups=a,b` for a partial bootstrap            | `{ epoch, lastSyncId, syncGroups, schemaHash, models: { [ModelName]: Record[] } }` (what the session sees)                                                     |
| `GET /sync/deltas`         | `?after=<syncId>`                                | `{ epoch, lastSyncId, syncGroups, actions }`, or `fullBootstrapRequired: true` once the log is compacted                                                       |
| `POST /sync/transactions`  | `{ actorId, utcOffsetMinutes?, transactions[] }` | `{ lastSyncId }`, or `{ error }` with 400/403/404/409                                                                                                          |
| `GET /sync/ws` (WebSocket) | query params above                               | `{ type: "handshake", epoch, lastSyncId, minSyncId, syncGroups }`, then `{ type: "delta", fromSyncId, lastSyncId, actions, syncGroups? }`; `"ping"` → `"pong"` |
| `POST /sync/reset`         | admin only                                       | `{ lastSyncId }`; wipes threads, keeps org/labels/groups, reseeds                                                                                              |
| `POST /auth/session`       | `{ workspace, personId }`, admin only            | `{ token, expiresAtMs }`: that person's session token (30 days)                                                                                                |
| `POST /ai/compose`         | `ComposeRequest`                                 | `ComposeDraft`; 503 without AI, 502 if the model fails                                                                                                         |

`SyncAction = { id, modelName, modelId, action: "I" | "U" | "D" | "A" | "V", data: Record | null }` (whole records).

`ComposeRequest = { author: {id,name}, people: {id,name}[] /* ≤ 500, only those @mentioned */, text /* 1–4000 */ }`
`ComposeDraft = { title, context, asks: { personIds: string[], text }[] }`

Workspaces: `WORKSPACES = ["local", "sample"]`. `sample` is served only when the `SAMPLE_WORKSPACE` binding is `on`
(development). New workspaces are seeded: `local` with the people in `localPeople()` and no threads; `sample` with the
sample team, threads and a group. Every workspace gets its Organization (local starts unnamed) and the seeded labels.
Seeded people are refreshed on load from code, keeping their `buckets`.

---

## 7. Server services: AI sorting and drafting

Both use Cloudflare Workers AI (binding `AI`). `THREADS_LOCAL_AI=off` leaves the binding out for local dev without
access to the Threads account; then nothing is sorted and drafting falls back on the client.

### 7.1 Triage (inbox sorting), `apps/api/src/triage.ts`

- **Who needs sorting** (`#needsTriage`): for each thread, each person in `inboxPeople(thread)` who has no triage, a
  triage pointing at a bucket they no longer have, or a `stale` one.
- **Requests** (`triageRequests`), grouped per person: `{ person, buckets, threads: [{ id, title, from, text }],
  examples: [{ title, bucketId }] }`. `from`/`text` are who last sent it to them and what; examples are their manual
  placements.
- **Triager**: runs after each successful transaction batch and on load; one pass at a time (a kick during a pass
  queues another). Sends 20 threads per call to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` with a JSON schema;
  threads and buckets are numbered so the model never copies ids (`triagePrompt`, `parseTriage`). Results are written with
  `applyTriage` as their own batch (re-checking each still needs it). On failure, the threads wait `RETRY_MS` (60 s)
  and a Durable Object alarm retries.

### 7.2 Compose (drafting a thread), `apps/api/src/compose.ts`

- Stateless, outside any workspace (the one exception to "no REST endpoints").
- `@cf/meta/llama-3.1-8b-instruct-fast` with a JSON schema; people are numbered. `parseCompose` keeps only people from
  the request and asks with someone to ask.
- The client calls it as you type (500 ms after you stop, aborting the previous call) and previews the draft. Without the model, `plainDraft`
  makes one: first sentence as title, one ask for everyone mentioned.
- Sending a draft is ordinary mutations: a Thread create (title), a description Entry (context), and one message per
  ask, sent to its people and opening with their @mentions (which assigns them).

---

## 8. Derived logic (shared and client)

Nothing below is stored; it's computed from synced data.

### 8.1 Inbox rules (`packages/model/src/model.ts`, shared by server and app)

- `isPersonal(thread)`: no assignees and no message sent to anyone → the owner's own to-do.
- `assignedIds(thread)`: assignees, or `[owner]` when personal.
- `inboxReason(thread, personId, now)` → `"assigned" | "sent" | null`:
  - null if done (closed/archived) or snoozed past now;
  - `assigned` if assigned to them and either never marked done or someone else did anything there since;
  - `sent` if someone else's latest message to them is newer than their `doneBy`.
- `inboxPeople(thread)`: everyone with an inbox reason (ignoring snooze), who it's sorted for.
- `participants(thread)`: owner, assignees, every author and recipient.
- `involves(thread, personId)`: owner, assignee, sent something, or wrote beyond the description. Used for
  notifications and profiles.
- `replyTo(thread, personId)`: whoever last sent you something; else the owner (if you're not it), else the assignees.
- `lastSentTo`, `descriptionOf`, `lastMessage`.

### 8.2 Score (`packages/model/src/score.ts`)

`threadScore({ priority, dueAtMs, effortHours, labelIds }, ownerLevel, now)` → 1–100, one decimal:

- weights: due 0.3, priority 0.3, owner level 0.2, best seeded label 0.1, effort 0.1;
- due urgency: 0 with ≥ a week of room (room = hours left − effort × 3), rising to 1 when overdue;
- priority: none 0, low 0.25, medium 0.5, high 0.75, urgent 1; urgent never scores below 75;
- owner level: `levelPositions(people)` maps levels to 0 (lowest) … 1 (highest);
- effort pull: quick work (0.5h) 1 → big work (≥ 8h) 0, unknown 0.5, blending into due urgency as a deadline nears.

### 8.3 Client derivations (`apps/desktop/src/renderer/src`)

| Module        | Exports                                                                                                                                                                                  | What                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inbox.ts`    | `buildInbox`, `scoreOf`, `Inbox`, `InboxItem`, `BucketGroup`                                                                                                                             | your inbox by bucket (blocked last, rest by score), "Sorting" for unsorted, Sent (outbox), `order` for J/K                                                |
| `activity.ts` | `activityFor`, `ActivityItem`                                                                                                                                                            | notifications: per thread you're in, the latest thing someone else did in 7 days (replies and noteworthy events), max 30, unread vs. last seen            |
| `groups.ts`   | `threadsWithLabel`, `ThreadFilter`, `NO_FILTER`, `groupsFor`, `filterLabels`, `selectableLabels`, `groupNoticesFor`                                                                      | list filtering (label, person, closed), group lists, "added you to a group" notices                                                                       |
| `sprints.ts`  | `sprintsOf`, `sprintThreads`, `summarize`, `summaryLabel`, `loadByPerson`, `nextSprint`, `sprintDates`, `addableThreads`, `openSprintWith`, `boardColumns`, `BOARD_COLUMNS`, `daysLater` | sprint pages and boards; load counts a shared thread fully for each assignee; next sprint is "Sprint N", 14 days from today or from where the latest ends |
| `profile.ts`  | `sharedThreads`, `sharedGroups`                                                                                                                                                          | threads you both `involve`: for you / for them / others / closed                                                                                          |
| `org.ts`      | `buildOrgTree`, `countUnder`, `chainAbove`, `orgDetails`                                                                                                                                 | org tree from `managerId`                                                                                                                                 |
| `compose.ts`  | `targetsFor`, `mentionedTargets`, `recipientsOf`, `plainDraft`, `Target`                                                                                                                 | @-targets (people by first name, groups by name), expanding groups to members                                                                             |
| `drafts.ts`   | `useDrafts`, `SavedDraft`                                                                                                                                                                | unsent ⌘⇧N drafts in localStorage, per data source                                                                                                        |
| `format.ts`   | `formatRelativeTime`, `formatDue`, `formatClock`, `parseWhen`, `formatWhen`, `startOfDay`, `DAY`                                                                                         | dates and times                                                                                                                                           |
| `listView.ts` | `useListView`, `ListView`                                                                                                                                                                | list/board preference in localStorage                                                                                                                     |
| `api.ts`      | `DataSource`, `serverFor`, `createSyncClient`, `composeDraft`, `SOURCE_LABELS`, `CLOUDFLARE_AVAILABLE`                                                                                   | data sources and transport                                                                                                                                |

Client state outside sync (device-local, localStorage): data source, "view as" person, last-seen times (unread dots),
drafts, list/board choice, panel widths, content zoom.

### 8.4 The client's mutation API (what the UI calls)

The UI calls methods on the sync client (`SyncClient` in the prototype). Each enqueues one or more mutations from
section 5; the UI never sends HTTP itself.

| Method                                                                                                               | Sends                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `createThread({ title, description, assignees?, branchedFromId?, blocksId?, movedEntryIds?, labelNames? }, me)` → id | Label creates (as needed) + Thread create + description Entry (or a move) |
| `updateThread(id, ThreadChanges, me)`                                                                                | Thread update                                                             |
| `addEntry(threadId, kind, text, me, id?, sentTo?)`                                                                   | Entry create                                                              |
| `moveMessages(entryIds, threadId, me)`                                                                               | move                                                                      |
| `updatePerson({ buckets }, me)`                                                                                      | Person update (own)                                                       |
| `ensureLabel(name, me)` → id                                                                                         | Label create unless it exists                                             |
| `createGroup(name, members, me)` → id, `updateGroup(id, changes, me)`                                                | Group create / update                                                     |
| `createSprint(groupId, name, { startMs, endMs }, threadIds, me)` → id, `updateSprint(id, changes, me)`               | Sprint create / update                                                    |
| `renameOrganization(name, me)`                                                                                       | Organization update                                                       |
| `wipe()`                                                                                                             | `POST /sync/reset`, then a full bootstrap                                 |

Observable reads: `threads` (resolved), `people`, `organization`, `labels`, `groups`, `sprints`, plus `status`
(`bootstrapping | waiting | ready`), `connected`, `error` (the last refused change, shown as a banner), `readyAtMs`.

---

## 9. UI components

Desktop renderer, `apps/desktop/src/renderer/src/components/`. Layout: sidebar (left), main area, details panel
(right, toggled), plus palettes and menus over the top. `App.tsx` owns routing and state and passes actions down.

### 9.1 Shell and routing (`App.tsx`)

- **Main area shows one of:** your profile (`ProfileView`), Settings, a person (`PersonView`), a sprint
  (`SprintView`), every thread or a label/group (`LabelView`), a draft (`DraftView`), or a thread (`ThreadView`, with an
  optional split view beside it).
- **Page state:** `SidebarPage = "settings" | "all" | { label } | { person } | { sprint }`; plus the active thread, the
  split thread, the open draft, and whether the profile is open.
- **Contexts:**
  - `MeContext` (who you're viewing as);
  - `ThreadLinksContext` (`titleOf`, `nameOf`, `open` into split view, `openPerson`, `search`, plus `people`,
    `threads`, `labels` and `groups`);
  - `ThreadMenuContext` (right-click menu on any thread);
  - `CurrentThreadContext`.
- **Thread actions** (`ThreadActions`, from `actionsFor(thread)`): note, send, blocked, task, set status, priority,
  due, effort, bucket and labels, branch, move, select.
  - Closing from your inbox moves you to the next inbox thread.
  - The board and sprint pages update status directly, so you stay where you are.
- **Thread right-click menu:**
  - Open, and Open beside;
  - Done (⌘E) and Snooze, when it's in your inbox;
  - Move to a bucket, and Sort it for me;
  - Add to or Remove from a sprint;
  - Close or Reopen, and Archive or Unarchive.
- **Keyboard:**

  | Keys         | Action                        |
  | ------------ | ----------------------------- |
  | ⌘K, ⌘⇧F      | command palette               |
  | ⌘N           | new thread                    |
  | ⌘⇧N          | compose panel                 |
  | ⌘U           | view as                       |
  | ⌘+ / ⌘- / ⌘0 | zoom the main content         |
  | J / K        | next or previous inbox thread |
  | ⌘E           | done                          |
  | H            | snooze until 9 tomorrow       |
  | R            | reply                         |
  | Escape       | leave the reply               |

  None of these work while a dialog is open. ⌘E also works while you're typing.

- **Banners and toasts:**
  - the save-error banner, for a change the server refused;
  - an undo toast for Done and Snooze;
  - mention toasts (`MentionToasts`).
- **Startup:** a "waiting for API" screen with buttons to switch the data source.

### 9.2 Components

| Component                               | File                                                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Sidebar`                               | `Sidebar.tsx`                                             | Tabs: Inbox (`InboxView`, buckets via `BucketSection`/`InboxRow`, drag to re-bucket), Sent, Drafts, Groups (`GroupList`: All threads, your groups, others, labels, archived). Top bar: `SidebarToggle`, `SearchButton`, `NotificationsButton`, compose. Footer: your profile. Also exports `DetailsToggle`, `SidebarPage`, `BucketActions`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ThreadView`                            | `ThreadView.tsx`                                          | A thread as a document. Internal parts:<br>• `ThreadHeader`: branched-from line, title, description, and property chips for status, bucket (when in your inbox), priority, due, effort and labels (`LabelChip`).<br>• `MessageBlock`: author name opens their profile; "to …" or "Note".<br>• `EventLine`, `ResolutionBlock`.<br>• `ReplyBlock`: Tiptap editor with `@` (`mentionNode.ts`), `#` (`threadLinkNode.ts`) and `/` (`slashCommands.ts`: blocked, task, close), a To line, Enter to send and a note when nobody's on the To line.<br>• `ThreadMenu`: the shared popup for `#`, `@` and `/`.<br>Also handles message selection (click, ⌘-click, shift-click) and moving messages. Exports `MenuChip` (a chip with a menu, optionally typed) and the `ThreadActions` type. |
| `ThreadMinimap`                         | `ThreadMinimap.tsx`                                       | Strip of ticks per entry along a thread's edge; hover previews, click jumps, ⌥+scroll steps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `DetailsPanel`                          | `DetailsPanel.tsx`                                        | Right panel: status, due, bucket (with reason), labels (open the label/group), branch graph (`ThreadGraph`), activity log (audit trail). Resizable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `LabelView`                             | `LabelView.tsx`                                           | Every thread, or a label's or group's. For a group: editable title (`GroupTitle`), `Members` (add, remove, join, leave, archive), activity. Toolbar: New thread, `ViewToggle`, **Sprints** menu (open a sprint, New sprint), filters (person, group/label, closed). Body: `ThreadRows` or `Board`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SprintView`                            | `SprintView.tsx`                                          | A sprint's own page:<br>• the name, renamed in place;<br>• its group (links back), dates and summary;<br>• date inputs, and load per person;<br>• Close/Reopen, and "Start the next sprint with N unfinished";<br>• a toolbar with New thread (in the sprint), `ViewToggle`, Add threads, and filters (person, closed);<br>• its threads as a list or board.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Board`                                 | `Board.tsx`                                               | Open / Blocked / Closed columns of cards (title, assignees, priority, due, effort). HTML5 drag between columns changes status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ThreadItems`                           | `ThreadItems.tsx`                                         | `ThreadRows` (list rows with unread dot and right-click menu) and `ViewToggle` (List / Board).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PersonView`                            | `PersonView.tsx`                                          | Someone's profile:<br>• level, role, manager and the chain above, reports, and groups you share;<br>• "New thread to them";<br>• shared threads, in "Assigned to you", "Assigned to them" and "Everything else you're both in";<br>• closed threads behind an "N closed" chip, shown right under it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ProfileView`                           | `ProfileView.tsx`                                         | Your profile:<br>• manager, reports, inbox counts, buckets;<br>• the organization's name, with Rename;<br>• the org tree (`OrgBranch`, neo-tree-style guides), where clicking a name opens that person.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SettingsView`                          | `SettingsView.tsx`                                        | Settings preview; controls aren't wired to anything yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DraftView`                             | `DraftView.tsx`                                           | An unsent ⌘⇧N draft in the main area, editable in place, with Send and Delete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ComposePanel`                          | `ComposePanel.tsx`                                        | ⌘⇧N: type one message and the AI preview drafts it as you type. The preview is editable, Redraft regenerates it, Enter sends, and ⌘S saves it as a draft.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `NewThreadPalette`                      | `NewThreadPalette.tsx`                                    | ⌘N in steps: title, then description, then who it's assigned to. Tab switches to labels. Accepts initial labels and an initial assignee. Exports `NewThreadDraft`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `BlockedPalette`                        | `BlockedPalette.tsx`                                      | `/blocked` in steps: who, what you need (title), and why (description).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `MovePalette`                           | `MovePalette.tsx`                                         | Where selected messages go: an existing thread, or a new branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `NewGroupPalette`                       | `NewGroupPalette.tsx`                                     | Name the group, then pick its members.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `BucketPalette`                         | `BucketPalette.tsx`                                       | Make or edit a bucket: its name, then a description for the model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `CommandPalette`                        | `CommandPalette.tsx`                                      | ⌘K with tabs All, Threads, Groups and labels, and People.<br>• Sections: Quick Actions, Views, People, Groups and Labels (sprints listed as "Group › Sprint"), Data (view as, switch data source), Threads.<br>• People match on name, level or role.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ViewAsPalette`                         | `ViewAsPalette.tsx`                                       | Pick who to view the app as. A testing stand-in for real identity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `OrganizationPrompt`                    | `OrganizationPrompt.tsx`                                  | Names the organization. It can't be skipped on first open, and it's also used to rename later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Notifications` (`NotificationsButton`) | `Notifications.tsx`                                       | Bell with an unread dot. Its panel lists group notices and `activityFor` items, with Mark all read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `MentionToasts`                         | `MentionToasts.tsx`                                       | Toasts for messages sent to you while the app is open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ContextMenu`                           | `ContextMenu.tsx`                                         | Right-click menu, kept on screen. Exports `ContextMenuItem`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Identicon`                             | `Identicon.tsx`                                           | Seeded 5×5 avatar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ResizeHandle`, `useResizablePanel`     | `ResizeHandle.tsx`, `useResizablePanel.tsx`               | Draggable panel widths, remembered between launches. Double-click resets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Tiptap extensions                       | `mentionNode.ts`, `threadLinkNode.ts`, `slashCommands.ts` | `@`, `#` and `/` menus. They talk to the reply component through DOM events (`MENTION_MENU_EVENT`, `THREAD_MENU_EVENT`, `COMMAND_MENU_EVENT`) and `offerKey`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Styling: one stylesheet (`assets/main.css`), dark only. Colour tokens are on `:root`. The font is IBM Plex Sans.
The window uses native macOS vibrancy and is zoomed to 110%.

---

## 10. Tooling, running, testing, deploying

- **Toolchain.**
  - Vite+ (`vp`) wraps Vite, Vitest, Oxlint and Oxfmt.
  - Bun 1.4.4 is the package manager, and Node 22.18 or newer is required.
  - Use `vp install`, then `vp check` (format, lint, types) and `vp run -r test`.
  - `vp run <script>` runs package scripts. Check the `api#` and `desktop#` scripts in each `package.json`.
- **Run locally.**
  - `vp run dev` at the root starts the API on 3030 and Electron.
  - Without access to the Threads Cloudflare account, use `THREADS_LOCAL_AI=off vp run dev`.
  - In the app, pick the data source in ⌘K: Cloudflare, Local or Sample.
  - Cloudflare appears when `apps/desktop/.env.local` sets `VITE_API_URL` and `VITE_API_TOKEN`. That file is gitignored; never commit the token.
  - Local API data persists in `apps/api/.cloudflare/state`.
- **Tests.**
  - `apps/api/tests` run the HTTP protocol over in-memory engines (`createApp`), with no Cloudflare needed. Covered: transactions, assignees, groups, sprints, triage and compose parsing.
  - `apps/desktop/tests` cover the sync client against a fake server, and the derived logic: inbox, activity, groups, sprints, profile, org, compose and format.
- **Deploy.**
  - Run `vp run api#deploy` (`cf deploy`). This needs a `cf auth login` that's a member of the Threads account (`80308317b4a59eb5d4880895142af795`), and the `API_TOKEN` secret.
  - Clients built against an older schema rebuild their cache on the next start.
  - The desktop app builds with `electron-builder` (`build:mac` and the other `build:*` scripts).

---

## 11. Production gaps

What the prototype leaves out on purpose, roughly in the order production needs it:

1. **Identity and auth.**
   - Sessions exist: a person's session acts only as them. But nothing signs people in: the app holds the API token and
     mints a session for whoever it views as (View As).
   - Production needs real accounts, for example Cloudflare Access or OAuth, minting the same session tokens, and the
     app must never hold the API token.
   - People should come from accounts or an invite flow rather than seed data, with a way to create, deactivate and edit them.
2. **Authorization.**
   - Every rule today is "anyone can do anything", except a few: only the owner writes a description, people edit only themselves, only members change groups, and only members plan sprints.
   - Decide per mutation: who may close or assign threads, edit others' threads, or rename the org.
3. **Who sees what (LSE sync groups).**
   - The engine filters by sync group, but Threads has one group per workspace, so every member receives every thread.
     Profile and group pages are display filters, not privacy.
   - Partition by organization (one Durable Object per org) and, if needed, by team or private thread (a schema change).
4. **Multi-tenancy.** Workspaces are a fixed list (`local`, `sample`). Production needs organizations created at signup, routed by id.
5. **Deletes.**
   - The engine has delete, archive and unarchive with cascades, but Threads only lets you delete your own messages.
     Threads, labels, people, groups and sprints aren't deleted, and assignees can't be removed.
6. **Concurrency on lists.** `memberIds`, `threadIds` and `labelIds` are replaced whole, so concurrent edits lose one side. Consider add/remove operations instead.
7. **Undo and redo** at the transaction level (LSE's undo queue). Today only Done and Snooze have an Undo toast.
8. **AI operations.**
   - Sorting depends on Workers AI. Its costs and limits need watching.
   - Production also needs a fallback when the AI is down, prompt and model versioning, and an evaluation set.
   - Compose sends message text to the model, so check that's acceptable for customer data.
9. **Data lifecycle.** Backups or exports of each workspace's SQLite, and a migration strategy beyond `upgrade()` plus a cache rebuild. (The sync log is compacted to its last 10,000 actions.)
10. **Observability.**
    - Structured logs, metrics and alerts: refused batches, AI failures, socket counts, Durable Object errors.
    - Client error reporting. The save-error banner is the only signal today.
11. **Client.**
    - Code signing and notarisation, auto-update (`electron-updater` is a dependency but not set up), and crash reporting.
    - Accessibility, and replacing the dev-only remote-debugging port.
    - `apps/web` and `packages/ui` are unused templates.
12. **Settings.** `SettingsView` is a preview, and working hours and notification preferences aren't stored anywhere.
13. **Rate limits and input limits.** Batches are capped at 200 transactions and 1 MB, but nothing limits requests per user, message size beyond the compose cap, or total model counts.
