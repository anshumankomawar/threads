import type { Person, Sprint, Thread } from "model";
import { expect, test } from "vite-plus/test";
import {
  addableThreads,
  boardColumns,
  loadByPerson,
  nextSprint,
  openSprintWith,
  sprintDates,
  sprintsOf,
  sprintThreads,
  summarize,
  summaryLabel,
} from "../src/renderer/src/sprints";

const me: Person = { id: "me", name: "You" };
const sam: Person = { id: "sam", name: "Sam Rivera" };
const kim: Person = { id: "kim", name: "Kim Lee" };

const NOW = new Date(2026, 10, 2, 12).getTime();
const MIDNIGHT = new Date(2026, 10, 2).getTime();

function thread(id: string, fields: Partial<Thread> = {}): Thread {
  return {
    id,
    title: id,
    owner: me,
    assignees: [sam],
    status: "open",
    priority: "none",
    dueAtMs: null,
    effortHours: null,
    labelIds: ["platform"],
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

function sprint(id: string, fields: Partial<Sprint> = {}): Sprint {
  return {
    id,
    groupId: "g1",
    name: id,
    startMs: MIDNIGHT,
    endMs: new Date(2026, 10, 16).getTime(),
    threadIds: [],
    closed: false,
    createdById: "me",
    createdAtMs: NOW,
    updatedAtMs: NOW,
    ...fields,
  };
}

const ids = (threads: Thread[]): string[] => threads.map((item) => item.id);

test("a group's sprints list open ones first, newest first", () => {
  const list = sprintsOf(
    [
      sprint("old", { closed: true, startMs: MIDNIGHT - 1 }),
      sprint("earlier", { startMs: MIDNIGHT - 2 }),
      sprint("later"),
      sprint("elsewhere", { groupId: "g2" }),
    ],
    "g1",
  );
  expect(list.map((item) => item.id)).toEqual(["later", "earlier", "old"]);
});

test("a sprint shows its threads still in the group, leaving out archived ones", () => {
  const threads = [
    thread("in"),
    thread("left-the-group", { labelIds: [] }),
    thread("archived", { status: "archived" }),
    thread("not-in-sprint"),
  ];
  const shown = sprintThreads(
    sprint("s", { threadIds: ["in", "left-the-group", "archived"] }),
    threads,
    "platform",
  );
  expect(ids(shown)).toEqual(["in"]);
});

test("a sprint's summary counts closed and blocked threads", () => {
  const summary = summarize([
    thread("a"),
    thread("b", { status: "closed" }),
    thread("c", { status: "blocked" }),
  ]);
  expect(summaryLabel(summary)).toBe("3 threads · 1 closed · 1 blocked");
  expect(summaryLabel(summarize([thread("a")]))).toBe("1 thread");
});

test("load is each assignee's open threads and hours, a shared thread counting for each", () => {
  const loads = loadByPerson([
    thread("shared", { assignees: [sam, kim], effortHours: 4 }),
    thread("sams", { effortHours: 2 }),
    thread("kims-unestimated", { assignees: [kim] }),
    thread("done", { status: "closed", effortHours: 8 }),
  ]);
  expect(
    loads.map(({ person, threads, hours, unestimated }) => [
      person.id,
      threads,
      hours,
      unestimated,
    ]),
  ).toEqual([
    ["sam", 2, 6, 0],
    ["kim", 2, 4, 1],
  ]);
});

test("the next sprint is two weeks, from today or from where the latest one ends", () => {
  const first = nextSprint([], NOW);
  expect(first.name).toBe("Sprint 1");
  expect(first.startMs).toBe(MIDNIGHT);
  expect(first.endMs).toBe(new Date(2026, 10, 16).getTime());
  const second = nextSprint([sprint("s1")], NOW);
  expect(second.name).toBe("Sprint 2");
  expect(second.startMs).toBe(new Date(2026, 10, 16).getTime());
  expect(second.endMs).toBe(new Date(2026, 10, 30).getTime());
  // A sprint that's already over doesn't push the next one back.
  const late = nextSprint([sprint("s1", { endMs: MIDNIGHT - 1 })], NOW);
  expect(late.startMs).toBe(MIDNIGHT);
});

test("a sprint's dates read as its first and last day", () => {
  expect(sprintDates(sprint("s"))).toBe(
    `${new Date(2026, 10, 2).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(2026, 10, 15).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
  );
});

test("only the group's open threads not in an open sprint can be added", () => {
  const current = sprint("current", { threadIds: ["in-current"] });
  const groupSprints = [
    current,
    sprint("other", { threadIds: ["in-other"] }),
    sprint("old", { closed: true, threadIds: ["in-old"] }),
  ];
  const threads = [
    thread("free"),
    thread("in-current"),
    thread("in-other"),
    thread("in-old"),
    thread("closed", { status: "closed" }),
    thread("outside", { labelIds: [] }),
  ];
  expect(ids(addableThreads(current, threads, "platform", groupSprints))).toEqual([
    "free",
    "in-old",
  ]);
  expect(openSprintWith(groupSprints, "in-other")?.id).toBe("other");
  expect(openSprintWith(groupSprints, "in-old")).toBeUndefined();
});

test("the board puts each thread in its status's column", () => {
  const columns = boardColumns([
    thread("a"),
    thread("b", { status: "blocked" }),
    thread("c", { status: "closed" }),
  ]);
  expect(ids(columns.open)).toEqual(["a"]);
  expect(ids(columns.blocked)).toEqual(["b"]);
  expect(ids(columns.closed)).toEqual(["c"]);
});
