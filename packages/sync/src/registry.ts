import type { ModelMeta } from "protocol";
import type { Model } from "./model";

// A model class: what the decorators register and `Store` methods take.
export type ModelClass<T = unknown> = (new () => T) & { prototype: T };

// Every model's metadata, shared with the server, which validates mutations and builds tables from it.
export class ModelRegistry {
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

  // Changes => clients wipe their local data and bootstrap again.
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

export const registry = new ModelRegistry();

// The admin's only group: it sees everything.
export const ALL = "*";

// Whether holding `mine` you see a row in `theirs`.
export const sees = (mine: string[], theirs: string[]): boolean =>
  mine.includes(ALL) || theirs.some((group) => mine.includes(group));
