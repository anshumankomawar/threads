import type { ClientMutations } from "../mutations";
import {
  isBuiltIn,
  type AnyRecord,
  type BuiltInTransaction,
  type ModelName,
  type Models,
  type TransactionBatch,
  type TransactionBatchResponse,
  type TransactionEnvelope,
} from "../protocol";
import type { StoredTransaction, SyncDatabase } from "./database";
import type { ObjectPool } from "./pool";

// The server refused a batch (a 4xx other than 401): it's rolled back rather than retried.
export class RejectedError extends Error {}

// The session wasn't accepted (401): the batch waits, to be sent again once signed in.
export class UnauthorizedError extends Error {}

// The server failed (5xx): the batch is retried, and after a few failures in a row it's stuck until the user retries or
// discards it.
export class ServerError extends Error {}

// The server runs a newer schema (426): this client stops sending until it's updated.
export class OutdatedError extends Error {}

// Waits around `ms`, give or take a quarter, so clients that failed together don't all retry together.
export const jittered = (ms: number): number => ms * (0.75 + Math.random() / 2);

// LSE's transaction kinds. Creations don't rebase: the server's copy of a new model is the truth.
export type TransactionKind = "creation" | "update" | "deletion" | "archival" | "unarchive";

const KINDS: Record<string, TransactionKind> = {
  create: "creation",
  delete: "deletion",
  archive: "archival",
  unarchive: "unarchive",
};

const key = (modelName: string, id: string): string => `${modelName}:${id}`;

// What a change replaced: the fields it changed (with their old values), the whole record when it removed it, or null
// when it made it.
function replaced(
  before: object | undefined,
  after: object | null,
): Record<string, unknown> | null {
  if (before === undefined) return null;
  if (after === null) return { ...before };
  const was = before as Record<string, unknown>;
  const now = after as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(now)
      .filter((field) => now[field] !== was[field])
      .map((field) => [field, was[field]]),
  );
}

// One change made on this client, as in LSE. It's applied to the pool at once and kept until the server has executed it
// and its sync id has come back. `original` holds, per model it touched, the values it replaced, so a refusal can put
// them back (`rollback`); when newer server data for one of its models arrives first, the change is rebased onto it
// (`rebase`): `original` becomes the server's values and the change stays on top (last writer wins). `before` holds
// each model as it was when the change was made, for undoing it.
export class Transaction<M extends Models, T extends TransactionEnvelope> {
  readonly id: string;
  readonly actorId: string;
  readonly input: T | BuiltInTransaction<M>;
  readonly kind: TransactionKind;
  readonly createdAtMs: number;
  batchIndex = 0;
  // The sync id that completes this transaction, once the server accepts it.
  syncIdNeededForCompletion: number | undefined;
  readonly original = new Map<string, Record<string, unknown> | null>();
  readonly before = new Map<string, AnyRecord<M> | undefined>();
  readonly #mutations: ClientMutations<M, T>;

  constructor(
    input: T | BuiltInTransaction<M>,
    actorId: string,
    mutations: ClientMutations<M, T>,
    createdAtMs = Date.now(),
  ) {
    this.id = input.id;
    this.input = input;
    this.actorId = actorId;
    this.kind = KINDS[input.type] ?? "update";
    this.createdAtMs = createdAtMs;
    this.#mutations = mutations;
  }

  static restore<M extends Models, T extends TransactionEnvelope>(
    stored: StoredTransaction<T | BuiltInTransaction<M>>,
    mutations: ClientMutations<M, T>,
  ): Transaction<M, T> {
    const transaction = new Transaction(
      stored.input,
      stored.actorId,
      mutations,
      stored.createdAtMs,
    );
    transaction.batchIndex = stored.batchIndex;
    return transaction;
  }

  touches(): { modelName: ModelName<M>; id: string }[] {
    const { input } = this;
    if (isBuiltIn(input))
      return [{ modelName: input.modelName as ModelName<M>, id: input.modelId }];
    return this.#mutations.touches(input as T);
  }

  touchesModel(modelName: string, id: string): boolean {
    return this.touches().some((model) => model.modelName === modelName && model.id === id);
  }

  // The record with this change on top, or null when it's removed, or undefined when it doesn't change it.
  #changed(
    modelName: ModelName<M>,
    record: AnyRecord<M> | undefined,
  ): AnyRecord<M> | null | undefined {
    const { input } = this;
    if (isBuiltIn(input)) {
      if (input.type === "delete") return null;
      if (record === undefined) return undefined;
      return {
        ...record,
        archivedAtMs: input.type === "archive" ? this.createdAtMs : null,
      } as AnyRecord<M>;
    }
    return this.#mutations.change(input as T, modelName, record, {
      actorId: this.actorId,
      nowMs: this.createdAtMs,
    });
  }

  // Shows the change: applied to the pool as it is now.
  apply(pool: ObjectPool<M>): void {
    for (const { modelName, id } of this.touches()) {
      const was = pool.get(modelName, id) as AnyRecord<M> | undefined;
      if (!this.before.has(key(modelName, id))) this.before.set(key(modelName, id), was);
      const after = this.#changed(modelName, was);
      if (after === undefined) continue;
      this.original.set(key(modelName, id), replaced(was, after));
      if (after === null) pool.delete(modelName, id);
      else pool.set(modelName, after);
    }
  }

  // Undoes the change in the pool after the server refused it: a model it made goes, one it deleted comes back, and
  // otherwise the values it replaced go back (unless the model is gone meanwhile, when there's nothing to put them on).
  rollback(pool: ObjectPool<M>): void {
    for (const { modelName, id } of this.touches()) {
      const was = this.original.get(key(modelName, id));
      if (was === undefined) continue;
      const current = pool.get(modelName, id) as AnyRecord<M> | undefined;
      if (was === null) pool.delete(modelName, id);
      else if (current !== undefined) pool.set(modelName, { ...current, ...was } as AnyRecord<M>);
      else if (this.kind === "deletion") pool.set(modelName, was as AnyRecord<M>);
    }
  }

  // This change on top of a newer server copy of one of its models (or none), its `original` now that copy's values;
  // undefined when that leaves no record. A creation leaves a server copy as it is.
  rebase(
    modelName: ModelName<M>,
    id: string,
    record: AnyRecord<M> | undefined,
  ): AnyRecord<M> | undefined {
    if (this.kind === "creation" && record !== undefined) return record;
    const after = this.#changed(modelName, record);
    if (after === undefined) return record;
    this.original.set(key(modelName, id), replaced(record, after));
    return after ?? undefined;
  }

  // The transaction that undoes this one (LSE's `undoTransaction`), or null when it can't be undone. Archiving and
  // unarchiving undo each other; otherwise the product says (`ClientMutations.inverse`), and without it a creation of
  // one model undoes by deleting it.
  undoTransaction(): Transaction<M, T> | null {
    const { input } = this;
    const id = crypto.randomUUID();
    const inverse = ((): Omit<T, "id"> | Omit<BuiltInTransaction<M>, "id"> | null => {
      if (isBuiltIn(input)) {
        if (input.type === "delete") return null;
        return { ...input, type: input.type === "archive" ? "unarchive" : "archive" };
      }
      if (this.#mutations.inverse !== undefined)
        return this.#mutations.inverse(input as T, this.before, {
          actorId: this.actorId,
          nowMs: this.createdAtMs,
        });
      const [only, ...rest] = this.touches();
      if (this.kind !== "creation" || only === undefined || rest.length > 0) return null;
      return { type: "delete", modelName: only.modelName, modelId: only.id };
    })();
    if (inverse === null) return null;
    return new Transaction<M, T>(
      { ...inverse, id } as T | BuiltInTransaction<M>,
      this.actorId,
      this.#mutations,
    );
  }

  // The server deleted one of its models: there's nothing of it left for a rollback to put back.
  rebaseDeleted(modelName: ModelName<M>, id: string): void {
    if (this.original.has(key(modelName, id))) this.original.set(key(modelName, id), null);
  }

  serialize(): StoredTransaction<T | BuiltInTransaction<M>> {
    return {
      id: this.id,
      batchIndex: this.batchIndex,
      actorId: this.actorId,
      createdAtMs: this.createdAtMs,
      input: this.input,
    };
  }
}

export type QueueOptions<M extends Models, T extends TransactionEnvelope> = {
  pool: ObjectPool<M>;
  database: Pick<
    SyncDatabase<M, T | BuiltInTransaction<M>>,
    "putTransactions" | "deleteTransactions"
  >;
  send: (batch: TransactionBatch<T | BuiltInTransaction<M>>) => Promise<TransactionBatchResponse>;
  // The schema this client was built with, sent with every batch.
  schemaHash: string;
  // Called when the server refuses a batch, after it's rolled back, with it and any changes dropped with it.
  onRejected: (error: Error, transactions: Transaction<M, T>[]) => void;
  // Called when a batch is stuck (the server keeps failing on it), and with null when it's no longer stuck.
  onStuck: (message: string | null) => void;
  // Called when the server says this client is out of date; the queue has stopped.
  onOutdated: (error: Error) => void;
  // How long to wait before resending after a failure, doubling from `minMs` up to `maxMs`.
  retry?: { minMs: number; maxMs: number };
  utcOffsetMinutes: () => number;
  // The client's sync position. A batch's delta packet can arrive before the response that accepts it.
  lastSyncId: () => number;
};

const MAX_BATCH = 100;
// Kept well under the server's 1 MB limit on a request.
const MAX_BATCH_BYTES = 500_000;
// Retries back off from 2 seconds to a minute by default. Five server failures in a row and the batch is stuck.
const RETRY = { minMs: 2000, maxMs: 60_000 };
const MAX_SERVER_FAILURES = 5;

// Takes transactions from creation to completion, through LSE's stages: created (this tick), queued (saved, waiting to
// send), executing (sent), and completed but unsynced (accepted, waiting for its sync id to arrive).
export class TransactionQueue<M extends Models, T extends TransactionEnvelope> {
  createdTransactions: Transaction<M, T>[] = [];
  queuedTransactions: Transaction<M, T>[] = [];
  executingTransactions: Transaction<M, T>[] = [];
  completedButUnsyncedTransactions: Transaction<M, T>[] = [];
  batchIndex = 0;
  online = false;
  readonly #options: QueueOptions<M, T>;
  // Told of every transaction enqueued (LSE's transactionQueuedSignal), for the undo queue.
  readonly #listeners = new Set<(transaction: Transaction<M, T>) => void>();
  #commitScheduled = false;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  // Failed sends in a row (any kind), for backing off, and server failures in a row, for deciding it's stuck.
  #attempts = 0;
  #serverFailures = 0;
  // The message of a batch stuck at the front of the queue, until it's retried or discarded.
  stuck: string | null = null;

  constructor(options: QueueOptions<M, T>) {
    this.#options = options;
  }

  get pending(): Transaction<M, T>[] {
    return [
      ...this.completedButUnsyncedTransactions,
      ...this.executingTransactions,
      ...this.queuedTransactions,
      ...this.createdTransactions,
    ];
  }

  onEnqueued(listener: (transaction: Transaction<M, T>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // Applies a new transaction to the pool and schedules it. Transactions made in the same tick share a batch.
  enqueue(transaction: Transaction<M, T>): void {
    transaction.apply(this.#options.pool);
    this.createdTransactions.push(transaction);
    for (const listener of this.#listeners) listener(transaction);
    if (this.#commitScheduled) return;
    this.#commitScheduled = true;
    queueMicrotask(() => void this.commitCreatedTransactions());
  }

  async commitCreatedTransactions(): Promise<void> {
    this.#commitScheduled = false;
    const created = this.createdTransactions;
    if (created.length === 0) return;
    this.createdTransactions = [];
    for (const transaction of created) transaction.batchIndex = this.batchIndex;
    this.batchIndex += 1;
    this.queuedTransactions.push(...created);
    await this.#options.database.putTransactions(
      created.map((transaction) => transaction.serialize()),
    );
    this.dequeue();
  }

  // Restores transactions saved before a restart: replays them onto the pool and queues them to send.
  restore(stored: Transaction<M, T>[]): void {
    for (const transaction of stored) transaction.apply(this.#options.pool);
    this.queuedTransactions.push(...stored);
    this.batchIndex = Math.max(
      this.batchIndex,
      ...stored.map((transaction) => transaction.batchIndex + 1),
    );
  }

  // Puts every pending change back on the pool, after it was rebuilt from a full bootstrap.
  reapply(): void {
    for (const transaction of this.pending) transaction.apply(this.#options.pool);
  }

  // Sends the next batch: the leading queued transactions sharing a batch index and an actor, within the size limits.
  dequeue(): void {
    if (
      this.#stopped ||
      this.stuck !== null ||
      !this.online ||
      this.executingTransactions.length > 0
    )
      return;
    const [first] = this.queuedTransactions;
    if (first === undefined) return;
    const batch: Transaction<M, T>[] = [];
    let bytes = 0;
    for (const transaction of this.queuedTransactions) {
      const size = JSON.stringify(transaction.input).length;
      if (
        transaction.batchIndex !== first.batchIndex ||
        transaction.actorId !== first.actorId ||
        batch.length === MAX_BATCH ||
        (batch.length > 0 && bytes + size > MAX_BATCH_BYTES)
      )
        break;
      batch.push(transaction);
      bytes += size;
    }
    clearTimeout(this.#retry);
    this.queuedTransactions = this.queuedTransactions.slice(batch.length);
    this.executingTransactions = batch;
    void this.executeTransactionBatch(batch);
  }

  async executeTransactionBatch(batch: Transaction<M, T>[]): Promise<void> {
    const {
      send,
      schemaHash,
      onOutdated,
      onStuck,
      utcOffsetMinutes,
      lastSyncId: synced,
    } = this.#options;
    try {
      const { lastSyncId } = await send({
        actorId: batch[0].actorId,
        utcOffsetMinutes: utcOffsetMinutes(),
        schemaHash,
        transactions: batch.map((transaction) => transaction.input),
      });
      this.#attempts = 0;
      this.#serverFailures = 0;
      for (const transaction of batch) transaction.syncIdNeededForCompletion = lastSyncId;
      this.completedButUnsyncedTransactions.push(...batch);
      this.executingTransactions = [];
      this.progressQueue(synced());
      await this.#options.database.deleteTransactions(batch.map((transaction) => transaction.id));
    } catch (error) {
      this.executingTransactions = [];
      if (error instanceof RejectedError) {
        this.#attempts = 0;
        this.#serverFailures = 0;
        await this.#refuse(batch, error);
      } else {
        // Keep the batch first in line.
        this.queuedTransactions = [...batch, ...this.queuedTransactions];
        if (error instanceof OutdatedError) {
          // Nothing more goes out until the app is updated; what's queued stays, to send then.
          this.#stopped = true;
          onOutdated(error);
          return;
        }
        if (error instanceof ServerError && ++this.#serverFailures >= MAX_SERVER_FAILURES) {
          // The server keeps failing on this batch, and everything else waits behind it: the user decides.
          this.stuck = error.message;
          onStuck(error.message);
          return;
        }
        // Offline, the server down, or signed out: try again, waiting longer each time.
        clearTimeout(this.#retry);
        const { minMs, maxMs } = this.#options.retry ?? RETRY;
        const delay = Math.min(minMs * 2 ** this.#attempts++, maxMs);
        this.#retry = setTimeout(() => this.dequeue(), jittered(delay));
        return;
      }
    }
    this.dequeue();
  }

  // Rolls back a refused batch, newest first so each restores the value the one before it saw, and drops the changes
  // still waiting that touch what a refused creation would have made: they can only be refused too, and rolling them
  // back would bring back a record the server never had.
  async #refuse(batch: Transaction<M, T>[], error: Error): Promise<void> {
    for (const transaction of [...batch].reverse()) transaction.rollback(this.#options.pool);
    const made = batch
      .filter((transaction) => transaction.kind === "creation")
      .flatMap((transaction) => transaction.touches());
    const dependsOnRefused = (transaction: Transaction<M, T>): boolean =>
      made.some((model) => transaction.touchesModel(model.modelName, model.id));
    const dropped = [...this.createdTransactions, ...this.queuedTransactions].filter(
      dependsOnRefused,
    );
    this.createdTransactions = this.createdTransactions.filter(
      (transaction) => !dependsOnRefused(transaction),
    );
    this.queuedTransactions = this.queuedTransactions.filter(
      (transaction) => !dependsOnRefused(transaction),
    );
    await this.#options.database.deleteTransactions(
      [...batch, ...dropped].map((transaction) => transaction.id),
    );
    this.#options.onRejected(error, [...batch, ...dropped]);
  }

  // Sends the stuck batch again.
  retryStuck(): void {
    if (this.stuck === null) return;
    this.stuck = null;
    this.#serverFailures = 0;
    this.#options.onStuck(null);
    this.dequeue();
  }

  // Gives up on the stuck batch: rolls it back as if the server had refused it, and carries on with the rest.
  async discardStuck(): Promise<void> {
    if (this.stuck === null) return;
    const [first] = this.queuedTransactions;
    const batch = this.queuedTransactions.filter(
      (transaction) => transaction.batchIndex === first?.batchIndex,
    );
    this.queuedTransactions = this.queuedTransactions.filter(
      (transaction) => !batch.includes(transaction),
    );
    const message = this.stuck;
    this.stuck = null;
    this.#serverFailures = 0;
    this.#options.onStuck(null);
    await this.#refuse(batch, new Error(`Discarded: ${message}`));
    this.dequeue();
  }

  // Completes transactions whose sync id has arrived (LSE's `progressQueue`).
  progressQueue(lastSyncId: number): void {
    this.completedButUnsyncedTransactions = this.completedButUnsyncedTransactions.filter(
      (transaction) => (transaction.syncIdNeededForCompletion ?? Infinity) > lastSyncId,
    );
  }

  // Pending transactions touching a model that a server action numbered `syncId` doesn't already include, oldest first,
  // for rebasing onto it.
  pendingFor(modelName: string, id: string, syncId: number): Transaction<M, T>[] {
    return this.pending.filter(
      (transaction) =>
        (transaction.syncIdNeededForCompletion ?? Infinity) > syncId &&
        transaction.touchesModel(modelName, id),
    );
  }

  // The server inserted a model: a creation of this client's with the same id that hasn't been sent is no longer valid,
  // and is cancelled (LSE's `modelUpserted`). Ids are UUIDs, so this guards against a collision rather than being routine.
  async modelUpserted(modelName: string, id: string): Promise<void> {
    const stale = (transaction: Transaction<M, T>): boolean =>
      transaction.kind === "creation" && transaction.touchesModel(modelName, id);
    const dropped = [...this.createdTransactions, ...this.queuedTransactions].filter(stale);
    if (dropped.length === 0) return;
    this.createdTransactions = this.createdTransactions.filter(
      (transaction) => !stale(transaction),
    );
    this.queuedTransactions = this.queuedTransactions.filter((transaction) => !stale(transaction));
    await this.#options.database.deleteTransactions(dropped.map((transaction) => transaction.id));
  }

  // The server deleted a model: changes to it that haven't been sent can only be refused, so they're dropped rather
  // than sent (and refused along with whatever shares their batch).
  async modelDeleted(modelName: string, id: string): Promise<void> {
    const doomed = (transaction: Transaction<M, T>): boolean =>
      transaction.kind !== "creation" &&
      transaction.touches().every((model) => model.modelName === modelName && model.id === id);
    const dropped = [...this.createdTransactions, ...this.queuedTransactions].filter(doomed);
    if (dropped.length === 0) return;
    this.createdTransactions = this.createdTransactions.filter(
      (transaction) => !doomed(transaction),
    );
    this.queuedTransactions = this.queuedTransactions.filter((transaction) => !doomed(transaction));
    await this.#options.database.deleteTransactions(dropped.map((transaction) => transaction.id));
  }

  // Drops everything, for example when the client is reset.
  clear(): void {
    this.createdTransactions = [];
    this.queuedTransactions = [];
    this.executingTransactions = [];
    this.completedButUnsyncedTransactions = [];
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#retry);
  }

  resume(): void {
    this.#stopped = false;
  }
}
