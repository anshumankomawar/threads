import { DEFAULT_BUCKETS, type Person, type Thread, type Triage } from "model";
import { expect, test } from "vite-plus/test";
import { buildInbox } from "../src/renderer/src/inbox";

const me: Person = { id: "me", name: "You" };
const other: Person = { id: "other", name: "Sam Rivera" };
const kim: Person = { id: "kim", name: "Kim Park" };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Noon, so offsets of a few hours stay on the same local day.
const NOW = new Date(2026, 10, 2, 12).getTime();

let counter = 0;

function thread(fields: Partial<Thread> = {}): Thread {
  return {
    id: `thread-${++counter}`,
    kind: "issue",
    title: "Title",
    requester: other,
    assignee: me,
    status: "open",
    priority: "none",
    dueAtMs: null,
    effortHours: null,
    triage: null,
    attendees: [],
    branchedFromId: null,
    blocksId: null,
    createdBy: other,
    seenBy: {},
    labelIds: [],
    updatedAtMs: NOW,
    entries: [],
    ...fields,
  };
}

const sorted = (bucketId: string, person = me, manual = false): Triage => ({
  personId: person.id,
  bucketId,
  reason: "Because",
  manual,
  stale: false,
});

const inBucket = (threads: Thread[], bucketId: string, person = me): string[] =>
  buildInbox(threads, person, [], NOW)
    .buckets.find((group) => group.bucket.id === bucketId)
    ?.items.map((item) => item.thread.id) ?? [];

test("each thread waiting on you is in the bucket it was sorted into, your buckets in your order", () => {
  const customer = thread({ triage: sorted("customers") });
  const bug = thread({ triage: sorted("bugs") });
  const inbox = buildInbox([customer, bug], me, [], NOW);
  expect(inbox.buckets.map((group) => group.bucket.id)).toEqual(
    DEFAULT_BUCKETS.map((bucket) => bucket.id),
  );
  expect(inBucket([customer, bug], "customers")).toEqual([customer.id]);
  expect(inBucket([customer, bug], "bugs")).toEqual([bug.id]);
  expect(inbox.unsorted).toEqual([]);
  expect(inbox.order).toEqual([customer, bug]);
});

test("a thread waiting to be sorted again stays in its bucket meanwhile", () => {
  const stale = thread({ triage: { ...sorted("bugs"), stale: true } });
  expect(inBucket([stale], "bugs")).toEqual([stale.id]);
});

test("your own buckets replace the defaults", () => {
  const mine = { ...me, buckets: [{ id: "today", name: "Today", description: "" }] };
  const today = thread({ assignee: mine, triage: sorted("today") });
  expect(buildInbox([today], mine, [], NOW).buckets).toEqual([
    { bucket: mine.buckets[0], items: [expect.objectContaining({ thread: today })] },
  ]);
});

test("a thread is unsorted until it's sorted for you, in a bucket you still have", () => {
  const fresh = thread();
  const forSomeoneElse = thread({ triage: sorted("bugs", other) });
  const gone = thread({ triage: sorted("deleted") });
  const inbox = buildInbox([fresh, forSomeoneElse, gone], me, [], NOW);
  expect(inbox.unsorted.map((item) => item.thread)).toEqual([fresh, forSomeoneElse, gone]);
  expect(inbox.buckets.every((group) => group.items.length === 0)).toBe(true);
  // Unsorted threads come first in the order.
  expect(inbox.order[0]).toBe(fresh);
});

test("within a bucket, threads needing an assignee lead, blocked ones trail, the rest by score", () => {
  const low = thread({ priority: "low", triage: sorted("coding") });
  const urgent = thread({ priority: "urgent", triage: sorted("coding") });
  const dueSoon = thread({ dueAtMs: NOW + HOUR, triage: sorted("coding") });
  const blocked = thread({ status: "blocked", priority: "urgent", triage: sorted("coding") });
  const unassigned = thread({ requester: me, assignee: null, triage: sorted("coding") });
  expect(inBucket([low, blocked, dueSoon, urgent, unassigned], "coding")).toEqual([
    unassigned.id,
    urgent.id,
    dueSoon.id,
    low.id,
    blocked.id,
  ]);
});

test("threads assigned to someone else, done, or conversations aren't in your inbox", () => {
  const theirs = thread({ assignee: kim, requester: kim });
  const done = thread({ status: "closed" });
  const archived = thread({ status: "archived" });
  const talk = thread({ kind: "conversation", assignee: null, attendees: [other, me] });
  const inbox = buildInbox([theirs, done, archived, talk], me, [], NOW);
  expect(inbox.order).toEqual([]);
  expect(inbox.tracking).toEqual([]);
});

test("reassigning moves the thread to the new assignee's inbox", () => {
  const reassigned = thread({ assignee: kim, triage: sorted("bugs") });
  expect(buildInbox([reassigned], me, [], NOW).order).toEqual([]);
  // Sorted for you, not for them: it waits to be sorted for Kim.
  expect(buildInbox([reassigned], kim, [], NOW).unsorted.map((item) => item.thread)).toEqual([
    reassigned,
  ]);
});

test("each row says who it's from and how soon it's due", () => {
  const due = thread({ dueAtMs: NOW + DAY, priority: "urgent", triage: sorted("bugs") });
  const late = thread({ dueAtMs: NOW - HOUR, triage: sorted("bugs") });
  // Urgent work never falls below the floor, so it leads even something overdue.
  const [first, second] = buildInbox([late, due], me, [], NOW).buckets.find(
    (group) => group.bucket.id === "bugs",
  )!.items;
  expect([first.thread, first.reason, first.dueLabel]).toEqual([
    due,
    "From Sam Rivera · due tomorrow · urgent",
    "Tomorrow",
  ]);
  expect([second.reason, second.dueLabel, second.overdue]).toEqual([
    "From Sam Rivera · overdue",
    "Overdue",
    true,
  ]);
});

test("Tracking is what you asked of others, with who has it, and your blocked threads", () => {
  const asked = thread({ requester: me, assignee: kim, createdBy: me });
  const blocked = thread({ status: "blocked", triage: sorted("bugs") });
  const blocker = thread({ requester: me, assignee: kim, blocksId: blocked.id });
  const inbox = buildInbox([asked, blocked, blocker], me, [], NOW);
  expect(inbox.tracking.map((item) => [item.thread.id, item.from?.id])).toEqual([
    [asked.id, kim.id],
    [blocked.id, kim.id],
    [blocker.id, kim.id],
  ]);
  // The blocked thread is still yours, last in its bucket, labelled with who it's blocked on.
  const [item] = inbox.buckets.find((group) => group.bucket.id === "bugs")!.items;
  expect([item.reason, item.dueLabel]).toEqual(["Blocked on Kim Park", "Blocked"]);
});

test("a thread made on someone's behalf is theirs to track, not its maker's", () => {
  const made = thread({ requester: kim, createdBy: me, assignee: other });
  expect(buildInbox([made], kim, [], NOW).tracking.map((item) => item.thread)).toEqual([made]);
  expect(buildInbox([made], me, [], NOW).tracking).toEqual([]);
});
