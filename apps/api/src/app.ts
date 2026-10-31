import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  localPeople,
  PRIORITY_LABELS,
  samplePeople,
  sampleThreads,
  STATUS_LABELS,
  type Entry,
  type Person,
  type Thread,
} from "model";
import { z } from "zod";
import { openThreadsFor } from "./inbox.ts";
import {
  createEntryBody,
  createInboxBody,
  createThreadBody,
  createUserBody,
  editEntryBody,
  editThreadBody,
  scheduleQuery,
  type Store,
} from "./model.ts";
import { buildSchedule } from "./schedule.ts";

const firstLine = (text: string): string => text.split("\n")[0].slice(0, 80);

function validate<Target extends "json" | "query", Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: z.prettifyError(result.error) }, 400);
  });
}

type Edits = Omit<z.infer<typeof editThreadBody>, "actor" | "assignee"> & {
  assignee?: Person;
};

// The activity line for each field an edit actually changes, phrased from the actor's point of view.
function describeEdits(thread: Thread, edits: Edits, actor: Person): string[] {
  const lines: string[] = [];
  if (edits.title !== undefined && edits.title !== thread.title)
    lines.push(`renamed this to “${edits.title}”`);
  if (edits.status !== undefined && edits.status !== thread.status)
    lines.push(
      thread.status === "done" && edits.status === "open"
        ? "reopened this"
        : `changed status to ${STATUS_LABELS[edits.status]}`,
    );
  if (edits.priority !== undefined && edits.priority !== thread.priority)
    lines.push(
      edits.priority === "none"
        ? "removed the priority"
        : `set priority to ${PRIORITY_LABELS[edits.priority]}`,
    );
  if (edits.dueAtMs !== undefined && edits.dueAtMs !== thread.dueAtMs)
    lines.push(
      edits.dueAtMs === null
        ? "removed the due date"
        : `set the due date to ${new Date(edits.dueAtMs).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`,
    );
  if (edits.assignee !== undefined && edits.assignee.id !== thread.assignee?.id)
    lines.push(
      edits.assignee.id === actor.id ? "took this on" : `assigned this to ${edits.assignee.name}`,
    );
  if (edits.schedule !== undefined && edits.schedule?.startMs !== thread.schedule?.startMs)
    lines.push(
      edits.schedule === null
        ? "removed it from the schedule"
        : `scheduled this for ${new Date(edits.schedule.startMs).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`,
    );
  return lines;
}

// Each workspace is its own set of people and threads. "local" starts with a few people and no threads, for
// trying the app as each of them; "sample" is the demo team with their threads, for seeing the UX with data in it.
const WORKSPACES = ["local", "sample"] as const;
export type Workspace = (typeof WORKSPACES)[number];

export type AppOptions = {
  now?: () => number;
  // Who runs the app: seeds both workspaces, with the sample threads addressed to you.
  me?: Person;
};

const emptyStore = (): Store => ({ people: new Map(), threads: new Map(), inboxes: new Map() });

// Data lives in memory for now, so it's gone (or reseeded) when the server restarts. Requests pick a workspace
// with the X-Workspace header.
export function createApp({ now = Date.now, me }: AppOptions = {}) {
  const stores: Record<Workspace, Store> = { local: emptyStore(), sample: emptyStore() };
  if (me !== undefined) {
    for (const person of localPeople()) stores.local.people.set(person.id, person);
    for (const person of samplePeople(me)) stores.sample.people.set(person.id, person);
    for (const thread of sampleThreads(me, now())) stores.sample.threads.set(thread.id, thread);
  }
  const app = new Hono<{ Variables: { store: Store } }>();
  // The desktop renderer runs on its own dev origin (or file://), so it needs CORS to reach the API.
  app.use(cors());
  app.use(async (c, next) => {
    const workspace = c.req.header("X-Workspace") ?? "local";
    if (!(WORKSPACES as readonly string[]).includes(workspace))
      return c.json({ error: `Unknown workspace: ${workspace}` }, 400);
    c.set("store", stores[workspace as Workspace]);
    await next();
  });

  const missingUser = (id: string): { error: string } => ({ error: `User not found: ${id}` });
  const missingThread = { error: "Thread not found" };

  const save = (store: Store, thread: Thread): Thread => {
    store.threads.set(thread.id, thread);
    return thread;
  };

  app.get("/", (c) => c.text("Hello Hono!"));

  app.get("/users", (c) => c.json([...c.var.store.people.values()]));

  app.post("/users", validate("json", createUserBody), (c) => {
    const { firstName, lastName, level, role, manager } = c.req.valid("json");
    if (manager !== undefined && !c.var.store.people.has(manager))
      return c.json(missingUser(manager), 404);
    const person: Person = {
      id: crypto.randomUUID(),
      name: `${firstName} ${lastName}`,
      level,
      role,
      ...(manager === undefined ? {} : { managerId: manager }),
    };
    c.var.store.people.set(person.id, person);
    return c.json(person, 201);
  });

  // Every thread, most recently active first.
  app.get("/threads", (c) =>
    c.json([...c.var.store.threads.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs)),
  );

  app.post("/threads", validate("json", createThreadBody), (c) => {
    const body = c.req.valid("json");
    const ids = [
      body.creator,
      ...(body.assignee === null ? [] : [body.assignee]),
      ...body.invitees,
    ];
    const unknown = ids.find((id) => !c.var.store.people.has(id));
    if (unknown !== undefined) return c.json(missingUser(unknown), 404);
    const person = (id: string): Person => c.var.store.people.get(id)!;
    const creator = person(body.creator);
    const createdAtMs = now();
    const thread: Thread = {
      id: crypto.randomUUID(),
      kind: body.kind,
      title: firstLine(body.text),
      requester: creator,
      // A focus block is your own work, so it's yours unless said otherwise.
      assignee:
        body.assignee !== null ? person(body.assignee) : body.kind === "focus" ? creator : null,
      status: "open",
      priority: "none",
      dueAtMs: null,
      schedule: body.schedule,
      attendees:
        body.kind === "meeting"
          ? [creator, ...body.invitees.filter((id) => id !== creator.id).map(person)]
          : [],
      updatedAtMs: createdAtMs,
      entries: [
        {
          kind: "message",
          id: crypto.randomUUID(),
          author: creator,
          text: body.text,
          createdAtMs,
          decision: false,
        },
      ],
    };
    return c.json(save(c.var.store, thread), 201);
  });

  app.get("/threads/:threadId", (c) => {
    const thread = c.var.store.threads.get(c.req.param("threadId"));
    if (thread === undefined) return c.json(missingThread, 404);
    return c.json(thread);
  });

  // Applies the edits and records an activity line for each real change.
  app.patch("/threads/:threadId", validate("json", editThreadBody), (c) => {
    const thread = c.var.store.threads.get(c.req.param("threadId"));
    if (thread === undefined) return c.json(missingThread, 404);
    const { actor: actorId, assignee: assigneeId, ...rest } = c.req.valid("json");
    const actor = c.var.store.people.get(actorId);
    if (actor === undefined) return c.json(missingUser(actorId), 404);
    const assignee = assigneeId === undefined ? undefined : c.var.store.people.get(assigneeId);
    if (assigneeId !== undefined && assignee === undefined)
      return c.json(missingUser(assigneeId), 404);
    const edits: Edits = { ...rest, ...(assignee === undefined ? {} : { assignee }) };
    const lines = describeEdits(thread, edits, actor);
    if (lines.length === 0) return c.json(thread);
    const updatedAtMs = now();
    const events: Entry[] = lines.map((text) => ({
      kind: "event",
      id: crypto.randomUUID(),
      actor,
      text,
      createdAtMs: updatedAtMs,
    }));
    return c.json(
      save(c.var.store, {
        ...thread,
        ...edits,
        updatedAtMs,
        entries: [...thread.entries, ...events],
      }),
    );
  });

  // A reply, or a resolution, which also marks the thread done.
  app.post("/threads/:threadId/entries", validate("json", createEntryBody), (c) => {
    const thread = c.var.store.threads.get(c.req.param("threadId"));
    if (thread === undefined) return c.json(missingThread, 404);
    const { kind, author: authorId, text } = c.req.valid("json");
    const author = c.var.store.people.get(authorId);
    if (author === undefined) return c.json(missingUser(authorId), 404);
    const createdAtMs = now();
    const id = crypto.randomUUID();
    const entry: Entry =
      kind === "message"
        ? { kind, id, author, text, createdAtMs, decision: false }
        : { kind, id, author, text, createdAtMs };
    return c.json(
      save(c.var.store, {
        ...thread,
        status: kind === "resolution" ? "done" : thread.status,
        updatedAtMs: createdAtMs,
        entries: [...thread.entries, entry],
      }),
      201,
    );
  });

  // Bookmarks a message as a decision, or removes the bookmark.
  app.patch("/threads/:threadId/entries/:entryId", validate("json", editEntryBody), (c) => {
    const thread = c.var.store.threads.get(c.req.param("threadId"));
    if (thread === undefined) return c.json(missingThread, 404);
    const entryId = c.req.param("entryId");
    const target = thread.entries.find((entry) => entry.id === entryId);
    if (target?.kind !== "message") return c.json({ error: "Message not found" }, 404);
    const { decision } = c.req.valid("json");
    return c.json(
      save(c.var.store, {
        ...thread,
        entries: thread.entries.map((entry) =>
          entry.id === entryId && entry.kind === "message" ? { ...entry, decision } : entry,
        ),
      }),
    );
  });

  app.post("/inboxes", validate("json", createInboxBody), (c) => {
    const { userId } = c.req.valid("json");
    if (!c.var.store.people.has(userId)) return c.json(missingUser(userId), 404);
    if (c.var.store.inboxes.has(userId)) return c.json({ error: "User already has an inbox" }, 409);
    const inbox = { id: crypto.randomUUID(), userId, createdAtMs: now() };
    c.var.store.inboxes.set(userId, inbox);
    return c.json(inbox, 201);
  });

  app.get("/inboxes/:userId", (c) => {
    const userId = c.req.param("userId");
    const inbox = c.var.store.inboxes.get(userId);
    if (inbox === undefined) return c.json({ error: "Inbox not found" }, 404);
    const items = openThreadsFor(c.var.store.threads.values(), userId).map(
      ({ entries: _entries, ...summary }) => summary,
    );
    return c.json({ ...inbox, items });
  });

  app.get("/users/:userId/schedule", validate("query", scheduleQuery), (c) => {
    const userId = c.req.param("userId");
    if (!c.var.store.people.has(userId)) return c.json(missingUser(userId), 404);
    const nowMs = now();
    const date = c.req.valid("query").date ?? new Date(nowMs).toISOString().slice(0, 10);
    return c.json(buildSchedule(openThreadsFor(c.var.store.threads.values(), userId), date, nowMs));
  });

  return app;
}
