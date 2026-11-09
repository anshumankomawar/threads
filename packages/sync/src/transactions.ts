import type { Row, TxRecord } from "protocol";
import { RejectedError, type Transport } from "./http";
import type { LocalDB } from "./local-db";
import { equal, write, type Core } from "./model";
import { registry } from "./registry";
import { cell } from "./signals";

export interface Transaction {
  readonly id: string; // idempotency key, sent to the server
  readonly status: "queued" | "sending" | "awaitingSync" | "done" | "rejected";
  result(): Promise<void>; // resolves when its own sync id comes back
}

export class Tx implements Transaction {
  status: Transaction["status"] = "queued";
  settle!: (error?: Error) => void;
  readonly #result: Promise<void>;

  constructor(readonly id: string) {
    this.#result = new Promise((resolve, reject) => {
      this.settle = (error) => {
        this.status = error ? "rejected" : "done";
        if (error) reject(error);
        else resolve();
      };
    });
    // A rejection nobody awaits isn't an error: the edit is already rolled back.
    this.#result.catch(() => {});
  }

  result(): Promise<void> {
    return this.#result;
  }
}

export type Timer = (fn: () => void, ms: number) => unknown;

// 1s doubling to 10s, for resending and reconnecting.
export const backoff = (attempt: number): number => Math.min(1000 * 2 ** attempt, 10_000);

const PER_REQUEST = 40;

type Entry = { record: TxRecord; tx: Tx; saved: boolean; syncId?: number };

type QueueOptions = {
  core: Core;
  localDB: LocalDB;
  transport: Transport;
  waitForSyncId(id: number): Promise<void>;
  lastSyncId(): number;
  setTimeout: Timer;
};

// The ids a transaction references, so it isn't sent alongside a transaction for one of them.
function references(record: TxRecord): unknown[] {
  return Object.values(registry.get(record.model).fields)
    .filter((field) => field.kind === "reference")
    .flatMap((field) => [
      record.original?.[field.foreignKey!],
      record.changes?.[field.foreignKey!],
    ]);
}

const related = (a: TxRecord, b: TxRecord): boolean =>
  a.modelId === b.modelId || references(a).includes(b.modelId) || references(b).includes(a.modelId);

// Takes each transaction from the setter that made it to the sync id that confirms it, one request at a time.
export class TransactionQueue {
  batch = 0;
  readonly pendingCount = cell(0);
  // Why the server last refused a change, which has already been undone.
  readonly rejection = cell<string | null>(null);
  readonly #o: QueueOptions;
  #entries: Entry[] = [];
  #created: Entry[] = [];
  #listeners = new Set<(record: TxRecord) => void>();
  #busy = false;
  #attempt = 0;

  constructor(options: QueueOptions) {
    this.#o = options;
  }

  enqueue(record: TxRecord): Transaction {
    const entry: Entry = { record, tx: new Tx(record.id), saved: false };
    this.#add(entry);
    for (const listener of this.#listeners) listener(record);
    if (this.#created.push(entry) === 1) queueMicrotask(() => void this.#flush());
    return entry.tx;
  }

  // Hears each transaction as it's queued (as Linear's transactionQueuedSignal), until the returned function is called:
  // how an undo step learns what it's made of.
  listen(listener: (record: TxRecord) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onDelta(modelId: string, lastSyncId: number): void {
    for (const { record, syncId } of this.#entries)
      if (record.modelId === modelId && !(syncId! <= lastSyncId)) this.#apply(record);
  }

  // The transactions saved before a reload, ahead of anything queued since: they were made first.
  replayOutbox(records: TxRecord[]): void {
    const replayed = records.map((record) => ({ record, tx: new Tx(record.id), saved: true }));
    this.#entries = [...replayed, ...this.#entries];
    this.pendingCount.set(this.#entries.length);
    for (const record of records) {
      this.#apply(record);
      this.batch = Math.max(this.batch, record.batch + 1);
    }
    this.#pump();
  }

  #add(entry: Entry): void {
    this.#entries.push(entry);
    this.pendingCount.set(this.#entries.length);
  }

  // The end of the tick: this tick's transactions are one batch, saved before they're sent.
  async #flush(): Promise<void> {
    const created = this.#created.filter((entry) => this.#entries.includes(entry));
    this.#created = [];
    this.batch++;
    await this.#o.localDB.outbox.put(created.map((entry) => entry.record));
    for (const entry of created) entry.saved = true;
    this.#pump();
  }

  // Sends the queued transactions in order, up to the first that's unsaved or related to one already in the request.
  #pump(): void {
    if (this.#busy) return;
    const request: Entry[] = [];
    for (const entry of this.#entries) {
      if (entry.tx.status !== "queued") continue;
      if (
        !entry.saved ||
        request.length === PER_REQUEST ||
        request.some((sent) => related(sent.record, entry.record))
      )
        break;
      request.push(entry);
    }
    if (request.length > 0) void this.#send(request);
  }

  async #send(request: Entry[]): Promise<void> {
    this.#busy = true;
    for (const entry of request) entry.tx.status = "sending";
    let refused: Promise<void>[] = [];
    try {
      const { results } = await this.#o.transport.mutate({
        transactions: request.map((entry) => entry.record),
      });
      for (const result of results) {
        const entry = request.find((e) => e.record.id === result.txId)!;
        if (result.ok) this.#confirm(entry, result.syncId);
        else refused.push(this.#reject(entry, new RejectedError(result.message)));
      }
    } catch (error) {
      if (!(error instanceof RejectedError)) {
        for (const entry of request) entry.tx.status = "queued";
        this.#o.setTimeout(
          () => {
            this.#busy = false;
            this.#pump();
          },
          backoff(this.#attempt++),
        );
        return;
      }
      refused = request.map((entry) => this.#reject(entry, error));
    }
    // A refusal is rolled back, and what it takes with it gone, before anything else is sent: an edit to a model whose
    // creation was refused mustn't go out.
    await Promise.all(refused);
    this.#attempt = 0;
    this.#busy = false;
    this.#pump();
  }

  #confirm(entry: Entry, syncId: number): void {
    const { kind, modelId } = entry.record;
    const { pool } = this.#o.core;
    entry.syncId = syncId;
    entry.tx.status = "awaitingSync";
    // Its own change already came back, and rebasing put the transaction on top of it again: take that off.
    if (syncId <= this.#o.lastSyncId() && kind !== "create" && kind !== "delete")
      void this.#rollback(entry.record);
    void this.#o.waitForSyncId(syncId).then(() => {
      // A creation the server didn't send back is one this client can't see.
      if (kind === "create" && !pool.get(modelId)?.isPersisted) pool.remove(modelId);
      return this.#finish(entry);
    });
  }

  async #reject(entry: Entry, error: Error): Promise<void> {
    const { kind, modelId } = entry.record;
    this.rejection.set(error.message);
    await this.#rollback(entry.record);
    // What waits on a refused creation goes with it: undoing it would bring back a model that never existed. Unless
    // the server has the model after all, and the rollback put its copy back.
    if (kind === "create" && !this.#o.core.pool.get(modelId))
      await Promise.all(
        this.#entries
          .filter((later) => later !== entry && later.record.modelId === modelId)
          .map((later) => this.#finish(later, error)),
      );
    return this.#finish(entry, error);
  }

  async #finish(entry: Entry, error?: Error): Promise<void> {
    this.#entries = this.#entries.filter((e) => e !== entry);
    this.pendingCount.set(this.#entries.length);
    await this.#o.localDB.outbox.remove(entry.record.id);
    entry.tx.settle(error);
  }

  // (Re)applies a transaction on top of what the pool holds now, which becomes its `original` (in place, so an undo
  // step holding it sees that too). The server's copy of a model wins over a pending create of it.
  #apply(record: TxRecord): void {
    const { pool, materialize } = this.#o.core;
    const model = pool.get(record.modelId);
    if (record.kind === "create") {
      if (!model) pool.put(materialize(record.model, record.changes as Row));
      return;
    }
    if (!model) return;
    if (record.kind === "delete") {
      record.original = Object.assign(record.original ?? {}, model.__data);
      pool.remove(model.id);
      return;
    }
    record.original ??= {};
    for (const [field, value] of Object.entries(record.changes!)) {
      record.original[field] = model.__data[field];
      write(model, field, value);
    }
  }

  // Undoes a rejected transaction, leaving any field edited since as it is. A deleted model comes back as the
  // server last sent it, if this client may still see it.
  //
  // So does a model whose creation was refused while the server still has it: undoing a delete that the server
  // refused, or hadn't run yet, makes the model again before that's known, and the server says it already exists.
  // Its copy replaces the one made again, with the transactions pending for it back on top.
  async #rollback(record: TxRecord): Promise<void> {
    const { pool, materialize } = this.#o.core;
    if (record.kind === "delete" || record.kind === "create") {
      const row = (await this.#o.localDB.load(record.model)).find((r) => r.id === record.modelId);
      if (record.kind === "create" && !row) return pool.remove(record.modelId);
      if (!row || (record.kind === "delete" && pool.get(record.modelId))) return;
      const model = materialize(record.model, row);
      model.__persisted = true;
      pool.remove(record.modelId);
      pool.put(model);
      if (record.kind === "create") this.onDelta(record.modelId, this.#o.lastSyncId());
      return;
    }
    const model = pool.get(record.modelId);
    if (model) {
      // Edits made on top of it, saved or not, now undo to what was there before it.
      const later = this.#entries.slice(this.#entries.findIndex((e) => e.record === record) + 1);
      const above = [model.__original];
      for (const { record: other } of later)
        if (other.modelId === record.modelId && other.original) above.push(other.original);
      for (const [field, value] of Object.entries(record.original!)) {
        const rejected = record.changes![field];
        if (equal(model.__data[field], rejected)) write(model, field, value);
        for (const original of above)
          if (field in original && equal(original[field], rejected)) original[field] = value;
      }
    }
  }
}
