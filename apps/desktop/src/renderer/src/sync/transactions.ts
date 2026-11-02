import {
  entryFromCreate,
  groupFromCreate,
  labelFromCreate,
  threadFromCreate,
  type AnyRecord,
  type ModelName,
  type TransactionBatch,
  type TransactionBatchResponse,
  type TransactionInput,
} from "model";
import type { StoredTransaction, SyncDatabase } from "./database";
import type { ObjectPool } from "./objectPool";

// A rejection from the server. The batch it covers is rolled back rather than retried.
export class RejectedError extends Error {}

// One change made on this client. It's applied to the object pool straight away (optimistically) and kept until
// the server has executed it and its sync id has come back in a delta packet.
export abstract class BaseTransaction {
  readonly id: string;
  readonly actorId: string;
  readonly input: TransactionInput;
  batchIndex = 0;
  // The sync id that completes this transaction, set once the server accepts it.
  syncIdNeededForCompletion: number | undefined;

  constructor(input: TransactionInput, actorId: string) {
    this.id = input.id;
    this.input = input;
    this.actorId = actorId;
  }

  get modelName(): ModelName {
    return this.input.modelName;
  }

  abstract get modelId(): string;
  // Applies the change to the pool, for the optimistic view and when replaying after a restart.
  abstract apply(pool: ObjectPool): void;
  abstract rollback(pool: ObjectPool): void;

  serialize(): StoredTransaction {
    return { id: this.id, batchIndex: this.batchIndex, actorId: this.actorId, input: this.input };
  }

  static fromSerializedData(stored: StoredTransaction): BaseTransaction {
    const transaction =
      stored.input.type === "create"
        ? new CreationTransaction(stored.input, stored.actorId)
        : stored.input.type === "move"
          ? new MoveTransaction(stored.input, stored.actorId)
          : new UpdateTransaction(stored.input, stored.actorId);
    transaction.batchIndex = stored.batchIndex;
    return transaction;
  }
}

// Adds a model. Its id is made on the client, so the pool and later transactions can refer to it at once.
export class CreationTransaction extends BaseTransaction {
  get modelId(): string {
    return this.input.type === "create" ? this.input.data.id : "";
  }

  // The record the server will make, as near as the client can tell before side effects.
  record(): AnyRecord {
    const nowMs = Date.now();
    const { input } = this;
    if (input.type !== "create") throw new Error("Not a creation");
    if (input.modelName === "Thread") return threadFromCreate(input.data, this.actorId, nowMs);
    if (input.modelName === "Label") return labelFromCreate(input.data, this.actorId, nowMs);
    if (input.modelName === "Group") return groupFromCreate(input.data, this.actorId, nowMs);
    return entryFromCreate(input.data, this.actorId, nowMs);
  }

  apply(pool: ObjectPool): void {
    if (pool.get(this.modelName, this.modelId) === undefined)
      pool.set(this.modelName, this.record());
  }

  rollback(pool: ObjectPool): void {
    pool.delete(this.modelName, this.modelId);
  }
}

// Changes properties of a model. `original` holds the values underneath the change, so a rejection can restore
// them; rebasing onto newer server data replaces them, and the local change stays on top (last writer wins).
export class UpdateTransaction extends BaseTransaction {
  original: Record<string, unknown> = {};

  get modelId(): string {
    return this.input.type === "update" ? this.input.modelId : "";
  }

  get changes(): Record<string, unknown> {
    return this.input.type === "update" ? this.input.changes : {};
  }

  apply(pool: ObjectPool): void {
    const current = pool.get(this.modelName, this.modelId) as Record<string, unknown> | undefined;
    if (current === undefined) return;
    this.original = Object.fromEntries(Object.keys(this.changes).map((key) => [key, current[key]]));
    pool.set(this.modelName, { ...current, ...this.changes } as AnyRecord);
  }

  rollback(pool: ObjectPool): void {
    const current = pool.get(this.modelName, this.modelId);
    if (current !== undefined)
      pool.set(this.modelName, { ...current, ...this.original } as AnyRecord);
  }

  // Puts this change on top of a newer server copy of the model.
  rebase(record: AnyRecord): AnyRecord {
    const server = record as Record<string, unknown>;
    this.original = Object.fromEntries(Object.keys(this.changes).map((key) => [key, server[key]]));
    return { ...record, ...this.changes } as AnyRecord;
  }
}

// Moves messages into another thread: an update of each one's `threadId`, sent as one transaction so the server
// writes a single activity line for it.
export class MoveTransaction extends BaseTransaction {
  original = new Map<string, string>();

  get entryIds(): string[] {
    return this.input.type === "move" ? this.input.entryIds : [];
  }

  get threadId(): string {
    return this.input.type === "move" ? this.input.threadId : "";
  }

  get modelId(): string {
    return this.entryIds[0] ?? "";
  }

  touches(modelName: ModelName, id: string): boolean {
    return modelName === "Entry" && this.entryIds.includes(id);
  }

  apply(pool: ObjectPool): void {
    for (const entryId of this.entryIds) {
      const entry = pool.get("Entry", entryId);
      if (entry === undefined) continue;
      this.original.set(entryId, entry.threadId);
      pool.set("Entry", { ...entry, threadId: this.threadId });
    }
  }

  rollback(pool: ObjectPool): void {
    for (const [entryId, threadId] of this.original) {
      const entry = pool.get("Entry", entryId);
      if (entry !== undefined) pool.set("Entry", { ...entry, threadId });
    }
  }

  rebase(record: AnyRecord): AnyRecord {
    if (!("threadId" in record)) return record;
    this.original.set(record.id, record.threadId);
    return { ...record, threadId: this.threadId };
  }
}

export type QueueOptions = {
  pool: ObjectPool;
  database: Pick<SyncDatabase, "putTransactions" | "deleteTransactions">;
  send: (batch: TransactionBatch) => Promise<TransactionBatchResponse>;
  // Called when the server rejects a batch, after it's rolled back.
  onRejected: (error: Error) => void;
  utcOffsetMinutes: () => number;
  // The client's sync position. A batch's delta packet can arrive before the response that accepts it.
  lastSyncId: () => number;
};

const MAX_BATCH = 100;
const RETRY_MS = 2000;

// Takes transactions from creation to completion, through LSE's four stages: created (this tick), queued (saved,
// waiting to send), executing (sent), and completed but unsynced (accepted, waiting for its sync id).
export class TransactionQueue {
  createdTransactions: BaseTransaction[] = [];
  queuedTransactions: BaseTransaction[] = [];
  executingTransactions: BaseTransaction[] = [];
  completedButUnsyncedTransactions: BaseTransaction[] = [];
  batchIndex = 0;
  online = false;
  readonly #options: QueueOptions;
  #commitScheduled = false;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(options: QueueOptions) {
    this.#options = options;
  }

  get pending(): BaseTransaction[] {
    return [
      ...this.completedButUnsyncedTransactions,
      ...this.executingTransactions,
      ...this.queuedTransactions,
      ...this.createdTransactions,
    ];
  }

  // Applies a new transaction to the pool and schedules it. Transactions made in the same tick share a batch.
  enqueue(transaction: BaseTransaction): void {
    transaction.apply(this.#options.pool);
    this.createdTransactions.push(transaction);
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
  restore(stored: BaseTransaction[]): void {
    for (const transaction of stored) transaction.apply(this.#options.pool);
    this.queuedTransactions.push(...stored);
    this.batchIndex = Math.max(
      this.batchIndex,
      ...stored.map((transaction) => transaction.batchIndex + 1),
    );
  }

  // Sends the next batch: the leading queued transactions sharing a batch index and an actor.
  dequeue(): void {
    if (this.#stopped || !this.online || this.executingTransactions.length > 0) return;
    const [first] = this.queuedTransactions;
    if (first === undefined) return;
    const batch: BaseTransaction[] = [];
    for (const transaction of this.queuedTransactions) {
      if (
        transaction.batchIndex !== first.batchIndex ||
        transaction.actorId !== first.actorId ||
        batch.length === MAX_BATCH
      )
        break;
      batch.push(transaction);
    }
    clearTimeout(this.#retry);
    this.queuedTransactions = this.queuedTransactions.slice(batch.length);
    this.executingTransactions = batch;
    void this.executeTransactionBatch(batch);
  }

  async executeTransactionBatch(batch: BaseTransaction[]): Promise<void> {
    const {
      send,
      database,
      pool,
      onRejected,
      utcOffsetMinutes,
      lastSyncId: synced,
    } = this.#options;
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
        // Undo newest first, so each restores the value the one before it saw.
        for (const transaction of [...batch].reverse()) transaction.rollback(pool);
        await database.deleteTransactions(batch.map((transaction) => transaction.id));
        onRejected(error);
      } else {
        // Offline or the server is down: keep the batch first in line and try again.
        this.queuedTransactions = [...batch, ...this.queuedTransactions];
        clearTimeout(this.#retry);
        this.#retry = setTimeout(() => this.dequeue(), RETRY_MS);
        return;
      }
    }
    this.dequeue();
  }

  // Completes transactions whose sync id has arrived in a delta packet.
  progressQueue(lastSyncId: number): void {
    this.completedButUnsyncedTransactions = this.completedButUnsyncedTransactions.filter(
      (transaction) => (transaction.syncIdNeededForCompletion ?? Infinity) > lastSyncId,
    );
  }

  // Pending updates to one model (property changes and moves), oldest first, for rebasing onto server data.
  updatesFor(
    modelName: ModelName,
    id: string,
    syncId: number,
  ): (UpdateTransaction | MoveTransaction)[] {
    return this.pending.filter(
      (transaction): transaction is UpdateTransaction | MoveTransaction =>
        (transaction.syncIdNeededForCompletion ?? Infinity) > syncId &&
        (transaction instanceof MoveTransaction
          ? transaction.touches(modelName, id)
          : transaction instanceof UpdateTransaction &&
            transaction.modelName === modelName &&
            transaction.modelId === id),
    );
  }

  // Drops everything, for example when the server's data was reset and the client starts over.
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
