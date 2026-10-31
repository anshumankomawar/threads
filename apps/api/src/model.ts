import type { Person, Thread } from "model";
import { z } from "zod";

const STATUSES = ["open", "in_progress", "waiting", "done"] as const;
const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
const KINDS = ["response", "meeting", "focus"] as const;

const name = z.string().trim().min(1);
const id = z.string().min(1);

export const createUserBody = z.object({
  firstName: name,
  lastName: name,
  level: z.string().regex(/^l[1-9]\d*$/, "Expected a level like l1, l2, l3"),
  role: z.enum(["sde", "pm"]),
});

const schedule = z
  .object({ startMs: z.number().int(), endMs: z.number().int() })
  .refine(({ startMs, endMs }) => endMs > startMs, "endMs must be after startMs");

// What the new thread palette sends: the opening message, plus who it's for (a thread), who's in it (a
// meeting), and when it happens (a meeting or focus block).
export const createThreadBody = z.object({
  kind: z.enum(KINDS).default("response"),
  creator: id,
  text: z.string().trim().min(1),
  assignee: id.nullable().default(null),
  invitees: z.array(id).default([]),
  schedule: schedule.nullable().default(null),
});

// Strict so a misspelled field fails rather than silently changing nothing. `actor` is who made the edit; it
// shows up in the activity line the server records for each change.
export const editThreadBody = z
  .strictObject({
    actor: id,
    title: name.optional(),
    assignee: id.optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    dueAtMs: z.number().int().nullable().optional(),
    schedule: schedule.nullable().optional(),
  })
  .refine((edits) => Object.keys(edits).length > 1, "Expected at least one field to edit");

// A reply, or the resolution that closes the thread.
export const createEntryBody = z.object({
  kind: z.enum(["message", "resolution"]),
  author: id,
  text: z.string().trim().min(1),
});

export const editEntryBody = z.strictObject({ decision: z.boolean() });

export const createInboxBody = z.object({ userId: id });

export const scheduleQuery = z.object({ date: z.iso.date().optional() });

export type Inbox = { id: string; userId: string; createdAtMs: number };

export type Store = {
  people: Map<string, Person>;
  threads: Map<string, Thread>;
  // Keyed by user: each user has one inbox.
  inboxes: Map<string, Inbox>;
};
