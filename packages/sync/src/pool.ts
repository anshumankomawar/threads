import type { Model } from "./model";
import { announcer, type Announcer } from "./signals";

type Bucket = { models: Set<Model>; signal: Announcer };

// Every model in memory, by id, by model name (`all`) and by indexed field value (`where`, collections). Each list
// has its own signal, so a change notifies only the views that read it.
export class ObjectPool {
  readonly #models = new Map<string, Model>();
  readonly #buckets = new Map<string, Bucket>();
  // Per id, so a read of a model that isn't here yet updates when it arrives.
  readonly #ids = new Map<string, Announcer>();

  #id(id: string): Announcer {
    let signal = this.#ids.get(id);
    if (!signal) this.#ids.set(id, (signal = announcer()));
    return signal;
  }

  #bucket(model: string, field?: string, value?: unknown): Bucket {
    const key = JSON.stringify([model, field, value]);
    let bucket = this.#buckets.get(key);
    if (!bucket) this.#buckets.set(key, (bucket = { models: new Set(), signal: announcer() }));
    return bucket;
  }

  #lists(model: Model): Bucket[] {
    const { name, fields } = model.__meta;
    return [
      this.#bucket(name),
      ...Object.keys(fields)
        .filter((field) => fields[field].indexed)
        .map((field) => this.#bucket(name, field, model.__data[field])),
    ];
  }

  get(id: string): Model | undefined {
    this.#id(id).track();
    return this.#models.get(id);
  }

  ids(): string[] {
    return [...this.#models.keys()];
  }

  put(model: Model): void {
    this.#models.set(model.id, model);
    this.#id(model.id).notify();
    for (const bucket of this.#lists(model)) {
      bucket.models.add(model);
      bucket.signal.notify();
    }
  }

  remove(id: string): void {
    const model = this.#models.get(id);
    if (!model) return;
    this.#models.delete(id);
    this.#id(id).notify();
    for (const bucket of this.#lists(model)) {
      bucket.models.delete(model);
      bucket.signal.notify();
    }
  }

  // An indexed field changed: the model moves between buckets.
  move(model: Model, field: string, before: unknown, after: unknown): void {
    if (this.#models.get(model.id) !== model) return;
    const from = this.#bucket(model.__meta.name, field, before);
    const to = this.#bucket(model.__meta.name, field, after);
    from.models.delete(model);
    to.models.add(model);
    from.signal.notify();
    to.signal.notify();
  }

  byIndex(model: string, field: string, value: unknown): Model[] {
    return this.#read(this.#bucket(model, field, value));
  }

  all(model: string): Model[] {
    return this.#read(this.#bucket(model));
  }

  #read(bucket: Bucket): Model[] {
    bucket.signal.track();
    return [...bucket.models];
  }
}
