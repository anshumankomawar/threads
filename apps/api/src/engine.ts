import {
  applyScopedChanges,
  bucketsOf,
  GROUP_TARGET,
  groupMentionsIn,
  mentionsIn,
  descriptionOf,
  inboxPeople,
  lastSentTo,
  entryFromCreate,
  groupFromCreate,
  labelFromCreate,
  formatEffort,
  fromThread,
  labelSlug,
  localPeople,
  MAX_BUCKETS,
  MIN_EFFORT_HOURS,
  MODEL_NAMES,
  plainThreadLinks,
  PRIORITY_LABELS,
  ORGANIZATION_ID,
  sampleGroup,
  samplePeople,
  SEEDED_LABELS,
  sampleThreads,
  STATUS_LABELS,
  threadFromCreate,
  threadLink,
  isDone,
  toThread,
  toThreads,
  type AnyRecord,
  type EntryRecord,
  type Bucket,
  type Label,
  type ModelName,
  type ModelRecords,
  type Person,
  type SyncAction,
  type Thread,
  type ThreadChanges,
  type ThreadRecord,
  type Triage,
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

  // The open threads still blocking a thread.
  openBlockers(threadId: string): ThreadRecord[] {
    return this.all("Thread").filter(
      (thread) => thread.blocksId === threadId && !isDone(thread.status),
    );
  }
}

// --- Validation -------------------------------------------------------------------------------------------

const id = z.string().min(1).max(100);

const threadCreate = z.object({
  id,
  title: z.string().trim().min(1).max(200),
  assigneeIds: z.array(id).max(50).optional(),
  branchedFromId: id.nullable().optional(),
  blocksId: id.nullable().optional(),
  labelIds: z.array(id).optional(),
});

const threadChanges = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    status: z.enum(["open", "blocked", "closed", "archived"]),
    priority: z.enum(["none", "low", "medium", "high", "urgent"]),
    dueAtMs: z.number().int().nullable(),
    effortHours: z.number().min(MIN_EFFORT_HOURS).multipleOf(MIN_EFFORT_HOURS).nullable(),
    labelIds: z
      .array(id)
      .refine((labels) => new Set(labels).size === labels.length, "Labels must be unique"),
    // Scoped to whoever sends them (`applyScopedChanges`).
    seen: z.literal(true),
    done: z.boolean(),
    snoozeUntilMs: z.number().int().nullable(),
    bucketId: id.nullable(),
  })
  .partial();

// Someone's inbox buckets: named, described in plain words for the model, each id once.
const bucket = z.strictObject({
  id,
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(500),
});

const personChanges = z
  .strictObject({
    buckets: z
      .array(bucket)
      .min(1)
      .max(MAX_BUCKETS)
      .refine(
        (buckets) => new Set(buckets.map((bucket) => bucket.id)).size === buckets.length,
        "Bucket ids must be unique",
      ),
  })
  .partial();

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
  sentToIds: z
    .array(id)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, "Each person once")
    .optional(),
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
  if (changes.effortHours !== undefined && changes.effortHours !== thread.effortHours)
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
  return lines;
}

// --- Engine -----------------------------------------------------------------------------------------------

// A record stored by an older version, in today's shape, or null when it no longer has one. Labels were tags; threads
// had schedules and kinds (meetings, focus blocks, conversations: all plain threads now) with call links and notes;
// messages weren't sent to anyone (they're notes); a thread's bucket was one person's rather than one per person; and a
// thread had a requester and one assignee, where now its maker owns it and any number of people are assigned.
function upgrade(modelName: ModelName, data: AnyRecord): AnyRecord | null {
  if (modelName === "Entry") {
    const { kind } = data as { kind: string };
    if (kind === "call" || kind === "notes") return null;
    const entry = data as EntryRecord;
    return entry.kind === "message" ? { ...entry, sentToIds: entry.sentToIds ?? [] } : entry;
  }
  if (modelName !== "Thread") return data;
  type Old = ThreadRecord & {
    tagIds?: string[];
    schedule?: unknown;
    blocks?: unknown;
    workedMinutes?: unknown;
    kind?: string;
    attendeeIds?: string[];
    requesterId?: string;
    assigneeId?: string | null;
    triage: ThreadRecord["triage"] | (Triage & { personId: string }) | null;
  };
  const {
    tagIds,
    schedule: _schedule,
    blocks: _blocks,
    workedMinutes: _workedMinutes,
    kind: _kind,
    attendeeIds: _attendeeIds,
    requesterId,
    assigneeId,
    triage,
    ...thread
  } = data as Old;
  const perPerson = (): ThreadRecord["triage"] => {
    if (triage === null || triage === undefined) return {};
    if (!("personId" in triage)) return triage as ThreadRecord["triage"];
    const { personId, ...sorted } = triage as Triage & { personId: string };
    return { [personId]: sorted };
  };
  return {
    ...thread,
    createdById: thread.createdById ?? requesterId,
    assigneeIds:
      thread.assigneeIds ?? (assigneeId === null || assigneeId === undefined ? [] : [assigneeId]),
    labelIds: thread.labelIds ?? tagIds ?? [],
    triage: perPerson(),
    doneBy: thread.doneBy ?? {},
    snoozedUntil: thread.snoozedUntil ?? {},
  };
}

export type EngineOptions = {
  now?: () => number;
  storage?: EngineStorage;
  // Called after each committed batch with its sync actions, to broadcast them as a delta packet.
  onActions?: (actions: SyncAction[]) => void;
};

// What the model needs to sort one person's inbox: their buckets, the threads in their inbox that aren't sorted
// for them yet, and the ones they placed by hand, as examples of what they mean.
export type TriageRequest = {
  person: Person;
  buckets: Bucket[];
  threads: { id: string; title: string; from: string; text: string }[];
  examples: { title: string; bucketId: string }[];
};

export type TriageResult = { threadId: string; bucketId: string; reason: string };

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

  // Restores models and the sync position from storage, bringing older records up to date.
  load(records: { modelName: ModelName; data: AnyRecord }[], lastSyncId: number): void {
    for (const { modelName, data } of records) {
      const record = upgrade(modelName, data);
      if (record !== null)
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
        for (const transaction of fresh)
          this.#apply(batch, actor, transaction, nowMs, utcOffsetMinutes);
      },
      fresh.map((transaction) => transaction.id),
    );
  }

  // A thread as the app sees it, with its entries and people resolved.
  #view(record: ThreadRecord): Thread {
    const entries = [...this.models.Entry.values()].filter((entry) => entry.threadId === record.id);
    return toThread(record, entries, this.models.Person);
  }

  // Who a thread needs sorting for: everyone whose inbox it's in (`inboxPeople`) without a bucket of theirs, or whose
  // bucket the model chose before something changed (`stale`). Someone sending it to a new person, or deleting a
  // bucket, leaves it unsorted for them.
  #needsTriage(thread: Thread): string[] {
    return inboxPeople(thread).filter((personId) => {
      const triage = thread.triage[personId];
      const buckets = bucketsOf(this.models.Person.get(personId));
      return (
        triage === undefined ||
        triage.stale ||
        !buckets.some((bucket) => bucket.id === triage.bucketId)
      );
    });
  }

  // Everyone with unsorted threads, each with what the model needs. `skip` holds threads to leave for now, such as
  // ones the model just failed on.
  triageRequests(skip: ReadonlySet<string> = new Set()): TriageRequest[] {
    const threads = this.threads();
    const byPerson = new Map<string, Thread[]>();
    for (const thread of threads) {
      if (skip.has(thread.id)) continue;
      for (const personId of this.#needsTriage(thread))
        byPerson.set(personId, [...(byPerson.get(personId) ?? []), thread]);
    }
    // People by id, groups by `group:<id>`.
    const name = (target: string): string | undefined =>
      target.startsWith(GROUP_TARGET)
        ? this.models.Group.get(target.slice(GROUP_TARGET.length))?.name
        : this.models.Person.get(target)?.name;
    const title = (threadId: string): string | undefined => this.models.Thread.get(threadId)?.title;
    const plain = (text: string): string => plainThreadLinks(text, title, name);
    return [...byPerson].flatMap(([personId, waiting]) => {
      const person = this.models.Person.get(personId);
      if (person === undefined) return [];
      const examples = threads.flatMap((thread) => {
        const triage = thread.triage[personId];
        return triage?.manual ? [{ title: thread.title, bucketId: triage.bucketId }] : [];
      });
      return [
        {
          person,
          buckets: bucketsOf(person),
          examples: examples.slice(-20),
          threads: waiting.map((thread) => {
            // What it's about: its description (or first message), and the latest thing sent to them, if anything was.
            const opening =
              descriptionOf(thread) ?? thread.entries.find((entry) => entry.kind === "message");
            const sent = lastSentTo(thread, personId);
            const text = [
              opening?.kind === "message" ? plain(opening.text) : "",
              sent !== undefined && sent !== opening
                ? `${sent.author.name} sent: ${plain(sent.text)}`
                : "",
            ]
              .filter((part) => part !== "")
              .join("\n");
            return {
              id: thread.id,
              title: thread.title,
              from: (sent?.author ?? thread.owner).name,
              text: text.slice(0, 600),
            };
          }),
        },
      ];
    });
  }

  // Saves the model's choices for one person's threads. Any thread that left their inbox, or that they placed by hand,
  // while the model was thinking keeps what it has; a bucket that's gone is ignored.
  applyTriage(personId: string, results: TriageResult[]): SyncAction[] {
    return this.write((batch) => {
      const buckets = bucketsOf(batch.get("Person", personId));
      for (const { threadId, bucketId, reason } of results) {
        const record = batch.get("Thread", threadId);
        if (record === undefined || !this.#needsTriage(this.#view(record)).includes(personId))
          continue;
        if (!buckets.some((bucket) => bucket.id === bucketId)) continue;
        batch.put("Thread", {
          ...record,
          triage: {
            ...record.triage,
            [personId]: {
              bucketId,
              reason: reason.trim().slice(0, 120),
              manual: false,
              stale: false,
            },
          },
        });
      }
    });
  }

  // Puts back what a wipe keeps: the organization, its labels and its groups.
  restore(records: { modelName: ModelName; data: AnyRecord }[]): void {
    this.write((batch) => {
      for (const { modelName, data } of records)
        batch.put(modelName, data as ModelRecords[typeof modelName]);
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
      for (const personId of data.assigneeIds ?? []) requirePerson(personId);
      const parent = data.branchedFromId ? batch.get("Thread", data.branchedFromId) : undefined;
      if (data.branchedFromId && parent === undefined)
        throw new EngineError(404, "Thread not found");
      const blocked = data.blocksId ? batch.get("Thread", data.blocksId) : undefined;
      if (data.blocksId && (blocked === undefined || isDone(blocked.status)))
        throw new EngineError(404, "Thread not found");
      requireLabels(data.labelIds ?? []);
      // A branch or blocker stays in its parent's groups, so a project's blockers don't fall out of the project.
      const inherited = [...(parent?.labelIds ?? []), ...(blocked?.labelIds ?? [])].filter(
        (labelId) => batch.get("Label", labelId)?.groupId != null,
      );
      const made = threadFromCreate(data, actor.id, nowMs);
      batch.put("Thread", {
        ...made,
        labelIds: [...new Set([...made.labelIds, ...inherited])],
      });
      // A blocker blocks the thread it's for until the blocker closes.
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
      // made the thread. No entry takes another thread's id.
      if (data.id === thread.id) {
        if (data.kind !== "message")
          throw new EngineError(400, "A thread's description is a message");
        if (actor.id !== thread.createdById)
          throw new EngineError(403, "Only whoever opened a thread writes its description");
      } else if (batch.get("Thread", data.id) !== undefined)
        throw new EngineError(400, "An entry can't take another thread's id");
      // Sending is to real people, and only a message is sent; anything else is a note in the thread.
      const sentTo = data.sentToIds ?? [];
      if (sentTo.length > 0 && data.kind !== "message")
        throw new EngineError(400, "Only a message is sent to people");
      for (const personId of sentTo) requirePerson(personId);
      batch.put("Entry", entryFromCreate(data, actor.id, nowMs));
      // Whoever a message @mentions is assigned the thread, and a group @mentioned through its label. Mentions of
      // people or groups that don't exist are left as text.
      const mentioned =
        data.kind === "message"
          ? mentionsIn(data.text).filter((personId) => person(personId) !== undefined)
          : [];
      const groupLabels =
        data.kind === "message"
          ? groupMentionsIn(data.text).flatMap((groupId) => {
              const labelId = batch.get("Group", groupId)?.labelId;
              return labelId !== undefined && batch.get("Label", labelId) !== undefined
                ? [labelId]
                : [];
            })
          : [];
      batch.put("Thread", {
        ...thread,
        assigneeIds: [...new Set([...thread.assigneeIds, ...mentioned])],
        labelIds: [...new Set([...thread.labelIds, ...groupLabels])],
        status: data.kind === "resolution" ? "closed" : thread.status,
        updatedAtMs: nowMs,
      });
      return;
    }

    if (transaction.modelName === "Person") {
      const target = person(transaction.modelId);
      if (target === undefined) throw missingUser(transaction.modelId);
      if (target.id !== actor.id)
        throw new EngineError(403, "People change only their own profile");
      // No activity line: a profile isn't a thread.
      batch.put("Person", { ...target, ...transaction.changes });
      // New buckets mean sorting their inbox again, keeping what they placed by hand in buckets that are still there.
      // Threads stay where they are until the model has looked again. Only reordering them changes nothing.
      const { buckets } = transaction.changes;
      const key = (list: Bucket[]): string =>
        JSON.stringify(list.toSorted((a, b) => a.id.localeCompare(b.id)));
      if (buckets !== undefined && key(buckets) !== key(bucketsOf(target)))
        for (const thread of batch.all("Thread")) {
          const { [actor.id]: mine, ...others } = thread.triage;
          if (mine === undefined) continue;
          const kept = buckets.some((bucket) => bucket.id === mine.bucketId);
          if (!kept) batch.put("Thread", { ...thread, triage: others });
          else if (!mine.manual)
            batch.put("Thread", {
              ...thread,
              triage: { ...others, [actor.id]: { ...mine, stale: true } },
            });
        }
      return;
    }
    const thread = batch.get("Thread", transaction.modelId);
    if (thread === undefined) throw new EngineError(404, "Thread not found");
    const { changes } = transaction;
    if (changes.labelIds !== undefined) requireLabels(changes.labelIds);
    // Changes that are only about you (seen, done, snoozed, placed in one of your buckets) are quiet: no activity
    // line, and they don't count as an update. You place only what's in your inbox, into a bucket of yours.
    if (changes.bucketId !== undefined && changes.bucketId !== null) {
      if (!inboxPeople(this.#view(thread)).includes(actor.id))
        throw new EngineError(400, "Only a thread in your inbox goes in your buckets");
      if (!bucketsOf(actor).some((bucket) => bucket.id === changes.bucketId))
        throw new EngineError(404, "Bucket not found");
    }
    const { record: scoped, rest: edits } = applyScopedChanges(thread, changes, actor.id, nowMs);
    if (scoped !== thread) batch.put("Thread", scoped);
    const current = scoped;
    const lines = describeChanges(
      current,
      edits,
      (labelId) => batch.get("Label", labelId),
      offsetMinutes,
    );
    if (lines.length === 0) return;
    // A new title can mean a different bucket for everyone, except where they placed it by hand.
    const triage =
      edits.title === undefined
        ? current.triage
        : Object.fromEntries(
            Object.entries(current.triage).map(([personId, sorted]) => [
              personId,
              sorted.manual ? sorted : { ...sorted, stale: true },
            ]),
          );
    batch.put("Thread", { ...current, ...edits, triage, updatedAtMs: nowMs });
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

    // Closing (or archiving) the last open blocker unblocks the thread it was for.
    const blocked = thread.blocksId ? batch.get("Thread", thread.blocksId) : undefined;
    if (
      changes.status !== undefined &&
      isDone(changes.status) &&
      blocked?.status === "blocked" &&
      batch.openBlockers(blocked.id).length === 0
    ) {
      batch.put("Thread", { ...blocked, status: "open", updatedAtMs: nowMs });
      // Mirrors "is blocked on …", in its owner's name.
      batch.put("Entry", {
        id: `${transaction.id}:unblocked`,
        threadId: blocked.id,
        kind: "event",
        actorId: blocked.createdById,
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

// Fills an empty workspace with its starting data.
export function seed(
  engine: SyncEngine,
  workspace: WorkspaceName,
  me: Person,
  nowMs = Date.now(),
): void {
  engine.write((batch) => {
    for (const person of seedPeople(workspace, me)) batch.put("Person", person);
    if (workspace !== "sample") return;
    const { group, label } = sampleGroup(me, nowMs);
    batch.put("Group", group);
    batch.put("Label", label);
    for (const sample of sampleThreads(me, nowMs)) {
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
    const buckets = engine.models.Person.get(person.id)?.buckets;
    return buckets === undefined ? person : { ...person, buckets };
  });
  const changed = refreshed.filter(
    (person) => JSON.stringify(engine.models.Person.get(person.id)) !== JSON.stringify(person),
  );
  if (changed.length > 0)
    engine.write((batch) => {
      for (const person of changed) batch.put("Person", person);
    });
}
