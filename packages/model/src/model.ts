// How someone relates to you in the org; drives inbox triage.
export type Relationship = "manager" | "lead" | "teammate";

export type Person = {
  id: string;
  name: string;
  // Org details. A higher level is more senior.
  level?: string;
  role?: "sde" | "pm";
  // Who they report to, which places them in the org tree. Nobody's at the top.
  managerId?: string;
};

export type Status = "open" | "in_progress" | "waiting" | "done";
export type Priority = "none" | "low" | "medium" | "high" | "urgent";

export const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// A thread is a log of one ask: messages, activity, and the resolution that closes it.
export type Entry =
  | {
      kind: "message";
      id: string;
      author: Person;
      text: string;
      createdAtMs: number;
      decision: boolean;
    }
  | { kind: "event"; id: string; actor: Person; text: string; createdAtMs: number }
  | { kind: "resolution"; id: string; author: Person; text: string; createdAtMs: number }
  // A meeting's video call; who's on it and when come from the thread.
  | { kind: "call"; id: string; link: string; createdAtMs: number }
  // Notes summarizing a meeting after the call.
  | {
      kind: "notes";
      id: string;
      summary: string;
      decisions: string[];
      actionItems: { text: string; owner: Person }[];
      createdAtMs: number;
    };

// Every item on your day is a thread. A response is someone's ask of you; a meeting is a scheduled thread with
// attendees; a focus block is your own work. They share the same document, replies and resolution.
export type ThreadKind = "response" | "meeting" | "focus";

export const KIND_LABELS: Record<ThreadKind, string> = {
  response: "Response",
  meeting: "Meeting",
  focus: "Focus block",
};

export type Schedule = { startMs: number; endMs: number };

export type Thread = {
  id: string;
  kind: ThreadKind;
  title: string;
  requester: Person;
  assignee: Person | null;
  status: Status;
  priority: Priority;
  dueAtMs: number | null;
  // When it happens or when you've planned to work on it; places it on your day timeline.
  schedule: Schedule | null;
  // Who's in it: meeting attendees; empty for other kinds.
  attendees: Person[];
  updatedAtMs: number;
  entries: Entry[];
};
