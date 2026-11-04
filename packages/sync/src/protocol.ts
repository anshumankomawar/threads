// The wire protocol between a sync server and its clients, after Linear's sync engine (LSE): clients send
// transactions, the server numbers every resulting change with a sync id, and clients apply the changes (sync actions)
// in sync id order. Nothing here knows what the models are; a schema (`schema.ts`) names them.

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

// What every transaction has. A product adds its own types (create, update, anything else); the engine adds three that
// work on any model (`BuiltInTransaction`).
export type TransactionEnvelope = { id: string; type: string; modelName: string };

export type BuiltInType = "delete" | "archive" | "unarchive";

export const BUILT_IN_TYPES: readonly BuiltInType[] = ["delete", "archive", "unarchive"];

export type BuiltInTransaction<M extends Models = Models> = {
  [Type in BuiltInType]: { id: string; type: Type; modelName: ModelName<M>; modelId: string };
}[BuiltInType];

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

// Where a session stands: the server data's identity (`epoch`, new whenever the data starts over), its sync position,
// and the sync groups the session sees (`"*"` for all of them).
export type SyncPosition = { epoch: string; lastSyncId: number; syncGroups: string[] };

// Records by model.
export type ModelSet<M extends Models> = { [Name in ModelName<M>]?: M[Name][] };

// Everything a client loads at start (the models that load `instant`), in the groups it asked for (all of its groups
// when it asked for none).
export type BootstrapResponse<M extends Models = Models> = SyncPosition & {
  schemaHash: string;
  models: ModelSet<M>;
};

// The actions after a client's sync id, for catching up, or, once the log no longer reaches back that far (it's
// compacted), a request to bootstrap afresh.
export type DeltasResponse<M extends Models = Models> = SyncPosition &
  ({ actions: SyncAction<M>[] } | { fullBootstrapRequired: true });

// A request for models that don't load at start: all of a `lazy` model, or a `partial` model's records whose `key`
// (one of its partial indexes) is `value`, as LSE's batch loader asks for them.
export type LoadRequest = { modelName: string; key?: string; value?: string };

export type LoadResponse<M extends Models = Models> = SyncPosition & { models: ModelSet<M> };

// A value that isn't persisted or logged, such as who's looking at a record (LSE's ephemeral properties). It reaches the
// sessions that can see the record, and is gone when they disconnect.
export type Ephemeral = { modelName: string; modelId: string; key: string; value: unknown };

// Messages from the server on the socket. The handshake says where the server is, so a client can tell what it missed
// while away; each delta packet holds the actions of one committed batch that this session may see (possibly none),
// with the batch's last sync id. `syncGroups` is set on the packet where the session's groups change.
export type SyncMessage<M extends Models = Models> =
  | ({ type: "handshake"; minSyncId: number } & SyncPosition)
  | {
      type: "delta";
      lastSyncId: number;
      actions: SyncAction<M>[];
      syncGroups?: string[];
    }
  | ({ type: "ephemeral"; userId: string | null } & Ephemeral);

// Messages from a client on the socket.
export type ClientMessage = { type: "ephemeral" } & Ephemeral;

// Every group: an admin session subscribes to it to see everything, and a record in it is seen by everyone.
export const ALL_GROUPS = "*";

// Whether a record in `groups` is visible to a session in `subscribed`.
export function visibleIn(groups: readonly string[], subscribed: readonly string[]): boolean {
  if (subscribed.includes(ALL_GROUPS) || groups.includes(ALL_GROUPS)) return true;
  return groups.some((group) => subscribed.includes(group));
}
