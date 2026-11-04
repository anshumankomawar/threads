// The wire protocol between a sync server and its clients, after Linear's sync engine (LSE): clients send
// transactions, the server numbers every resulting change with a sync id, and clients apply the changes (sync
// actions) in sync id order. Nothing here knows what the models are; a schema (`schema.ts`) names them.

// Every model has an id, made on the client for anything a client creates. `archivedAtMs` is set while it's archived.
export type SyncRecord = { id: string; archivedAtMs?: number | null };

// A product's models: each model's name and the shape of its records.
export type Models = { [modelName: string]: SyncRecord };

export type ModelName<M extends Models> = keyof M & string;

export type AnyRecord<M extends Models> = M[ModelName<M>];

// I(nsert), U(pdate), D(elete), A(rchive) and (unarchi)V(e), as in LSE. Every action but a delete carries the whole
// record as it now is.
export type ActionType = "I" | "U" | "D" | "A" | "V";

// One change, numbered by sync id. A client applies them in order.
export type SyncAction<M extends Models = Models> = {
  id: number;
  modelName: ModelName<M>;
  modelId: string;
  action: ActionType;
  data: AnyRecord<M> | null;
};

// What every transaction has. A product adds its own types (create, update, anything else); the engine adds three
// that work on any model: delete, archive and unarchive (`BuiltInTransaction`).
export type TransactionEnvelope = { id: string; type: string; modelName: string };

export type BuiltInType = "delete" | "archive" | "unarchive";

export type BuiltInTransaction<M extends Models = Models> = {
  [Type in BuiltInType]: { id: string; type: Type; modelName: ModelName<M>; modelId: string };
}[BuiltInType];

export const BUILT_IN_TYPES = ["delete", "archive", "unarchive"] as const;

export const isBuiltIn = (transaction: TransactionEnvelope): transaction is BuiltInTransaction =>
  (BUILT_IN_TYPES as readonly string[]).includes(transaction.type);

// One request's transactions, executed all or nothing. `actorId` is who made them: with a user's session it must be
// that user. `utcOffsetMinutes` is their time zone, for anything the server writes in words ("due Fri, Nov 7").
export type TransactionBatch<T extends TransactionEnvelope = TransactionEnvelope> = {
  actorId: string;
  utcOffsetMinutes?: number;
  transactions: T[];
};

export type TransactionBatchResponse = { lastSyncId: number };

// Where a client stands: the server's data identity and sync position. `epoch` changes when the server's data starts
// over (a reset), so a client can tell its cache is from another life even if the sync ids have caught up since.
// `syncGroups` are the groups this session sees (`"*"` for all of them).
export type SyncPosition = { epoch: string; lastSyncId: number; syncGroups: string[] };

// Everything a client needs to start, in the groups it asked for (all of its groups when it asked for none).
export type BootstrapResponse<M extends Models = Models> = SyncPosition & {
  schemaHash: string;
  models: { [Name in ModelName<M>]?: M[Name][] };
};

// The actions after a client's sync id, for catching up, or, once the log no longer reaches back that far
// (it's compacted), a request to bootstrap afresh.
export type DeltasResponse<M extends Models = Models> = SyncPosition &
  ({ actions: SyncAction<M>[] } | { fullBootstrapRequired: true });

// Messages on the socket. The handshake says where the server is; each delta packet covers the sync ids after
// `fromSyncId` up to `lastSyncId`, holding the actions in them this client may see (possibly none). `syncGroups` is
// set on the packet where this client's groups change.
export type SyncMessage<M extends Models = Models> =
  | ({ type: "handshake"; minSyncId: number } & SyncPosition)
  | {
      type: "delta";
      fromSyncId: number;
      lastSyncId: number;
      actions: SyncAction<M>[];
      syncGroups?: string[];
    };

// Every group: an admin session subscribes to it to see everything, and a record in it is seen by everyone.
export const ALL_GROUPS = "*";

// Whether a record in `groups` is visible to a session in `subscribed`.
export function visibleIn(groups: readonly string[], subscribed: readonly string[]): boolean {
  if (subscribed.includes(ALL_GROUPS) || groups.includes(ALL_GROUPS)) return true;
  return groups.some((group) => subscribed.includes(group));
}
