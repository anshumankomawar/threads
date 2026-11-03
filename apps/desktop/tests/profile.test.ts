import { involves, labelSlug, type Entry, type Group, type Person, type Thread } from "model";
import { expect, test } from "vite-plus/test";
import { sharedGroups, sharedThreads } from "../src/renderer/src/profile";

const me: Person = { id: "me", name: "You" };
const sam: Person = { id: "sam", name: "Sam Rivera" };
const kim: Person = { id: "kim", name: "Kim Lee" };

const DAY = 24 * 60 * 60_000;
const NOW = new Date(2026, 10, 2, 12).getTime();

function thread(id: string, fields: Partial<Thread> = {}): Thread {
  return {
    id,
    title: id,
    requester: me,
    createdBy: me,
    assignee: sam,
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

const message = (id: string, author: Person, sentTo: Person[] = []): Entry => ({
  kind: "message",
  id,
  author,
  text: "Hello",
  sentTo,
  createdAtMs: NOW,
});

const ids = (threads: Thread[]): string[] => threads.map((item) => item.id);

test("you're in a thread you asked for, have, were sent something in, or replied in", () => {
  expect(involves(thread("asked", { requester: kim, assignee: me }), "me")).toBe(true);
  expect(involves(thread("asked"), "me")).toBe(true);
  const between = { requester: kim, assignee: sam };
  expect(involves(thread("sent", { ...between, entries: [message("m", kim, [me])] }), "me")).toBe(
    true,
  );
  expect(involves(thread("replied", { ...between, entries: [message("m", me)] }), "me")).toBe(true);
  expect(involves(thread("not", between), "me")).toBe(false);
});

test("writing a thread's description for someone else doesn't put you in it", () => {
  const onBehalf = thread("t", {
    requester: kim,
    createdBy: me,
    assignee: sam,
    entries: [message("t", me)],
  });
  expect(involves(onBehalf, "me")).toBe(false);
});

test("a profile shows only threads you're both in, by whose turn it is, newest first", () => {
  const threads = [
    thread("mine-from-sam", { requester: sam, assignee: me }),
    thread("sams-older", { updatedAtMs: NOW - DAY }),
    thread("sams-newer"),
    thread("kims", { requester: sam, assignee: kim, entries: [message("m", kim, [me])] }),
    thread("without-me", { requester: kim, assignee: sam }),
    thread("without-sam", { assignee: kim }),
  ];
  const shared = sharedThreads(threads, "me", "sam");
  expect(ids(shared.waitingOnYou)).toEqual(["mine-from-sam"]);
  expect(ids(shared.waitingOnThem)).toEqual(["sams-newer", "sams-older"]);
  expect(ids(shared.others)).toEqual(["kims"]);
  expect(ids(shared.closed)).toEqual([]);
});

test("closed threads you share are kept apart, and archived ones never show", () => {
  const shared = sharedThreads(
    [
      thread("open"),
      thread("closed", { status: "closed" }),
      thread("gone", { status: "archived" }),
    ],
    "me",
    "sam",
  );
  expect(ids(shared.waitingOnThem)).toEqual(["open"]);
  expect(ids(shared.closed)).toEqual(["closed"]);
});

test("the groups you share are the open ones you're both in, by name", () => {
  const group = (id: string, name: string, memberIds: string[], archived = false): Group => ({
    id,
    name,
    labelId: labelSlug(name),
    memberIds,
    createdById: "me",
    archived,
    activity: [],
    createdAtMs: NOW,
    updatedAtMs: NOW,
  });
  const groups = [
    group("b", "Zebra", ["me", "sam"]),
    group("a", "Apple", ["sam", "me", "kim"]),
    group("c", "Just Sam", ["sam"]),
    group("d", "Old", ["me", "sam"], true),
  ];
  expect(sharedGroups(groups, "me", "sam").map((item) => item.name)).toEqual(["Apple", "Zebra"]);
});
