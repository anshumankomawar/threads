// The shared half of the engine: models and their metadata, with no store, IndexedDB or DOM. The server imports this.
import type { FieldMeta, ModelClass, ModelMeta, ModelRegistry } from "./api";
import {
  BASE,
  computed,
  ephemeral,
  Model,
  oneToMany,
  property,
  reference,
  type Serializer,
} from "./model";
import type { Row } from "./protocol";

export { date, Model, type Serializer } from "./model";

class Registry implements ModelRegistry {
  readonly #models = new Map<string, { meta: ModelMeta; ctor: ModelClass<Model> }>();

  register(meta: ModelMeta, ctor: ModelClass<Model>): void {
    this.#models.set(meta.name, { meta, ctor });
  }

  get(name: string): ModelMeta {
    return this.#models.get(name)!.meta;
  }

  classOf(name: string): ModelClass<Model> {
    return this.#models.get(name)!.ctor;
  }

  all(): ModelMeta[] {
    return [...this.#models.values()].map((entry) => entry.meta);
  }

  get schemaHash(): string {
    const shape = this.all()
      .map(({ name, fields }) => [
        name,
        Object.keys(fields)
          .sort()
          .map((key) => {
            const { target, ...rest } = fields[key];
            return [key, target?.().prototype.__meta.name, rest];
          }),
      ])
      .sort(([a], [b]) => (a < b ? -1 : 1));
    // FNV-1a: only has to change when the metadata does.
    let hash = 0x811c9dc5;
    for (const char of JSON.stringify(shape))
      hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
    return (hash >>> 0).toString(16);
  }
}

export const registry = new Registry();

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
    ephemeral(proto, key);
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
    reference(proto, key, foreignKey);
  };
}

// `foreignKey` is the target's reference back to this model, e.g. "conversation" for `conversationId`.
export function OneToMany(target: () => ModelClass<Model>, foreignKey: string) {
  return (proto: Model, key: string): void => {
    field(proto, key, { kind: "oneToMany", target, foreignKey: `${foreignKey}Id` });
    oneToMany(proto, key, target, `${foreignKey}Id`);
  };
}

export function Computed(
  _proto: Model,
  key: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  return computed(key, descriptor);
}
