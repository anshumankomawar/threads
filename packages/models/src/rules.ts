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
import { dateToken, mentionsIn, subspaceMentionsIn, threadLink } from "./text";
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

const inSubspace = (db: Reader, userId: string, subspaceId: unknown): boolean =>
  db.all("SubspaceMember").some((m) => m.subspaceId === subspaceId && m.userId === userId);
// A subspace the user may see: one they're in, or an open one in a workspace of theirs.
const canSee = (db: Reader, userId: string, subspaceId: unknown): boolean => {
  const subspace = db.get("Subspace", subspaceId as string);
  return (
    subspace !== undefined &&
    (inSubspace(db, userId, subspace.id) ||
      (subspace.visibility === "open" && memberOf(db, userId, subspace.workspaceId) !== undefined))
  );
};
// Threads and what's in them: in the workspace, and in subspaces the user may see.
const inSpaces = (change: Change, userId: string, db: Reader): boolean =>
  inWorkspace(change, userId, db) &&
  rowsOf(change).every((row) =>
    (row.subspaceIds as string[]).every((id) => canSee(db, userId, id)),
  );

// What loads for a user: their workspaces, their own rows, and the subspaces they're in. Open subspaces they aren't in
// load when they open them (`mayRead`).
export const groupsOf = (userId: string, db: Reader): string[] => [
  ...db
    .all("Workspace")
    .filter((workspace) => memberOf(db, userId, workspace.id) !== undefined)
    .map((workspace) => `workspace:${workspace.id}`),
  `user:${userId}`,
  ...db
    .all("SubspaceMember")
    .filter((m) => m.userId === userId)
    .map((m) => `subspace:${String(m.subspaceId)}`),
];

export const mayRead = (userId: string, group: string, db: Reader): boolean =>
  group.startsWith("subspace:") && canSee(db, userId, group.slice("subspace:".length));

const rules: ServerOptions["rules"] = {
  Workspace: ({ modelId }, userId, db) => memberOf(db, userId, modelId) !== undefined,
  // `workspaceIds` is the server's: it follows the person's memberships.
  User: ({ modelId, before, after }, userId) =>
    modelId === userId &&
    JSON.stringify(before?.workspaceIds ?? []) === JSON.stringify(after?.workspaceIds ?? []),
  WorkspaceMember: (change, userId, db) =>
    rowsOf(change).every((row) => memberOf(db, userId, row.workspaceId)?.role === "admin"),
  Label: inWorkspace,
  // A subspace is made by anyone in the workspace, and changed by its members.
  Subspace: (change, userId, db) =>
    inWorkspace(change, userId, db) &&
    (change.kind === "create" || inSubspace(db, userId, change.modelId)),
  // Members add and remove anyone; you join an open subspace, or one nobody is in yet (its maker), and leave any.
  SubspaceMember: (change, userId, db) =>
    rowsOf(change).every((row) => {
      const subspace = db.get("Subspace", row.subspaceId as string);
      if (subspace === undefined || memberOf(db, userId, subspace.workspaceId) === undefined)
        return false;
      if (inSubspace(db, userId, subspace.id)) return true;
      const empty = !db.all("SubspaceMember").some((m) => m.subspaceId === subspace.id);
      return row.userId === userId && (subspace.visibility === "open" || empty);
    }),
  View: (change, userId, db) =>
    inWorkspace(change, userId, db) && rowsOf(change).every((row) => row.ownerId === userId),
  // Only the server writes these.
  Activity: () => false,
  Thread: inSpaces,
  Message: (change, userId, db) =>
    change.kind === "delete"
      ? change.before!.authorId === userId
      : change.kind === "create" &&
        change.after!.authorId === userId &&
        inSpaces(change, userId, db),
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
    changes: {
      threadId: thread.id,
      actorId,
      text,
      workspaceId: thread.workspaceId,
      subspaceIds: thread.subspaceIds,
    },
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
  if ((after.startAt ?? null) !== (before.startAt ?? null))
    lines.push(
      after.startAt == null
        ? "removed the start date"
        : `set the start date to ${dateToken(after.startAt as number)}`,
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
    // What's in a thread is seen where the thread is.
    if (
      kind === "update" &&
      JSON.stringify(after!.subspaceIds) !== JSON.stringify(before!.subspaceIds)
    )
      for (const model of ["Message", "Activity"])
        for (const row of db.all(model))
          if (row.threadId === after!.id)
            update(db, model, row.id, { subspaceIds: after!.subspaceIds });
    if (kind === "update" && userId !== undefined)
      for (const line of describeChanges(before!, after!, db))
        logActivity(db, after!, userId, line);
    if (kind === "create") {
      // Its owner gets it in their inbox only if they're on it; otherwise it's in their My Threads (or Sent, handed
      // to someone else).
      const owner = after!.ownerId as string | null;
      if (owner != null && (after!.assigneeIds as string[]).includes(owner))
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
  // A deleted subspace's threads stay, outside it, and its memberships go.
  Subspace: ({ kind, modelId }, db) => {
    if (kind !== "delete") return;
    for (const thread of db.all("Thread"))
      if ((thread.subspaceIds as string[]).includes(modelId))
        update(db, "Thread", thread.id, {
          subspaceIds: (thread.subspaceIds as string[]).filter((id) => id !== modelId),
        });
    for (const member of db.all("SubspaceMember"))
      if (member.subspaceId === modelId)
        db.write({ kind: "delete", model: "SubspaceMember", modelId: member.id });
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
    if (
      thread === undefined ||
      thread.workspaceId !== workspaceId ||
      JSON.stringify(thread.subspaceIds) !== JSON.stringify(after!.subspaceIds)
    )
      throw new Refusal("invalid", "A message's workspaceId and subspaceIds are its thread's");
    // An @mention assigns someone, and a subspace's assigns everyone in it now; a message that mentions nobody tells
    // nobody.
    const assignees = thread.assigneeIds as string[];
    const members = subspaceMentionsIn(body)
      .filter((id) => canSee(db, authorId, id))
      .flatMap((id) =>
        db
          .all("SubspaceMember")
          .filter((m) => m.subspaceId === id)
          .map((m) => m.userId as string),
      );
    const mentioned = [...new Set([...mentionsIn(body), ...members])].filter(
      (id) => id !== authorId && db.get("User", id) !== undefined,
    );
    for (const id of mentioned) deliver(db, id, threadId);
    if (mentioned.some((id) => !assignees.includes(id)))
      update(db, "Thread", threadId, { assigneeIds: [...new Set([...assignees, ...mentioned])] });
    if (mentioned.length === 0) return;
    // An owner who hands their thread to someone has it in Sent, until someone @mentions them there.
    const item = itemOf(db, authorId, threadId);
    if (authorId === thread.ownerId && !assignees.includes(authorId) && item && item.doneAt == null)
      update(db, "InboxItem", item.id, { doneAt: createdAt });
  },
};

// Who `admit` lets in, and to where: the workspace's directory entry, and the person as they signed in.
export type Admission = {
  workspace: { id: string; name: string };
  person: { id: string; name: string; email: string; avatarUrl?: string };
  role: "admin" | "member";
};

const actions: ServerOptions["actions"] = {
  // Fills a new workspace: `args` is its name.
  seed: (workspace, session, db) => {
    if (!("admin" in session)) throw new Refusal("forbidden", "Only the admin seeds a workspace");
    for (const write of seed(workspace as string)) db.write(write);
  },
  // Makes whatever of a member's place is missing: the workspace, their person and their membership. The directory
  // (apps/api) decides who's a member; this runs each time they sign in, so it changes nothing that's there.
  admit: (args, session, db) => {
    if (!("admin" in session)) throw new Refusal("forbidden", "Only the admin admits people");
    const { workspace, person, role } = args as Admission;
    if (db.get("Workspace", workspace.id) === undefined)
      db.write({
        kind: "create",
        model: "Workspace",
        modelId: workspace.id,
        changes: { name: workspace.name },
      });
    if (db.get("User", person.id) === undefined)
      db.write({
        kind: "create",
        model: "User",
        modelId: person.id,
        changes: {
          name: person.name,
          email: person.email,
          avatarUrl: person.avatarUrl ?? null,
          workspaceIds: [],
        },
      });
    if (memberOf(db, person.id, workspace.id) === undefined)
      db.write({
        kind: "create",
        model: "WorkspaceMember",
        modelId: crypto.randomUUID(),
        changes: { workspaceId: workspace.id, userId: person.id, role },
      });
  },
};

export const threadsServer = (storage: Storage, sockets: () => Iterable<Socket>): SyncServer =>
  new SyncServer({ storage, sockets, groupsOf, mayRead, rules, effects, actions });
