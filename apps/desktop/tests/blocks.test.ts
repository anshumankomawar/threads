import type { Person, Schedule, Thread } from "model";
import { expect, test } from "vite-plus/test";
import { buildDay, slotMissesDue } from "../src/renderer/src/inbox";

const me: Person = { id: "me", name: "You" };
const other: Person = { id: "other", name: "Sam Rivera" };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 10, 2, 8).getTime();
const block = (startMs: number, hours: number): Schedule => ({
  startMs,
  endMs: startMs + hours * HOUR,
});

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
    effortHours: null,
    tagIds: [],
    schedule: null,
    blocks: [],
    workedMinutes: 0,
    attendees: [],
    branchedFromId: null,
    blocksId: null,
    seenBy: {},
    updatedAtMs: NOW,
    entries: [],
    ...fields,
  };
}

test("a thread has a timeline row for each of its blocks on the day shown", () => {
  const blocks = [block(NOW + HOUR, 2), block(NOW + 4 * HOUR, 3), block(NOW + DAY + HOUR, 3)];
  const big = thread({ blocks, schedule: blocks[0] });
  const today = buildDay([big], me, [], NOW);
  expect(today.timeline.map((item) => item.block)).toEqual([blocks[0], blocks[1]]);
  const tomorrow = buildDay([big], me, [], NOW, today.dayMs + DAY);
  expect(tomorrow.timeline.map((item) => item.block)).toEqual([blocks[2]]);
});

test("a thread with blocks today stays out of the inbox; with only later ones it's in", () => {
  const today = block(NOW + HOUR, 2);
  const tomorrow = block(NOW + DAY, 2);
  expect(buildDay([thread({ blocks: [today, tomorrow] })], me, [], NOW).unscheduled).toEqual([]);
  expect(buildDay([thread({ blocks: [tomorrow] })], me, [], NOW).unscheduled).toHaveLength(1);
});

test("timeline rows from different threads sort by when each block starts", () => {
  const big = thread({ id: "big", blocks: [block(NOW + HOUR, 1), block(NOW + 5 * HOUR, 1)] });
  const small = thread({ id: "small", blocks: [block(NOW + 3 * HOUR, 1)] });
  expect(
    buildDay([big, small], me, [], NOW).timeline.map((item) => [
      item.thread.id,
      item.block.startMs,
    ]),
  ).toEqual([
    ["big", NOW + HOUR],
    ["small", NOW + 3 * HOUR],
    ["big", NOW + 5 * HOUR],
  ]);
});

test("a thread misses its due date when its last block ends too late", () => {
  const blocks = [block(NOW, 2), block(NOW + DAY, 2)];
  expect(slotMissesDue(thread({ blocks, dueAtMs: NOW + 12 * HOUR }))).toBe(true);
  expect(slotMissesDue(thread({ blocks, dueAtMs: NOW + 2 * DAY }))).toBe(false);
});

test("a thread misses its due date when part of its estimate has no room", () => {
  const blocks = [block(NOW, 8)];
  expect(slotMissesDue(thread({ blocks, dueAtMs: NOW + 9 * HOUR, effortHours: 40 }))).toBe(true);
  expect(slotMissesDue(thread({ blocks, dueAtMs: NOW + 9 * HOUR, effortHours: 8 }))).toBe(false);
  // Time already put in counts as placed.
  expect(
    slotMissesDue(thread({ blocks, dueAtMs: NOW + 9 * HOUR, effortHours: 10, workedMinutes: 120 })),
  ).toBe(false);
});

test("no due date, or a thread that isn't open, can't miss one", () => {
  const blocks = [block(NOW + DAY, 2)];
  expect(slotMissesDue(thread({ blocks }))).toBe(false);
  expect(slotMissesDue(thread({ blocks, dueAtMs: NOW, status: "blocked" }))).toBe(false);
});
