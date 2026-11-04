import {
  ALL_GROUPS,
  isBuiltIn,
  visibleIn,
  type AnyRecord,
  type BootstrapResponse,
  type BuiltInTransaction,
  type DeltasResponse,
  type Ephemeral,
  type LoadRequest,
  type LoadResponse,
  type ModelName,
  type Models,
  type ModelSet,
  type SyncAction,
  type SyncMessage,
  type SyncPosition,
  type TransactionBatch,
  type TransactionEnvelope,
} from "../protocol";
import {
  groupDependents,
  loadStrategy,
  modelNames,
  schemaHash,
  syncGroupsOf,
  WORKSPACE_GROUP,
  type Lookup,
  type SyncSchema,
} from "../schema";
import { Batch, emptyModels, type ModelMaps } from "./batch";
import { memoryStorage, type LoggedAction, type SyncStorage } from "./storage";

// Who's asking. A user's session sees their sync groups and acts only as them. An admin session (an operator's token,
// or local development with no auth) sees everything and may act as anyone.
export type Session = { userId: string } | { admin: true };

export const isAdmin = (session: Session): session is { admin: true } => "admin" in session;

// A refusal: the whole batch is rolled back and the client told why, with this HTTP status.
export class SyncError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 426;

  constructor(status: SyncError["status"], message: string) {
    super(message);
    this.status = status;
  }
}

export type ApplyContext = {
  actorId: string;
  nowMs: number;
  utcOffsetMinutes: number;
  session: Session;
};

// What the server reports as it works, for logs and metrics.
export type ServerEvent =
  | {
      type: "committed";
      fromSyncId: number;
      lastSyncId: number;
      actions: number;
      transactions: number;
    }
  | { type: "refused"; status: number; message: string; transactions: number }
  // A rule threw something other than a `SyncError`: a bug in the product's rules, refused like any bad batch (422) so
  // the client doesn't retry it forever.
  | { type: "failed"; message: string; transactions: number }
  | { type: "compacted"; throughSyncId: number };

export type ServerOptions<M extends Models, T extends TransactionEnvelope> = {
  schema: SyncSchema<M>;
  // Runs one transaction of a batch: checks it, and stages its writes and side effects. Throwing a `SyncError` refuses
  // the batch. It's also handed the built-in delete, archive and unarchive transactions, to allow or refuse; the engine
  // has already checked the target exists, that the session can see it, and that it's in a state to change.
  apply: (batch: Batch<M>, transaction: T | BuiltInTransaction<M>, context: ApplyContext) => void;
  storage?: SyncStorage<M>;
  now?: () => number;
  // The sync groups a user is in. Everyone is in the workspace group by default.
  groupsFor?: (userId: string, models: ModelMaps<M>) => string[];
  // A record stored by an older version, in today's shape, or null to drop it.
  upgrade?: (modelName: ModelName<M>, data: AnyRecord<M>) => AnyRecord<M> | null;
  // After each committed batch, with its actions: broadcast them (`broadcast`).
  onCommit?: (actions: LoggedAction<M>[]) => void;
  onEvent?: (event: ServerEvent) => void;
  // The most transactions a batch may hold.
  maxBatch?: number;
};

const DAY_MS = 24 * 60 * 60_000;

const sameGroups = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((group) => b.includes(group));

// The server half of the sync engine: one per workspace, and the only thing that writes its data. Every change is a
// batch: staged (`Batch`), checked, then numbered with the next sync ids, saved, applied in memory and handed to
// `onCommit`. Batches run one at a time, so sync ids put every change in one order.
export class SyncServer<M extends Models, T extends TransactionEnvelope = TransactionEnvelope> {
  readonly schema: SyncSchema<M>;
  readonly schemaHash: string;
  readonly models: ModelMaps<M>;
  lastSyncId = 0;
  minSyncId = 0;
  readonly epoch: string;
  onCommit: ServerOptions<M, T>["onCommit"];
  readonly #options: ServerOptions<M, T>;
  readonly #storage: SyncStorage<M>;
  readonly #now: () => number;
  readonly #lookup: Lookup<M> = (modelName, id) => this.models[modelName]?.get(id);

  constructor(options: ServerOptions<M, T>) {
    this.#options = options;
    this.schema = options.schema;
    this.schemaHash = schemaHash(options.schema);
    this.models = emptyModels(options.schema);
    this.#storage = options.storage ?? memoryStorage<M>();
    this.#now = options.now ?? Date.now;
    this.onCommit = options.onCommit;
    const state = this.#storage.load();
    for (const { modelName, data } of state.models) {
      if (!(modelName in this.models)) continue;
      const record = options.upgrade === undefined ? data : options.upgrade(modelName, data);
      if (record !== null)
        (this.models[modelName] as Map<string, AnyRecord<M>>).set(record.id, record);
    }
    this.lastSyncId = state.lastSyncId;
    this.minSyncId = state.minSyncId;
    this.epoch = state.epoch ?? crypto.randomUUID();
    if (state.epoch === undefined) this.#storage.setEpoch(this.epoch);
  }

  get nowMs(): number {
    return this.#now();
  }

  get isEmpty(): boolean {
    return modelNames(this.schema).every((name) => this.models[name].size === 0);
  }

  // --- Writing ---

  // Runs `stage` as one batch: nothing is saved or applied if it throws. `sessionGroups` are the acting session's, for
  // `find`.
  write(
    stage: (batch: Batch<M>) => void,
    transactionIds: string[] = [],
    sessionGroups?: string[],
  ): LoggedAction<M>[] {
    const batch = new Batch(this.models, this.schema, sessionGroups);
    stage(batch);
    const fromSyncId = this.lastSyncId;
    const after: Lookup<M> = (modelName, id) => batch.get(modelName, id);
    const groups = (
      modelName: ModelName<M>,
      record: AnyRecord<M> | undefined,
      lookup: Lookup<M>,
    ) => (record === undefined ? [] : syncGroupsOf(this.schema, modelName, record, lookup));
    const actions: LoggedAction<M>[] = [];
    const logged = new Set<string>();
    let syncId = fromSyncId;
    for (const { modelName, id, data, action } of batch.writes.values()) {
      const before = this.models[modelName].get(id) as AnyRecord<M> | undefined;
      if (data === null && before === undefined) continue;
      logged.add(`${modelName}:${id}`);
      actions.push({
        id: ++syncId,
        modelName,
        modelId: id,
        action: data === null ? "D" : (action ?? (before === undefined ? "I" : "U")),
        data,
        groups: groups(modelName, data ?? undefined, after),
        previousGroups: groups(modelName, before, this.#lookup),
      });
    }
    // Records whose groups come from one whose groups just changed move with it. Those the batch doesn't otherwise
    // touch are logged again, unchanged, so sessions see them arrive or leave along with it.
    const moved = actions.filter((action) => !sameGroups(action.groups, action.previousGroups));
    while (moved.length > 0) {
      const parent = moved.shift() as LoggedAction<M>;
      for (const { modelName, key } of groupDependents(this.schema, parent.modelName))
        for (const record of this.models[modelName].values()) {
          const id = record.id;
          if (
            logged.has(`${modelName}:${id}`) ||
            (record as Record<string, unknown>)[key] !== parent.modelId
          )
            continue;
          const data = after(modelName, id) as AnyRecord<M>;
          const dependent: LoggedAction<M> = {
            id: ++syncId,
            modelName,
            modelId: id,
            action: "U",
            data,
            groups: groups(modelName, data, after),
            previousGroups: groups(modelName, record as AnyRecord<M>, this.#lookup),
          };
          logged.add(`${modelName}:${id}`);
          actions.push(dependent);
          if (!sameGroups(dependent.groups, dependent.previousGroups)) moved.push(dependent);
        }
    }
    // Persist first, then apply in memory, then tell clients.
    this.#storage.commit(actions, transactionIds, this.#now());
    for (const action of actions) {
      const models = this.models[action.modelName] as Map<string, AnyRecord<M>>;
      if (action.data === null) models.delete(action.modelId);
      else models.set(action.modelId, action.data);
    }
    this.lastSyncId = syncId;
    if (actions.length > 0) {
      this.#options.onEvent?.({
        type: "committed",
        fromSyncId,
        lastSyncId: syncId,
        actions: actions.length,
        transactions: transactionIds.length,
      });
      this.onCommit?.(actions);
    }
    return actions;
  }

  // Executes a client's batch, all or nothing, skipping transactions it has already executed (a client resending after
  // it lost the response).
  execute(input: TransactionBatch<T | BuiltInTransaction<M>>, session: Session): LoggedAction<M>[] {
    try {
      if (input.schemaHash !== undefined && input.schemaHash !== this.schemaHash)
        throw new SyncError(426, "This version of the app is out of date");
      if (!isAdmin(session) && input.actorId !== session.userId)
        throw new SyncError(403, "You can only act as yourself");
      if (input.transactions.length > (this.#options.maxBatch ?? 200))
        throw new SyncError(413, "Too many transactions in one batch");
      const fresh = input.transactions.filter(
        (transaction) => !this.#storage.hasTransaction(transaction.id),
      );
      if (fresh.length === 0) return [];
      const groups = this.groupsOf(session);
      const context: ApplyContext = {
        actorId: input.actorId,
        nowMs: this.#now(),
        utcOffsetMinutes: input.utcOffsetMinutes ?? 0,
        session,
      };
      return this.write(
        (batch) => {
          for (const transaction of fresh) {
            if (isBuiltIn(transaction)) this.#checkBuiltIn(batch, transaction);
            try {
              this.#options.apply(batch, transaction, context);
            } catch (error) {
              if (error instanceof SyncError) throw error;
              const message = error instanceof Error ? error.message : String(error);
              this.#options.onEvent?.({
                type: "failed",
                message,
                transactions: input.transactions.length,
              });
              throw new SyncError(422, "The server couldn't apply this change");
            }
          }
        },
        fresh.map((transaction) => transaction.id),
        groups,
      );
    } catch (error) {
      if (error instanceof SyncError)
        this.#options.onEvent?.({
          type: "refused",
          status: error.status,
          message: error.message,
          transactions: input.transactions.length,
        });
      throw error;
    }
  }

  // A delete, archive or unarchive needs a target this session can see, in the right state.
  #checkBuiltIn(batch: Batch<M>, transaction: BuiltInTransaction): void {
    const { modelName, modelId, type } = transaction;
    if (!(modelName in this.models)) throw new SyncError(400, `Unknown model: ${modelName}`);
    const record = batch.find(modelName as ModelName<M>, modelId);
    if (record === undefined) throw new SyncError(404, `${modelName} not found`);
    const archived = record.archivedAtMs !== undefined && record.archivedAtMs !== null;
    if (type === "archive" && archived) throw new SyncError(409, `${modelName} is archived`);
    if (type === "unarchive" && !archived) throw new SyncError(409, `${modelName} isn't archived`);
  }

  #visible(
    modelName: ModelName<M>,
    record: AnyRecord<M>,
    groups: string[],
    lookup: Lookup<M> = this.#lookup,
  ): boolean {
    return visibleIn(syncGroupsOf(this.schema, modelName, record, lookup), groups);
  }

  // --- Reading ---

  // The groups a session sees.
  groupsOf(session: Session): string[] {
    if (isAdmin(session)) return [ALL_GROUPS];
    return this.#options.groupsFor?.(session.userId, this.models) ?? [WORKSPACE_GROUP];
  }

  position(session: Session): SyncPosition {
    return {
      epoch: this.epoch,
      lastSyncId: this.lastSyncId,
      syncGroups: this.groupsOf(session),
      schemaHash: this.schemaHash,
    };
  }

  handshake(session: Session): SyncMessage<M> {
    return { type: "handshake", minSyncId: this.minSyncId, ...this.position(session) };
  }

  // The models that load at start (`instant`) that a session sees: all of them, or only those in `onlyGroups` (a
  // partial bootstrap, when it joins groups).
  bootstrap(session: Session, onlyGroups?: string[]): BootstrapResponse<M> {
    const groups = this.groupsOf(session);
    const wanted =
      onlyGroups === undefined
        ? groups
        : onlyGroups.filter((group) => group !== ALL_GROUPS && visibleIn([group], groups));
    const models: ModelSet<M> = {};
    for (const name of modelNames(this.schema))
      if (loadStrategy(this.schema, name) === "instant")
        models[name] = [...this.models[name].values()].filter((record) =>
          this.#visible(name, record as AnyRecord<M>, wanted),
        );
    return { ...this.position(session), models };
  }

  // Models that don't load at start, as LSE's batch loader asks for them: all of a lazy model, or a partial model's
  // records by one of its partial indexes. Only what the session sees.
  load(session: Session, requests: LoadRequest[]): LoadResponse<M> {
    const groups = this.groupsOf(session);
    const models: ModelSet<M> = {};
    for (const { modelName, key, value } of requests) {
      if (!(modelName in this.models)) throw new SyncError(400, `Unknown model: ${modelName}`);
      const name = modelName as ModelName<M>;
      if (key !== undefined && !(this.schema.models[name].partialIndexes ?? []).includes(key))
        throw new SyncError(400, `${modelName} isn't loaded by ${key}`);
      const found = [...this.models[name].values()].filter(
        (record) =>
          (key === undefined || (record as Record<string, unknown>)[key] === value) &&
          this.#visible(name, record as AnyRecord<M>, groups),
      );
      const list = (models[name] ??= []);
      for (const record of found) if (!list.includes(record)) list.push(record);
    }
    return { ...this.position(session), models };
  }

  // The actions after `after` that a session sees, or a request to bootstrap afresh once the log doesn't reach back.
  deltas(session: Session, after: number): DeltasResponse<M> {
    const position = this.position(session);
    if (after < this.minSyncId) return { ...position, fullBootstrapRequired: true };
    return {
      ...position,
      actions: visibleActions(this.#storage.actionsAfter(after), position.syncGroups),
    };
  }

  // An ephemeral value from a session, as the message for everyone who can see its record, or undefined when the session
  // can't see it.
  ephemeral(session: Session, value: Ephemeral): SyncMessage<M> | undefined {
    if (!(value.modelName in this.models)) return undefined;
    const name = value.modelName as ModelName<M>;
    const record = this.models[name].get(value.modelId) as AnyRecord<M> | undefined;
    if (record === undefined || !this.#visible(name, record, this.groupsOf(session)))
      return undefined;
    return { type: "ephemeral", userId: isAdmin(session) ? null : session.userId, ...value };
  }

  // Whether a session sees a record, for deciding who an ephemeral value reaches.
  sees(session: Session, modelName: string, modelId: string): boolean {
    if (!(modelName in this.models)) return false;
    const name = modelName as ModelName<M>;
    const record = this.models[name].get(modelId) as AnyRecord<M> | undefined;
    return record !== undefined && this.#visible(name, record, this.groupsOf(session));
  }

  // Trims the log to its last `keepActions` actions, and forgets executed transaction ids older than
  // `keepTransactionsMs` (clients resending after that long get their batch refused rather than run twice).
  compact({
    keepActions = 10_000,
    keepTransactionsMs = 30 * DAY_MS,
  }: { keepActions?: number; keepTransactionsMs?: number } = {}): void {
    const through = this.lastSyncId - keepActions;
    if (through <= this.minSyncId) return;
    this.#storage.compact(through, this.#now() - keepTransactionsMs);
    this.minSyncId = through;
    this.#options.onEvent?.({ type: "compacted", throughSyncId: through });
  }
}

// The actions a session in `groups` sees, as it should see them: a record that left its groups arrives as a delete,
// and one that entered them as an insert.
export function visibleActions<M extends Models>(
  actions: LoggedAction<M>[],
  groups: string[],
): SyncAction<M>[] {
  return actions.flatMap(({ groups: now, previousGroups, ...action }): SyncAction<M>[] => {
    const visibleNow = action.data !== null && visibleIn(now, groups);
    const visibleBefore = previousGroups.length > 0 && visibleIn(previousGroups, groups);
    if (visibleNow) return [visibleBefore ? action : { ...action, action: "I" }];
    if (visibleBefore) return [{ ...action, action: "D", data: null }];
    return [];
  });
}
