// A small product to test the engine with: notes, private to their owner unless they're in a team, with tags (a list,
// patched with add and remove), comments that belong to a note and are seen by whoever sees it (loaded a note at a time,
// partially), stickers (a lazy model), and teams whose members see the team's notes.
import {
  applyPatch,
  defineSchema,
  invertPatch,
  WORKSPACE_GROUP,
  type BuiltInTransaction,
  type ClientMutations,
  type Patch,
  type SyncMessage,
} from "../src";
import {
  memoryDatabase,
  RejectedError,
  SyncClient,
  UnauthorizedError,
  type ClientEvent,
  type SyncDatabase,
  type Transport,
} from "../src/client";
import {
  broadcast,
  receive,
  SyncError,
  SyncServer,
  type HubSocket,
  type ServerEvent,
  type Session,
  type SyncStorage,
} from "../src/server";

export type Note = {
  id: string;
  ownerId: string;
  teamId: string | null;
  text: string;
  tagIds: string[];
  archivedAtMs?: number | null;
};
export type Comment = { id: string; noteId: string; text: string };
export type Sticker = { id: string; name: string };
export type Team = { id: string; memberIds: string[] };
export type User = { id: string; name: string };
export type TestModels = {
  User: User;
  Note: Note;
  Comment: Comment;
  Sticker: Sticker;
  Team: Team;
};

export type TestTransaction =
  | { id: string; type: "create"; modelName: "Note"; data: Omit<Note, "ownerId"> }
  | { id: string; type: "create"; modelName: "Comment"; data: Comment }
  | { id: string; type: "update"; modelName: "Note"; modelId: string; changes: Patch<Note> }
  | { id: string; type: "update"; modelName: "Team"; modelId: string; changes: Patch<Team> };

export const schema = defineSchema<TestModels>({
  version: "test:v1",
  models: {
    User: {},
    Note: {
      references: { ownerId: "User", teamId: "Team" },
      referenceArrays: { tagIds: "Sticker" },
      backReferences: { comments: { model: "Comment", key: "noteId" } },
    },
    Comment: {
      loadStrategy: "partial",
      partialIndexes: ["noteId"],
      references: { noteId: "Note" },
      syncGroupsFrom: "noteId",
    },
    Sticker: { loadStrategy: "lazy" },
    Team: { referenceArrays: { memberIds: "User" } },
  },
  syncGroupsOf: (modelName, record) => {
    if (modelName !== "Note") return [WORKSPACE_GROUP];
    const note = record as Note;
    return note.teamId === null ? [`user:${note.ownerId}`] : [`team:${note.teamId}`];
  },
});

export const mutations: ClientMutations<TestModels, TestTransaction> = {
  touches: (input) => [
    input.type === "create"
      ? { modelName: input.modelName, id: input.data.id }
      : { modelName: input.modelName, id: input.modelId },
  ],
  change: (input, _modelName, record, { actorId }) => {
    if (input.type === "create")
      return (
        record ?? (input.modelName === "Note" ? { ...input.data, ownerId: actorId } : input.data)
      );
    return record === undefined
      ? undefined
      : applyPatch(record as Note & Team, input.changes as Patch<Note & Team>);
  },
  inverse: (input, before) => {
    if (input.type === "create")
      return { type: "delete", modelName: input.modelName, modelId: input.data.id };
    const was = before.get(`${input.modelName}:${input.modelId}`);
    if (was === undefined) return null;
    return {
      ...input,
      changes: invertPatch(was as Note & Team, input.changes as Patch<Note & Team>),
    };
  },
};

export function createServer(
  storage?: SyncStorage<TestModels>,
  now = () => 1_000,
  onEvent?: (event: ServerEvent) => void,
) {
  return new SyncServer<TestModels, TestTransaction>({
    schema,
    storage,
    now,
    onEvent,
    groupsFor: (userId, models) => [
      WORKSPACE_GROUP,
      `user:${userId}`,
      ...[...models.Team.values()]
        .filter((team) => team.memberIds.includes(userId))
        .map((team) => `team:${team.id}`),
    ],
    apply: (batch, transaction, { actorId, nowMs }) => {
      if (transaction.type === "delete") {
        if (transaction.modelName === "Comment")
          return batch.delete("Comment", transaction.modelId);
        const note = batch.get("Note", transaction.modelId);
        if (note?.ownerId !== actorId) throw new SyncError(403, "Only its owner deletes a note");
        return batch.delete("Note", transaction.modelId);
      }
      if (transaction.type === "archive")
        return batch.archive(transaction.modelName, transaction.modelId, nowMs);
      if (transaction.type === "unarchive")
        return batch.unarchive(transaction.modelName, transaction.modelId);
      if (transaction.type === "create") {
        if (transaction.modelName === "Comment") {
          if (batch.get("Note", transaction.data.noteId) === undefined)
            throw new SyncError(404, "Note not found");
          return batch.put("Comment", transaction.data);
        }
        return batch.put("Note", { ...transaction.data, ownerId: actorId });
      }
      if (transaction.modelName === "Team") {
        const team = batch.get("Team", transaction.modelId);
        if (team === undefined) throw new SyncError(404, "Team not found");
        return batch.put("Team", applyPatch(team, transaction.changes));
      }
      const note = batch.get("Note", transaction.modelId);
      if (note === undefined) throw new SyncError(404, "Note not found");
      batch.put("Note", applyPatch(note, transaction.changes));
    },
  });
}

export type TestServer = ReturnType<typeof createServer>;
export type TestClient = SyncClient<TestModels, TestTransaction>;
export type TestDatabase = SyncDatabase<
  TestModels,
  TestTransaction | BuiltInTransaction<TestModels>
>;

type Socket = HubSocket & {
  paused: boolean;
  handlers: Parameters<Transport<TestModels, TestTransaction>["connect"]>[0];
};

// Wires clients to a server in memory, as the Durable Object does: a socket per client, each packet filtered for its
// session. Sockets can be paused to lose packets, clients taken offline, and the server swapped to simulate a reset.
export class Hub {
  server: TestServer;
  readonly sockets = new Set<Socket>();
  readonly offline = new Set<string>();

  constructor(server: TestServer = createServer()) {
    this.server = server;
    this.#listen();
  }

  #listen(): void {
    this.server.onCommit = (actions, fromSyncId) =>
      broadcast(this.server, this.sockets, actions, fromSyncId);
  }

  // Replaces the server (a reset, or a restart from the same storage), dropping every socket.
  replace(server: TestServer): void {
    this.server = server;
    this.#listen();
    const dropped = Array.from(this.sockets);
    this.sockets.clear();
    for (const socket of dropped) socket.handlers.onClose();
  }

  socketOf(userId: string): Socket {
    const socket = Array.from(this.sockets).find(
      (candidate) => "userId" in candidate.session && candidate.session.userId === userId,
    );
    if (socket === undefined) throw new Error(`${userId} isn't connected`);
    return socket;
  }

  transport(session: Session): Transport<TestModels, TestTransaction> {
    const copy = <V>(value: V): V => JSON.parse(JSON.stringify(value)) as V;
    const reachable = (): void => {
      if ("userId" in session && this.offline.has(session.userId)) throw new Error("offline");
    };
    return {
      bootstrap: async (onlyGroups) => {
        reachable();
        return copy(this.server.bootstrap(session, onlyGroups));
      },
      deltas: async (after) => {
        reachable();
        return copy(this.server.deltas(session, after));
      },
      load: async (requests) => {
        reachable();
        return copy(this.server.load(session, requests));
      },
      send: async (batch) => {
        reachable();
        try {
          this.server.execute(copy(batch), session);
        } catch (error) {
          if (error instanceof SyncError)
            throw error.status === 401
              ? new UnauthorizedError(error.message)
              : new RejectedError(error.message);
          throw error;
        }
        return { lastSyncId: this.server.lastSyncId };
      },
      connect: (handlers) => {
        const socket: Socket = {
          session,
          groups: this.server.groupsOf(session),
          paused: false,
          handlers,
          setGroups(groups) {
            socket.groups = groups;
          },
          send(message) {
            if (!socket.paused) handlers.onMessage(JSON.parse(message) as SyncMessage<TestModels>);
          },
        };
        this.sockets.add(socket);
        queueMicrotask(() => {
          handlers.onOpen();
          handlers.onMessage(copy(this.server.handshake(session)));
        });
        return {
          close: () => void this.sockets.delete(socket),
          send: (message) => receive(this.server, this.sockets, socket, JSON.stringify(message)),
        };
      },
    };
  }

  client(
    userId: string,
    database: TestDatabase = memoryDatabase(),
    onEvent?: (event: ClientEvent) => void,
  ): TestClient {
    return new SyncClient<TestModels, TestTransaction>({
      schema,
      mutations,
      transport: this.transport({ userId }),
      openDatabase: async () => database,
      onEvent,
      // Quick reconnects, so tests don't wait out a real backoff.
      reconnect: { minMs: 5, maxMs: 20 },
    });
  }
}

// Lets queued microtasks, timers and promise chains run.
export async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

let counter = 0;
export const txId = (): string => `tx-${++counter}`;

export function seedUsers(server: TestServer, ...ids: string[]): void {
  server.write((batch) => {
    for (const id of ids) batch.put("User", { id, name: id });
  });
}

export const note = (
  id: string,
  text = "Hello",
  teamId: string | null = null,
): TestTransaction => ({
  id: txId(),
  type: "create",
  modelName: "Note",
  data: { id, text, teamId, tagIds: [] },
});

export const editNote = (id: string, changes: Patch<Note>): TestTransaction => ({
  id: txId(),
  type: "update",
  modelName: "Note",
  modelId: id,
  changes,
});

export const comment = (id: string, noteId: string, text = "Hi"): TestTransaction => ({
  id: txId(),
  type: "create",
  modelName: "Comment",
  data: { id, noteId, text },
});
