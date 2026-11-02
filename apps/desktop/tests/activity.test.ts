import { mention, type Entry, type Person, type Thread } from "model";
import { expect, test } from "vite-plus/test";
import { activityFor } from "../src/renderer/src/activity";

const me: Person = { id: "me", name: "You" };
const sam: Person = { id: "sam", name: "Sam Rivera" };
const kim: Person = { id: "kim", name: "Kim Lee" };

const MINUTE = 60_000;
const NOW = new Date(2026, 10, 2, 12).getTime();

let counter = 0;
const message = (author: Person, text: string, atMs: number): Entry => ({
  id: `e${++counter}`,
  kind: "message",
  author,
  text,
  createdAtMs: atMs,
});
const event = (actor: Person, text: string, atMs: number): Entry => ({
  id: `e${++counter}`,
  kind: "event",
  actor,
  text,
  createdAtMs: atMs,
});

function thread(id: string, entries: Entry[], fields: Partial<Thread> = {}): Thread {
  return {
    id,
    kind: "response",
    title: id,
    requester: me,
    assignee: sam,
    status: "open",
    priority: "none",
    dueAtMs: null,
    schedule: null,
    blocks: [],
    workedMinutes: 0,
    attendees: [],
    branchedFromId: null,
    blocksId: null,
    createdBy: me,
    seenBy: {},
    effortHours: null,
    tagIds: [],
    updatedAtMs: NOW,
    entries,
    ...fields,
  };
}

const never = (): number => 0;

// A thread I made for Kim, asking Sam: with my description, and the line the server records.
const madeForKim = (later: Entry[] = []): Thread =>
  thread(
    "on-call",
    [
      { ...message(me, "Set up the on-call rotation", NOW - 40 * MINUTE), id: "on-call" },
      event(me, "created this on behalf of Kim Lee", NOW - 40 * MINUTE),
      ...later,
    ],
    { requester: kim, createdBy: me },
  );

test("making a thread on someone's behalf leaves you out of its notifications", () => {
  const replied = madeForKim([message(sam, "On it", NOW - 10 * MINUTE)]);
  expect(activityFor([replied], me, never, NOW)).toEqual([]);
});

test("the person it was made for is told, even with no description", () => {
  const items = activityFor([madeForKim()], kim, never, NOW);
  expect(items.map((item) => [item.actor.id, item.summary])).toEqual([["me", "event"]]);
  const bare = thread("bare", [event(me, "created this on behalf of Kim Lee", NOW - 40 * MINUTE)], {
    requester: kim,
    createdBy: me,
  });
  expect(activityFor([bare], kim, never, NOW)).toHaveLength(1);
});

test("replying in a thread you made for someone brings you back in", () => {
  const joined = madeForKim([
    message(me, "One more thing", NOW - 20 * MINUTE),
    message(sam, "On it", NOW - 10 * MINUTE),
  ]);
  expect(activityFor([joined], me, never, NOW)).toHaveLength(1);
});

test("the new requester is told when a thread is passed to them", () => {
  const passed = thread("passed", [event(sam, "made Kim Lee the requester", NOW - MINUTE)], {
    requester: kim,
  });
  expect(activityFor([passed], kim, never, NOW)).toHaveLength(1);
  // The old one is out of it once they're no longer on it.
  expect(activityFor([passed], me, never, NOW)).toEqual([]);
});

test("a new thread is opened, and other messages are replies", () => {
  const items = activityFor(
    [
      thread("new", [{ ...message(sam, "Review the PR", NOW - 40 * MINUTE), id: "new" }], {
        requester: sam,
        assignee: me,
      }),
      thread("chat", [
        message(me, "Fix the bug", NOW - 15 * MINUTE),
        message(sam, "Pushed a fix", NOW - 10 * MINUTE),
      ]),
    ],
    me,
    never,
    NOW,
  );
  expect(items.map((item) => [item.thread.id, item.summary])).toEqual([
    ["chat", "replied"],
    ["new", "opened"],
  ]);
});

test("your own doings, conversations, routine edits and other people's threads stay out", () => {
  const items = activityFor(
    [
      thread("mine", [message(me, "Started", NOW - MINUTE)]),
      thread("talk", [message(sam, `${mention("me")} can you check?`, NOW - MINUTE)], {
        kind: "conversation",
        attendees: [sam, me],
      }),
      thread("routine", [
        event(sam, "set priority to High", NOW - MINUTE),
        event(sam, "scheduled this for Mon 9:00 AM", NOW - MINUTE),
      ]),
      thread("theirs", [message(kim, "Hi", NOW - MINUTE)], { requester: kim, assignee: sam }),
    ],
    me,
    never,
    NOW,
  );
  expect(items).toEqual([]);
});

test("status changes worth knowing show, and unread counts what's new since you looked", () => {
  const closed = thread("closed", [
    message(me, "Ship it", NOW - 9 * MINUTE),
    message(sam, "Done, see the PR", NOW - 5 * MINUTE),
    event(sam, "changed status to Closed", NOW - 4 * MINUTE),
  ]);
  const [item] = activityFor([closed], me, () => NOW - 6 * MINUTE, NOW);
  expect(item.summary).toBe("event");
  expect(item.unread).toBe(2);
  expect(activityFor([closed], me, () => NOW, NOW)[0].unread).toBe(0);
});
