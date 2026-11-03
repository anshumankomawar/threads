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
    id: "action",
    name: "Messages that require action",
    description:
      "Someone needs you to do something: answer a question, make a decision, review or approve, fix, build or deliver.",
  },
  {
    id: "read",
    name: "Messages to read",
    description:
      "Nothing to do but read: updates, announcements, answers to your questions, and anything that doesn't clearly need action from you.",
  },
];

export const MAX_BUCKETS = 12;

export function bucketsOf(person: Person | undefined): Bucket[] {
  return person?.buckets !== undefined && person.buckets.length > 0
    ? person.buckets
    : DEFAULT_BUCKETS;
}

// Which of someone's buckets a thread is in for them (`Thread.triage` is keyed by person): chosen by the model with a
// short reason, or placed by them by hand (`manual`), which sticks. Once their bucket is gone it's sorted again. When
// their buckets change or the thread is retitled, the model's choice goes `stale`: the thread stays where it is until
// the model has looked again, so nothing jumps around in the meantime.
export type Triage = {
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

// A thread is a log of one ask: messages, activity, and the resolution that closes it. A message is a note in the
// thread (`sentTo` empty: nobody is told) or sent to people (⌘↵), which puts the thread in their inbox, like email.
export type Entry =
  | {
      kind: "message";
      id: string;
      author: Person;
      text: string;
      sentTo: Person[];
      createdAtMs: number;
    }
  | { kind: "event"; id: string; actor: Person; text: string; createdAtMs: number }
  | { kind: "resolution"; id: string; author: Person; text: string; createdAtMs: number };

// Everything is a thread: an ask, with whoever it's assigned to, a log of notes and messages sent between people, and
// the resolution that closes it.
export type Thread = {
  id: string;
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
  // Which of their buckets it's in, for each person it's in the inbox of, by id; missing until it's sorted for them.
  triage: Record<string, Triage>;
  // When each person last marked it done for themselves (⌘E), by id. Something sent to them after brings it back.
  doneBy: Record<string, number>;
  // Until when each person has snoozed it (H), by id; it's out of their inbox until then.
  snoozedUntil: Record<string, number>;
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

// Whose turn it is: the assignee, or whoever asked while nobody is assigned. The thread is theirs to finish, so it
// stays in their inbox until it's closed. Messages never move it.
export function waitingOn(thread: Thread): string {
  return thread.assignee?.id ?? thread.requester.id;
}

// The other side of a thread from someone: whoever asked if it's the assignee, and the assignee otherwise.
export function otherSide(thread: Thread, personId: string): Person | null {
  if (thread.assignee === null) return null;
  const other = personId === thread.assignee.id ? thread.requester : thread.assignee;
  return other.id === personId ? null : other;
}

// The latest message someone else sent this person in the thread.
export function lastSentTo(thread: Thread, personId: string): Message | undefined {
  return thread.entries.findLast(
    (entry): entry is Message =>
      entry.kind === "message" &&
      entry.author.id !== personId &&
      entry.sentTo.some((person) => person.id === personId),
  );
}

// Why a thread is in someone's inbox, as in email: it's theirs to finish (`assigned`), or someone sent them something
// (`sent`). Marking it done (⌘E) takes it out for them alone, never closing it, until someone else does something
// there: sends them something new or, for their own work, anything at all. Snoozing takes it out until then; closing,
// which is always by hand, takes it out for everyone.
export type InboxReason = "assigned" | "sent";

export function inboxReason(thread: Thread, personId: string, nowMs: number): InboxReason | null {
  if (isDone(thread.status) || (thread.snoozedUntil[personId] ?? 0) > nowMs) return null;
  const doneAt = thread.doneBy[personId];
  if (
    waitingOn(thread) === personId &&
    (doneAt === undefined ||
      thread.entries.some(
        (entry) =>
          entry.createdAtMs > doneAt &&
          (entry.kind === "event" ? entry.actor : entry.author).id !== personId,
      ))
  )
    return "assigned";
  const sent = lastSentTo(thread, personId);
  return sent !== undefined && sent.createdAtMs > (thread.doneBy[personId] ?? 0) ? "sent" : null;
}

// Everyone whose inbox a thread is in, snoozed or not, which is who it's sorted for.
export function inboxPeople(thread: Thread): string[] {
  const candidates = new Set([
    waitingOn(thread),
    ...thread.entries.flatMap((entry) =>
      entry.kind === "message" ? entry.sentTo.map((person) => person.id) : [],
    ),
  ]);
  return [...candidates].filter((personId) => inboxReason(thread, personId, 0) !== null);
}

// Everyone on a thread: whoever asked, whoever has it, and everyone who's written in it or been sent something.
export function participants(thread: Thread): Person[] {
  const people = new Map<string, Person>();
  const add = (person: Person | null): void => {
    if (person !== null && !people.has(person.id)) people.set(person.id, person);
  };
  add(thread.requester);
  add(thread.assignee);
  for (const entry of thread.entries)
    if (entry.kind === "message") {
      add(entry.author);
      entry.sentTo.forEach(add);
    }
  return [...people.values()];
}

// Who a reply goes to by default (⌘↵), as in email: whoever last sent you something here, else the other side.
export function replyTo(thread: Thread, personId: string): Person[] {
  const sent = lastSentTo(thread, personId);
  if (sent !== undefined) return [sent.author];
  const other =
    otherSide(thread, personId) ?? (thread.requester.id === personId ? null : thread.requester);
  return other === null ? [] : [other];
}

// Links inside a message's text: another thread as `[[thread:<id>]]` (`#` in a reply), a person as
// `[[person:<id>]]` (`@` in a reply; mentioning someone adds them to who it's sent to).
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
