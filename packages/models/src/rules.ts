import type { Row } from "protocol";
import {
  Refusal,
  SyncServer,
  type Change,
  type Reader,
  type ServerOptions,
  type Socket,
  type Storage,
  type Writer,
} from "server";
import "./models";
import { DEFAULT_BUCKETS, seed } from "./seed";

const membersOf = (team: Row | undefined): string[] => (team?.memberIds ?? []) as string[];
const inTeam = (userId: string, teamId: unknown, db: Reader): boolean =>
  membersOf(db.get("Team", teamId as string)).includes(userId);

// The rows a change touches: before and after, whichever exist.
const rowsOf = ({ before, after }: Change): Row[] =>
  [before, after].filter((row) => row !== undefined);
const own = (change: Change, userId: string): boolean =>
  rowsOf(change).every((row) => row.userId === userId);

// One workspace per server, so its Workspace row is the workspace.
export const groupsOf = (userId: string, db: Reader): string[] => [
  ...db.all("Workspace").map((workspace) => `workspace:${workspace.id}`),
  `user:${userId}`,
  ...db
    .all("Team")
    .filter((team) => membersOf(team).includes(userId))
    .map((team) => `team:${team.id}`),
];

const rules: ServerOptions["rules"] = {
  User: (change, userId) => change.modelId === userId,
  Bucket: own,
  Draft: own,
  InboxItem: own,
  Team: (change, userId) => {
    const { kind, changes = {}, before, after } = change;
    if (membersOf(before ?? after).includes(userId)) return true;
    // Anyone may join: the only change is adding themselves.
    return (
      kind === "update" &&
      Object.keys(changes).every((key) => key === "memberIds") &&
      JSON.stringify(membersOf(after)) === JSON.stringify([...membersOf(before), userId])
    );
  },
  Conversation: (change, userId, db) =>
    rowsOf(change).every((row) => inTeam(userId, row.teamId, db)),
  Message: ({ kind, before, after }, userId, db) =>
    kind === "delete"
      ? before!.authorId === userId
      : kind === "create" && after!.authorId === userId && inTeam(userId, after!.teamId, db),
};

// Puts the conversation in the user's inbox, or back in it when they'd marked it done or snoozed it.
function deliver(db: Writer, userId: string, conversationId: string): void {
  const item = db
    .all("InboxItem")
    .find((row) => row.userId === userId && row.conversationId === conversationId);
  if (item === undefined)
    db.write({
      kind: "create",
      model: "InboxItem",
      modelId: crypto.randomUUID(),
      changes: { userId, conversationId, manual: false },
    });
  else if (item.doneAt != null || item.snoozedUntil != null)
    db.write({
      kind: "update",
      model: "InboxItem",
      modelId: item.id,
      changes: { doneAt: null, snoozedUntil: null },
    });
}

const setState = (db: Writer, conversationId: string, state: string): void =>
  db.write({ kind: "update", model: "Conversation", modelId: conversationId, changes: { state } });

const effects: ServerOptions["effects"] = {
  User: ({ kind, modelId }, db) => {
    if (kind === "create")
      DEFAULT_BUCKETS.forEach((bucket, position) =>
        db.write({
          kind: "create",
          model: "Bucket",
          modelId: crypto.randomUUID(),
          changes: { userId: modelId, ...bucket, position },
        }),
      );
  },
  Conversation: ({ kind, before, after }, db) => {
    if (kind === "create") {
      if (after!.ownerId != null) deliver(db, after!.ownerId as string, after!.id);
      if (after!.blocksId != null) setState(db, after!.blocksId as string, "blocked");
    }
    const blocked = after?.blocksId as string | undefined;
    if (after?.state !== "resolved" || before?.state === "resolved" || blocked == null) return;
    const stillBlocked = db
      .all("Conversation")
      .some((row) => row.blocksId === blocked && row.state !== "resolved");
    if (!stillBlocked && db.get("Conversation", blocked)?.state === "blocked")
      setState(db, blocked, "open");
  },
  Message: ({ kind, after }, db) => {
    if (kind !== "create") return;
    const { conversationId, teamId, toIds } = after as Row & {
      conversationId: string;
      teamId: string;
      toIds: string[];
    };
    if (db.get("Conversation", conversationId)?.teamId !== teamId)
      throw new Refusal("invalid", "A message's teamId is its conversation's");
    for (const toId of toIds) {
      if (!inTeam(toId, teamId, db))
        throw new Refusal("invalid", `${toId} isn't in this conversation's team`);
      deliver(db, toId, conversationId);
    }
  },
};

const actions: ServerOptions["actions"] = {
  // Fills a new workspace: `args` is its name.
  seed: (workspace, session, db) => {
    if (!("admin" in session)) throw new Refusal("forbidden", "Only the admin seeds a workspace");
    for (const write of seed(workspace as string)) db.write(write);
  },
};

export const threadsServer = (storage: Storage, sockets: () => Iterable<Socket>): SyncServer =>
  new SyncServer({ storage, sockets, groupsOf, rules, effects, actions });
