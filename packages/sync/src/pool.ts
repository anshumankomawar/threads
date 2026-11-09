import type { Model } from "./model";
import { Announcers } from "./signals";

// Every model in memory, by id, by model name (`all`) and by indexed field value (`where`, collections). Each list
// has its own signal, so a change notifies only the views that read it. A list with nothing in it is dropped, and so
// is a signal nothing reads, so what's held follows what's here and what's shown.
export class ObjectPool {
  readonly #models = new Map<string, Model>();
  readonly #lists = new Map<string, Set<Model>>();
  // Per id, so a read of a model that isn't here yet updates when it arrives.
  readonly #ids = new Announcers<string>();
  readonly #listSignals = new Announcers<string>();

  #keys(model: Model): string[] {
    const { name, fields } = model.__meta;
    return [
      key(name),
      ...Object.keys(fields)
        .filter((field) => fields[field].indexed)
        .map((field) => key(name, field, model.__data[field])),
    ];
  }

  #add(list: string, model: Model): void {
    let models = this.#lists.get(list);
    if (!models) this.#lists.set(list, (models = new Set()));
    models.add(model);
    this.#listSignals.notify(list);
  }

  #delete(list: string, model: Model): void {
    const models = this.#lists.get(list);
    if (!models?.delete(model)) return;
    if (models.size === 0) this.#lists.delete(list);
    this.#listSignals.notify(list);
  }

  get(id: string): Model | undefined {
    this.#ids.track(id);
    return this.#models.get(id);
  }

  ids(): string[] {
    return [...this.#models.keys()];
  }

  put(model: Model): void {
    this.#models.set(model.id, model);
    this.#ids.notify(model.id);
    for (const list of this.#keys(model)) this.#add(list, model);
  }

  remove(id: string): void {
    const model = this.#models.get(id);
    if (!model) return;
    this.#models.delete(id);
    this.#ids.notify(id);
    for (const list of this.#keys(model)) this.#delete(list, model);
  }

  // An indexed field changed: the model moves between lists.
  move(model: Model, field: string, before: unknown, after: unknown): void {
    if (this.#models.get(model.id) !== model) return;
    this.#delete(key(model.__meta.name, field, before), model);
    this.#add(key(model.__meta.name, field, after), model);
  }

  byIndex(model: string, field: string, value: unknown): Model[] {
    return this.#read(key(model, field, value));
  }

  all(model: string): Model[] {
    return this.#read(key(model));
  }

  // What's held besides the models: lists and the signals being read, for the tests.
  get held(): { lists: number; signals: number } {
    return { lists: this.#lists.size, signals: this.#ids.size + this.#listSignals.size };
  }

  #read(list: string): Model[] {
    this.#listSignals.track(list);
    return [...(this.#lists.get(list) ?? [])];
  }
}

const key = (model: string, field?: string, value?: unknown): string =>
  JSON.stringify([model, field, value]);
