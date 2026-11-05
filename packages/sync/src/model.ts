import type { ModelMeta, Row, TxKind } from "protocol";
import type { ObjectPool } from "./pool";
import { announcer, type Announcer } from "./signals";
import { Tx, type Transaction } from "./transactions";

// What a model needs from the store it lives in.
export type Core = {
  pool: ObjectPool;
  materialize: (model: string, row: Row) => Model;
  enqueue: (
    kind: TxKind,
    model: Model,
    changes?: Record<string, unknown>,
    original?: Record<string, unknown>,
  ) => Transaction;
};

export const equal = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

export class Model {
  declare readonly id: string;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
  declare archivedAt?: Date;
  declare __meta: ModelMeta; // on the prototype, from @ClientModel
  __data!: Row;
  __store!: Core;
  // Unsaved edits: each edited field's value before its first edit.
  __original: Record<string, unknown> = {};
  __persisted = false;
  __signals: Record<string, Announcer> = {};
  __memos: Record<string, unknown> = {};
  __ephemeral: Record<string, unknown> = {};

  get isPersisted(): boolean {
    return this.__persisted;
  }

  get changedFields(): string[] {
    return Object.keys(this.__original);
  }

  save(): Transaction {
    const original = this.__original;
    if (Object.keys(original).length === 0) {
      const done = new Tx(crypto.randomUUID());
      done.settle();
      return done;
    }
    this.__original = {};
    const changes = Object.fromEntries(Object.keys(original).map((f) => [f, this.__data[f]]));
    return this.__store.enqueue("update", this, changes, original);
  }

  archive(): Transaction {
    return this.#setArchived("archive", Date.now());
  }

  unarchive(): Transaction {
    return this.#setArchived("unarchive", null);
  }

  #setArchived(kind: TxKind, archivedAt: number | null): Transaction {
    const original = { archivedAt: this.__data.archivedAt };
    write(this, "archivedAt", archivedAt);
    return this.__store.enqueue(kind, this, { archivedAt }, original);
  }

  delete(): Transaction {
    this.__store.pool.remove(this.id);
    return this.__store.enqueue("delete", this, undefined, { ...this.__data });
  }

  discardChanges(): void {
    for (const [field, value] of Object.entries(this.__original)) write(this, field, value);
    this.__original = {};
  }
}

export const signal = (model: Model, field: string): Announcer =>
  (model.__signals[field] ??= announcer());

// The one way a stored field changes, for local edits and server data alike.
export function write(model: Model, field: string, value: unknown): void {
  const before = model.__data[field];
  if (equal(before, value)) return;
  model.__data[field] = value;
  signal(model, field).notify();
  if (model.__meta.fields[field].indexed) model.__store.pool.move(model, field, before, value);
}

export const unarchived = <T extends Model>(models: T[]): T[] =>
  models.filter((m) => !m.archivedAt);
