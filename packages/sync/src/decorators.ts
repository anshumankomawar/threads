import type { FieldMeta, ModelMeta, Row } from "protocol";
import { equal, Model, signal, unarchived, write } from "./model";
import { registry, type ModelClass } from "./registry";
import { memo } from "./signals";

export interface Collection<T> extends Iterable<T> {
  readonly length: number;
  filter(fn: (m: T) => boolean): T[];
  sorted(by: keyof T, dir?: "asc" | "desc"): T[];
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

function property(proto: object, field: string, serializer?: Serializer): void {
  Object.defineProperty(proto, field, {
    configurable: true,
    get(this: Model) {
      signal(this, field).track();
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

const BASE: Record<string, FieldMeta> = {
  id: { kind: "property" },
  createdAt: { kind: "property" },
  updatedAt: { kind: "property" },
  archivedAt: { kind: "property", nullable: true },
};
property(Model.prototype, "id");
for (const field of ["createdAt", "updatedAt", "archivedAt"])
  property(Model.prototype, field, date);

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

// Field metadata collected by the field decorators, which run before their class's @ClientModel.
const pending = new WeakMap<object, Record<string, FieldMeta>>();

function field(proto: object, key: string, meta: FieldMeta): void {
  let fields = pending.get(proto);
  if (!fields) pending.set(proto, (fields = {}));
  fields[key] = meta;
}

export function ClientModel(name: string, options: { syncGroup?: (row: Row) => string[] } = {}) {
  return (ctor: ModelClass<Model>): void => {
    const meta: ModelMeta = {
      name,
      fields: { ...BASE, ...pending.get(ctor.prototype) },
      syncGroup: options.syncGroup,
    };
    ctor.prototype.__meta = meta;
    registry.register(meta, ctor);
  };
}

export function Property(
  options: {
    enum?: readonly string[];
    indexed?: boolean;
    nullable?: boolean;
    serializer?: Serializer;
  } = {},
) {
  const { serializer, ...meta } = options;
  return (proto: Model, key: string): void => {
    field(proto, key, { kind: "property", ...meta });
    property(proto, key, serializer);
  };
}

export function Ephemeral() {
  return (proto: Model, key: string): void => {
    field(proto, key, { kind: "ephemeral" });
    Object.defineProperty(proto, key, {
      configurable: true,
      get(this: Model) {
        signal(this, key).track();
        return this.__ephemeral[key];
      },
      set(this: Model, value: unknown) {
        if (this.__ephemeral[key] === value) return;
        this.__ephemeral[key] = value;
        signal(this, key).notify();
      },
    });
  };
}

// `back` names the inverse side (a OneToMany on the target); the engine doesn't need it.
export function Reference(
  target: () => ModelClass<Model>,
  _back?: string,
  options: { nullable?: boolean } = {},
) {
  return (proto: Model, key: string): void => {
    const foreignKey = `${key}Id`;
    field(proto, foreignKey, { kind: "property", indexed: true, nullable: options.nullable });
    field(proto, key, { kind: "reference", target, foreignKey, nullable: options.nullable });
    property(proto, foreignKey);
    Object.defineProperty(proto, key, {
      configurable: true,
      get(this: Model) {
        const id = (this as unknown as Record<string, string | undefined>)[foreignKey];
        return id === undefined ? undefined : this.__store.pool.get(id);
      },
      set(this: Model, model: Model | undefined) {
        (this as unknown as Record<string, unknown>)[foreignKey] = model?.id;
      },
    });
  };
}

// `foreignKey` is the target's reference back to this model, e.g. "conversation" for `conversationId`.
export function OneToMany(target: () => ModelClass<Model>, foreignKey: string) {
  const id = `${foreignKey}Id`;
  return (proto: Model, key: string): void => {
    field(proto, key, { kind: "oneToMany", target, foreignKey: id });
    Object.defineProperty(proto, key, {
      configurable: true,
      get(this: Model) {
        return (this.__memos[key] ??= new Children(() =>
          unarchived(this.__store.pool.byIndex(target().prototype.__meta.name, id, this.id)),
        ));
      },
    });
  };
}

export function Computed(
  _proto: Model,
  key: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  return {
    configurable: true,
    get(this: Model) {
      return ((this.__memos[key] ??= memo(() => descriptor.get!.call(this))) as () => unknown)();
    },
  };
}
