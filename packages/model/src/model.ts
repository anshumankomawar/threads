export type Person = {
  id: string;
  name: string;
  // Org details. A higher level is more senior.
  level?: string;
  role?: "sde" | "pm";
  // Who they report to, which places them in the org tree. Nobody's at the top.
  managerId?: string;
  // How they sort their inbox, set by them; without any, `DEFAULT_BUCKETS` (`bucketsOf`).
  buckets?: Bucket[];
};

// A group in someone's inbox: a name, and in plain words what belongs in it. The server's model reads the
// description to sort each thread waiting on them into one bucket (`Thread.triage`).
export type Bucket = { id: string; name: string; description: string };

// Everyone's buckets until they make their own. The last one catches whatever fits nowhere else.
export const DEFAULT_BUCKETS: Bucket[] = [
  {
    id: "customers",
    name: "Customer requests",
    description:
      "Anything a customer or account asked for or reported: support questions, escalations, renewals, feature requests from a named customer.",
  },
  {
    id: "bugs",
    name: "Bugs & incidents",
    description:
      "Something is broken or degraded: production errors, outages, regressions, flaky tests, security issues.",
  },
  {
    id: "coding",
    name: "Coding",
    description:
      "Building or changing code that isn't a bug fix: features, refactors, migrations, performance work, tooling.",
  },
  {
    id: "reviews",
    name: "Reviews & approvals",
    description:
      "Someone is waiting on your sign-off or feedback: code reviews, design or doc reviews, plans, budgets, access requests.",
  },
  {
    id: "other",
    name: "Everything else",
    description: "Planning, writing, admin and anything that doesn't clearly fit another bucket.",
  },
];

export const MAX_BUCKETS = 12;

export function bucketsOf(person: Person | undefined): Bucket[] {
  return person?.buckets !== undefined && person.buckets.length > 0
    ? person.buckets
    : DEFAULT_BUCKETS;
}

// Which of their buckets a thread is in for whoever it's waiting on: chosen by the model with a short reason, or
// placed by them by hand (`manual`), which sticks. It's for one person; once the thread is waiting on someone else, or
// the bucket is gone, it's sorted again. When their buckets change or the thread is retitled, the model's choice goes
// `stale`: the thread stays where it is until the model has looked again, so nothing jumps around in the meantime.
export type Triage = {
  personId: string;
  bucketId: string;
  reason: string;
  manual: boolean;
  stale: boolean;
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
  | { kind: "resolution"; id: string; author: Person; text: string; createdAtMs: number };

// Everything is a thread. An issue is an ask of someone, in their inbox until it's closed; a conversation is a talk
// with the people you @mention, branched off the thread it started in, and in nobody's inbox. They share the same
// document, replies and resolution.
export type ThreadKind = "issue" | "conversation";

export const KIND_LABELS: Record<ThreadKind, string> = {
  issue: "Thread",
  conversation: "Conversation",
};

export type Thread = {
  id: string;
  kind: ThreadKind;
  title: string;
  // Whoever is asking: they track it until it closes. Not always whoever made it (`createdBy`).
  requester: Person;
  // Who really made it; someone else if they asked on the requester's behalf.
  createdBy: Person;
  assignee: Person | null;
  status: Status;
  priority: Priority;
  dueAtMs: number | null;
  // How much work it is, in hours; quick work gets a little ahead in its bucket. Null until someone estimates it.
  effortHours: number | null;
  // Ids of its labels. A group's label puts it in that group; the most important of `SEEDED_LABELS` feeds its score.
  labelIds: string[];
  // Which inbox bucket it's in for whoever it's waiting on; null until it's sorted.
  triage: Triage | null;
  // The people in a conversation (whoever started it and everyone mentioned); empty for issues.
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
// assigned. Messages never move it, so a thread is a worklog; it leaves the inbox when it's closed. Conversations
// aren't in anyone's inbox.
export function waitingOn(thread: Thread): string | null {
  if (thread.kind === "conversation") return null;
  return thread.assignee?.id ?? thread.requester.id;
}

// The other side of an issue from someone: whoever asked if it's the assignee, and the assignee otherwise.
export function otherSide(thread: Thread, personId: string): Person | null {
  if (thread.kind !== "issue" || thread.assignee === null) return null;
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

// The id of the message that announces a conversation in the thread it started in, so the thread can show the
// conversation there.
export const conversationStartedId = (conversationId: string): string =>
  `${conversationId}:started`;

// A message's words without the mentions it opens with: "[[person:arjun]] can you look?" is "can you look?".
export function withoutLeadingMentions(text: string): string {
  return text.replace(/^(\[\[person:[^\]]+\]\][\s,]*)+/, "");
}

// Who a message mentions.
export function mentionsIn(text: string): string[] {
  return [...text.matchAll(MENTION)].map((match) => match[1]);
}

// The organization a workspace belongs to; there's exactly one. Its name is empty until someone names it at first run.
export const ORGANIZATION_ID = "organization";
export type Organization = { id: string; name: string };

// What a thread is filed under. Names are unique across the organization. A label is either one anyone made for their
// own filtering, one of the `SEEDED_LABELS`, or a group's own label (`groupId`), which is what puts a thread in the group.
export type Label = {
  id: string;
  name: string;
  groupId: string | null;
  createdById: string | null;
  createdAtMs: number;
};

export type GroupActivity = {
  actorId: string;
  text: string;
  // Who this line is news for: people it added.
  targetIds: string[];
  atMs: number;
};

// A project, program or team: anyone can make one and add anyone. Its threads are the ones carrying its label.
export type Group = {
  id: string;
  name: string;
  labelId: string;
  memberIds: string[];
  createdById: string;
  archived: boolean;
  activity: GroupActivity[];
  createdAtMs: number;
  updatedAtMs: number;
};

// A name's id: the same however it's capitalized or punctuated, so two people making "Back-end" and "back end" get one
// label. Empty when the name has no letters or numbers.
export function labelSlug(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
