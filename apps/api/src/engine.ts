import {
  askerId,
  DUMMY_ZOOM_LINK,
  entryFromCreate,
  groupFromCreate,
  labelFromCreate,
  formatEffort,
  fromThread,
  labelSlug,
  levelPositions,
  localPeople,
  conversationStartedId,
  mentionsIn,
  MIN_EFFORT_HOURS,
  MODEL_NAMES,
  PRIORITY_LABELS,
  recordBlocks,
  ORGANIZATION_ID,
  sampleGroup,
  samplePeople,
  SEEDED_LABELS,
  sampleThreads,
  STATUS_LABELS,
  threadFromCreate,
  threadLink,
  threadScore,
  isDone,
  toThread,
  toThreads,
  workdayOf,
  type AnyRecord,
  type Label,
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
import {
  catchUpTimes,
  MIN_BLOCK_MINUTES,
  minutesSpent,
  planSchedule,
  workingSlots,
} from "./scheduler.ts";

// Each workspace is its own sync group: its own people, threads and sync ids. "local" starts with a few people
// and no threads, for trying the app as each of them; "sample" is the demo team with their threads.
export const WORKSPACES = ["local", "sample"] as const;
export type WorkspaceName = (typeof WORKSPACES)[number];

export const isWorkspaceName = (name: string): name is WorkspaceName =>
  (WORKSPACES as readonly string[]).includes(name);

// A failed request: the status to answer with, and why.
export class EngineError extends Error {
  readonly status: 400 | 403 | 404 | 409;

  constructor(status: 400 | 403 | 404 | 409, message: string) {
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
  Organization: new Map(),
  Label: new Map(),
  Group: new Map(),
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

  // Every record of a model, counting staged writes.
  all<Name extends ModelName>(modelName: Name): ModelRecords[Name][] {
    const records: ModelRecords[Name][] = [];
    for (const id of this.#models[modelName].keys()) {
      const record = this.get(modelName, id);
      if (record !== undefined) records.push(record);
    }
    for (const { modelName: name, id, data } of this.writes.values())
      if (name === modelName && data !== null && !this.#models[modelName].has(id))
        records.push(data as ModelRecords[Name]);
    return records;
  }

  // A thread that's done closes the conversations still open in it, each saying why.
  closeConversations(
    threadId: string,
    actorId: string,
    nowMs: number,
    transactionId: string,
  ): void {
    for (const conversation of this.all("Thread"))
      if (
        conversation.kind === "conversation" &&
        conversation.branchedFromId === threadId &&
        !isDone(conversation.status)
      ) {
        this.put("Thread", { ...conversation, status: "closed", updatedAtMs: nowMs });
        this.put("Entry", {
          id: `${transactionId}:closed:${conversation.id}`,
          threadId: conversation.id,
          kind: "event",
          actorId,
          text: `closed with ${threadLink(threadId)}`,
          createdAtMs: nowMs,
        });
      }
  }

  // Whose inbox a response is in, the same rule as `waitingOn` in the model.
  waitingOn(threadId: string): string | null {
    const thread = this.get("Thread", threadId);
    if (thread === undefined || thread.kind !== "response") return null;
    return thread.assigneeId ?? thread.requesterId;
  }

  // The open threads still blocking a thread.
  openBlockers(threadId: string): ThreadRecord[] {
    return this.all("Thread").filter(
      (thread) => thread.blocksId === threadId && !isDone(thread.status),
    );
  }
}

// --- Validation -------------------------------------------------------------------------------------------

const id = z.string().min(1).max(100);
const schedule = z
  .object({ startMs: z.number().int(), endMs: z.number().int() })
  .refine(({ startMs, endMs }) => endMs > startMs, "endMs must be after startMs");

const threadCreate = z.object({
  id,
  kind: z.enum(["response", "meeting", "focus", "conversation"]),
  title: z.string().trim().min(1).max(200),
  assigneeId: id.nullable(),
  attendeeIds: z.array(id),
  schedule: schedule.nullable(),
  branchedFromId: id.nullable().optional(),
  blocksId: id.nullable().optional(),
  onBehalfOfId: id.nullable().optional(),
  labelIds: z.array(id).optional(),
});

const threadChanges = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    requesterId: id,
    assigneeId: id,
    status: z.enum(["open", "blocked", "closed", "archived"]),
    priority: z.enum(["none", "low", "medium", "high", "urgent"]),
    dueAtMs: z.number().int().nullable(),
    effortHours: z.number().min(MIN_EFFORT_HOURS).multipleOf(MIN_EFFORT_HOURS).nullable(),
    labelIds: z
      .array(id)
      .refine((labels) => new Set(labels).size === labels.length, "Labels must be unique"),
    schedule: schedule.nullable(),
    seen: z.literal(true),
  })
  .partial();

const halfHour = z.strictObject({
  hour: z.number().int().min(0).max(23),
  minute: z.union([z.literal(0), z.literal(30)]),
});

// Someone's working day: whole hours, at least one long, with catch-up half hours inside it.
const workday = z
  .strictObject({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    catchUp: z.array(halfHour).max(4),
  })
  .refine((day) => day.startHour < day.endHour, "The working day must end after it starts")
  .refine(
    (day) => day.catchUp.every(({ hour }) => hour >= day.startHour && hour < day.endHour),
    "Catch-up times must be in working hours",
  );

const personChanges = z.strictObject({ workday }).partial();

const labelName = z.string().trim().min(1).max(80);

const labelCreate = z.object({ id, name: labelName });

const groupCreate = z.object({ id, name: labelName, memberIds: z.array(id) });

const groupChanges = z
  .strictObject({ name: labelName, memberIds: z.array(id), archived: z.boolean() })
  .partial();

const organizationChanges = z.strictObject({ name: z.string().trim().min(1).max(100) });

const entryCreate = z.object({
  id,
  threadId: id,
  kind: z.enum(["message", "resolution"]),
  text: z.string().trim().min(1),
});

export const transactionInput = z.union([
  z.object({ id, type: z.literal("create"), modelName: z.literal("Thread"), data: threadCreate }),
  z.object({ id, type: z.literal("create"), modelName: z.literal("Entry"), data: entryCreate }),
  z.object({ id, type: z.literal("create"), modelName: z.literal("Label"), data: labelCreate }),
  z.object({ id, type: z.literal("create"), modelName: z.literal("Group"), data: groupCreate }),
  z.object({
    id,
    type: z.literal("update"),
    modelName: z.literal("Thread"),
    modelId: id,
    changes: threadChanges,
  }),
  z.object({
    id,
    type: z.literal("update"),
    modelName: z.literal("Person"),
    modelId: id,
    changes: personChanges,
  }),
  z.object({
    id,
    type: z.literal("update"),
    modelName: z.literal("Group"),
    modelId: id,
    changes: groupChanges,
  }),
  z.object({
    id,
    type: z.literal("update"),
    modelName: z.literal("Organization"),
    modelId: id,
    changes: organizationChanges,
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
  labelOf: (id: string) => Label | undefined,
  offsetMinutes: number,
): string[] {
  const lines: string[] = [];
  if (changes.title !== undefined && changes.title !== thread.title)
    lines.push(`renamed this to “${changes.title}”`);
  if (changes.status !== undefined && changes.status !== thread.status)
    lines.push(
      changes.status === "archived"
        ? "archived this"
        : isDone(thread.status) && changes.status === "open"
          ? "reopened this"
          : thread.status === "archived"
            ? "unarchived this"
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
  if (changes.requesterId !== undefined && changes.requesterId !== thread.requesterId)
    lines.push(`made ${people(changes.requesterId)?.name ?? changes.requesterId} the requester`);
  if (changes.effortHours !== undefined && changes.effortHours !== (thread.effortHours ?? null))
    lines.push(
      changes.effortHours === null
        ? "removed the estimate"
        : `estimated this at ${formatEffort(changes.effortHours)}`,
    );
  if (changes.labelIds !== undefined) {
    const before = thread.labelIds ?? [];
    const after = changes.labelIds;
    for (const labelId of [...before, ...after].filter((id, at, all) => all.indexOf(id) === at)) {
      const label = labelOf(labelId);
      if (label === undefined || before.includes(labelId) === after.includes(labelId)) continue;
      const inGroup = label.groupId !== null;
      if (after.includes(labelId))
        lines.push(inGroup ? `added this to ${label.name}` : `labelled this ${label.name}`);
      else
        lines.push(inGroup ? `removed this from ${label.name}` : `removed the ${label.name} label`);
    }
  }
  if (changes.schedule !== undefined && changes.schedule?.startMs !== thread.schedule?.startMs)
    lines.push(
      changes.schedule === null
        ? "removed it from the schedule"
        : `scheduled this for ${localTime(changes.schedule.startMs, offsetMinutes, { weekday: "short", hour: "numeric", minute: "2-digit" })}`,
    );
  return lines;
}

// --- Engine -----------------------------------------------------------------------------------------------

// The threads a transaction changes, which a schedule might have to answer to.
function touchedThreads(batch: Batch, transaction: TransactionInput): string[] {
  // A blocker reaches the thread it blocks: making one blocks it, and closing it can unblock it.
  if (transaction.type === "create" && transaction.modelName === "Thread")
    return [transaction.data.id, ...(transaction.data.blocksId ? [transaction.data.blocksId] : [])];
  if (transaction.type === "create")
    return transaction.modelName === "Entry" ? [transaction.data.threadId] : [];
  if (transaction.type === "update" && transaction.modelName !== "Thread") return [];
  if (transaction.type === "update") {
    const blocksId = batch.get("Thread", transaction.modelId)?.blocksId;
    return [transaction.modelId, ...(blocksId ? [blocksId] : [])];
  }
  const sources = transaction.entryIds.flatMap((entryId) => {
    const entry = batch.get("Entry", entryId);
    return entry === undefined ? [] : [entry.threadId];
  });
  return [transaction.threadId, ...sources];
}

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
    for (const { modelName, data } of records) {
      // Threads stored when labels were called tags.
      const record =
        modelName === "Thread" && "tagIds" in data
          ? (({ tagIds, ...thread }) => ({ ...thread, labelIds: tagIds }))(
              data as ThreadRecord & { tagIds: string[] },
            )
          : data;
      (this.models[modelName] as Map<string, AnyRecord>).set(record.id, record);
    }
    this.lastSyncId = lastSyncId;
  }

  get nowMs(): number {
    return this.#now();
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
        const turnBefore = new Map<string, string | null>();
        // People whose working day changed, whose schedules follow it.
        const replanned = new Set<string>();
        for (const transaction of fresh) {
          if (transaction.type === "update" && transaction.modelName === "Person")
            replanned.add(transaction.modelId);
          for (const threadId of touchedThreads(batch, transaction))
            if (!turnBefore.has(threadId)) turnBefore.set(threadId, batch.waitingOn(threadId));
          this.#apply(batch, actor, transaction, nowMs, utcOffsetMinutes);
        }
        this.#replanAfter(batch, turnBefore, replanned, nowMs);
      },
      fresh.map((transaction) => transaction.id),
    );
  }

  // Reschedules everyone these changes affect. A response handed to someone gives up the slot it had on the other
  // person's schedule. Closing a thread reschedules nobody: its slot stays a gap until the next change.
  #replanAfter(
    batch: Batch,
    turnBefore: Map<string, string | null>,
    replanned: Set<string>,
    nowMs: number,
  ): void {
    const affected = new Set(replanned);
    for (const [threadId, before] of turnBefore) {
      const thread = batch.get("Thread", threadId);
      if (thread === undefined || isDone(thread.status)) continue;
      if (thread.kind !== "response") {
        for (const person of [...thread.attendeeIds, thread.assigneeId ?? thread.requesterId])
          affected.add(person);
        continue;
      }
      const turn = batch.waitingOn(threadId);
      if (turn === null) continue;
      if (turn !== before && recordBlocks(thread).length > 0) {
        // Time the assignee has put in so far still counts when the thread comes back to them.
        const worked = before === thread.assigneeId ? minutesSpent(recordBlocks(thread), nowMs) : 0;
        batch.put("Thread", {
          ...thread,
          schedule: null,
          blocks: [],
          workedMinutes: (thread.workedMinutes ?? 0) + worked,
        });
      }
      affected.add(turn);
    }
    for (const person of affected) this.#plan(batch, person, nowMs);
  }

  // Lays out one person's schedule: the open responses waiting on them, around their meetings and focus blocks. Only
  // threads whose blocks actually change are written. Blocked threads give up what's left of their blocks until
  // they're unblocked.
  //
  // Blocks that have ended count as work done. An estimate is the assignee's work, so it sets their time only; anyone
  // else the thread is waiting on, or a thread with no estimate or with its estimate used up, gets the shortest block.
  #plan(batch: Batch, personId: string, nowMs: number): void {
    const workday = workdayOf(batch.get("Person", personId));
    const slots = workingSlots(nowMs, workday);
    const threads = batch.all("Thread").filter((thread) => !isDone(thread.status));
    const levelOf = levelPositions(batch.all("Person"));
    const waiting = threads.filter(
      (thread) => batch.waitingOn(thread.id) === personId && thread.kind === "response",
    );
    const open = waiting.filter((thread) => thread.status === "open");
    const fixed = threads.flatMap((thread) => {
      if (thread.schedule === null || thread.kind === "response") return [];
      const mine =
        thread.kind === "meeting"
          ? thread.attendeeIds.includes(personId)
          : (thread.assigneeId ?? thread.requesterId) === personId;
      return mine ? [thread.schedule] : [];
    });
    const over = (thread: ThreadRecord): Schedule[] =>
      recordBlocks(thread).filter((block) => block.endMs <= nowMs);
    const plan = planSchedule(
      open.map((thread) => {
        const estimate = thread.assigneeId === personId ? (thread.effortHours ?? null) : null;
        const worked = (thread.workedMinutes ?? 0) + minutesSpent(over(thread), nowMs);
        return {
          id: thread.id,
          score: threadScore(
            thread,
            levelOf(askerId(thread.requesterId, thread.assigneeId, personId)),
            nowMs,
          ),
          minutes:
            estimate === null
              ? MIN_BLOCK_MINUTES
              : Math.max(estimate * 60 - worked, MIN_BLOCK_MINUTES),
          blocks: recordBlocks(thread).filter((block) => block.endMs > nowMs),
        };
      }),
      [...fixed, ...catchUpTimes(slots, workday.catchUp)],
      nowMs,
      slots,
    );
    for (const thread of waiting) {
      const upcoming = plan.get(thread.id) ?? [];
      const blocks = [...over(thread), ...upcoming];
      const schedule = upcoming[0] ?? null;
      if (
        JSON.stringify(blocks) !== JSON.stringify(thread.blocks) ||
        JSON.stringify(schedule) !== JSON.stringify(thread.schedule)
      )
        batch.put("Thread", { ...thread, schedule, blocks });
    }
  }

  // Puts back what a wipe keeps: the organization, its labels and its groups.
  restore(records: { modelName: ModelName; data: AnyRecord }[]): void {
    this.write((batch) => {
      for (const { modelName, data } of records)
        batch.put(modelName, data as ModelRecords[typeof modelName]);
    });
  }

  // Looks over every schedule: on load, and each morning, when due dates have drawn closer and slots have passed.
  replanAll(): void {
    const nowMs = this.#now();
    this.write((batch) => {
      const people = new Set(
        batch
          .all("Thread")
          .filter((thread) => thread.kind === "response" && !isDone(thread.status))
          .flatMap((thread) => batch.waitingOn(thread.id) ?? []),
      );
      for (const person of people) this.#plan(batch, person, nowMs);
    });
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
    const requireLabels = (labelIds: string[]): void => {
      for (const labelId of labelIds)
        if (batch.get("Label", labelId) === undefined)
          throw new EngineError(404, `Label not found: ${labelId}`);
    };
    // Whether a label other than `exceptId` already has this name, however it's capitalized or punctuated.
    const nameTaken = (slug: string, exceptId?: string): boolean =>
      batch
        .all("Label")
        .some(
          (label) => label.id !== exceptId && (label.id === slug || labelSlug(label.name) === slug),
        );

    // Making a label that exists does nothing, so a thread made with it in the same batch isn't refused along with it.
    if (transaction.type === "create" && transaction.modelName === "Label") {
      const { data } = transaction;
      const slug = labelSlug(data.name);
      if (slug === "" || data.id !== slug)
        throw new EngineError(400, "A label's id comes from its name");
      const existing = batch.get("Label", slug);
      if (existing !== undefined && labelSlug(existing.name) === slug) return;
      if (nameTaken(slug)) throw new EngineError(409, `That label name is taken: ${data.name}`);
      batch.put("Label", labelFromCreate(data, actor.id, nowMs));
      return;
    }

    if (transaction.type === "create" && transaction.modelName === "Group") {
      const { data } = transaction;
      if (batch.get("Group", data.id) !== undefined)
        throw new EngineError(409, `Group already exists: ${data.id}`);
      const slug = labelSlug(data.name);
      if (slug === "") throw new EngineError(400, "A group's name needs a letter or number");
      if (nameTaken(slug)) throw new EngineError(409, `That name is taken: ${data.name}`);
      for (const member of data.memberIds) requirePerson(member);
      const group = groupFromCreate(data, actor.id, nowMs);
      const others = group.memberIds.filter((member) => member !== actor.id);
      batch.put("Group", {
        ...group,
        activity: [
          { actorId: actor.id, text: "created this group", targetIds: [], atMs: nowMs },
          ...(others.length === 0
            ? []
            : [
                {
                  actorId: actor.id,
                  text: `added ${others.map((member) => person(member)?.name ?? member).join(", ")}`,
                  targetIds: others,
                  atMs: nowMs,
                },
              ]),
        ],
      });
      batch.put("Label", {
        ...labelFromCreate({ id: slug, name: data.name }, actor.id, nowMs),
        groupId: data.id,
      });
      return;
    }

    if (transaction.type === "update" && transaction.modelName === "Organization") {
      const organization = batch.get("Organization", transaction.modelId);
      if (organization === undefined) throw new EngineError(404, "Organization not found");
      batch.put("Organization", { ...organization, ...transaction.changes });
      return;
    }

    if (transaction.type === "update" && transaction.modelName === "Group") {
      const group = batch.get("Group", transaction.modelId);
      if (group === undefined) throw new EngineError(404, "Group not found");
      const { changes } = transaction;
      const memberIds = changes.memberIds;
      if (memberIds !== undefined) {
        if (new Set(memberIds).size !== memberIds.length)
          throw new EngineError(400, "Members must be unique");
        if (memberIds.length === 0)
          throw new EngineError(400, "A group needs a member; archive it instead");
        for (const member of memberIds) requirePerson(member);
      }
      const added = (memberIds ?? []).filter((member) => !group.memberIds.includes(member));
      const removed =
        memberIds === undefined
          ? []
          : group.memberIds.filter((member) => !memberIds.includes(member));
      // Any member can change a group. Anyone else can only join it.
      const joining =
        Object.keys(changes).length === 1 &&
        added.length === 1 &&
        added[0] === actor.id &&
        removed.length === 0;
      if (!group.memberIds.includes(actor.id) && !joining)
        throw new EngineError(403, "Only a group's members can change it");

      const names = (ids: string[]): string =>
        ids.map((member) => person(member)?.name ?? member).join(", ");
      const lines: { text: string; targetIds: string[] }[] = [];
      if (added.includes(actor.id)) lines.push({ text: "joined", targetIds: [] });
      const addedOthers = added.filter((member) => member !== actor.id);
      if (addedOthers.length > 0)
        lines.push({ text: `added ${names(addedOthers)}`, targetIds: addedOthers });
      if (removed.includes(actor.id)) lines.push({ text: "left", targetIds: [] });
      const removedOthers = removed.filter((member) => member !== actor.id);
      if (removedOthers.length > 0)
        lines.push({ text: `removed ${names(removedOthers)}`, targetIds: [] });
      if (changes.name !== undefined && changes.name !== group.name) {
        const slug = labelSlug(changes.name);
        if (slug === "") throw new EngineError(400, "A group's name needs a letter or number");
        if (nameTaken(slug, group.labelId))
          throw new EngineError(409, `That name is taken: ${changes.name}`);
        const label = batch.get("Label", group.labelId);
        if (label !== undefined) batch.put("Label", { ...label, name: changes.name });
        lines.push({ text: `renamed this to “${changes.name}”`, targetIds: [] });
      }
      if (changes.archived !== undefined && changes.archived !== group.archived)
        lines.push({ text: changes.archived ? "archived this" : "unarchived this", targetIds: [] });
      if (lines.length === 0) return;
      batch.put("Group", {
        ...group,
        ...changes,
        updatedAtMs: nowMs,
        activity: [
          ...group.activity,
          ...lines.map((line) => ({ ...line, actorId: actor.id, atMs: nowMs })),
        ],
      });
      return;
    }

    if (transaction.type === "create" && transaction.modelName === "Thread") {
      const { data } = transaction;
      if (batch.get("Thread", data.id) !== undefined)
        throw new EngineError(409, `Thread already exists: ${data.id}`);
      if (data.assigneeId !== null) requirePerson(data.assigneeId);
      for (const attendee of data.attendeeIds) requirePerson(attendee);
      const parent = data.branchedFromId ? batch.get("Thread", data.branchedFromId) : undefined;
      if (data.branchedFromId && parent === undefined)
        throw new EngineError(404, "Thread not found");
      // A conversation is with the people mentioned, inside an open thread that isn't itself a conversation (mentioning
      // someone in a conversation adds them to it instead).
      if (data.kind === "conversation") {
        if (parent === undefined || parent.kind === "conversation" || isDone(parent.status))
          throw new EngineError(400, "A conversation starts in an open thread");
        if (data.attendeeIds.every((id) => id === actor.id))
          throw new EngineError(400, "A conversation needs someone to talk to");
        if (data.assigneeId !== null || data.schedule !== null)
          throw new EngineError(400, "A conversation has no assignee or time");
      }
      const blocked = data.blocksId ? batch.get("Thread", data.blocksId) : undefined;
      if (data.blocksId && (blocked === undefined || isDone(blocked.status)))
        throw new EngineError(404, "Thread not found");
      // Asking on someone's behalf makes them the requester; who really made it stays on record.
      const onBehalfOf = data.onBehalfOfId === actor.id ? null : (data.onBehalfOfId ?? null);
      if (onBehalfOf !== null) {
        if (data.kind !== "response")
          throw new EngineError(400, "Only a thread can be made on someone's behalf");
        requirePerson(onBehalfOf);
      }
      if (data.kind === "conversation" && (data.labelIds ?? []).length > 0)
        throw new EngineError(400, "A conversation has no labels");
      requireLabels(data.labelIds ?? []);
      // A branch or blocker stays in its parent's groups, so a project's blockers don't fall out of the project.
      const inherited =
        data.kind === "conversation"
          ? []
          : [...(parent?.labelIds ?? []), ...(blocked?.labelIds ?? [])].filter(
              (labelId) => batch.get("Label", labelId)?.groupId != null,
            );
      const made = threadFromCreate(data, actor.id, nowMs);
      batch.put("Thread", {
        ...made,
        labelIds: [...new Set([...made.labelIds, ...inherited])],
      });
      if (onBehalfOf !== null)
        batch.put("Entry", {
          id: `${data.id}:on-behalf`,
          threadId: data.id,
          kind: "event",
          actorId: actor.id,
          text: `created this on behalf of ${person(onBehalfOf)?.name ?? onBehalfOf}`,
          createdAtMs: nowMs,
        });
      // A blocker blocks the thread it's for, which comes off the schedule until the blocker closes.
      if (blocked !== undefined) {
        batch.put("Thread", { ...blocked, status: "blocked", updatedAtMs: nowMs });
        batch.put("Entry", {
          id: `${data.id}:blocks`,
          threadId: blocked.id,
          kind: "event",
          actorId: actor.id,
          text: `is blocked on ${threadLink(data.id)}`,
          createdAtMs: nowMs,
        });
      }
      // The thread it started in says so in a message from whoever started it, linking to it.
      if (data.kind === "conversation" && parent !== undefined) {
        batch.put("Entry", {
          id: conversationStartedId(data.id),
          threadId: parent.id,
          kind: "message",
          authorId: actor.id,
          text: `Started a conversation ${threadLink(data.id)}`,
          createdAtMs: nowMs,
        });
        batch.put("Thread", { ...parent, updatedAtMs: nowMs });
      }
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
      if (messages.some((entry) => entry.id === entry.threadId))
        throw new EngineError(400, "A thread's description stays with it");
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
      // An entry with its thread's id is the thread's description (`descriptionOf`): a message, written by whoever
      // made the thread, who may have made it on someone's behalf. No entry takes another thread's id.
      if (data.id === thread.id) {
        if (data.kind !== "message")
          throw new EngineError(400, "A thread's description is a message");
        if (actor.id !== (thread.createdById ?? thread.requesterId))
          throw new EngineError(403, "Only whoever opened a thread writes its description");
      } else if (batch.get("Thread", data.id) !== undefined)
        throw new EngineError(400, "An entry can't take another thread's id");
      // Entries sort by time, so one made in the same batch as its thread still comes after the call link.
      batch.put("Entry", entryFromCreate(data, actor.id, nowMs));
      // Mentioning someone in a conversation brings them into it.
      const joining =
        thread.kind === "conversation" && data.kind === "message"
          ? mentionsIn(data.text).filter(
              (id) => !thread.attendeeIds.includes(id) && person(id) !== undefined,
            )
          : [];
      batch.put("Thread", {
        ...thread,
        attendeeIds: [...thread.attendeeIds, ...joining],
        status: data.kind === "resolution" ? "closed" : thread.status,
        updatedAtMs: nowMs,
      });
      if (joining.length > 0)
        batch.put("Entry", {
          id: `${data.id}:added`,
          threadId: thread.id,
          kind: "event",
          actorId: actor.id,
          text: `added ${joining.map((id) => person(id)?.name ?? id).join(", ")}`,
          createdAtMs: nowMs,
        });
      if (data.kind === "resolution")
        batch.closeConversations(thread.id, actor.id, nowMs, transaction.id);
      return;
    }

    if (transaction.modelName === "Person") {
      const target = person(transaction.modelId);
      if (target === undefined) throw missingUser(transaction.modelId);
      if (target.id !== actor.id)
        throw new EngineError(403, "People change only their own profile");
      // No activity line: a profile isn't a thread. Their schedule follows in the same batch (`#replanAfter`).
      batch.put("Person", { ...target, ...transaction.changes });
      return;
    }
    const thread = batch.get("Thread", transaction.modelId);
    if (thread === undefined) throw new EngineError(404, "Thread not found");
    const { changes } = transaction;
    if (thread.kind === "response" && changes.schedule !== undefined)
      throw new EngineError(400, "A response's slot comes from the schedule it lands on");
    if (changes.assigneeId !== undefined && changes.assigneeId !== null)
      requirePerson(changes.assigneeId);
    if (changes.requesterId !== undefined) {
      if (thread.kind !== "response")
        throw new EngineError(400, "Only a thread has a requester to change");
      requirePerson(changes.requesterId);
    }
    if (changes.labelIds !== undefined) {
      if (thread.kind === "conversation")
        throw new EngineError(400, "A conversation has no labels");
      requireLabels(changes.labelIds);
    }
    // Opening a thread marks it seen, quietly: no activity line, and it doesn't count as an update.
    const { seen, ...edits } = changes;
    if (seen) batch.put("Thread", { ...thread, seenBy: { ...thread.seenBy, [actor.id]: nowMs } });
    const current = batch.get("Thread", thread.id) ?? thread;
    const lines = describeChanges(
      current,
      edits,
      actor,
      person,
      (labelId) => batch.get("Label", labelId),
      offsetMinutes,
    );
    if (lines.length === 0) return;
    batch.put("Thread", { ...current, ...edits, updatedAtMs: nowMs });
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

    if (changes.status !== undefined && isDone(changes.status))
      batch.closeConversations(thread.id, actor.id, nowMs, transaction.id);

    // Closing (or archiving) the last open blocker unblocks the thread it was for, which goes back on the schedule.
    const blocked = thread.blocksId ? batch.get("Thread", thread.blocksId) : undefined;
    if (
      changes.status !== undefined &&
      isDone(changes.status) &&
      blocked?.status === "blocked" &&
      batch.openBlockers(blocked.id).length === 0
    ) {
      batch.put("Thread", { ...blocked, status: "open", updatedAtMs: nowMs });
      // Mirrors "is blocked on …": whoever has the thread is unblocked.
      batch.put("Entry", {
        id: `${transaction.id}:unblocked`,
        threadId: blocked.id,
        kind: "event",
        actorId: blocked.assigneeId ?? blocked.requesterId,
        text: `is unblocked, ${threadLink(thread.id)} is ${changes.status === "archived" ? "archived" : "closed"}`,
        createdAtMs: nowMs,
      });
    }
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
    const { group, label } = sampleGroup(me, nowMs);
    batch.put("Group", group);
    batch.put("Label", label);
    for (const sample of sampleThreads(me, nowMs, utcOffsetMinutes)) {
      const { thread, entries } = fromThread(sample);
      batch.put("Thread", thread);
      for (const entry of entries) batch.put("Entry", entry);
    }
  });
}

// Makes sure a workspace has its organization and the seeded labels, including one that was stored before they existed.
// The local organization starts unnamed, for whoever opens it first to name.
export function ensureOrganization(engine: SyncEngine, workspace: WorkspaceName): void {
  const nowMs = engine.nowMs;
  engine.write((batch) => {
    if (batch.get("Organization", ORGANIZATION_ID) === undefined)
      batch.put("Organization", {
        id: ORGANIZATION_ID,
        name: workspace === "sample" ? "Sample Organization" : "",
      });
    for (const { id, name } of SEEDED_LABELS)
      if (batch.get("Label", id) === undefined)
        batch.put("Label", { id, name, groupId: null, createdById: null, createdAtMs: nowMs });
  });
}

// Keeps the seeded people in step with the code (their levels and managers can change), since nothing edits them
// through the API. Threads and people added through the API stay as they are.
export function refreshSeedPeople(engine: SyncEngine, workspace: WorkspaceName, me: Person): void {
  // Seeds set who people are; what they've set on their profile stays.
  const refreshed = seedPeople(workspace, me).map((person) => {
    const workday = engine.models.Person.get(person.id)?.workday;
    return workday === undefined ? person : { ...person, workday };
  });
  const changed = refreshed.filter(
    (person) => JSON.stringify(engine.models.Person.get(person.id)) !== JSON.stringify(person),
  );
  if (changed.length > 0)
    engine.write((batch) => {
      for (const person of changed) batch.put("Person", person);
    });
}
