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

test("threads assigned to someone else or already done aren't yours", () => {
  expect(plan({ assignee: other })).toEqual(NOWHERE);
  expect(plan({ status: "done" })).toEqual(NOWHERE);
});

test("reassigning moves the thread to the new assignee's inbox", () => {
  const reassigned = thread({ requester: me, assignee: other });
  const inboxOf = (person: Person): Thread[] =>
    buildDay([reassigned], person, () => "teammate", NOW).unscheduled.map((item) => item.thread);
  expect(inboxOf(other)).toEqual([reassigned]);
  expect(inboxOf(me)).toEqual([]);
});
