import {
  bucketsOf,
  inboxReason,
  isDone,
  askerId,
  lastSentTo,
  otherSide,
  levelPositions,
  threadScore,
  waitingOn,
  type Bucket,
  type InboxReason,
  type Person,
  type Thread,
} from "model";
import { DAY, startOfDay } from "./format";

export type InboxItem = {
  thread: Thread;
  // Why it's in your inbox: yours to finish, or someone sent you something. Null for what you sent.
  why: InboxReason | null;
  // Who it's from: whoever sent you the latest message, else the other side; for what you sent, who has it.
  from: Person | null;
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
  // Waiting on you but not sorted yet, while the model gets to them.
  unsorted: InboxItem[];
  // Everything in the inbox in the order it's shown, for moving on to the next thread.
  order: Thread[];
  // What you sent and are waiting on, like email's Sent: what you asked others for, messages you sent that nobody
  // has answered yet, and your blocked threads, by who they're blocked on.
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

// A thread's score for whoever it's waiting on.
export function scoreOf(thread: Thread, people: Person[], nowMs: number): number {
  const asker = askerId(thread.requester.id, thread.assignee?.id ?? null, waitingOn(thread));
  return threadScore(thread, levelPositions(people)(asker), nowMs);
}

function reasonFor(thread: Thread, me: Person, sender: Person, nowMs: number): string {
  if (thread.assignee === null) return "Needs an assignee";
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

// Your inbox, as in email: every open thread that's yours to finish or that someone sent you something on since you
// last marked it done, unless you've snoozed it (`inboxReason`), in the bucket it was sorted into for you, ordered by
// how much it matters. Blocked threads stay, last in their bucket. What you sent and are waiting on is Sent.
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
    const turn = waitingOn(thread);
    // The last message anyone sent here, if it was yours: you're waiting to hear back.
    const lastSend = thread.entries.findLast(
      (entry) => entry.kind === "message" && entry.sentTo.length > 0,
    );
    const awaiting = lastSend?.kind === "message" && lastSend.author.id === me.id;
    const asked = turn !== me.id && thread.requester.id === me.id;
    if (why === null && !asked && !awaiting) continue;
    const due = thread.dueAtMs;
    const overdue = due !== null && due < nowMs;
    const isBlocked = thread.status === "blocked";
    const blockedOn = isBlocked ? blockerOf(thread)?.assignee : undefined;
    const sender = lastSentTo(thread, me.id)?.author;
    const from =
      (why === "sent" ? sender : undefined) ?? otherSide(thread, me.id) ?? thread.requester;
    const item: InboxItem = {
      thread,
      why,
      from,
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
      // Sent: who has it, or who you're waiting to hear from.
      const holder =
        awaiting && lastSend?.kind === "message"
          ? lastSend.sentTo[0]
          : [thread.assignee, thread.requester].find((person) => person?.id === turn);
      sent.push({ ...item, from: holder ?? null });
      continue;
    }
    const triage = thread.triage[me.id];
    const group = triage === undefined ? undefined : byBucket.get(triage.bucketId);
    (group ?? unsorted).push(item);
    if (isBlocked) sent.push({ ...item, from: blockedOn ?? null });
  }

  // Threads needing an assignee come first, since nobody else can act on them; blocked ones go last, with nothing to
  // do until they're unblocked; the rest by score.
  const rank = ({ thread }: InboxItem): number =>
    thread.status === "blocked" ? 2 : thread.assignee === null ? 0 : 1;
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
