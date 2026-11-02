import {
  bucketsOf,
  isDone,
  askerId,
  otherSide,
  levelPositions,
  threadScore,
  waitingOn,
  type Bucket,
  type Person,
  type Thread,
} from "model";
import { DAY, startOfDay } from "./format";

export type InboxItem = {
  thread: Thread;
  // The other side of it: whoever asked, or for something you asked of someone, whoever has it.
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
  // What you're tracking: what you asked others for, and your blocked threads, by who they're blocked on.
  tracking: InboxItem[];
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

// Your inbox: every open issue waiting on you (assigned to you, or asked by you with nobody assigned), in the bucket
// it was sorted into for you, ordered by how much it matters. Blocked threads stay, last in their bucket. What you
// asked of others, and your blocked threads, are what you're tracking.
export function buildInbox(threads: Thread[], me: Person, people: Person[], nowMs: number): Inbox {
  const buckets = bucketsOf(me);
  const byBucket = new Map<string, InboxItem[]>(buckets.map((bucket) => [bucket.id, []]));
  const unsorted: InboxItem[] = [];
  const asked: InboxItem[] = [];
  const blockerOf = (thread: Thread): Thread | undefined =>
    threads.find((candidate) => candidate.blocksId === thread.id && !isDone(candidate.status));

  for (const thread of threads) {
    if (thread.kind !== "issue" || isDone(thread.status)) continue;
    const turn = waitingOn(thread);
    const mine = turn === me.id;
    if (!mine && thread.requester.id !== me.id) continue;
    const due = thread.dueAtMs;
    const overdue = due !== null && due < nowMs;
    const isBlocked = thread.status === "blocked";
    const blockedOn = isBlocked ? blockerOf(thread)?.assignee : undefined;
    const item: InboxItem = {
      thread,
      from: otherSide(thread, me.id),
      reason: isBlocked
        ? blockedOn
          ? `Blocked on ${blockedOn.name}`
          : "Blocked"
        : reasonFor(thread, me, otherSide(thread, me.id) ?? thread.requester, nowMs),
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
    if (!mine) {
      // Asked of someone else: who has it, and when it's due.
      const holder = [thread.assignee, thread.requester].find((person) => person?.id === turn);
      asked.push({ ...item, from: holder ?? null });
      continue;
    }
    const { triage } = thread;
    const group =
      triage !== null && triage.personId === me.id ? byBucket.get(triage.bucketId) : undefined;
    (group ?? unsorted).push(item);
    if (isBlocked) asked.push({ ...item, from: blockedOn ?? null });
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
    tracking: asked.sort((a, b) => b.thread.updatedAtMs - a.thread.updatedAtMs),
  };
}
