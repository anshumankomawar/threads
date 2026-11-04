// Threads' half of the sync protocol, shared by the API and the desktop app: its models, the schema the sync engine
// (`packages/sync`) runs them with, the transactions clients send, and how those change models on the client. The
// engine itself (sync ids, the log, delta packets, sync groups, the client's queue and cache) knows none of this.

import {
  defineSchema,
  modelNames,
  schemaHash,
  type BootstrapResponse as SyncBootstrapResponse,
  type BuiltInTransaction,
  type ClientMutations,
  type DeltasResponse as SyncDeltasResponse,
  type SyncAction as SyncActionOf,
  type SyncMessage as SyncMessageOf,
  type TransactionBatch as SyncTransactionBatch,
} from "sync";
import { labelSlug } from "./model";
import type {
  Bucket,
  Entry,
  Group,
  Label,
  Organization,
  Person,
  Priority,
  Sprint,
  Status,
  Thread,
  Triage,
} from "./model";

// --- Models -----------------------------------------------------------------------------------------------

// A thread without its people or entries; those are references, resolved from the object pool.
export type ThreadRecord = {
  id: string;
  title: string;
  // Its owner: whoever made it.
  createdById: string;
  // Everyone it's assigned to. A message @mentioning someone adds them (`SyncEngine.#apply`); a group @mentioned is
  // assigned through its label, in `labelIds`.
  assigneeIds: string[];
  status: Status;
  priority: Priority;
  dueAtMs: number | null;
  effortHours: number | null;
  labelIds: string[];
  // Its bucket for each person whose inbox it's in, by id (`Triage`): set by the server's model, or by them by hand.
  triage: Record<string, Triage>;
  // Per person, by id: when they last marked it done for themselves, and until when they've snoozed it.
  doneBy: Record<string, number>;
  snoozedUntil: Record<string, number>;
  // The thread this one was branched off from, if any.
  branchedFromId: string | null;
  // The thread this one blocks (made with `/blocked`): that thread stays blocked until this one closes.
  blocksId: string | null;
  // When each person last opened it, so whoever asked them something can see it was seen.
  seenBy: Record<string, number>;
  createdAtMs: number;
  updatedAtMs: number;
};

type EntryFields =
  // `sentToIds` empty is a note: in the thread, but nobody is told.
  | { kind: "message"; authorId: string; text: string; sentToIds: string[] }
  | { kind: "event"; actorId: string; text: string }
  | { kind: "resolution"; authorId: string; text: string };

// One entry in a thread's log, referencing its thread (Linear's Comment / IssueHistory to an Issue).
export type EntryRecord = EntryFields & { id: string; threadId: string; createdAtMs: number };

export type ModelRecords = {
  Person: Person;
  Thread: ThreadRecord;
  Entry: EntryRecord;
  Organization: Organization;
  Label: Label;
  Group: Group;
  Sprint: Sprint;
};

export type ModelName = keyof ModelRecords;
export type AnyRecord = ModelRecords[ModelName];

// Each model's references, as in LSE's ModelRegistry. A thread's entries belong to it (deleting a thread deletes
// them). Everything is in the workspace's one sync group: every member sees every thread.
export const threadsSchema = defineSchema<ModelRecords>({
  version: "records:v21",
  models: {
    Person: { references: { managerId: "Person" } },
    Thread: {
      references: {
        createdById: "Person",
        branchedFromId: "Thread",
        blocksId: "Thread",
      },
      referenceArrays: { assigneeIds: "Person", labelIds: "Label" },
      backReferences: { entries: { model: "Entry", key: "threadId" } },
    },
    Entry: {
      references: { threadId: "Thread", authorId: "Person", actorId: "Person" },
      referenceArrays: { sentToIds: "Person" },
    },
    Organization: {},
    Label: {},
    Group: {},
    Sprint: {
      references: { groupId: "Group", createdById: "Person" },
      referenceArrays: { threadIds: "Thread" },
    },
  },
});

export const MODEL_NAMES: ModelName[] = modelNames(threadsSchema);

// A client whose cache was built under another hash rebuilds it with a full bootstrap.
export const SCHEMA_HASH = schemaHash(threadsSchema);

// --- The protocol, for these models ---------------------------------------------------------------------

export type SyncAction = SyncActionOf<ModelRecords>;
export type BootstrapResponse = SyncBootstrapResponse<ModelRecords>;
export type DeltasResponse = SyncDeltasResponse<ModelRecords>;
export type SyncMessage = SyncMessageOf<ModelRecords>;
// Deleting, archiving and unarchiving, which the engine provides for any model.
export type BuiltIn = BuiltInTransaction<ModelRecords>;

// --- Transactions -----------------------------------------------------------------------------------------

// What clients send: creations and updates of the models they may write, and moves of messages between threads (plus
// the engine's built-in delete, archive and unarchive). The server validates each, runs its side effects (activity
// lines, closing a thread on resolution) and answers with the new lastSyncId.
export type TransactionInput =
  | { id: string; type: "create"; modelName: "Thread"; data: ThreadCreate }
  | { id: string; type: "create"; modelName: "Entry"; data: EntryCreate }
  | { id: string; type: "create"; modelName: "Label"; data: LabelCreate }
  | { id: string; type: "create"; modelName: "Group"; data: GroupCreate }
  | { id: string; type: "create"; modelName: "Sprint"; data: SprintCreate }
  | { id: string; type: "update"; modelName: "Thread"; modelId: string; changes: ThreadChanges }
  // People change only their own profile.
  | { id: string; type: "update"; modelName: "Person"; modelId: string; changes: PersonChanges }
  | { id: string; type: "update"; modelName: "Group"; modelId: string; changes: GroupChanges }
  | { id: string; type: "update"; modelName: "Sprint"; modelId: string; changes: SprintChanges }
  | {
      id: string;
      type: "update";
      modelName: "Organization";
      modelId: string;
      changes: OrganizationChanges;
    }
  // Moves messages from one thread into another. The source thread gets an activity line where they were.
  | { id: string; type: "move"; modelName: "Entry"; entryIds: string[]; threadId: string };

export type ThreadCreate = {
  id: string;
  title: string;
  // Who it's assigned to from the start; more join as they're @mentioned.
  assigneeIds?: string[];
  // Set when a discussion is branched off another thread (`#` in a message).
  branchedFromId?: string | null;
  // Set when the thread is what another one is blocked on (`/blocked`).
  blocksId?: string | null;
  // Its labels from the start, such as the group it's made in.
  labelIds?: string[];
};

// The id is `labelSlug(name)`, so everyone making the same label makes one label.
export type LabelCreate = { id: string; name: string };

export type GroupCreate = { id: string; name: string; memberIds: string[] };

// Lists (members, a sprint's threads, a thread's labels) are set whole; the last change wins, as in LSE.
export type GroupChanges = Partial<Pick<Group, "name" | "memberIds" | "archived">>;

// A sprint is made in a group, with its dates and any threads to start with.
export type SprintCreate = {
  id: string;
  groupId: string;
  name: string;
  startMs: number;
  endMs: number;
  threadIds?: string[];
};

// Its threads are changed as a whole list, like a group's members.
export type SprintChanges = Partial<
  Pick<Sprint, "name" | "startMs" | "endMs" | "threadIds" | "closed">
>;

export type OrganizationChanges = Pick<Organization, "name">;

// Someone's own inbox buckets, the whole list at once.
export type PersonChanges = { buckets?: Bucket[] };

export type ThreadChanges = Partial<
  Pick<ThreadRecord, "title" | "status" | "priority" | "dueAtMs" | "effortHours" | "labelIds">
> &
  ScopedChanges;

// Changes that are only about whoever sends them, applied by `applyScopedChanges` on the server and, optimistically,
// in the app. They're quiet: no activity line, and the thread doesn't count as updated.
export type ScopedChanges = {
  // Marks it seen, now.
  seen?: true;
  // Done for you (⌘E) now, out of your inbox until someone sends you something; false brings it back.
  done?: boolean;
  // Out of your inbox until then (H); null brings it back now.
  snoozeUntilMs?: number | null;
  // Puts it in one of your buckets by hand; null hands it back to the model to sort.
  bucketId?: string | null;
};

// A thread record with whoever sent them's scoped changes applied, and the rest of the changes, still to apply.
export function applyScopedChanges<Changes extends ScopedChanges>(
  record: ThreadRecord,
  changes: Changes,
  actorId: string,
  nowMs: number,
): { record: ThreadRecord; rest: Omit<Changes, keyof ScopedChanges> } {
  const { seen, done, snoozeUntilMs, bucketId, ...rest } = changes;
  const without = (map: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(map).filter(([id]) => id !== actorId));
  let next = record;
  if (seen) next = { ...next, seenBy: { ...next.seenBy, [actorId]: nowMs } };
  if (done !== undefined)
    next = {
      ...next,
      doneBy: done ? { ...next.doneBy, [actorId]: nowMs } : without(next.doneBy),
    };
  if (snoozeUntilMs !== undefined)
    next = {
      ...next,
      snoozedUntil:
        snoozeUntilMs === null
          ? without(next.snoozedUntil)
          : { ...next.snoozedUntil, [actorId]: snoozeUntilMs },
    };
  if (bucketId !== undefined) {
    const { [actorId]: _mine, ...others } = next.triage;
    next = {
      ...next,
      triage:
        bucketId === null
          ? others
          : { ...others, [actorId]: { bucketId, reason: "", manual: true, stale: false } },
    };
  }
  return { record: next, rest };
}

export type EntryCreate = {
  id: string;
  threadId: string;
  kind: "message" | "resolution";
  text: string;
  // Who a message is sent to; none makes it a note.
  sentToIds?: string[];
};

// `utcOffsetMinutes` is the actor's time zone, so activity lines such as "set the due date to Fri, Nov 7" read in their
// local time rather than the server's UTC.
export type TransactionBatch = SyncTransactionBatch<TransactionInput | BuiltIn>;

export type { TransactionBatchResponse } from "sync";

// How each transaction changes models on the client: shown at once, replayed after a restart, and kept on top of newer
// server data. The server's side effects (activity lines, assignees from @mentions) aren't predicted; they arrive with
// the delta. A creation makes the record the server will, before its side effects.
export const threadsMutations: ClientMutations<ModelRecords, TransactionInput> = {
  touches: (input) => {
    if (input.type === "create") return [{ modelName: input.modelName, id: input.data.id }];
    if (input.type === "move")
      return input.entryIds.map((id) => ({ modelName: "Entry" as const, id }));
    return [{ modelName: input.modelName, id: input.modelId }];
  },
  change: (input, _modelName, record, { actorId, nowMs }) => {
    if (input.type === "create") {
      if (record !== undefined) return record;
      switch (input.modelName) {
        case "Thread":
          return threadFromCreate(input.data, actorId, nowMs);
        case "Label":
          return labelFromCreate(input.data, actorId, nowMs);
        case "Group":
          return groupFromCreate(input.data, actorId, nowMs);
        case "Sprint":
          return sprintFromCreate(input.data, actorId, nowMs);
        case "Entry":
          return entryFromCreate(input.data, actorId, nowMs);
      }
    }
    if (record === undefined) return undefined;
    if (input.type === "move") return { ...(record as EntryRecord), threadId: input.threadId };
    if (input.modelName !== "Thread") return { ...record, ...input.changes } as AnyRecord;
    // On a thread, changes only about whoever made them (seen, done, snoozed, placed in a bucket) land on their
    // entry, as the server puts them.
    const { record: scoped, rest } = applyScopedChanges(
      record as ThreadRecord,
      input.changes,
      actorId,
      nowMs,
    );
    return { ...scoped, ...rest };
  },
  // An update undoes by setting back what it changed (your own done, snooze and bucket as they were); a move by moving the messages back; making a message by deleting it. Nothing else is undone: the server
  // doesn't delete threads, labels, groups or sprints.
  inverse: (input, before, { actorId }) => {
    if (input.type === "create")
      // A thread's description (its id is the thread's) stays with it.
      return input.modelName === "Entry" &&
        input.data.kind === "message" &&
        input.data.id !== input.data.threadId
        ? { type: "delete", modelName: "Entry", modelId: input.data.id }
        : null;
    if (input.type === "move") {
      const from = before.get(`Entry:${input.entryIds[0]}`) as EntryRecord | undefined;
      return from === undefined ? null : { ...input, threadId: from.threadId };
    }
    const was = before.get(`${input.modelName}:${input.modelId}`) as
      | Record<string, unknown>
      | undefined;
    if (was === undefined) return null;
    const changes: Record<string, unknown> = {};
    for (const field of Object.keys(input.changes as Record<string, unknown>)) {
      if (field === "seen") continue;
      if (field === "done")
        changes.done = (was.doneBy as Record<string, number>)[actorId] !== undefined;
      else if (field === "snoozeUntilMs")
        changes.snoozeUntilMs = (was.snoozedUntil as Record<string, number>)[actorId] ?? null;
      else if (field === "bucketId") {
        const mine = (was.triage as Record<string, Triage>)[actorId];
        changes.bucketId = mine?.manual ? mine.bucketId : null;
      } else changes[field] = was[field] ?? null;
    }
    return Object.keys(changes).length === 0 ? null : ({ ...input, changes } as never);
  },
};

// --- Records <-> the app's threads -------------------------------------------------------------------------

// The thread a new ThreadCreate makes, before the server's side effects. The server and an optimistic client
// both build it this way.
export function threadFromCreate(data: ThreadCreate, actorId: string, nowMs: number): ThreadRecord {
  return {
    id: data.id,
    title: data.title,
    createdById: actorId,
    assigneeIds: [...new Set(data.assigneeIds ?? [])],
    status: "open",
    priority: "none",
    dueAtMs: null,
    effortHours: null,
    labelIds: data.labelIds ?? [],
    triage: {},
    doneBy: {},
    snoozedUntil: {},
    branchedFromId: data.branchedFromId ?? null,
    blocksId: data.blocksId ?? null,
    seenBy: {},
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function labelFromCreate(data: LabelCreate, actorId: string, nowMs: number): Label {
  return {
    id: data.id,
    name: data.name.trim(),
    groupId: null,
    createdById: actorId,
    createdAtMs: nowMs,
  };
}

// Whoever makes a group is in it. Its label is made alongside it, by the server.
export function groupFromCreate(data: GroupCreate, actorId: string, nowMs: number): Group {
  return {
    id: data.id,
    name: data.name.trim(),
    labelId: labelSlug(data.name),
    memberIds: [actorId, ...data.memberIds.filter((id) => id !== actorId)],
    createdById: actorId,
    archived: false,
    activity: [],
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function sprintFromCreate(data: SprintCreate, actorId: string, nowMs: number): Sprint {
  return {
    id: data.id,
    groupId: data.groupId,
    name: data.name.trim(),
    startMs: data.startMs,
    endMs: data.endMs,
    threadIds: [...new Set(data.threadIds ?? [])],
    closed: false,
    createdById: actorId,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function entryFromCreate(data: EntryCreate, actorId: string, nowMs: number): EntryRecord {
  const base = { id: data.id, threadId: data.threadId, createdAtMs: nowMs };
  return data.kind === "message"
    ? {
        ...base,
        kind: "message",
        authorId: actorId,
        text: data.text,
        sentToIds: (data.sentToIds ?? []).filter((id) => id !== actorId),
      }
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
        sentTo: record.sentToIds.map(person),
      };
    case "event":
      return { ...base, kind: "event", actor: person(record.actorId), text: record.text };
    case "resolution":
      return { ...base, kind: "resolution", author: person(record.authorId), text: record.text };
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
    title: record.title,
    owner: person(record.createdById),
    assignees: record.assigneeIds.map(person),
    status: record.status,
    priority: record.priority,
    dueAtMs: record.dueAtMs,
    effortHours: record.effortHours,
    labelIds: record.labelIds,
    triage: record.triage,
    doneBy: record.doneBy,
    snoozedUntil: record.snoozedUntil,
    branchedFromId: record.branchedFromId,
    blocksId: record.blocksId,
    seenBy: record.seenBy,
    updatedAtMs: record.updatedAtMs,
    // Oldest first. Within the same instant messages lead, so a description comes before the lines it causes.
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

// The reverse, for seeding from sample threads.
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
          sentToIds: entry.sentTo.map((person) => person.id),
        };
      case "event":
        return { ...base, kind: "event", actorId: entry.actor.id, text: entry.text };
      case "resolution":
        return { ...base, kind: "resolution", authorId: entry.author.id, text: entry.text };
    }
  });
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      createdById: thread.owner.id,
      assigneeIds: thread.assignees.map((person) => person.id),
      status: thread.status,
      priority: thread.priority,
      dueAtMs: thread.dueAtMs,
      effortHours: thread.effortHours,
      labelIds: thread.labelIds,
      triage: thread.triage,
      doneBy: thread.doneBy,
      snoozedUntil: thread.snoozedUntil,
      branchedFromId: thread.branchedFromId,
      blocksId: thread.blocksId,
      seenBy: thread.seenBy,
      createdAtMs,
      updatedAtMs: thread.updatedAtMs,
    },
    entries,
  };
}
