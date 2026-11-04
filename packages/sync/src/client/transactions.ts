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

// LSE's transaction kinds. Creations don't rebase: the server's copy of a new model is the truth.
export type TransactionKind = "creation" | "update" | "deletion" | "archival" | "unarchive";

const KINDS: Record<string, TransactionKind> = {
  create: "creation",
  delete: "deletion",
  archive: "archival",
  unarchive: "unarchive",
};

const key = (modelName: string, id: string): string => `${modelName}:${id}`;

// One change made on this client. It's applied to the pool at once and kept until the server has executed it and its
// sync id has come back. While it's pending, every model it touches is shown as the server's copy with the pending
// changes replayed on top, oldest first (`replay`): so newer server data lands underneath it (last writer wins, LSE's
// rebase), and if the server refuses it, rebuilding without it takes it out, whatever else is pending. `before` holds
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
      const after = this.replay(modelName, was);
      if (after === undefined) pool.delete(modelName, id);
      else pool.set(modelName, after);
    }
  }

  // One of its models with this change on top: undefined when that leaves no record. A creation leaves a record the
  // server already has as the server has it.
  replay(modelName: ModelName<M>, record: AnyRecord<M> | undefined): AnyRecord<M> | undefined {
    if (this.kind === "creation" && record !== undefined) return record;
    const after = this.#changed(modelName, record);
    if (after === null) return undefined;
    return after ?? record;
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
  // Called when the server refuses a batch, now out of the queue: what it touched needs rebuilding without it.
  onRejected: (error: Error, batch: Transaction<M, T>[]) => void;
  // Called with transactions whose sync id has arrived: what they changed is now as the server confirmed it.
  onCompleted: (transactions: Transaction<M, T>[]) => void;
  utcOffsetMinutes: () => number;
  // The client's sync position. A batch's delta packet can arrive before the response that accepts it.
  lastSyncId: () => number;
};

const MAX_BATCH = 100;
// Kept well under the server's 1 MB limit on a request.
const MAX_BATCH_BYTES = 500_000;
const RETRY_MS = 2000;

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
    if (this.#stopped || !this.online || this.executingTransactions.length > 0) return;
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
    const { send, database, onRejected, utcOffsetMinutes, lastSyncId: synced } = this.#options;
    try {
      const { lastSyncId } = await send({
        actorId: batch[0].actorId,
        utcOffsetMinutes: utcOffsetMinutes(),
        transactions: batch.map((transaction) => transaction.input),
      });
      for (const transaction of batch) transaction.syncIdNeededForCompletion = lastSyncId;
      this.completedButUnsyncedTransactions.push(...batch);
      this.executingTransactions = [];
      this.progressQueue(synced());
      await database.deleteTransactions(batch.map((transaction) => transaction.id));
    } catch (error) {
      this.executingTransactions = [];
      if (error instanceof RejectedError) {
        await database.deleteTransactions(batch.map((transaction) => transaction.id));
        onRejected(error, batch);
      } else {
        // Offline, the server is down, or signed out: keep the batch first in line and try again.
        this.queuedTransactions = [...batch, ...this.queuedTransactions];
        clearTimeout(this.#retry);
        this.#retry = setTimeout(() => this.dequeue(), RETRY_MS);
        return;
      }
    }
    this.dequeue();
  }

  // Completes transactions whose sync id has arrived.
  progressQueue(lastSyncId: number): void {
    const done = (transaction: Transaction<M, T>): boolean =>
      (transaction.syncIdNeededForCompletion ?? Infinity) <= lastSyncId;
    const completed = this.completedButUnsyncedTransactions.filter(done);
    if (completed.length === 0) return;
    this.completedButUnsyncedTransactions = this.completedButUnsyncedTransactions.filter(
      (transaction) => !done(transaction),
    );
    this.#options.onCompleted(completed);
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
