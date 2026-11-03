import {
  bucketsOf,
  inboxReason,
  isDone,
  isPersonal,
  lastSentTo,
  levelPositions,
  threadScore,
  type Bucket,
  type InboxReason,
  type Person,
  type Thread,
} from "model";
import { DAY, startOfDay } from "./format";

export type InboxItem = {
  thread: Thread;
  // Why it's in your inbox: assigned to you, or someone sent you something. Null for your outbox (Sent).
  why: InboxReason | null;
  // Who it's from: whoever sent you the latest message, else its owner.
  from: Person;
  // Who to show it by: who it's from, or for your outbox, who else is on it ("Sam +2").
  who: string | null;
  // Why it's where it is in its bucket: who it's from, how soon it's due, and so on.
  reason: string;
  dueLabel: string | null;
  overdue: boolean;
  // How important it is, from 1 to 100, which orders it within its bucket.
  score: number;
};

export type BucketGroup = { bucket: Bucket; items: InboxItem[] };

export type Inbox = {
  // Your buckets in your order, each with the threads the model (or you) put there, most important first.
  buckets: BucketGroup[];
  // In your inbox but not sorted yet, while the model gets to them.
  unsorted: InboxItem[];
  // Everything in the inbox in the order it's shown, for moving on to the next thread.
  order: Thread[];
  // Your outbox, like email's Sent: the open threads you own that anyone else is on, newest first.
  sent: InboxItem[];
};

function daysUntil(atMs: number, nowMs: number): number {
  return Math.round((startOfDay(atMs) - startOfDay(nowMs)) / DAY);
}

function shortDate(atMs: number, nowMs: number): string {
  const days = daysUntil(atMs, nowMs);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const format: Intl.DateTimeFormatOptions =
    days > 0 && days < 7 ? { weekday: "short" } : { month: "short", day: "numeric" };
  return new Date(atMs).toLocaleDateString(undefined, format);
}

// A thread's score: how much it matters, weighing its owner's level.
export function scoreOf(thread: Thread, people: Person[], nowMs: number): number {
  return threadScore(thread, levelPositions(people)(thread.owner.id), nowMs);
}

function reasonFor(thread: Thread, me: Person, sender: Person, nowMs: number): string {
  const due = thread.dueAtMs;
  const days = due === null ? null : daysUntil(due, nowMs);
  return [
    sender.id === me.id
      ? "Your own"
      : sender.id === me.managerId
        ? "From your manager"
        : `From ${sender.name}`,
    due !== null && due < nowMs
      ? "overdue"
      : days === 0
        ? "due today"
        : days === 1
          ? "due tomorrow"
          : null,
    thread.priority === "urgent" ? "urgent" : null,
  ]
    .filter((reason): reason is string => reason !== null)
    .join(" · ");
}

// Everyone else on a thread you own: its assignees and whoever you've sent it to.
function othersOn(thread: Thread, me: Person): Person[] {
  const others = new Map<string, Person>();
  for (const person of thread.assignees) others.set(person.id, person);
  for (const entry of thread.entries)
    if (entry.kind === "message" && entry.author.id === me.id)
      for (const person of entry.sentTo) others.set(person.id, person);
  others.delete(me.id);
  return [...others.values()];
}

// "Sam", or "Sam +2" when there are more.
const shortNames = (people: Person[]): string | null =>
  people.length === 0
    ? null
    : `${people[0].name.split(" ")[0]}${people.length > 1 ? ` +${people.length - 1}` : ""}`;

// Your inbox, as in email: every open thread assigned to you or that someone sent you something on since you last
// marked it done, unless you've snoozed it (`inboxReason`), in the bucket it was sorted into for you, ordered by how
// much it matters. Blocked threads stay, last in their bucket. Your outbox (Sent) is every open thread you own that
// anyone else is on, until it's closed.
export function buildInbox(threads: Thread[], me: Person, people: Person[], nowMs: number): Inbox {
  const buckets = bucketsOf(me);
  const byBucket = new Map<string, InboxItem[]>(buckets.map((bucket) => [bucket.id, []]));
  const unsorted: InboxItem[] = [];
  const sent: InboxItem[] = [];
  const blockerOf = (thread: Thread): Thread | undefined =>
    threads.find((candidate) => candidate.blocksId === thread.id && !isDone(candidate.status));

  for (const thread of threads) {
    if (isDone(thread.status)) continue;
    const why = inboxReason(thread, me.id, nowMs);
    const owned = thread.owner.id === me.id && !isPersonal(thread);
    if (why === null && !owned) continue;
    const due = thread.dueAtMs;
    const overdue = due !== null && due < nowMs;
    const isBlocked = thread.status === "blocked";
    const blockedOn = isBlocked ? blockerOf(thread)?.assignees[0] : undefined;
    const sender = lastSentTo(thread, me.id)?.author;
    const others = othersOn(thread, me);
    const from = (why === "sent" ? sender : undefined) ?? thread.owner;
    const item: InboxItem = {
      thread,
      why,
      from,
      who: why === null ? shortNames(others) : from.name.split(" ")[0],
      reason: isBlocked
        ? blockedOn
          ? `Blocked on ${blockedOn.name}`
          : "Blocked"
        : reasonFor(thread, me, from, nowMs),
      dueLabel: isBlocked
        ? "Blocked"
        : overdue
          ? "Overdue"
          : due === null
            ? null
            : shortDate(due, nowMs),
      overdue,
      score: scoreOf(thread, people, nowMs),
    };
    if (why === null) {
      sent.push(item);
      continue;
    }
    const triage = thread.triage[me.id];
    const group = triage === undefined ? undefined : byBucket.get(triage.bucketId);
    (group ?? unsorted).push(item);
  }

  // Blocked threads go last, with nothing to do until they're unblocked; the rest by score.
  const rank = ({ thread }: InboxItem): number => (thread.status === "blocked" ? 1 : 0);
  const byScore = (a: InboxItem, b: InboxItem): number => rank(a) - rank(b) || b.score - a.score;
  const groups = buckets.map((bucket) => ({
    bucket,
    items: (byBucket.get(bucket.id) ?? []).sort(byScore),
  }));
  unsorted.sort(byScore);
  return {
    buckets: groups,
    unsorted,
    order: [...unsorted, ...groups.flatMap((group) => group.items)].map((item) => item.thread),
    sent: sent.sort((a, b) => b.thread.updatedAtMs - a.thread.updatedAtMs),
  };
}
