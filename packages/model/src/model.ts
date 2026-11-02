export type Person = {
  id: string;
  name: string;
  // Org details. A higher level is more senior.
  level?: string;
  role?: "sde" | "pm";
  // Who they report to, which places them in the org tree. Nobody's at the top.
  managerId?: string;
  // Their own working day, set on their profile; without one, the org's (`workdayOf`).
  workday?: Workday;
};

// The hours someone's schedule is laid out in, and the half hours in them kept free for answering questions.
export type Workday = {
  startHour: number;
  endHour: number;
  catchUp: { hour: number; minute: number }[];
};

// Archived is closed and put away: off every list, still there to search and open.
export type Status = "open" | "blocked" | "closed" | "archived";
export type Priority = "none" | "low" | "medium" | "high" | "urgent";

export const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  blocked: "Blocked",
  closed: "Closed",
  archived: "Archived",
};

// Whether a thread is finished: closed or archived. It takes no time and no more replies.
export const isDone = (status: Status): boolean => status === "closed" || status === "archived";

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

// Everything is a thread. A response is someone's ask of you; a meeting is a scheduled thread with attendees; a focus
// block is your own work; a conversation is a talk with the people you @mention, branched off the thread it started in,
// taking no time on anyone's schedule. They share the same document, replies and resolution.
export type ThreadKind = "response" | "meeting" | "focus" | "conversation";

export const KIND_LABELS: Record<ThreadKind, string> = {
  response: "Response",
  meeting: "Meeting",
  focus: "Focus block",
  conversation: "Conversation",
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
  // When it happens or when you've planned to work on it; for a response, its next block.
  schedule: Schedule | null;
  // Every block of time it holds on the schedule of whoever it's waiting on, including ones already over. A response
  // can have any number, each as long as the free time allows. Meetings and focus blocks have just their `schedule`.
  blocks: Schedule[];
  // Time the assignee already spent in blocks before the thread last changed hands.
  workedMinutes: number;
  // Who's in it: a meeting's attendees, or the people in a conversation (whoever started it and everyone mentioned);
  // empty for other kinds.
  attendees: Person[];
  // The thread this one was branched off from, if any.
  branchedFromId: string | null;
  // The thread this one blocks, if it was made with `/blocked`.
  blocksId: string | null;
  // When each person last opened it, by id.
  seenBy: Record<string, number>;
  updatedAtMs: number;
  entries: Entry[];
};

// The organization's working hours. Every schedule is laid out in them, on weekdays.
export const WORKING_HOURS = { timeZone: "America/Los_Angeles", startHour: 9, endHour: 17 };

// The two half hours a working day keeps free for answering questions; the scheduler never fills them.
export const CATCH_UP_TIMES = [
  { hour: 12, minute: 0 },
  { hour: 16, minute: 30 },
];

// Someone's working day: their own, or the org's.
export function workdayOf(person: Person | undefined): Workday {
  return (
    person?.workday ?? {
      startHour: WORKING_HOURS.startHour,
      endHour: WORKING_HOURS.endHour,
      catchUp: CATCH_UP_TIMES,
    }
  );
}

// Every meeting's video call link, until meetings get real ones.
export const DUMMY_ZOOM_LINK = "zoom.us/j/0000000000";

type Message = Extract<Entry, { kind: "message" }>;

// A thread's description: the message it was opened with, shown in its heading under the title. It's an ordinary
// message (mentions in it ask people, like any other), told apart by sharing the thread's id. Only whoever opened
// the thread writes it, it stays put when messages move, and a thread opened without one has none.
export function descriptionOf(thread: Thread): Message | undefined {
  return thread.entries.find(
    (entry): entry is Message => entry.kind === "message" && entry.id === thread.id,
  );
}

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

// A message's words without the mentions it opens with: "[[person:arjun]] can you look?" is "can you look?".
export function withoutLeadingMentions(text: string): string {
  return text.replace(/^(\[\[person:[^\]]+\]\][\s,]*)+/, "");
}

// Who a message mentions.
export function mentionsIn(text: string): string[] {
  return [...text.matchAll(MENTION)].map((match) => match[1]);
}
