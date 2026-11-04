import type { AnyRecord, ModelName, Models } from "./protocol";

// How a model loads, as in LSE: `instant` at bootstrap; `lazy` all at once, the first time something asks for it;
// `partial` a slice at a time, by one of its partial indexes (such as a thread's entries, by `threadId`).
export type LoadStrategy = "instant" | "lazy" | "partial";

// What the engine knows about one model, as in LSE's ModelRegistry. References are properties holding another model's
// id; reference arrays hold several. A back reference is a model that belongs to this one through one of its
// references: deleting this deletes it (LSE's `backReference`, like an issue's comments).
export type ModelDefinition = {
  loadStrategy?: LoadStrategy;
  // For a partial model: the references it can be loaded by.
  partialIndexes?: string[];
  references?: Record<string, string>;
  referenceArrays?: Record<string, string>;
  backReferences?: Record<string, { model: string; key: string }>;
  // A reference whose record's sync groups this one shares (an entry is seen by whoever sees its thread), instead of
  // its own `syncGroupsOf`.
  syncGroupsFrom?: string;
};

// A product's schema: its models and how records map to sync groups. Shared by the server and its clients.
export type SyncSchema<M extends Models> = {
  models: { [Name in ModelName<M>]: ModelDefinition };
  // Bump it when a record's shape changes, so clients discard caches built under the old one.
  version: string;
  // The sync groups a record is in: who may see it. Everything is in `WORKSPACE_GROUP` by default.
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

export function loadStrategy<M extends Models>(
  schema: SyncSchema<M>,
  modelName: ModelName<M>,
): LoadStrategy {
  return schema.models[modelName]?.loadStrategy ?? "instant";
}

// Looks a record up by model and id, wherever the caller keeps them.
export type Lookup<M extends Models> = (
  modelName: ModelName<M>,
  id: string,
) => AnyRecord<M> | undefined;

// The sync groups a record is in, following `syncGroupsFrom` to the record it shares them with. A record whose parent
// is missing is in no group.
export function syncGroupsOf<M extends Models>(
  schema: SyncSchema<M>,
  modelName: ModelName<M>,
  record: AnyRecord<M>,
  lookup: Lookup<M>,
): string[] {
  for (let depth = 0, name = modelName, current = record; depth < 8; depth++) {
    const via = schema.models[name].syncGroupsFrom;
    if (via === undefined) return schema.syncGroupsOf?.(name, current) ?? [WORKSPACE_GROUP];
    const parentName = schema.models[name].references?.[via] as ModelName<M> | undefined;
    const parentId = (current as Record<string, unknown>)[via];
    if (parentName === undefined || typeof parentId !== "string") return [];
    const parent = lookup(parentName, parentId);
    if (parent === undefined) return [];
    name = parentName;
    current = parent;
  }
  return [];
}

// The models whose groups come from `modelName` through a reference, with that reference: whose groups change with it.
export function groupDependents<M extends Models>(
  schema: SyncSchema<M>,
  modelName: ModelName<M>,
): { modelName: ModelName<M>; key: string }[] {
  return modelNames(schema).flatMap((name) => {
    const via = schema.models[name].syncGroupsFrom;
    return via !== undefined && schema.models[name].references?.[via] === modelName
      ? [{ modelName: name, key: via }]
      : [];
  });
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
