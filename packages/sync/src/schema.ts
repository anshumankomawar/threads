import type { AnyRecord, ModelName, Models } from "./protocol";

// What the engine needs to know about one model, as in LSE's ModelRegistry. References are properties holding
// another model's id; reference arrays hold several. A back reference is a model that belongs to this one through
// one of its references: deleting this deletes it (LSE's `backReference`, like an issue's comments).
export type ModelDefinition = {
  references?: Record<string, string>;
  referenceArrays?: Record<string, string>;
  backReferences?: Record<string, { model: string; key: string }>;
};

// A product's schema: its models and how records map to sync groups. Shared by the server and its clients.
export type SyncSchema<M extends Models> = {
  models: { [Name in ModelName<M>]: ModelDefinition };
  // Bump it when a record's shape changes, so clients discard caches built under the old one.
  version: string;
  // The sync groups a record is in: who may see it. A record's groups must come from its own fields, since a change
  // to another record doesn't revisit it. Everything is in `WORKSPACE_GROUP` by default.
  syncGroupsOf?: (modelName: ModelName<M>, record: AnyRecord<M>) => string[];
};

// The group every member of a workspace is in.
export const WORKSPACE_GROUP = "workspace";

export function defineSchema<M extends Models>(schema: SyncSchema<M>): SyncSchema<M> {
  return schema;
}

export function modelNames<M extends Models>(schema: SyncSchema<M>): ModelName<M>[] {
  return Object.keys(schema.models) as ModelName<M>[];
}

export function syncGroupsOf<M extends Models>(
  schema: SyncSchema<M>,
  modelName: ModelName<M>,
  record: AnyRecord<M>,
): string[] {
  return schema.syncGroupsOf?.(modelName, record) ?? [WORKSPACE_GROUP];
}

// A hash of the registry and version. A client whose cache was built under another hash rebuilds it.
export function schemaHash<M extends Models>(schema: SyncSchema<M>): string {
  return fnv1a(`${JSON.stringify(schema.models)}|${schema.version}`);
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
