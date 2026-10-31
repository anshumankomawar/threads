import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { openThreadsFor } from "./inbox.ts";
import {
  createInboxBody,
  createThreadBody,
  createUserBody,
  editThreadBody,
  scheduleQuery,
  type Store,
  type Thread,
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

// Data lives in memory for now, so it's gone when the server restarts.
export function createApp(now: () => number = Date.now) {
  const store: Store = { users: new Map(), threads: new Map(), inboxes: new Map() };
  const app = new Hono();

  const missingUser = (id: string): { error: string } => ({ error: `User not found: ${id}` });

  app.post("/users", validate("json", createUserBody), (c) => {
    const user = { id: crypto.randomUUID(), ...c.req.valid("json") };
    store.users.set(user.id, user);
    return c.json(user, 201);
  });

  app.post("/threads", validate("json", createThreadBody), (c) => {
    const { creator, recipient, initialMessage } = c.req.valid("json");
    for (const id of [creator, recipient]) {
      if (!store.users.has(id)) return c.json(missingUser(id), 404);
    }
    const createdAtMs = now();
    const thread: Thread = {
      id: crypto.randomUUID(),
      creatorId: creator,
      recipientId: recipient,
      title: firstLine(initialMessage),
      status: "open",
      priority: "none",
      dueAtMs: null,
      schedule: null,
      createdAtMs,
      updatedAtMs: createdAtMs,
      messages: [{ id: crypto.randomUUID(), authorId: creator, text: initialMessage, createdAtMs }],
    };
    store.threads.set(thread.id, thread);
    return c.json(thread, 201);
  });

  app.get("/threads/:threadId", (c) => {
    const thread = store.threads.get(c.req.param("threadId"));
    if (thread === undefined) return c.json({ error: "Thread not found" }, 404);
    return c.json(thread);
  });

  app.patch("/threads/:threadId", validate("json", editThreadBody), (c) => {
    const thread = store.threads.get(c.req.param("threadId"));
    if (thread === undefined) return c.json({ error: "Thread not found" }, 404);
    const { recipient, ...edits } = c.req.valid("json");
    if (recipient !== undefined && !store.users.has(recipient))
      return c.json(missingUser(recipient), 404);
    const edited: Thread = {
      ...thread,
      ...edits,
      recipientId: recipient ?? thread.recipientId,
      updatedAtMs: now(),
    };
    store.threads.set(edited.id, edited);
    return c.json(edited);
  });

  app.post("/inboxes", validate("json", createInboxBody), (c) => {
    const { userId } = c.req.valid("json");
    if (!store.users.has(userId)) return c.json(missingUser(userId), 404);
    if (store.inboxes.has(userId)) return c.json({ error: "User already has an inbox" }, 409);
    const inbox = { id: crypto.randomUUID(), userId, createdAtMs: now() };
    store.inboxes.set(userId, inbox);
    return c.json(inbox, 201);
  });

  app.get("/inboxes/:userId", (c) => {
    const userId = c.req.param("userId");
    const inbox = store.inboxes.get(userId);
    if (inbox === undefined) return c.json({ error: "Inbox not found" }, 404);
    const items = openThreadsFor(store.threads.values(), userId).map(
      ({ messages: _messages, ...summary }) => summary,
    );
    return c.json({ ...inbox, items });
  });

  app.get("/users/:userId/schedule", validate("query", scheduleQuery), (c) => {
    const userId = c.req.param("userId");
    if (!store.users.has(userId)) return c.json(missingUser(userId), 404);
    const nowMs = now();
    const date = c.req.valid("query").date ?? new Date(nowMs).toISOString().slice(0, 10);
    return c.json(buildSchedule(openThreadsFor(store.threads.values(), userId), date, nowMs));
  });

  return app;
}
