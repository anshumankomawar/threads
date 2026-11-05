import { adapter, memo } from "./adapter";
import type { Collection, FieldMeta, ModelClass, ModelMeta, Transaction } from "./api";
import type { Pool } from "./pool";
import type { Row, TxKind } from "./protocol";

type Atom = ReturnType<typeof adapter.atom>;

// What a model needs from the store it lives in.
export interface Core {
  pool: Pool;
  materialize: (model: string, row: Row) => Model;
  enqueue: (
    kind: TxKind,
    model: Model,
    changes?: Record<string, unknown>,
    original?: Record<string, unknown>,
  ) => Transaction;
}

// Converts a stored JSON value to what the field reads as, and back.
export interface Serializer {
  read(json: unknown): unknown;
  write(value: unknown): unknown;
}

export const date = {
  read: (ms: number) => new Date(ms),
  write: (value: Date) => value.getTime(),
};

export const equal = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

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
  __atoms: Record<string, Atom> = {};
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

const atom = (model: Model, key: string): Atom => (model.__atoms[key] ??= adapter.atom());

// The one way a stored field changes, for local edits and server data alike.
export function write(model: Model, field: string, value: unknown): void {
  const before = model.__data[field];
  if (equal(before, value)) return;
  model.__data[field] = value;
  atom(model, field).notify();
  if (model.__meta.fields[field].indexed) model.__store.pool.move(model, field, before, value);
}

export const unarchived = <T extends Model>(models: T[]): T[] =>
  models.filter((m) => !m.archivedAt);

export function property(proto: object, field: string, serializer?: Serializer): void {
  Object.defineProperty(proto, field, {
    configurable: true,
    get(this: Model) {
      atom(this, field).track();
      const json = this.__data[field];
      return json == null ? undefined : serializer ? serializer.read(json) : json;
    },
    set(this: Model, value: unknown) {
      const json = value == null ? null : serializer ? serializer.write(value) : value;
      const before = this.__data[field];
      if (equal(before, json)) return;
      if (!(field in this.__original)) this.__original[field] = before;
      else if (equal(this.__original[field], json)) delete this.__original[field];
      write(this, field, json);
    },
  });
}

export function ephemeral(proto: object, field: string): void {
  Object.defineProperty(proto, field, {
    configurable: true,
    get(this: Model) {
      atom(this, field).track();
      return this.__ephemeral[field];
    },
    set(this: Model, value: unknown) {
      if (this.__ephemeral[field] === value) return;
      this.__ephemeral[field] = value;
      atom(this, field).notify();
    },
  });
}

export function reference(proto: object, field: string, foreignKey: string): void {
  Object.defineProperty(proto, field, {
    configurable: true,
    get(this: Model) {
      const id = (this as unknown as Record<string, string | undefined>)[foreignKey];
      return id === undefined ? undefined : this.__store.pool.get(id);
    },
    set(this: Model, target: Model | undefined) {
      (this as unknown as Record<string, unknown>)[foreignKey] = target?.id;
    },
  });
}

export function oneToMany(
  proto: object,
  field: string,
  target: () => ModelClass<Model>,
  foreignKey: string,
): void {
  Object.defineProperty(proto, field, {
    configurable: true,
    get(this: Model) {
      return (this.__memos[field] ??= new Children(() =>
        unarchived(this.__store.pool.byIndex(target().prototype.__meta.name, foreignKey, this.id)),
      ));
    },
  });
}

export function computed(field: string, getter: PropertyDescriptor): PropertyDescriptor {
  return {
    configurable: true,
    get(this: Model) {
      return ((this.__memos[field] ??= memo(() => getter.get!.call(this))) as () => unknown)();
    },
  };
}

class Children<T extends Model> implements Collection<T> {
  constructor(readonly items: () => T[]) {}

  get length(): number {
    return this.items().length;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items()[Symbol.iterator]();
  }

  filter(fn: (m: T) => boolean): T[] {
    return this.items().filter(fn);
  }

  sorted(by: keyof T, dir: "asc" | "desc" = "asc"): T[] {
    const sign = dir === "asc" ? 1 : -1;
    return this.items().sort((a, b) => (a[by] < b[by] ? -sign : a[by] > b[by] ? sign : 0));
  }
}

export const BASE: Record<string, FieldMeta> = {
  id: { kind: "property" },
  createdAt: { kind: "property" },
  updatedAt: { kind: "property" },
  archivedAt: { kind: "property", nullable: true },
};
property(Model.prototype, "id");
for (const field of ["createdAt", "updatedAt", "archivedAt"])
  property(Model.prototype, field, date);
