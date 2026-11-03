import type { Entry, Person, Thread } from "model";
import { expect, test } from "vite-plus/test";
import { activityFor } from "../src/renderer/src/activity";

const me: Person = { id: "me", name: "You" };
const sam: Person = { id: "sam", name: "Sam Rivera" };
const kim: Person = { id: "kim", name: "Kim Lee" };

const MINUTE = 60_000;
const NOW = new Date(2026, 10, 2, 12).getTime();

let counter = 0;
const message = (author: Person, text: string, atMs: number, sentTo: Person[] = []): Entry => ({
  id: `e${++counter}`,
  kind: "message",
  author,
  text,
  sentTo,
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
    title: id,
    owner: me,
    assignees: [sam],
    status: "open",
    priority: "none",
    dueAtMs: null,
    branchedFromId: null,
    blocksId: null,
    seenBy: {},
    effortHours: null,
    labelIds: [],
    triage: {},
    doneBy: {},
    snoozedUntil: {},
    updatedAtMs: NOW,
    entries,
    ...fields,
  };
}

const never = (): number => 0;

test("being assigned a thread brings you into its notifications", () => {
  const assigned = thread("assigned", [message(sam, "Can you look at this?", NOW - MINUTE)], {
    owner: sam,
    assignees: [kim],
  });
  expect(activityFor([assigned], kim, never, NOW)).toHaveLength(1);
  expect(activityFor([assigned], me, never, NOW)).toEqual([]);
});

test("a new thread is opened, and other messages are replies", () => {
  const items = activityFor(
    [
      thread("new", [{ ...message(sam, "Review the PR", NOW - 40 * MINUTE), id: "new" }], {
        owner: sam,
        assignees: [me],
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

test("your own doings, routine edits and other people's threads stay out", () => {
  const items = activityFor(
    [
      thread("mine", [message(me, "Started", NOW - MINUTE)]),
      thread("routine", [
        event(sam, "set priority to High", NOW - MINUTE),
        event(sam, "estimated this at 2h", NOW - MINUTE),
      ]),
      thread("theirs", [message(kim, "Hi", NOW - MINUTE)], { owner: kim, assignees: [sam] }),
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
