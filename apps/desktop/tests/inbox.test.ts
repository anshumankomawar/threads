import type { Person, Thread } from "model";
import { expect, test } from "vite-plus/test";
import { buildDay, upNext } from "../src/renderer/src/inbox";

const me: Person = { id: "me", name: "You" };
const other: Person = { id: "other", name: "Sam Rivera" };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Noon, so offsets of a few hours stay on the same local day.
const NOW = new Date(2026, 10, 2, 12).getTime();

function thread(fields: Partial<Thread>): Thread {
  return {
    id: "thread",
    kind: "response",
    title: "Title",
    requester: other,
    assignee: me,
    status: "open",
    priority: "none",
    dueAtMs: null,
    schedule: null,
    workedMinutes: 0,
    attendees: [],
    branchedFromId: null,
    blocksId: null,
    effortHours: null,
    tagIds: [],
    updatedAtMs: NOW,
    entries: [],
    ...fields,
    blocks: fields.blocks ?? (fields.schedule ? [fields.schedule] : []),
  };
}

function plan(fields: Partial<Thread>) {
  const day = buildDay([thread(fields)], me, [], NOW);
  return {
    timeline: day.timeline.length,
    inbox: day.unscheduled.length,
    later: day.later.length,
  };
}

const IN_INBOX = { timeline: 0, inbox: 1, later: 0 };
const ON_TIMELINE = { timeline: 1, inbox: 0, later: 0 };
const NOWHERE = { timeline: 0, inbox: 0, later: 0 };

test.each<[string, Partial<Thread>]>([
  ["no due date or priority", {}],
  ["a due date next week", { dueAtMs: NOW + 7 * DAY }],
  ["a due date today", { dueAtMs: NOW + HOUR }],
  ["a due date in the past", { dueAtMs: NOW - DAY }],
  ["urgent priority", { priority: "urgent" }],
  ["a schedule that has passed", { schedule: { startMs: NOW - DAY, endMs: NOW - DAY + HOUR } }],
])("a thread assigned to you with %s goes in your inbox", (_, fields) => {
  expect(plan(fields)).toEqual(IN_INBOX);
});

test("a thread assigned to you and scheduled today sits on the timeline instead", () => {
  expect(plan({ schedule: { startMs: NOW + HOUR, endMs: NOW + 2 * HOUR } })).toEqual(ON_TIMELINE);
});

test("a response slotted for a later day waits in your inbox, and is on the timeline that day", () => {
  const schedule = { startMs: NOW + DAY, endMs: NOW + DAY + HOUR };
  expect(plan({ schedule })).toEqual(IN_INBOX);
  const tomorrow = buildDay([thread({ schedule })], me, [], NOW, NOW - 12 * HOUR + DAY);
  expect(tomorrow.timeline).toHaveLength(1);
});

test("a later schedule doesn't hide a thread that needs attention today", () => {
  const schedule = { startMs: NOW + DAY, endMs: NOW + DAY + HOUR };
  expect(plan({ schedule, priority: "urgent" })).toEqual(IN_INBOX);
  expect(plan({ schedule, dueAtMs: NOW + HOUR })).toEqual(IN_INBOX);
});

test("a thread you created with no assignee stays in your inbox", () => {
  expect(plan({ requester: me, assignee: null })).toEqual(IN_INBOX);
});

test("a thread still needing an assignee stays in your inbox even with a later schedule", () => {
  const schedule = { startMs: NOW + DAY, endMs: NOW + DAY + HOUR };
  expect(plan({ requester: me, assignee: null, schedule })).toEqual(IN_INBOX);
});

test("threads assigned to someone else or already done aren't yours", () => {
  expect(plan({ assignee: other })).toEqual(NOWHERE);
  expect(plan({ status: "closed" })).toEqual(NOWHERE);
});

const arjun: Person = { id: "arjun", name: "Arjun Bulusu" };
const anshu: Person = { id: "anshu", name: "Anshu" };
const kk: Person = { id: "kk", name: "KK" };

// A thread from Arjun to Anshu with these people writing in it, in order.
function conversation(authors: Person[], fields: Partial<Thread> = {}): Thread {
  return thread({
    requester: arjun,
    assignee: anshu,
    entries: authors.map((author, index) => ({
      kind: "message",
      id: `message-${index}`,
      author,
      text: "Text",
      createdAtMs: NOW,
    })),
    ...fields,
  });
}

// Who a thread is shown as from in someone's inbox, or null if it isn't there.
function inboxFrom(subject: Thread, person: Person): string | null {
  const [item] = buildDay([subject], person, [], NOW).unscheduled;
  return item === undefined ? null : (item.from?.name ?? "nobody");
}

test("a new thread is in the assignee's inbox, from whoever asked", () => {
  const asked = conversation([arjun]);
  expect(inboxFrom(asked, anshu)).toBe("Arjun Bulusu");
  expect(inboxFrom(asked, arjun)).toBeNull();
});

test("a reply alone is a worklog note: the thread stays with the assignee", () => {
  const noted = conversation([arjun, anshu, anshu]);
  expect(inboxFrom(noted, anshu)).toBe("Arjun Bulusu");
  expect(inboxFrom(noted, arjun)).toBeNull();
});

test("replying back returns the thread to the assignee", () => {
  const followedUp = conversation([arjun, anshu, arjun]);
  expect(inboxFrom(followedUp, anshu)).toBe("Arjun Bulusu");
  expect(inboxFrom(followedUp, arjun)).toBeNull();
});

test("a thread waiting on someone else is in your outbox, labelled with who has it", () => {
  const asked = conversation([arjun, anshu]);
  const day = buildDay([asked], arjun, [], NOW);
  expect(day.outbox.map((item) => [item.thread, item.from?.name])).toEqual([[asked, "Anshu"]]);
  expect(day.unscheduled).toEqual([]);
  // Asking someone puts it in your outbox straight away.
  expect(buildDay([conversation([arjun])], arjun, [], NOW).outbox).toHaveLength(1);
});

test("a message from someone else leaves the thread with the assignee, from whoever asked", () => {
  const joined = conversation([arjun, kk]);
  expect(inboxFrom(joined, anshu)).toBe("Arjun Bulusu");
  expect(inboxFrom(joined, arjun)).toBeNull();
});

test("a blocked thread stays in your inbox, last, labelled Blocked and off the schedule", () => {
  const schedule = { startMs: NOW + HOUR, endMs: NOW + 2 * HOUR };
  const stuck = conversation([arjun], { id: "stuck", status: "blocked", schedule, blocks: [] });
  const blocker = thread({ id: "blocker", requester: anshu, assignee: kk, blocksId: "stuck" });
  const ready = conversation([arjun], { id: "ready" });
  const day = buildDay([stuck, blocker, ready], anshu, [], NOW);
  expect(day.unscheduled.map((item) => [item.thread.id, item.dueLabel])).toEqual([
    ["ready", null],
    ["stuck", "Blocked"],
  ]);
  expect(day.unscheduled[1].reason).toBe("Blocked on KK");
  expect(day.timeline).toEqual([]);
  // The blocker itself waits on KK: it's in Anshu's outbox.
  expect(day.outbox.map((item) => item.thread.id)).toEqual(["blocker"]);
});

test("a thread you assigned to yourself is in your inbox with no name on it", () => {
  const own = conversation([arjun], { assignee: arjun });
  expect(inboxFrom(own, arjun)).toBe("nobody");
  expect(inboxFrom(conversation([arjun, arjun], { assignee: arjun }), arjun)).toBe("nobody");
});

test("a slot belongs to whoever the thread is waiting on", () => {
  const schedule = { startMs: NOW + HOUR, endMs: NOW + 2 * HOUR };
  const asked = conversation([arjun, anshu], { schedule, blocks: [schedule] });
  expect(buildDay([asked], anshu, [], NOW).timeline).toHaveLength(1);
  expect(buildDay([asked], arjun, [], NOW).timeline).toHaveLength(0);
});

test("reassigning moves the thread to the new assignee's inbox", () => {
  const reassigned = thread({ requester: me, assignee: other });
  const inboxOf = (person: Person): Thread[] =>
    buildDay([reassigned], person, [], NOW).unscheduled.map((item) => item.thread);
  expect(inboxOf(other)).toEqual([reassigned]);
  expect(inboxOf(me)).toEqual([]);
});

test("an outbox item says when the other person is slotted to get to it", () => {
  const answered = (startMs: number) =>
    conversation([arjun, anshu], { schedule: { startMs, endMs: startMs + HOUR } });
  const [later] = buildDay([answered(NOW + 2 * DAY)], arjun, [], NOW).outbox;
  expect(later.dueLabel).toBe(
    new Date(NOW + 2 * DAY).toLocaleDateString(undefined, { weekday: "short" }),
  );
  const [today] = buildDay([answered(NOW + HOUR)], arjun, [], NOW).outbox;
  expect(today.dueLabel).toBe(
    new Date(NOW + HOUR).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  );
});

test("up next lists each thread once at its next block, soonest first, skipping what's over", () => {
  const block = (offsetMs: number) => ({ startMs: NOW + offsetMs, endMs: NOW + offsetMs + HOUR });
  const over = thread({ id: "over", kind: "focus", requester: me, schedule: block(-2 * HOUR) });
  const now = thread({ id: "now", kind: "focus", requester: me, schedule: block(-HOUR / 2) });
  const tomorrow = thread({ id: "tomorrow", kind: "focus", requester: me, schedule: block(DAY) });
  const later = thread({ id: "later", kind: "focus", requester: me, schedule: block(3 * HOUR) });
  const ids = upNext([over, now, tomorrow, later], me, [], NOW, 3).map((item) => item.thread.id);
  expect(ids).toEqual(["now", "later", "tomorrow"]);
});
