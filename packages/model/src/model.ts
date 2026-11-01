export type Person = {
  id: string;
  name: string;
  // Org details. A higher level is more senior.
  level?: string;
  role?: "sde" | "pm";
  // Who they report to, which places them in the org tree. Nobody's at the top.
  managerId?: string;
};

export type Status = "open" | "blocked" | "closed";
export type Priority = "none" | "low" | "medium" | "high" | "urgent";

export const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  blocked: "Blocked",
  closed: "Closed",
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
  // How much work it is, in hours; sets the length of its slot and feeds its score. Null until someone estimates it.
  effortHours: number | null;
  // Ids from `TAGS`; the most important one feeds its score.
  tagIds: string[];
  // When it happens or when you've planned to work on it; places it on your day timeline.
  schedule: Schedule | null;
  // Who's in it: meeting attendees; empty for other kinds.
  attendees: Person[];
  // The thread this one was branched off from, if any.
  branchedFromId: string | null;
  updatedAtMs: number;
  entries: Entry[];
};

// Every meeting's video call link, until meetings get real ones.
export const DUMMY_ZOOM_LINK = "zoom.us/j/0000000000";

type Message = Extract<Entry, { kind: "message" }>;

export function lastMessage(thread: Thread): Message | undefined {
  return thread.entries.findLast((entry): entry is Message => entry.kind === "message");
}

// Whose turn it is, which decides whose inbox the thread is in: the assignee's reply sends it back to whoever asked,
// and anything else leaves it with the assignee. With no assignee it stays with whoever asked. Meetings aren't turns.
export function waitingOn(thread: Thread): string | null {
  if (thread.kind === "meeting") return null;
  if (thread.assignee === null) return thread.requester.id;
  return lastMessage(thread)?.author.id === thread.assignee.id
    ? thread.requester.id
    : thread.assignee.id;
}

// A link to another thread inside a message's text, as `[[thread:<id>]]`. Typing `/thread` in a reply makes one.
const THREAD_LINK = /\[\[thread:([^\]\s]+)\]\]/g;

export const threadLink = (threadId: string): string => `[[thread:${threadId}]]`;

// A message's text split into plain runs and thread links, for rendering.
export function splitThreadLinks(text: string): ({ text: string } | { threadId: string })[] {
  const parts: ({ text: string } | { threadId: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(THREAD_LINK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ threadId: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// The text with each thread link replaced by `#<title>`, for previews and plain text.
export function plainThreadLinks(
  text: string,
  titleOf: (threadId: string) => string | undefined,
): string {
  return text.replace(THREAD_LINK, (_, threadId: string) => `#${titleOf(threadId) ?? "thread"}`);
}
