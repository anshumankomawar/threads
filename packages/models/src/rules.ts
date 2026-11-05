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
import { dateToken, groupMentionsIn, mentionsIn, threadLink } from "./text";
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
  // Only the server writes these.
  Activity: () => false,
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

function logActivity(db: Writer, thread: Row, actorId: unknown, text: string): void {
  db.write({
    kind: "create",
    model: "Activity",
    modelId: crypto.randomUUID(),
    changes: { threadId: thread.id, actorId, text, workspaceId: thread.workspaceId },
  });
}

const capital = (word: unknown): string => {
  const text = String(word);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// The line for each field a person's update actually changes, from their point of view.
function describeChanges(before: Row, after: Row, db: Reader): string[] {
  const lines: string[] = [];
  if (after.title !== before.title) lines.push(`renamed this to “${String(after.title)}”`);
  if (after.state !== before.state)
    lines.push(
      before.state === "resolved" && after.state === "open"
        ? "reopened this"
        : `changed status to ${capital(after.state)}`,
    );
  if (after.priority !== before.priority)
    lines.push(
      after.priority === "none"
        ? "removed the priority"
        : `set priority to ${capital(after.priority)}`,
    );
  if ((after.dueAt ?? null) !== (before.dueAt ?? null))
    lines.push(
      after.dueAt == null
        ? "removed the due date"
        : `set the due date to ${dateToken(after.dueAt as number)}`,
    );
  const [was, now] = [before.labelIds as string[], after.labelIds as string[]];
  for (const id of now.filter((label) => !was.includes(label)))
    lines.push(`labelled this ${(db.get("Label", id)?.name as string | undefined) ?? "something"}`);
  for (const id of was.filter((label) => !now.includes(label)))
    lines.push(`removed the ${(db.get("Label", id)?.name as string | undefined) ?? "old"} label`);
  return lines;
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
  Thread: ({ kind, before, after, userId }, db) => {
    if (kind === "update" && userId !== undefined)
      for (const line of describeChanges(before!, after!, db))
        logActivity(db, after!, userId, line);
    if (kind === "create") {
      // Assigned to someone else from the start, it's in its owner's Sent.
      const assigned = after!.assigneeIds as string[];
      const owner = after!.ownerId as string | null;
      if (owner != null && (assigned.length === 0 || assigned.includes(owner)))
        deliver(db, owner, after!.id);
      const blocks =
        after!.blocksId != null ? db.get("Thread", after!.blocksId as string) : undefined;
      if (blocks) {
        update(db, "Thread", blocks.id, { state: "blocked" });
        logActivity(db, blocks, owner, `is blocked on ${threadLink(after!.id)}`);
      }
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
    const waiting = db.get("Thread", blocked);
    if (!stillBlocked && waiting?.state === "blocked") {
      update(db, "Thread", blocked, { state: "open" });
      logActivity(
        db,
        waiting,
        waiting.ownerId,
        `is unblocked, ${threadLink(after.id)} is resolved`,
      );
    }
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
    // An @mention involves someone, and a group's is everyone in it now; a message that mentions nobody tells nobody.
    const assignees = thread.assigneeIds as string[];
    const labelIds = thread.labelIds as string[];
    const groups = groupMentionsIn(body)
      .map((id) => db.get("Label", id))
      .filter((label) => label?.workspaceId === workspaceId) as Row[];
    const mentioned = [
      ...new Set([...mentionsIn(body), ...groups.flatMap((g) => g.memberIds as string[])]),
    ].filter((id) => id !== authorId && db.get("User", id) !== undefined);
    if (mentioned.length === 0 && groups.length === 0) return;
    for (const id of mentioned) deliver(db, id, threadId);
    if (
      mentioned.some((id) => !assignees.includes(id)) ||
      groups.some((g) => !labelIds.includes(g.id))
    )
      update(db, "Thread", threadId, {
        assigneeIds: [...new Set([...assignees, ...mentioned])],
        labelIds: [...new Set([...labelIds, ...groups.map((g) => g.id)])],
      });
    if (mentioned.length === 0) return;
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
