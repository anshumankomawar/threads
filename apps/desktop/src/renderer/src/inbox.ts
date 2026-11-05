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
  // Null for your outbox (Sent).
  why: InboxReason | null;
  // Whoever sent you the latest message, else its owner.
  from: Person;
  // Who it's from, or for your outbox, who else is on it ("Sam +2").
  who: string | null;
  reason: string;
  dueLabel: string | null;
  score: number;
};

export type BucketGroup = { bucket: Bucket; items: InboxItem[] };

export type Inbox = {
  buckets: BucketGroup[];
  // Not sorted into a bucket yet.
  unsorted: InboxItem[];
  // Everything in the order shown, for moving on to the next thread.
  order: Thread[];
  // Open threads you own that anyone else is on, newest first.
  sent: InboxItem[];
};

function shortDate(atMs: number, nowMs: number): string {
  const days = Math.round((startOfDay(atMs) - startOfDay(nowMs)) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Date(atMs).toLocaleDateString(
    undefined,
    days > 0 && days < 7 ? { weekday: "short" } : { month: "short", day: "numeric" },
  );
}

const firstName = (person: Person): string => person.name.split(" ")[0];

// Everyone else on a thread you own: its assignees and whoever you've sent it to.
function othersOn(thread: Thread, me: Person): Person[] {
  const others = new Map(thread.assignees.map((person) => [person.id, person]));
  for (const entry of thread.entries)
    if (entry.kind === "message" && entry.author.id === me.id)
      for (const person of entry.sentTo) others.set(person.id, person);
  others.delete(me.id);
  return [...others.values()];
}

// Your inbox (`inboxReason`) in your buckets, blocked threads last and the rest by score; and your outbox.
export function buildInbox(threads: Thread[], me: Person, people: Person[], nowMs: number): Inbox {
  const buckets = bucketsOf(me);
  const byBucket = new Map<string, InboxItem[]>(buckets.map((bucket) => [bucket.id, []]));
  const unsorted: InboxItem[] = [];
  const sent: InboxItem[] = [];
  const level = levelPositions(people);

  for (const thread of threads) {
    if (isDone(thread.status)) continue;
    const why = inboxReason(thread, me.id, nowMs);
    if (why === null && (thread.owner.id !== me.id || isPersonal(thread))) continue;
    const blocked = thread.status === "blocked";
    const blockedOn = blocked
      ? threads.find((other) => other.blocksId === thread.id && !isDone(other.status))?.assignees[0]
      : undefined;
    const from = (why === "sent" ? lastSentTo(thread, me.id)?.author : undefined) ?? thread.owner;
    const others = othersOn(thread, me);
    const item: InboxItem = {
      thread,
      why,
      from,
      who:
        why !== null
          ? firstName(from)
          : others.length === 0
            ? null
            : `${firstName(others[0])}${others.length > 1 ? ` +${others.length - 1}` : ""}`,
      reason: blocked
        ? blockedOn
          ? `Blocked on ${blockedOn.name}`
          : "Blocked"
        : from.id === me.id
          ? "Your own"
          : from.id === me.managerId
            ? "From your manager"
            : `From ${from.name}`,
      dueLabel: blocked
        ? "Blocked"
        : thread.dueAtMs === null
          ? null
          : shortDate(thread.dueAtMs, nowMs),
      score: threadScore(thread, level(thread.owner.id), nowMs),
    };
    if (why === null) sent.push(item);
    else (byBucket.get(thread.triage[me.id]?.bucketId ?? "") ?? unsorted).push(item);
  }

  const rank = (item: InboxItem): number => (item.thread.status === "blocked" ? 1 : 0);
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
