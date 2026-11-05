// The wire protocol and model metadata, exactly as the Sync Engine v1 spec defines them. Client, server and tests all
// build against these.

// A model's stored values as JSON. Every row has `id`, `createdAt`, `updatedAt` and `archivedAt` (ms since epoch).
export type Row = { id: string; [field: string]: unknown };

export type TxKind = "create" | "update" | "archive" | "unarchive" | "delete";

// What is stored in the outbox and sent to the server.
export interface TxRecord {
  id: string; // idempotency key
  kind: TxKind;
  model: string;
  modelId: string;
  changes?: Record<string, unknown>; // create/update: new values
  original?: Record<string, unknown>; // for rollback and rebase
  batch: number; // same tick = same batch
}

export type SyncAction = {
  id: number;
  txId: string;
  model: string;
  modelId: string;
  action: "I" | "U" | "A" | "R" | "D";
  data?: Row;
};

// POST /sync/mutate
export type MutateRequest = { transactions: TxRecord[] };
export type MutateResponse = {
  results: Array<
    | { txId: string; ok: true; syncId: number }
    | {
        txId: string;
        ok: false;
        code: "forbidden" | "invalid" | "conflict" | "not_found";
        message: string;
      }
  >;
};

// WebSocket, server -> client
export type DeltaPacket = { type: "delta"; actions: SyncAction[]; lastSyncId: number };
export type GroupsChanged = { type: "groups"; added: string[]; removed: string[] }; // v1: client re-bootstraps
export type ServerMessage = DeltaPacket | GroupsChanged;

// WebSocket, client -> server
export type Hello = { type: "hello"; lastSyncId: number; token: string };

// GET /sync/bootstrap streams one `BootstrapLine` per row, then a `BootstrapEnd`, as newline-delimited JSON.
export type BootstrapLine = { model: string; row: Row };
export type BootstrapEnd = { lastSyncId: number; schemaHash: string };

// GET /sync/deltas?after=<id>
export type DeltasResponse = { actions: SyncAction[]; lastSyncId: number };

// POST /actions/<name>
export type ActionResponse = { lastSyncId: number };

export interface FieldMeta {
  kind: "property" | "ephemeral" | "reference" | "oneToMany";
  target?: () => { prototype: { __meta: ModelMeta } }; // a reference's model class, by the time it's read
  foreignKey?: string; // e.g. "ownerId"
  indexed?: boolean;
  nullable?: boolean;
  enum?: readonly string[];
}

export interface ModelMeta {
  name: string;
  fields: Record<string, FieldMeta>;
  syncGroup?: (row: Row) => string[];
}
