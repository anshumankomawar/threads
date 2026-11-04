import { visibleIn, type AnyRecord, type ModelName, type Models } from "../protocol";
import { modelNames, syncGroupsOf, type SyncSchema } from "../schema";

export type ModelMaps<M extends Models> = { [Name in ModelName<M>]: Map<string, M[Name]> };

export function emptyModels<M extends Models>(schema: SyncSchema<M>): ModelMaps<M> {
  return Object.fromEntries(modelNames(schema).map((name) => [name, new Map()])) as ModelMaps<M>;
}

// A staged write: the record as it will be (null to delete it), and whether it's an archive (A) or unarchive (V).
export type StagedWrite<M extends Models> = {
  modelName: ModelName<M>;
  id: string;
  data: AnyRecord<M> | null;
  action?: "A" | "V";
};

// The writes of one batch, staged until the whole batch succeeds. Reads see staged writes first, so a transaction
// sees what the ones before it in the batch did. A batch run for a session knows its sync groups, so rules can look up
// only what that session may see (`find`).
export class Batch<M extends Models> {
  readonly writes = new Map<string, StagedWrite<M>>();
  readonly #models: ModelMaps<M>;
  readonly #schema: SyncSchema<M>;
  readonly #groups: string[] | undefined;

  constructor(models: ModelMaps<M>, schema: SyncSchema<M>, groups?: string[]) {
    this.#models = models;
    this.#schema = schema;
    this.#groups = groups;
  }

  // A record the acting session can see, or undefined, as if it weren't there. Rules look up whatever a transaction
  // names with this, so nobody changes, or learns of, a record outside their groups by guessing its id. `get` reads
  // anything, for side effects the server makes on its own account.
  find<Name extends ModelName<M>>(modelName: Name, id: string): M[Name] | undefined {
    const record = this.get(modelName, id);
    if (record === undefined || this.#groups === undefined) return record;
    const groups = syncGroupsOf(this.#schema, modelName, record as AnyRecord<M>, (name, other) =>
      this.get(name, other),
    );
    return visibleIn(groups, this.#groups) ? record : undefined;
  }

  get<Name extends ModelName<M>>(modelName: Name, id: string): M[Name] | undefined {
    const staged = this.writes.get(`${modelName}:${id}`);
    if (staged !== undefined) return (staged.data ?? undefined) as M[Name] | undefined;
    return this.#models[modelName].get(id);
  }

  put<Name extends ModelName<M>>(modelName: Name, record: M[Name]): void {
    const key = `${modelName}:${record.id}`;
    // An archive staged earlier in the batch stays one when the record changes again.
    this.writes.set(key, {
      modelName,
      id: record.id,
      data: record,
      action: this.writes.get(key)?.action,
    });
  }

  // Every record of a model, counting staged writes.
  all<Name extends ModelName<M>>(modelName: Name): M[Name][] {
    const records: M[Name][] = [];
    for (const id of this.#models[modelName].keys()) {
      const record = this.get(modelName, id);
      if (record !== undefined) records.push(record);
    }
    for (const { modelName: name, id, data } of this.writes.values())
      if (name === modelName && data !== null && !this.#models[modelName].has(id))
        records.push(data as M[Name]);
    return records;
  }

  // Deletes a record, and what goes with it: the records that belong to it (its back references) are deleted too,
  // references to it elsewhere become null, and it's taken out of reference arrays.
  delete(modelName: ModelName<M>, id: string): void {
    if (this.get(modelName, id) === undefined) return;
    this.writes.set(`${modelName}:${id}`, { modelName, id, data: null });
    const owned = Object.values(this.#schema.models[modelName].backReferences ?? {});
    for (const name of modelNames(this.#schema)) {
      const definition = this.#schema.models[name];
      const references = Object.entries(definition.references ?? {}).filter(
        ([, target]) => target === modelName,
      );
      const arrays = Object.entries(definition.referenceArrays ?? {}).filter(
        ([, target]) => target === modelName,
      );
      if (references.length === 0 && arrays.length === 0) continue;
      for (const record of this.all(name)) {
        const fields = record as Record<string, unknown>;
        if (
          references.some(
            ([key]) =>
              fields[key] === id && owned.some((back) => back.model === name && back.key === key),
          )
        ) {
          this.delete(name, record.id);
          continue;
        }
        let next = fields;
        for (const [key] of references) if (next[key] === id) next = { ...next, [key]: null };
        for (const [key] of arrays) {
          const list = next[key];
          if (Array.isArray(list) && list.includes(id))
            next = { ...next, [key]: list.filter((item) => item !== id) };
        }
        if (next !== fields) this.put(name, next as M[typeof name]);
      }
    }
  }

  archive(modelName: ModelName<M>, id: string, nowMs: number): void {
    this.#setArchived(modelName, id, nowMs, "A");
  }

  unarchive(modelName: ModelName<M>, id: string): void {
    this.#setArchived(modelName, id, null, "V");
  }

  #setArchived(
    modelName: ModelName<M>,
    id: string,
    archivedAtMs: number | null,
    action: "A" | "V",
  ): void {
    const record = this.get(modelName, id);
    if (record === undefined) return;
    this.writes.set(`${modelName}:${id}`, {
      modelName,
      id,
      data: { ...record, archivedAtMs } as AnyRecord<M>,
      action,
    });
  }
}
