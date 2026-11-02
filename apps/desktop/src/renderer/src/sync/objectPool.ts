import { action, makeObservable, observable, type ObservableMap } from "mobx";
import type { AnyRecord, ModelName, ModelRecords } from "model";

// Every loaded model by id, observable so views update when a model changes, as in LSE's object pool. It holds
// what the user sees: the server's data with this client's pending transactions applied on top.
export class ObjectPool {
  readonly maps: { [Name in ModelName]: ObservableMap<string, ModelRecords[Name]> } = {
    // Records are replaced whole rather than mutated, so only the maps need to be observable.
    Person: observable.map(undefined, { deep: false }),
    Thread: observable.map(undefined, { deep: false }),
    Entry: observable.map(undefined, { deep: false }),
    Organization: observable.map(undefined, { deep: false }),
    Label: observable.map(undefined, { deep: false }),
    Group: observable.map(undefined, { deep: false }),
  };

  constructor() {
    makeObservable(this, { set: action, delete: action, clear: action });
  }

  get<Name extends ModelName>(modelName: Name, id: string): ModelRecords[Name] | undefined {
    return this.maps[modelName].get(id);
  }

  set(modelName: ModelName, record: AnyRecord): void {
    (this.maps[modelName] as ObservableMap<string, AnyRecord>).set(record.id, record);
  }

  delete(modelName: ModelName, id: string): void {
    this.maps[modelName].delete(id);
  }

  clear(): void {
    for (const map of Object.values(this.maps)) map.clear();
  }
}
