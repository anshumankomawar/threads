import { z } from "zod";

const STATUSES = ["open", "in_progress", "waiting", "done"] as const;
const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

export type Priority = (typeof PRIORITIES)[number];

const name = z.string().trim().min(1);

export const createUserBody = z.object({
  firstName: name,
  lastName: name,
  level: z.string().regex(/^l[1-9]\d*$/, "Expected a level like l1, l2, l3"),
  role: z.enum(["sde", "pm"]),
});

export const createThreadBody = z.object({
  creator: z.string().min(1),
  recipient: z.string().min(1),
  initialMessage: z.string().trim().min(1),
});

const schedule = z
  .object({ startMs: z.number().int(), endMs: z.number().int() })
  .refine(({ startMs, endMs }) => endMs > startMs, "endMs must be after startMs");

// Strict so a misspelled field fails rather than silently changing nothing.
export const editThreadBody = z
  .strictObject({
    title: name,
    recipient: z.string().min(1),
    status: z.enum(STATUSES),
    priority: z.enum(PRIORITIES),
    dueAtMs: z.number().int().nullable(),
    schedule: schedule.nullable(),
  })
  .partial()
  .refine((edits) => Object.keys(edits).length > 0, "Expected at least one field to edit");

export const createInboxBody = z.object({ userId: z.string().min(1) });

export const scheduleQuery = z.object({ date: z.iso.date().optional() });

export type User = z.infer<typeof createUserBody> & { id: string };

export type Message = { id: string; authorId: string; text: string; createdAtMs: number };

export type Schedule = z.infer<typeof schedule>;

export type Thread = {
  id: string;
  creatorId: string;
  recipientId: string;
  title: string;
  status: (typeof STATUSES)[number];
  priority: Priority;
  dueAtMs: number | null;
  // Set by the user. Open threads without one get a slot from the auto-scheduler.
  schedule: Schedule | null;
  createdAtMs: number;
  updatedAtMs: number;
  messages: Message[];
};

export type Inbox = { id: string; userId: string; createdAtMs: number };

export type Store = {
  users: Map<string, User>;
  threads: Map<string, Thread>;
  // Keyed by user: each user has one inbox.
  inboxes: Map<string, Inbox>;
};
