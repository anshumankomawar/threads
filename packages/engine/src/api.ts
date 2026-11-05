// The developer API and the engine's internal interfaces, exactly as the Sync Engine v1 spec defines them. Product
// code uses `Model`, `Store`, `Transaction`, `Collection` and the decorators; the rest is for the engine and tests.
import type { Row, SyncAction, TxRecord } from "./protocol";

export interface Transaction {
  readonly id: string; // idempotency key, sent to the server
  readonly status: "queued" | "sending" | "awaitingSync" | "done" | "rejected";
  result(): Promise<void>; // resolves when its own sync id comes back
}

export interface Collection<T> extends Iterable<T> {
  readonly length: number;
  filter(fn: (m: T) => boolean): T[];
  sorted(by: keyof T, dir?: "asc" | "desc"): T[];
}

// A model class: what the decorators register and `Store` methods take.
export type ModelClass<T = unknown> = (new () => T) & { prototype: T };

export interface UndoQueue {
  group(label: string, fn: () => void): void; // every save() inside = one undo step
  undo(): void;
  redo(): void; // v1: stubs, added after the core works
}

// ── Engine internals ──

export interface FieldMeta {
  kind: "property" | "ephemeral" | "reference" | "oneToMany";
  // oxlint-disable-next-line typescript/no-explicit-any -- any model class
  target?: () => ModelClass<any>; // for references
  foreignKey?: string; // e.g. "ownerId"
  indexed?: boolean;
  nullable?: boolean;
  enum?: readonly string[];
}

export interface ModelMeta {
  name: string;
  fields: Record<string, FieldMeta>;
  syncGroup?: (row: Row) => string[];
}

export interface ModelRegistry {
  // oxlint-disable-next-line typescript/no-explicit-any -- any model class
  register(meta: ModelMeta, ctor: ModelClass<any>): void;
  get(name: string): ModelMeta;
  all(): ModelMeta[];
  readonly schemaHash: string; // changes => client wipes local data and re-bootstraps
}

export interface ObjectPool<M> {
  get(id: string): M | undefined;
  put(model: M): void;
  remove(id: string): void;
  byIndex(model: string, field: string, value: unknown): M[];
}

export interface TransactionQueue {
  enqueue(tx: TxRecord): Transaction; // memory already updated by the setter
  onDelta(modelId: string, lastSyncId: number): void; // rebase pending updates, drop finished ones
  replayOutbox(): Promise<void>; // on startup: re-apply and resend
}

export interface SyncClient {
  bootstrap(): Promise<void>; // full load, or local data + catch-up
  connect(): void; // WebSocket with backoff
  applyDelta(packet: { actions: SyncAction[]; lastSyncId: number }): Promise<void>; // one at a time, under a lock
  readonly lastSyncId: number;
  waitForSyncId(id: number): Promise<void>;
}

export interface LocalDB {
  open(workspaceId: string, schemaHash: string): Promise<"fresh" | "existing">;
  load(model: string): Promise<Row[]>;
  write(actions: SyncAction[]): Promise<void>; // server-approved data only
  meta: { get(): Promise<{ lastSyncId: number }>; set(m: { lastSyncId: number }): Promise<void> };
  outbox: {
    put(txs: TxRecord[]): Promise<void>;
    remove(id: string): Promise<void>;
    all(): Promise<TxRecord[]>;
  };
  wipe(): Promise<void>;
}

export interface ReactivityAdapter {
  atom(): { track(): void; notify(): void }; // one per field: read subscribes, write announces
  memo<T>(fn: () => T): () => T;
  asyncCollection<T>(load: () => Promise<T[]>): () => T[]; // waits inside <Loading>
  onUnobserved(atomOrMemo: unknown, fn: () => void): void;
  root<T>(fn: () => T): T; // owner for engine-level memos
}
