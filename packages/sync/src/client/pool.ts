import { action, makeObservable, observable, type ObservableMap } from "mobx";
import type { AnyRecord, ModelName, Models } from "../protocol";
import { modelNames, type SyncSchema } from "../schema";

// Every loaded model by id, observable so views update when a model changes, as in LSE's object pool. It holds what
// the user sees: the server's data with this client's pending transactions on top. Records are replaced whole rather
// than mutated, so only the maps are observable.
export class ObjectPool<M extends Models> {
  readonly maps: { [Name in ModelName<M>]: ObservableMap<string, M[Name]> };

  constructor(schema: SyncSchema<M>) {
    this.maps = Object.fromEntries(
      modelNames(schema).map((name) => [name, observable.map(undefined, { deep: false })]),
    ) as unknown as ObjectPool<M>["maps"];
    makeObservable(this, { set: action, delete: action, clear: action });
  }

  get<Name extends ModelName<M>>(modelName: Name, id: string): M[Name] | undefined {
    return this.maps[modelName]?.get(id);
  }

  set(modelName: ModelName<M>, record: AnyRecord<M>): void {
    (this.maps[modelName] as ObservableMap<string, AnyRecord<M>> | undefined)?.set(
      record.id,
      record,
    );
  }

  delete(modelName: ModelName<M>, id: string): void {
    this.maps[modelName]?.delete(id);
  }

  clear(): void {
    for (const map of Object.values(this.maps) as ObservableMap[]) map.clear();
  }
}
