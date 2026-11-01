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
  threadLink,
  toThread,
  toThreads,
  type AnyRecord,
  type ModelName,
  type ModelRecords,
  type Person,
  type Schedule,
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

  // Who wrote a thread's latest message, counting staged writes.
  lastMessageAuthor(threadId: string): string | undefined {
    let latest: { authorId: string; createdAtMs: number } | undefined;
    const consider = (entry: AnyRecord | null | undefined): void => {
      if (entry === null || entry === undefined || !("kind" in entry) || entry.kind !== "message")
        return;
      if (entry.threadId !== threadId) return;
      if (latest === undefined || entry.createdAtMs >= latest.createdAtMs) latest = entry;
    };
    for (const entry of this.#models.Entry.values())
      if (!this.writes.has(`Entry:${entry.id}`)) consider(entry);
    for (const write of this.writes.values()) if (write.modelName === "Entry") consider(write.data);
    return latest?.authorId;
  }

  // Whose inbox a response is in, the same rule as `waitingOn` in the model.
  waitingOn(threadId: string): string | null {
    const thread = this.get("Thread", threadId);
    if (thread === undefined || thread.kind !== "response") return null;
    if (thread.assigneeId === null) return thread.requesterId;
    return this.lastMessageAuthor(threadId) === thread.assigneeId
      ? thread.requesterId
      : thread.assigneeId;
  }
}

const SLOT_MS = 30 * 60_000;
const SLOT_WINDOW_MS = 3 * 24 * 60 * 60_000;

// A random half-hour slot in working hours (9 to 6, in the given time zone) within the next three days: where a
// response lands on the schedule of whoever it's waiting on. Random for now, to stand in for real scheduling.
export function randomSlot(nowMs: number, offsetMinutes: number, random: () => number): Schedule {
  const offsetMs = offsetMinutes * 60_000;
  const slots: number[] = [];
  for (
    let start = Math.ceil(nowMs / SLOT_MS) * SLOT_MS;
    start + SLOT_MS <= nowMs + SLOT_WINDOW_MS;
    start += SLOT_MS
  ) {
    const hour = new Date(start + offsetMs).getUTCHours();
    if (hour >= 9 && hour < 18) slots.push(start);
  }
  const startMs =
    slots[Math.floor(random() * slots.length)] ?? Math.ceil(nowMs / SLOT_MS) * SLOT_MS;
  return { startMs, endMs: startMs + SLOT_MS };
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
    status: z.enum(["open", "blocked", "closed"]),
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
  z.object({
    id,
    type: z.literal("move"),
    modelName: z.literal("Entry"),
    entryIds: z.array(id).min(1).max(500),
    threadId: id,
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
      thread.status === "closed" && changes.status === "open"
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

// The threads a transaction can change the turn of.
function touchedThreads(transaction: TransactionInput): string[] {
  if (transaction.type === "create")
    return [transaction.modelName === "Thread" ? transaction.data.id : transaction.data.threadId];
  if (transaction.type === "update") return [transaction.modelId];
  return [];
}

export type EngineOptions = {
  now?: () => number;
  // Picks response slots; injectable so tests are repeatable.
  random?: () => number;
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
  readonly #random: () => number;
  readonly #storage: EngineStorage;
  onActions: ((actions: SyncAction[]) => void) | undefined;

  constructor({
    now = Date.now,
    random = Math.random,
    storage = memoryStorage(),
    onActions,
  }: EngineOptions = {}) {
    this.#now = now;
    this.#random = random;
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
        for (const transaction of fresh) {
          // A response that lands in someone's inbox (made, replied to, reassigned) gets a slot on their schedule.
          const threadIds = touchedThreads(transaction);
          const before = threadIds.map((threadId) => batch.waitingOn(threadId));
          this.#apply(batch, actor, transaction, nowMs, utcOffsetMinutes);
          threadIds.forEach((threadId, index) => {
            const after = batch.waitingOn(threadId);
            const thread = batch.get("Thread", threadId);
            if (after === null || after === before[index] || thread === undefined) return;
            batch.put("Thread", {
              ...thread,
              schedule: randomSlot(nowMs, utcOffsetMinutes, this.#random),
            });
          });
        }
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

    if (transaction.type === "move") {
      const destination = batch.get("Thread", transaction.threadId);
      if (destination === undefined) throw new EngineError(404, "Thread not found");
      const entries = transaction.entryIds.map((entryId) => batch.get("Entry", entryId));
      const messages = entries.filter((entry) => entry?.kind === "message");
      if (messages.length !== entries.length) throw new EngineError(404, "Message not found");
      const sourceId = messages[0].threadId;
      if (messages.some((entry) => entry.threadId !== sourceId))
        throw new EngineError(400, "Messages must come from one thread");
      if (sourceId === destination.id)
        throw new EngineError(400, "Messages are already in that thread");
      // A message linking a thread is the way into it from here; moved inside, it would only link to itself.
      if (messages.some((entry) => entry.text.includes(threadLink(destination.id))))
        throw new EngineError(400, "A message can't move into the thread it links to");
      const source = batch.get("Thread", sourceId);
      if (source === undefined) throw new EngineError(404, "Thread not found");
      for (const entry of messages) batch.put("Entry", { ...entry, threadId: destination.id });
      // The activity line sits where the first moved message was.
      const count = messages.length;
      batch.put("Entry", {
        id: `${transaction.id}:moved`,
        threadId: source.id,
        kind: "event",
        actorId: actor.id,
        text: `moved ${count === 1 ? "a message" : `${count} messages`} to ${threadLink(destination.id)}`,
        createdAtMs: Math.min(...messages.map((entry) => entry.createdAtMs)),
      });
      batch.put("Thread", { ...source, updatedAtMs: nowMs });
      batch.put("Thread", { ...destination, updatedAtMs: nowMs });
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
        status: data.kind === "resolution" ? "closed" : thread.status,
        updatedAtMs: nowMs,
      });
      return;
    }

    const thread = batch.get("Thread", transaction.modelId);
    if (thread === undefined) throw new EngineError(404, "Thread not found");
    const { changes } = transaction;
    if (thread.kind === "response" && changes.schedule !== undefined)
      throw new EngineError(400, "A response's slot comes from the schedule it lands on");
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

  // Gives a slot to any open response that's waiting on someone but has none, such as one made before slots.
  fillMissingSlots(offsetMinutes = 0): void {
    const missing = [...this.models.Thread.values()].filter(
      (thread) =>
        thread.kind === "response" && thread.status !== "closed" && thread.schedule === null,
    );
    if (missing.length === 0) return;
    const nowMs = this.#now();
    this.write((batch) => {
      for (const thread of missing)
        if (batch.waitingOn(thread.id) !== null)
          batch.put("Thread", {
            ...thread,
            schedule: randomSlot(nowMs, offsetMinutes, this.#random),
          });
    });
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
