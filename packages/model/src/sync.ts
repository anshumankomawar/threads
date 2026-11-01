// The sync protocol shared by the API and the desktop app, modeled on Linear's sync engine (LSE): normalized
// models in an object pool, transactions sent to the server, and delta packets of sync actions broadcast back,
// all ordered by a monotonically increasing sync id.

import type { Entry, Person, Priority, Schedule, Status, Thread, ThreadKind } from "./model";

// --- Models -----------------------------------------------------------------------------------------------

// A thread without its people or entries; those are references, resolved from the object pool.
export type ThreadRecord = {
  id: string;
  kind: ThreadKind;
  title: string;
  requesterId: string;
  assigneeId: string | null;
  status: Status;
  priority: Priority;
  dueAtMs: number | null;
  schedule: Schedule | null;
  attendeeIds: string[];
  // The thread this one was branched off from, if any.
  branchedFromId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type EntryFields =
  | { kind: "message"; authorId: string; text: string; decision: boolean }
  | { kind: "event"; actorId: string; text: string }
  | { kind: "resolution"; authorId: string; text: string }
  | { kind: "call"; link: string }
  | {
      kind: "notes";
      summary: string;
      decisions: string[];
      actionItems: { text: string; ownerId: string }[];
    };

// One entry in a thread's log, referencing its thread (Linear's Comment / IssueHistory to an Issue).
export type EntryRecord = EntryFields & { id: string; threadId: string; createdAtMs: number };

export type ModelRecords = {
  Person: Person;
  Thread: ThreadRecord;
  Entry: EntryRecord;
};

export type ModelName = keyof ModelRecords;
export type AnyRecord = ModelRecords[ModelName];

export const MODEL_NAMES: ModelName[] = ["Person", "Thread", "Entry"];

// Each model's metadata, as in LSE's ModelRegistry: how it loads, and which properties reference other models.
// Every model loads instantly at bootstrap for now; lazy and partial loading can come with more data.
export const ModelRegistry = {
  Person: { loadStrategy: "instant", references: { managerId: "Person" } },
  Thread: {
    loadStrategy: "instant",
    references: { requesterId: "Person", assigneeId: "Person", branchedFromId: "Thread" },
    referenceArrays: { attendeeIds: "Person" },
    backReferences: { entries: "Entry" },
  },
  Entry: {
    loadStrategy: "instant",
    references: { threadId: "Thread", authorId: "Person", actorId: "Person" },
  },
} as const;

// A hash of the registry. A client whose cache was built under another hash rebuilds it with a full bootstrap.
export const SCHEMA_HASH = fnv1a(JSON.stringify(ModelRegistry) + "|records:v2");

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// --- Sync actions and delta packets -----------------------------------------------------------------------

// One change on the server, numbered by sync id: I(nsert), U(pdate) or D(elete). Inserts and updates carry the
// whole record, as LSE's do.
export type SyncAction = {
  id: number;
  modelName: ModelName;
  modelId: string;
  action: "I" | "U" | "D";
  data: AnyRecord | null;
};

export type BootstrapResponse = {
  lastSyncId: number;
  schemaHash: string;
  models: { [Name in ModelName]: ModelRecords[Name][] };
};

export type DeltasResponse = { lastSyncId: number; actions: SyncAction[] };

// Messages on the sync WebSocket. The handshake tells the client the server's lastSyncId, so it can fetch any
// deltas it missed; each delta packet holds the sync actions from one executed batch.
export type SyncMessage =
  | { type: "handshake"; lastSyncId: number }
  | { type: "delta"; lastSyncId: number; actions: SyncAction[] };

// --- Transactions -----------------------------------------------------------------------------------------

// What clients send: creations and updates of the models they may write. The server validates each, runs its
// side effects (activity lines, call links, closing a thread on resolution) and answers with the new lastSyncId.
export type TransactionInput =
  | { id: string; type: "create"; modelName: "Thread"; data: ThreadCreate }
  | { id: string; type: "create"; modelName: "Entry"; data: EntryCreate }
  | { id: string; type: "update"; modelName: "Thread"; modelId: string; changes: ThreadChanges }
  | {
      id: string;
      type: "update";
      modelName: "Entry";
      modelId: string;
      changes: { decision: boolean };
    };

export type ThreadCreate = {
  id: string;
  kind: ThreadKind;
  title: string;
  assigneeId: string | null;
  attendeeIds: string[];
  schedule: Schedule | null;
  // Set when a discussion is branched off another thread (`/thread` in a message).
  branchedFromId?: string | null;
};

export type ThreadChanges = Partial<
  Pick<ThreadRecord, "title" | "assigneeId" | "status" | "priority" | "dueAtMs" | "schedule">
>;

export type EntryCreate = {
  id: string;
  threadId: string;
  kind: "message" | "resolution";
  text: string;
};

// `utcOffsetMinutes` is the actor's time zone, so activity lines such as "scheduled this for 5:00 PM" read in their
// local time rather than the server's UTC.
export type TransactionBatch = {
  actorId: string;
  utcOffsetMinutes?: number;
  transactions: TransactionInput[];
};

export type TransactionBatchResponse = { lastSyncId: number };

// --- Records <-> the app's threads -------------------------------------------------------------------------

// The thread a new ThreadCreate makes, before the server's side effects. The server and an optimistic client
// both build it this way.
export function threadFromCreate(data: ThreadCreate, actorId: string, nowMs: number): ThreadRecord {
  return {
    id: data.id,
    kind: data.kind,
    title: data.title,
    requesterId: actorId,
    // A focus block is your own work, so it's yours unless said otherwise.
    assigneeId: data.assigneeId ?? (data.kind === "focus" ? actorId : null),
    status: "open",
    priority: "none",
    dueAtMs: null,
    schedule: data.schedule,
    attendeeIds:
      data.kind === "meeting" ? [actorId, ...data.attendeeIds.filter((id) => id !== actorId)] : [],
    branchedFromId: data.branchedFromId ?? null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function entryFromCreate(data: EntryCreate, actorId: string, nowMs: number): EntryRecord {
  const base = { id: data.id, threadId: data.threadId, createdAtMs: nowMs };
  return data.kind === "message"
    ? { ...base, kind: "message", authorId: actorId, text: data.text, decision: false }
    : { ...base, kind: "resolution", authorId: actorId, text: data.text };
}

// Someone the pool doesn't have, for example after they're removed: shown by id rather than breaking the thread.
const unknownPerson = (id: string): Person => ({ id, name: id });

export function toEntry(record: EntryRecord, person: (id: string) => Person): Entry {
  const base = { id: record.id, createdAtMs: record.createdAtMs };
  switch (record.kind) {
    case "message":
      return {
        ...base,
        kind: "message",
        author: person(record.authorId),
        text: record.text,
        decision: record.decision,
      };
    case "event":
      return { ...base, kind: "event", actor: person(record.actorId), text: record.text };
    case "resolution":
      return { ...base, kind: "resolution", author: person(record.authorId), text: record.text };
    case "call":
      return { ...base, kind: "call", link: record.link };
    case "notes":
      return {
        ...base,
        kind: "notes",
        summary: record.summary,
        decisions: record.decisions,
        actionItems: record.actionItems.map((item) => ({
          text: item.text,
          owner: person(item.ownerId),
        })),
      };
  }
}

// Resolves a thread's references into the shape the app renders.
export function toThread(
  record: ThreadRecord,
  entries: EntryRecord[],
  people: ReadonlyMap<string, Person>,
): Thread {
  const person = (id: string): Person => people.get(id) ?? unknownPerson(id);
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    requester: person(record.requesterId),
    assignee: record.assigneeId === null ? null : person(record.assigneeId),
    status: record.status,
    priority: record.priority,
    dueAtMs: record.dueAtMs,
    schedule: record.schedule,
    attendees: record.attendeeIds.map(person),
    // Threads stored before branching existed have no field.
    branchedFromId: record.branchedFromId ?? null,
    updatedAtMs: record.updatedAtMs,
    // Oldest first. Within the same instant messages lead, so a meeting's agenda comes before its call link.
    entries: [...entries]
      .sort(
        (a, b) =>
          a.createdAtMs - b.createdAtMs ||
          Number(a.kind !== "message") - Number(b.kind !== "message"),
      )
      .map((entry) => toEntry(entry, person)),
  };
}

// All threads in a pool, with entries grouped onto them.
export function toThreads(
  threads: Iterable<ThreadRecord>,
  entries: Iterable<EntryRecord>,
  people: ReadonlyMap<string, Person>,
): Thread[] {
  const byThread = new Map<string, EntryRecord[]>();
  for (const entry of entries) {
    const list = byThread.get(entry.threadId);
    if (list === undefined) byThread.set(entry.threadId, [entry]);
    else list.push(entry);
  }
  return [...threads].map((thread) => toThread(thread, byThread.get(thread.id) ?? [], people));
}

// The reverse, for seeding from sample threads and migrating stored ones.
export function fromThread(thread: Thread): { thread: ThreadRecord; entries: EntryRecord[] } {
  const createdAtMs = thread.entries[0]?.createdAtMs ?? thread.updatedAtMs;
  const entries = thread.entries.map((entry): EntryRecord => {
    const base = { id: entry.id, threadId: thread.id, createdAtMs: entry.createdAtMs };
    switch (entry.kind) {
      case "message":
        return {
          ...base,
          kind: "message",
          authorId: entry.author.id,
          text: entry.text,
          decision: entry.decision,
        };
      case "event":
        return { ...base, kind: "event", actorId: entry.actor.id, text: entry.text };
      case "resolution":
        return { ...base, kind: "resolution", authorId: entry.author.id, text: entry.text };
      case "call":
        return { ...base, kind: "call", link: entry.link };
      case "notes":
        return {
          ...base,
          kind: "notes",
          summary: entry.summary,
          decisions: entry.decisions,
          actionItems: entry.actionItems.map((item) => ({
            text: item.text,
            ownerId: item.owner.id,
          })),
        };
    }
  });
  return {
    thread: {
      id: thread.id,
      kind: thread.kind,
      title: thread.title,
      requesterId: thread.requester.id,
      assigneeId: thread.assignee?.id ?? null,
      status: thread.status,
      priority: thread.priority,
      dueAtMs: thread.dueAtMs,
      schedule: thread.schedule,
      attendeeIds: thread.attendees.map((person) => person.id),
      branchedFromId: thread.branchedFromId,
      createdAtMs,
      updatedAtMs: thread.updatedAtMs,
    },
    entries,
  };
}
