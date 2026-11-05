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
import { mentionsIn } from "./text";
import { DEFAULT_BUCKETS, seed } from "./seed";

const memberOf = (db: Reader, userId: string, workspaceId: unknown): Row | undefined =>
  db.all("WorkspaceMember").find((m) => m.userId === userId && m.workspaceId === workspaceId);

// The rows a change touches: before and after, whichever exist.
const rowsOf = ({ before, after }: Change): Row[] =>
  [before, after].filter((row) => row !== undefined);
const own = (change: Change, userId: string): boolean =>
  rowsOf(change).every((row) => row.userId === userId);
const inWorkspace = (change: Change, userId: string, db: Reader): boolean =>
  rowsOf(change).every((row) => memberOf(db, userId, row.workspaceId) !== undefined);

export const groupsOf = (userId: string, db: Reader): string[] => [
  ...db
    .all("Workspace")
    .filter((workspace) => memberOf(db, userId, workspace.id) !== undefined)
    .map((workspace) => `workspace:${workspace.id}`),
  `user:${userId}`,
];

const rules: ServerOptions["rules"] = {
  Workspace: ({ modelId }, userId, db) => memberOf(db, userId, modelId) !== undefined,
  // `workspaceIds` is the server's: it follows the person's memberships.
  User: ({ modelId, before, after }, userId) =>
    modelId === userId &&
    JSON.stringify(before?.workspaceIds ?? []) === JSON.stringify(after?.workspaceIds ?? []),
  WorkspaceMember: (change, userId, db) =>
    rowsOf(change).every((row) => memberOf(db, userId, row.workspaceId)?.role === "admin"),
  Label: inWorkspace,
  Thread: inWorkspace,
  Message: ({ kind, before, after }, userId, db) =>
    kind === "delete"
      ? before!.authorId === userId
      : kind === "create" &&
        after!.authorId === userId &&
        memberOf(db, userId, after!.workspaceId) !== undefined,
  Bucket: own,
  Draft: own,
  InboxItem: own,
};

const itemOf = (db: Reader, userId: string, threadId: string): Row | undefined =>
  db.all("InboxItem").find((row) => row.userId === userId && row.threadId === threadId);
const update = (db: Writer, model: string, modelId: string, changes: Record<string, unknown>) =>
  db.write({ kind: "update", model, modelId, changes });

// Puts the thread in the user's inbox, or back in it when they'd marked it done or snoozed it.
function deliver(db: Writer, userId: string, threadId: string): void {
  const item = itemOf(db, userId, threadId);
  if (item === undefined)
    db.write({
      kind: "create",
      model: "InboxItem",
      modelId: crypto.randomUUID(),
      changes: { userId, threadId, manual: false },
    });
  else if (item.doneAt != null || item.snoozedUntil != null)
    update(db, "InboxItem", item.id, { doneAt: null, snoozedUntil: null });
}

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
  WorkspaceMember: ({ kind, before, after }, db) => {
    if (kind !== "create" && kind !== "delete") return;
    const { userId, workspaceId } = (after ?? before)!;
    const user = db.get("User", userId as string);
    if (user === undefined) return;
    const others = (user.workspaceIds as string[]).filter((id) => id !== workspaceId);
    update(db, "User", user.id, {
      workspaceIds: kind === "create" ? [...others, workspaceId] : others,
    });
  },
  Thread: ({ kind, before, after }, db) => {
    if (kind === "create") {
      // Assigned to someone else from the start, it's in its owner's Sent.
      const assigned = after!.assigneeIds as string[];
      const owner = after!.ownerId as string | null;
      if (owner != null && (assigned.length === 0 || assigned.includes(owner)))
        deliver(db, owner, after!.id);
      if (after!.blocksId != null)
        update(db, "Thread", after!.blocksId as string, { state: "blocked" });
    }
    if (after) {
      const assignees = after.assigneeIds as string[];
      const was = (before?.assigneeIds ?? []) as string[];
      for (const id of assignees) if (!was.includes(id)) deliver(db, id, after.id);
      for (const id of was)
        if (!assignees.includes(id)) {
          const item = itemOf(db, id, after.id);
          if (item) update(db, "InboxItem", item.id, { doneAt: after.updatedAt });
        }
    }
    const blocked = after?.blocksId as string | undefined;
    if (after?.state !== "resolved" || before?.state === "resolved" || blocked == null) return;
    const stillBlocked = db
      .all("Thread")
      .some((row) => row.blocksId === blocked && row.state !== "resolved");
    if (!stillBlocked && db.get("Thread", blocked)?.state === "blocked")
      update(db, "Thread", blocked, { state: "open" });
  },
  // What was in a deleted bucket is sorted again.
  Bucket: ({ kind, modelId }, db) => {
    if (kind !== "delete") return;
    for (const item of db.all("InboxItem"))
      if (item.bucketId === modelId)
        update(db, "InboxItem", item.id, { bucketId: null, manual: false });
  },
  Message: ({ kind, after }, db) => {
    if (kind !== "create") return;
    const { threadId, workspaceId, authorId, body, createdAt } = after as Row & {
      threadId: string;
      authorId: string;
      body: string;
    };
    const thread = db.get("Thread", threadId);
    if (thread === undefined || thread.workspaceId !== workspaceId)
      throw new Refusal("invalid", "A message's workspaceId is its thread's");
    // An @mention involves someone; a message that mentions nobody tells nobody.
    const assignees = thread.assigneeIds as string[];
    const mentioned = [...new Set(mentionsIn(body))].filter(
      (id) => id !== authorId && db.get("User", id) !== undefined,
    );
    if (mentioned.length === 0) return;
    for (const id of mentioned) deliver(db, id, threadId);
    if (mentioned.some((id) => !assignees.includes(id)))
      update(db, "Thread", threadId, { assigneeIds: [...new Set([...assignees, ...mentioned])] });
    // An owner who hands their thread to someone has it in Sent, until someone @mentions them there.
    const item = itemOf(db, authorId, threadId);
    if (authorId === thread.ownerId && !assignees.includes(authorId) && item && item.doneAt == null)
      update(db, "InboxItem", item.id, { doneAt: createdAt });
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
