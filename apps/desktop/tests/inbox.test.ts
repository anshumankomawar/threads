import type { Person, Thread } from "model";
import { expect, test } from "vite-plus/test";
import { buildDay } from "../src/renderer/src/inbox";

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
    attendees: [],
    branchedFromId: null,
    updatedAtMs: NOW,
    entries: [],
    ...fields,
  };
}

function plan(fields: Partial<Thread>) {
  const day = buildDay([thread(fields)], me, () => "teammate", NOW);
  return {
    timeline: day.timeline.length,
    inbox: day.unscheduled.length,
    later: day.later.length,
  };
}

const IN_INBOX = { timeline: 0, inbox: 1, later: 0 };
const ON_TIMELINE = { timeline: 1, inbox: 0, later: 0 };
const IN_LATER = { timeline: 0, inbox: 0, later: 1 };
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

test("a thread you've scheduled for a later day stays out of today's inbox", () => {
  expect(plan({ schedule: { startMs: NOW + DAY, endMs: NOW + DAY + HOUR } })).toEqual(IN_LATER);
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
  expect(plan({ status: "done" })).toEqual(NOWHERE);
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
      decision: false,
    })),
    ...fields,
  });
}

// Who a thread is shown as from in someone's inbox, or null if it isn't there.
function inboxFrom(subject: Thread, person: Person): string | null {
  const [item] = buildDay([subject], person, () => "teammate", NOW).unscheduled;
  return item === undefined ? null : (item.from?.name ?? "nobody");
}

test("a new thread is in the assignee's inbox, from whoever asked", () => {
  const asked = conversation([arjun]);
  expect(inboxFrom(asked, anshu)).toBe("Arjun Bulusu");
  expect(inboxFrom(asked, arjun)).toBeNull();
});

test("the assignee's reply moves the thread to the inbox of whoever asked", () => {
  const answered = conversation([arjun, anshu]);
  expect(inboxFrom(answered, arjun)).toBe("Anshu");
  expect(inboxFrom(answered, anshu)).toBeNull();
});

test("replying back returns the thread to the assignee", () => {
  const followedUp = conversation([arjun, anshu, arjun]);
  expect(inboxFrom(followedUp, anshu)).toBe("Arjun Bulusu");
  expect(inboxFrom(followedUp, arjun)).toBeNull();
});

test("a thread waiting on someone else stays on the assignee's plan as Later", () => {
  const answered = conversation([arjun, anshu]);
  const day = buildDay([answered], anshu, () => "teammate", NOW);
  expect(day.later.map((item) => item.thread)).toEqual([answered]);
});

test("activity lines don't change whose turn it is", () => {
  const answered = conversation([arjun, anshu]);
  const withEvent = {
    ...answered,
    entries: [
      ...answered.entries,
      { kind: "event" as const, id: "event", actor: arjun, text: "set priority", createdAtMs: NOW },
    ],
  };
  expect(inboxFrom(withEvent, arjun)).toBe("Anshu");
});

test("someone else's reply goes to the assignee, from that person", () => {
  const joined = conversation([arjun, kk]);
  expect(inboxFrom(joined, anshu)).toBe("KK");
  expect(inboxFrom(joined, arjun)).toBeNull();
});

test("a thread you assigned to yourself is in your inbox with no name on it", () => {
  const own = conversation([arjun], { assignee: arjun });
  expect(inboxFrom(own, arjun)).toBe("nobody");
  expect(inboxFrom(conversation([arjun, arjun], { assignee: arjun }), arjun)).toBe("nobody");
});

test("a slot today stays on the assignee's timeline while the reply waits with whoever asked", () => {
  const schedule = { startMs: NOW + HOUR, endMs: NOW + 2 * HOUR };
  const answered = conversation([arjun, anshu], { schedule });
  expect(buildDay([answered], anshu, () => "teammate", NOW).timeline).toHaveLength(1);
  expect(buildDay([answered], arjun, () => "teammate", NOW).timeline).toHaveLength(0);
  expect(inboxFrom(answered, arjun)).toBe("Anshu");
});

test("someone else's later schedule doesn't keep a reply out of your inbox", () => {
  const schedule = { startMs: NOW + DAY, endMs: NOW + DAY + HOUR };
  expect(inboxFrom(conversation([arjun, anshu], { schedule }), arjun)).toBe("Anshu");
});

test("reassigning moves the thread to the new assignee's inbox", () => {
  const reassigned = thread({ requester: me, assignee: other });
  const inboxOf = (person: Person): Thread[] =>
    buildDay([reassigned], person, () => "teammate", NOW).unscheduled.map((item) => item.thread);
  expect(inboxOf(other)).toEqual([reassigned]);
  expect(inboxOf(me)).toEqual([]);
});
