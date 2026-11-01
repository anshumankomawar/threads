import {
  DUMMY_ZOOM_LINK,
  entryFromCreate,
  fromThread,
  localPeople,
  MODEL_NAMES,
  PRIORITY_LABELS,
  samplePeople,
  sampleThreads,
  STATUS_LABELS,
  threadFromCreate,
  toThread,
  toThreads,
  type AnyRecord,
  type ModelName,
  type ModelRecords,
  type Person,
  type SyncAction,
  type Thread,
  type ThreadChanges,
  type ThreadRecord,
  type TransactionInput,
} from "model";
import { z } from "zod";

// Each workspace is its own sync group: its own people, threads and sync ids. "local" starts with a few people
// and no threads, for trying the app as each of them; "sample" is the demo team with their threads.
export const WORKSPACES = ["local", "sample"] as const;
export type WorkspaceName = (typeof WORKSPACES)[number];

export const isWorkspaceName = (name: string): name is WorkspaceName =>
  (WORKSPACES as readonly string[]).includes(name);

// A failed request: the status to answer with, and why.
export class EngineError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

const missingUser = (id: string): EngineError => new EngineError(404, `User not found: ${id}`);

// Where an engine keeps its sync log. The Durable Object stores it in SQLite; tests keep it in memory.
export type EngineStorage = {
  // Saves a batch's sync actions, the models they leave behind, and the transactions that made them, all or nothing.
  commit(actions: SyncAction[], transactionIds: string[]): void;
  actionsAfter(syncId: number): SyncAction[];
  // A transaction already executed, for example one a client resent after losing the response.
  hasTransaction(id: string): boolean;
};

export function memoryStorage(): EngineStorage {
  const log: SyncAction[] = [];
  const transactions = new Set<string>();
  return {
    commit(actions, transactionIds) {
      log.push(...actions);
      for (const id of transactionIds) transactions.add(id);
    },
    actionsAfter: (syncId) => log.filter((action) => action.id > syncId),
    hasTransaction: (id) => transactions.has(id),
  };
}

type Models = { [Name in ModelName]: Map<string, ModelRecords[Name]> };

const emptyModels = (): Models => ({
  Person: new Map(),
  Thread: new Map(),
  Entry: new Map(),
});

// The writes of one batch, staged until the whole batch succeeds. Reads see staged writes first.
class Batch {
  readonly writes = new Map<string, { modelName: ModelName; id: string; data: AnyRecord | null }>();
  readonly #models: Models;

  constructor(models: Models) {
    this.#models = models;
  }

  get<Name extends ModelName>(modelName: Name, id: string): ModelRecords[Name] | undefined {
    const staged = this.writes.get(`${modelName}:${id}`);
    if (staged !== undefined) return (staged.data ?? undefined) as ModelRecords[Name] | undefined;
    return this.#models[modelName].get(id);
  }

  put<Name extends ModelName>(modelName: Name, record: ModelRecords[Name]): void {
    this.writes.set(`${modelName}:${record.id}`, { modelName, id: record.id, data: record });
  }
}

// --- Validation -------------------------------------------------------------------------------------------

const id = z.string().min(1).max(100);
const schedule = z
  .object({ startMs: z.number().int(), endMs: z.number().int() })
  .refine(({ startMs, endMs }) => endMs > startMs, "endMs must be after startMs");

const threadCreate = z.object({
  id,
  kind: z.enum(["response", "meeting", "focus"]),
  title: z.string().trim().min(1).max(200),
  assigneeId: id.nullable(),
  attendeeIds: z.array(id),
  schedule: schedule.nullable(),
  branchedFromId: id.nullable().optional(),
});

const threadChanges = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    assigneeId: id,
    status: z.enum(["open", "in_progress", "waiting", "done"]),
    priority: z.enum(["none", "low", "medium", "high", "urgent"]),
    dueAtMs: z.number().int().nullable(),
    schedule: schedule.nullable(),
  })
  .partial();

const entryCreate = z.object({
  id,
  threadId: id,
  kind: z.enum(["message", "resolution"]),
  text: z.string().trim().min(1),
});

export const transactionInput = z.union([
  z.object({ id, type: z.literal("create"), modelName: z.literal("Thread"), data: threadCreate }),
  z.object({ id, type: z.literal("create"), modelName: z.literal("Entry"), data: entryCreate }),
  z.object({
    id,
    type: z.literal("update"),
    modelName: z.literal("Thread"),
    modelId: id,
    changes: threadChanges,
  }),
]);

export const transactionBatch = z.object({
  actorId: id,
  utcOffsetMinutes: z.number().int().min(-1440).max(1440).optional(),
  transactions: z.array(transactionInput).min(1).max(200),
});

// --- Side effects -----------------------------------------------------------------------------------------

// Formats a time in the actor's time zone.
function localTime(ms: number, offsetMinutes: number, options: Intl.DateTimeFormatOptions): string {
  return new Date(ms + offsetMinutes * 60_000).toLocaleString("en-US", {
    ...options,
    timeZone: "UTC",
  });
}

// The activity line for each field an update actually changes, phrased from the actor's point of view.
function describeChanges(
  thread: ThreadRecord,
  changes: ThreadChanges,
  actor: Person,
  people: (id: string) => Person | undefined,
  offsetMinutes: number,
): string[] {
  const lines: string[] = [];
  if (changes.title !== undefined && changes.title !== thread.title)
    lines.push(`renamed this to “${changes.title}”`);
  if (changes.status !== undefined && changes.status !== thread.status)
    lines.push(
      thread.status === "done" && changes.status === "open"
        ? "reopened this"
        : `changed status to ${STATUS_LABELS[changes.status]}`,
    );
  if (changes.priority !== undefined && changes.priority !== thread.priority)
    lines.push(
      changes.priority === "none"
        ? "removed the priority"
        : `set priority to ${PRIORITY_LABELS[changes.priority]}`,
    );
  if (changes.dueAtMs !== undefined && changes.dueAtMs !== thread.dueAtMs)
    lines.push(
      changes.dueAtMs === null
        ? "removed the due date"
        : `set the due date to ${localTime(changes.dueAtMs, offsetMinutes, { weekday: "short", month: "short", day: "numeric" })}`,
    );
  if (
    changes.assigneeId !== undefined &&
    changes.assigneeId !== null &&
    changes.assigneeId !== thread.assigneeId
  )
    lines.push(
      changes.assigneeId === actor.id
        ? "took this on"
        : `assigned this to ${people(changes.assigneeId)?.name ?? changes.assigneeId}`,
    );
  if (changes.schedule !== undefined && changes.schedule?.startMs !== thread.schedule?.startMs)
    lines.push(
      changes.schedule === null
        ? "removed it from the schedule"
        : `scheduled this for ${localTime(changes.schedule.startMs, offsetMinutes, { weekday: "short", hour: "numeric", minute: "2-digit" })}`,
    );
  return lines;
}

// --- Engine -----------------------------------------------------------------------------------------------

export type EngineOptions = {
  now?: () => number;
  storage?: EngineStorage;
  // Called after each committed batch with its sync actions, to broadcast them as a delta packet.
  onActions?: (actions: SyncAction[]) => void;
};

// One workspace's models and sync log. Every change, whether a client transaction, a REST call or a seed, runs as
// a batch: it's validated and staged, its side effects added, then each write is numbered with the next sync id,
// saved, applied, and broadcast. Batches run one at a time, so sync ids give every change a total order.
export class SyncEngine {
  readonly models = emptyModels();
  lastSyncId = 0;
  readonly #now: () => number;
  readonly #storage: EngineStorage;
  onActions: ((actions: SyncAction[]) => void) | undefined;

  constructor({ now = Date.now, storage = memoryStorage(), onActions }: EngineOptions = {}) {
    this.#now = now;
    this.#storage = storage;
    this.onActions = onActions;
  }

  // Restores models and the sync position from storage.
  load(records: { modelName: ModelName; data: AnyRecord }[], lastSyncId: number): void {
    for (const { modelName, data } of records)
      (this.models[modelName] as Map<string, AnyRecord>).set(data.id, data);
    this.lastSyncId = lastSyncId;
  }

  get isEmpty(): boolean {
    return MODEL_NAMES.every((name) => this.models[name].size === 0);
  }

  // Runs `stage` as one batch. Nothing is saved or applied if it throws.
  write(stage: (batch: Batch) => void, transactionIds: string[] = []): SyncAction[] {
    const batch = new Batch(this.models);
    stage(batch);
    const actions: SyncAction[] = [];
    let syncId = this.lastSyncId;
    for (const { modelName, id, data } of batch.writes.values()) {
      const exists = this.models[modelName].has(id);
      if (data === null && !exists) continue;
      actions.push({
        id: ++syncId,
        modelName,
        modelId: id,
        action: data === null ? "D" : exists ? "U" : "I",
        data,
      });
    }
    // Persist first, then apply in memory.
    this.#storage.commit(actions, transactionIds);
    for (const action of actions) {
      const models = this.models[action.modelName] as Map<string, AnyRecord>;
      if (action.data === null) models.delete(action.modelId);
      else models.set(action.modelId, action.data);
    }
    this.lastSyncId = syncId;
    if (actions.length > 0) this.onActions?.(actions);
    return actions;
  }

  // Executes a client's transactions as one batch, skipping any it already executed.
  execute(actorId: string, transactions: TransactionInput[], utcOffsetMinutes = 0): SyncAction[] {
    const fresh = transactions.filter(
      (transaction) => !this.#storage.hasTransaction(transaction.id),
    );
    if (fresh.length === 0) return [];
    const actor = this.models.Person.get(actorId);
    if (actor === undefined) throw missingUser(actorId);
    const nowMs = this.#now();
    return this.write(
      (batch) => {
        for (const transaction of fresh)
          this.#apply(batch, actor, transaction, nowMs, utcOffsetMinutes);
      },
      fresh.map((transaction) => transaction.id),
    );
  }

  #apply(
    batch: Batch,
    actor: Person,
    transaction: TransactionInput,
    nowMs: number,
    offsetMinutes: number,
  ): void {
    const person = (personId: string): Person | undefined => batch.get("Person", personId);
    const requirePerson = (personId: string): void => {
      if (person(personId) === undefined) throw missingUser(personId);
    };

    if (transaction.type === "create" && transaction.modelName === "Thread") {
      const { data } = transaction;
      if (batch.get("Thread", data.id) !== undefined)
        throw new EngineError(409, `Thread already exists: ${data.id}`);
      if (data.assigneeId !== null) requirePerson(data.assigneeId);
      for (const attendee of data.attendeeIds) requirePerson(attendee);
      if (data.branchedFromId && batch.get("Thread", data.branchedFromId) === undefined)
        throw new EngineError(404, "Thread not found");
      batch.put("Thread", threadFromCreate(data, actor.id, nowMs));
      // Every meeting gets a video call.
      if (data.kind === "meeting")
        batch.put("Entry", {
          id: `${data.id}:call`,
          threadId: data.id,
          kind: "call",
          link: DUMMY_ZOOM_LINK,
          createdAtMs: nowMs,
        });
      return;
    }

    if (transaction.type === "create") {
      const { data } = transaction;
      const thread = batch.get("Thread", data.threadId);
      if (thread === undefined) throw new EngineError(404, "Thread not found");
      if (batch.get("Entry", data.id) !== undefined)
        throw new EngineError(409, `Entry already exists: ${data.id}`);
      // Entries sort by time, so one made in the same batch as its thread still comes after the call link.
      batch.put("Entry", entryFromCreate(data, actor.id, nowMs));
      batch.put("Thread", {
        ...thread,
        status: data.kind === "resolution" ? "done" : thread.status,
        updatedAtMs: nowMs,
      });
      return;
    }

    const thread = batch.get("Thread", transaction.modelId);
    if (thread === undefined) throw new EngineError(404, "Thread not found");
    const { changes } = transaction;
    if (changes.assigneeId !== undefined && changes.assigneeId !== null)
      requirePerson(changes.assigneeId);
    const lines = describeChanges(thread, changes, actor, person, offsetMinutes);
    if (lines.length === 0) return;
    batch.put("Thread", { ...thread, ...changes, updatedAtMs: nowMs });
    lines.forEach((text, index) =>
      batch.put("Entry", {
        id: `${transaction.id}:${index}`,
        threadId: thread.id,
        kind: "event",
        actorId: actor.id,
        text,
        createdAtMs: nowMs,
      }),
    );
  }

  // --- Reads ---

  actionsAfter(syncId: number): SyncAction[] {
    return this.#storage.actionsAfter(syncId);
  }

  thread(threadId: string): Thread | undefined {
    const record = this.models.Thread.get(threadId);
    if (record === undefined) return undefined;
    const entries = [...this.models.Entry.values()].filter((entry) => entry.threadId === threadId);
    return toThread(record, entries, this.models.Person);
  }

  threads(): Thread[] {
    return toThreads(this.models.Thread.values(), this.models.Entry.values(), this.models.Person);
  }
}

// --- Seeding ----------------------------------------------------------------------------------------------

// Who the sample threads are addressed to when there's no local user to borrow, such as on the hosted API.
export const SAMPLE_ME: Person = { id: "you", name: "You" };

// The people a workspace starts with.
export function seedPeople(workspace: WorkspaceName, me: Person): Person[] {
  return workspace === "local" ? localPeople() : samplePeople(me);
}

// Fills an empty workspace with its starting data, laying out sample times in `utcOffsetMinutes`.
export function seed(
  engine: SyncEngine,
  workspace: WorkspaceName,
  me: Person,
  utcOffsetMinutes?: number,
  nowMs = Date.now(),
): void {
  engine.write((batch) => {
    for (const person of seedPeople(workspace, me)) batch.put("Person", person);
    if (workspace !== "sample") return;
    for (const sample of sampleThreads(me, nowMs, utcOffsetMinutes)) {
      const { thread, entries } = fromThread(sample);
      batch.put("Thread", thread);
      for (const entry of entries) batch.put("Entry", entry);
    }
  });
}

// Keeps the seeded people in step with the code (their levels and managers can change), since nothing edits them
// through the API. Threads and people added through the API stay as they are.
export function refreshSeedPeople(engine: SyncEngine, workspace: WorkspaceName, me: Person): void {
  const changed = seedPeople(workspace, me).filter(
    (person) => JSON.stringify(engine.models.Person.get(person.id)) !== JSON.stringify(person),
  );
  if (changed.length > 0)
    engine.write((batch) => {
      for (const person of changed) batch.put("Person", person);
    });
}
