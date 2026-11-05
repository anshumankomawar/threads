import { DEFAULT_BUCKETS, type Entry, type Person, type Thread, type Triage } from "model";
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
    title: "Title",
    owner: other,
    assignees: [me],
    status: "open",
    priority: "none",
    dueAtMs: null,
    effortHours: null,
    labelIds: [],
    triage: {},
    doneBy: {},
    snoozedUntil: {},
    branchedFromId: null,
    blocksId: null,
    seenBy: {},
    updatedAtMs: NOW,
    entries: [],
    ...fields,
  };
}

const message = (author: Person, sentTo: Person[], atMs = NOW - HOUR, text = "Hi"): Entry => ({
  kind: "message",
  id: `m-${++counter}`,
  author,
  text,
  sentTo,
  createdAtMs: atMs,
});

const sorted = (bucketId: string, manual = false): Triage => ({
  bucketId,
  reason: "Because",
  manual,
  stale: false,
});

const inBucket = (threads: Thread[], bucketId: string, person = me): string[] =>
  buildInbox(threads, person, [], NOW)
    .buckets.find((group) => group.bucket.id === bucketId)
    ?.items.map((item) => item.thread.id) ?? [];

test("each thread in your inbox is in the bucket it was sorted into for you, your buckets in your order", () => {
  const customer = thread({ triage: { me: sorted("action"), other: sorted("read") } });
  const bug = thread({ triage: { me: sorted("read") } });
  const inbox = buildInbox([customer, bug], me, [], NOW);
  expect(inbox.buckets.map((group) => group.bucket.id)).toEqual(
    DEFAULT_BUCKETS.map((bucket) => bucket.id),
  );
  expect(inBucket([customer, bug], "action")).toEqual([customer.id]);
  expect(inBucket([customer, bug], "read")).toEqual([bug.id]);
  expect(inbox.order).toEqual([customer, bug]);
});

test("a thread someone sent you is in your inbox until you mark it done, and comes back when they send again", () => {
  const sent = thread({
    owner: kim,
    assignees: [kim],
    entries: [message(kim, [me], NOW - 2 * HOUR, "Can you check the numbers?")],
  });
  const [item] = buildInbox([sent], me, [], NOW).unsorted;
  expect([item.thread, item.why, item.from]).toEqual([sent, "sent", kim]);
  const done = { ...sent, doneBy: { me: NOW - HOUR } };
  expect(buildInbox([done], me, [], NOW).order).toEqual([]);
  const again = { ...done, entries: [...done.entries, message(kim, [me], NOW - 30 * 60_000)] };
  expect(buildInbox([again], me, [], NOW).order).toEqual([again]);
});

test("a note isn't sent to anyone, and what you send yourself doesn't count", () => {
  const notes = thread({
    owner: kim,
    assignees: [kim],
    entries: [message(kim, []), message(me, [kim])],
  });
  expect(buildInbox([notes], me, [], NOW).order).toEqual([]);
});

test("marking your own work done takes it out until someone else does something there", () => {
  const mine = thread({ doneBy: { me: NOW } });
  expect(buildInbox([mine], me, [], NOW).order).toEqual([]);
  // Done is yours alone: it isn't closed for anyone.
  expect(mine.status).toBe("open");
  // Your own reply after marking it done keeps it out; anyone else's brings it back.
  const replied = { ...mine, entries: [message(me, [other], NOW + HOUR)] };
  expect(buildInbox([replied], me, [], NOW + HOUR).order).toEqual([]);
  const answered = { ...mine, entries: [message(other, [], NOW + HOUR)] };
  expect(buildInbox([answered], me, [], NOW + HOUR).order).toEqual([answered]);
});

test("snoozing takes a thread out of your inbox until then", () => {
  const snoozed = thread({ snoozedUntil: { me: NOW + HOUR } });
  expect(buildInbox([snoozed], me, [], NOW).order).toEqual([]);
  expect(buildInbox([snoozed], me, [], NOW + 2 * HOUR).order).toEqual([snoozed]);
  // Someone else's snooze is theirs.
  expect(
    buildInbox([thread({ snoozedUntil: { other: NOW + HOUR } })], me, [], NOW).order,
  ).toHaveLength(1);
});

test("a thread is unsorted until it's sorted for you, in a bucket you still have", () => {
  const fresh = thread();
  const forSomeoneElse = thread({ triage: { other: sorted("read") } });
  const gone = thread({ triage: { me: sorted("deleted") } });
  const inbox = buildInbox([fresh, forSomeoneElse, gone], me, [], NOW);
  expect(inbox.unsorted.map((item) => item.thread)).toEqual([fresh, forSomeoneElse, gone]);
  // Unsorted threads come first in the order.
  expect(inbox.order[0]).toBe(fresh);
});

test("a thread waiting to be sorted again stays in its bucket meanwhile", () => {
  const stale = thread({ triage: { me: { ...sorted("read"), stale: true } } });
  expect(inBucket([stale], "read")).toEqual([stale.id]);
});

test("within a bucket, blocked threads trail and the rest go by score", () => {
  const coding = { me: sorted("action") };
  const low = thread({ priority: "low", triage: coding });
  const urgent = thread({ priority: "urgent", triage: coding });
  const dueSoon = thread({ dueAtMs: NOW + HOUR, triage: coding });
  const blocked = thread({ status: "blocked", priority: "urgent", triage: coding });
  expect(inBucket([low, blocked, dueSoon, urgent], "action")).toEqual([
    urgent.id,
    dueSoon.id,
    low.id,
    blocked.id,
  ]);
});

test("each row says who it's from and when it's due, without urgency", () => {
  const due = thread({ dueAtMs: NOW + DAY, priority: "urgent" });
  const late = thread({ dueAtMs: NOW - 2 * DAY });
  const [first, second] = buildInbox([late, due], me, [], NOW).unsorted;
  expect([first.thread, first.reason, first.dueLabel]).toEqual([
    due,
    "From Sam Rivera",
    "Tomorrow",
  ]);
  // Past due shows its date, like any other.
  expect([second.reason, second.dueLabel]).toEqual([
    "From Sam Rivera",
    new Date(NOW - 2 * DAY).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  ]);
});

test("your outbox is every open thread you own that anyone else is on, with who's on it", () => {
  const asked = thread({ owner: me, assignees: [kim] });
  const toGroup = thread({ owner: me, assignees: [], entries: [message(me, [kim, other])] });
  const answered = thread({ owner: me, assignees: [kim], entries: [message(kim, [me])] });
  const closed = thread({ owner: me, assignees: [kim], status: "closed" });
  const inbox = buildInbox([asked, toGroup, answered, closed], me, [], NOW);
  expect(inbox.sent.map((item) => [item.thread.id, item.who])).toEqual([
    [asked.id, "Kim"],
    [toGroup.id, "Kim +1"],
  ]);
  // Answered, it's back in your inbox instead.
  expect(inbox.order).toEqual([answered]);
});

test("a thread nobody else is on is your own to-do, in your inbox", () => {
  const todo = thread({ owner: me, assignees: [] });
  const inbox = buildInbox([todo], me, [], NOW);
  expect(inbox.order).toEqual([todo]);
  expect(inbox.sent).toEqual([]);
});

test("a thread assigned to several people is in each of their inboxes until each marks it done", () => {
  const shared = thread({ owner: other, assignees: [me, kim], doneBy: { kim: NOW - HOUR } });
  expect(buildInbox([shared], me, [], NOW).order).toEqual([shared]);
  expect(buildInbox([shared], kim, [], NOW).order).toEqual([]);
});

test("a blocked thread stays, labelled with who it's blocked on", () => {
  const blocked = thread({ status: "blocked", triage: { me: sorted("read") } });
  const blocker = thread({ owner: me, assignees: [kim], blocksId: blocked.id });
  const [item] = buildInbox([blocked, blocker], me, [], NOW).buckets.find(
    (group) => group.bucket.id === "read",
  )!.items;
  expect([item.reason, item.dueLabel]).toEqual(["Blocked on Kim Park", "Blocked"]);
});

test("threads assigned to someone else, or done, aren't in your inbox", () => {
  const theirs = thread({ owner: kim, assignees: [kim] });
  const done = thread({ status: "closed" });
  const archived = thread({ status: "archived" });
  const inbox = buildInbox([theirs, done, archived], me, [], NOW);
  expect(inbox.order).toEqual([]);
  expect(inbox.sent).toEqual([]);
});
