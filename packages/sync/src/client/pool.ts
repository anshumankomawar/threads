import type { AnyRecord, ModelName, Models } from "../protocol";
import { modelNames, type SyncSchema } from "../schema";
import { ReactiveMap } from "./reactive";

// Every loaded model by id, reactive so views update when a model changes, as in LSE's object pool. It holds what
// the user sees: the server's data with this client's pending transactions on top. Records are replaced whole rather
// than mutated, so only the maps are reactive.
export class ObjectPool<M extends Models> {
  readonly maps: { [Name in ModelName<M>]: ReactiveMap<string, M[Name]> };

  constructor(schema: SyncSchema<M>) {
    this.maps = Object.fromEntries(
      modelNames(schema).map((name) => [name, new ReactiveMap()]),
    ) as unknown as ObjectPool<M>["maps"];
  }

  get<Name extends ModelName<M>>(modelName: Name, id: string): M[Name] | undefined {
    return this.maps[modelName]?.get(id);
  }

  set(modelName: ModelName<M>, record: AnyRecord<M>): void {
    (this.maps[modelName] as ReactiveMap<string, AnyRecord<M>> | undefined)?.set(record.id, record);
  }

  delete(modelName: ModelName<M>, id: string): void {
    this.maps[modelName]?.delete(id);
  }

  clear(): void {
    for (const map of Object.values(this.maps) as ReactiveMap<string, unknown>[]) map.clear();
  }
}
