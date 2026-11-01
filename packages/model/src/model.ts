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

// A block on someone's schedule for answering a question in a thread.
export type ReplyBlock = Schedule & { personId: string };

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
  // When it happens or when you've planned to work on it; for a response, its next block.
  schedule: Schedule | null;
  // Every block of time it holds on the schedule of whoever it's waiting on, including ones already over. A response
  // can have any number, each as long as the free time allows. Meetings and focus blocks have just their `schedule`.
  blocks: Schedule[];
  // Time set aside for people asked a question in it (mentioned, and not yet answered): one block each, on their
  // schedule, placed by the server like `blocks`.
  replyBlocks: ReplyBlock[];
  // Time the assignee already spent in blocks before the thread last changed hands.
  workedMinutes: number;
  // Who's in it: meeting attendees; empty for other kinds.
  attendees: Person[];
  // The thread this one was branched off from, if any.
  branchedFromId: string | null;
  // The thread this one blocks, if it was made with `/blocked`.
  blocksId: string | null;
  updatedAtMs: number;
  entries: Entry[];
};

// Every meeting's video call link, until meetings get real ones.
export const DUMMY_ZOOM_LINK = "zoom.us/j/0000000000";

type Message = Extract<Entry, { kind: "message" }>;

export function lastMessage(thread: Thread): Message | undefined {
  return thread.entries.findLast((entry): entry is Message => entry.kind === "message");
}

// Whose turn it is, which decides whose inbox the thread is in: the assignee's, or whoever asked while nobody is
// assigned. Messages never move it, so a thread is a worklog; it leaves the inbox when it's closed. Meetings aren't
// turns.
export function waitingOn(thread: Thread): string | null {
  if (thread.kind === "meeting") return null;
  return thread.assignee?.id ?? thread.requester.id;
}

// The other side of a response from someone: whoever asked if it's the assignee, and the assignee otherwise.
export function otherSide(thread: Thread, personId: string): Person | null {
  if (thread.kind !== "response" || thread.assignee === null) return null;
  const other = personId === thread.assignee.id ? thread.requester : thread.assignee;
  return other.id === personId ? null : other;
}

// Links inside a message's text: another thread as `[[thread:<id>]]` (`#` in a reply), a person as
// `[[person:<id>]]` (`@` in a reply; mentioning someone asks them a question).
const LINK = /\[\[(thread|person):([^\]\s]+)\]\]/g;
const THREAD_LINK = /\[\[thread:([^\]\s]+)\]\]/g;
const MENTION = /\[\[person:([^\]\s]+)\]\]/g;

export const threadLink = (threadId: string): string => `[[thread:${threadId}]]`;
export const mention = (personId: string): string => `[[person:${personId}]]`;

export type TextPart = { text: string } | { threadId: string } | { personId: string };

// A message's text split into plain runs, thread links and mentions, for rendering.
export function splitThreadLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push(match[1] === "thread" ? { threadId: match[2] } : { personId: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// The text with each thread link as `#<title>` and each mention as `@<name>`, for previews and plain text.
export function plainThreadLinks(
  text: string,
  titleOf: (threadId: string) => string | undefined,
  nameOf: (personId: string) => string | undefined = () => undefined,
): string {
  return text
    .replace(THREAD_LINK, (_, threadId: string) => `#${titleOf(threadId) ?? "thread"}`)
    .replace(MENTION, (_, personId: string) => `@${nameOf(personId) ?? "someone"}`);
}

// Who a message mentions.
export function mentionsIn(text: string): string[] {
  return [...text.matchAll(MENTION)].map((match) => match[1]);
}

// The questions still waiting in a thread's messages: everyone mentioned by someone else who hasn't written since,
// with who asked and when. Writing anything in the thread answers it.
export function pendingAsks(
  messages: { authorId: string; text: string; createdAtMs: number }[],
): Map<string, { askerId: string; atMs: number }> {
  const pending = new Map<string, { askerId: string; atMs: number }>();
  for (const message of [...messages].sort((a, b) => a.createdAtMs - b.createdAtMs)) {
    pending.delete(message.authorId);
    for (const personId of mentionsIn(message.text))
      if (personId !== message.authorId)
        pending.set(personId, { askerId: message.authorId, atMs: message.createdAtMs });
  }
  return pending;
}
