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
// description to sort each thread in their inbox into one bucket (`Thread.triage`).
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

// Everything is a thread, and every thread is visible to the whole organization: an ask, with whoever made it (its
// owner), whoever it's assigned to, a log of notes and messages sent between people, and the resolution that closes
// it. Anyone @mentioned in it is assigned it; a group @mentioned is assigned it through its label.
export type Thread = {
  id: string;
  title: string;
  // Whoever made it. It's in their outbox until it's closed.
  owner: Person;
  // Everyone it's assigned to: picked when it's made, or @mentioned since. It's in each of their inboxes.
  assignees: Person[];
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

// A thread nobody else is on: no assignees and nothing sent to anyone. It's its owner's own to-do.
export function isPersonal(thread: Thread): boolean {
  return (
    thread.assignees.length === 0 &&
    !thread.entries.some((entry) => entry.kind === "message" && entry.sentTo.length > 0)
  );
}

// Whose work it is: its assignees, or its owner when it's their own to-do.
export function assignedIds(thread: Thread): string[] {
  return isPersonal(thread) ? [thread.owner.id] : thread.assignees.map((person) => person.id);
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

// Why a thread is in someone's inbox, as in email: it's assigned to them (`assigned`), or someone sent them something
// (`sent`). Marking it done (⌘E) takes it out for them alone, never closing it, until someone else does something
// there: sends them something new or, when it's assigned to them, anything at all. Snoozing takes it out until then;
// closing, which is always by hand and anyone's to do, takes it out for everyone.
export type InboxReason = "assigned" | "sent";

export function inboxReason(thread: Thread, personId: string, nowMs: number): InboxReason | null {
  if (isDone(thread.status) || (thread.snoozedUntil[personId] ?? 0) > nowMs) return null;
  const doneAt = thread.doneBy[personId];
  if (
    assignedIds(thread).includes(personId) &&
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
    ...assignedIds(thread),
    ...thread.entries.flatMap((entry) =>
      entry.kind === "message" ? entry.sentTo.map((person) => person.id) : [],
    ),
  ]);
  return [...candidates].filter((personId) => inboxReason(thread, personId, 0) !== null);
}

// Everyone on a thread: its owner, its assignees, and everyone who's written in it or been sent something.
export function participants(thread: Thread): Person[] {
  const people = new Map<string, Person>();
  const add = (person: Person): void => {
    if (!people.has(person.id)) people.set(person.id, person);
  };
  add(thread.owner);
  thread.assignees.forEach(add);
  for (const entry of thread.entries)
    if (entry.kind === "message") {
      add(entry.author);
      entry.sentTo.forEach(add);
    }
  return [...people.values()];
}

// Whether someone is part of a thread: they own it, it's assigned to them, something was sent to them, or they've
// written in it beyond its description. Unlike `participants`, which counts everyone who's written anything.
export function involves(thread: Thread, personId: string): boolean {
  return (
    thread.owner.id === personId ||
    thread.assignees.some((person) => person.id === personId) ||
    thread.entries.some(
      (entry) =>
        entry.kind === "message" &&
        (entry.sentTo.some((person) => person.id === personId) ||
          (entry.author.id === personId && entry.id !== thread.id)),
    )
  );
}

// Who a reply goes to by default, as in email: whoever last sent you something here; else, for its owner, everyone
// it's assigned to, and for anyone else, its owner.
export function replyTo(thread: Thread, personId: string): Person[] {
  const sent = lastSentTo(thread, personId);
  if (sent !== undefined) return [sent.author];
  if (thread.owner.id !== personId) return [thread.owner];
  return thread.assignees.filter((person) => person.id !== personId);
}

// Links inside a message's text: another thread as `[[thread:<id>]]` (`#` in a reply), a person as
// `[[person:<id>]]` (`@` in a reply; mentioning someone adds them to who it's sent to), and a group as
// `[[group:<id>]]` (sent to its members as they are when it's sent).
const LINK = /\[\[(thread|person|group):([^\]\s]+)\]\]/g;
const THREAD_LINK = /\[\[thread:([^\]\s]+)\]\]/g;
const MENTION = /\[\[person:([^\]\s]+)\]\]/g;
const GROUP_MENTION = /\[\[group:([^\]\s]+)\]\]/g;

export const threadLink = (threadId: string): string => `[[thread:${threadId}]]`;
export const mention = (personId: string): string => `[[person:${personId}]]`;
export const groupMention = (groupId: string): string => `[[group:${groupId}]]`;

// What the @ menus and drafts mention: a person by id, or a group as `group:<id>`.
export const GROUP_TARGET = "group:";
export const groupTarget = (groupId: string): string => `${GROUP_TARGET}${groupId}`;
export const mentionToken = (target: string): string =>
  target.startsWith(GROUP_TARGET)
    ? groupMention(target.slice(GROUP_TARGET.length))
    : mention(target);

export type TextPart =
  | { text: string }
  | { threadId: string }
  | { personId: string }
  | { groupId: string };

// A message's text split into plain runs, thread links and mentions, for rendering.
export function splitThreadLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push(
      match[1] === "thread"
        ? { threadId: match[2] }
        : match[1] === "group"
          ? { groupId: match[2] }
          : { personId: match[2] },
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// The text with each thread link as `#<title>` and each mention as `@<name>`, for previews and plain text. `nameOf`
// names people by id and groups by `group:<id>`.
export function plainThreadLinks(
  text: string,
  titleOf: (threadId: string) => string | undefined,
  nameOf: (target: string) => string | undefined = () => undefined,
): string {
  return text
    .replace(THREAD_LINK, (_, threadId: string) => `#${titleOf(threadId) ?? "thread"}`)
    .replace(MENTION, (_, personId: string) => `@${nameOf(personId) ?? "someone"}`)
    .replace(GROUP_MENTION, (_, groupId: string) => `@${nameOf(groupTarget(groupId)) ?? "group"}`);
}

// A message's words without the mentions it opens with: "[[person:arjun]] can you look?" is "can you look?".
export function withoutLeadingMentions(text: string): string {
  return text.replace(/^(\[\[(person|group):[^\]]+\]\][\s,]*)+/, "");
}

// Which groups a message mentions.
export function groupMentionsIn(text: string): string[] {
  return [...text.matchAll(GROUP_MENTION)].map((match) => match[1]);
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
