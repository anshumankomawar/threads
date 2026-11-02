import { levelPositions, threadScore, SEEDED_LABELS, type Priority, type Schedule } from "model";
import { expect, test } from "vite-plus/test";
import { nextPlanningMs, planSchedule, workingSlots, type Plannable } from "../src/scheduler.ts";

// Monday 2026-11-02, midnight in the organization's time zone (UTC−8).
const NOW = Date.UTC(2026, 10, 2, 8);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Monday at the given time in the organization's time zone.
const at = (hour: number, minute = 0): number => NOW + hour * HOUR + minute * MINUTE;
const slot = (startMs: number, minutes = 30): Schedule => ({
  startMs,
  endMs: startMs + minutes * MINUTE,
});

const score = (
  fields: Partial<{
    priority: Priority;
    dueAtMs: number | null;
    effortHours: number | null;
    labelIds: string[];
  }> = {},
  level = 0,
): number => threadScore({ priority: "none", dueAtMs: null, ...fields }, level, NOW);

test("scores run from 1 to 100, with decimals", () => {
  const everything = score(
    { priority: "urgent", dueAtMs: NOW - HOUR, effortHours: 0.5, labelIds: ["incident"] },
    1,
  );
  expect(everything).toBe(100);
  expect(score({ effortHours: 8 })).toBe(1);
  // Worked by hand: urgency 96/168, so 0.3 × 0.571 + 0.3 × 0.5 + 0.2 × 0.5 + 0.1 × 0.786 = 0.5.
  expect(score({ dueAtMs: NOW + 3 * DAY, priority: "medium" }, 0.5)).toBe(50.5);
});

test("a nearer due date, higher priority, more senior asker or weightier tag all score higher", () => {
  expect(score({ dueAtMs: NOW + DAY })).toBeGreaterThan(score({ dueAtMs: NOW + 5 * DAY }));
  expect(score({ dueAtMs: NOW + 5 * DAY })).toBeGreaterThan(score());
  expect(score({ dueAtMs: NOW - HOUR })).toBeGreaterThan(score({ dueAtMs: NOW + DAY }));
  expect(score({ priority: "high" })).toBeGreaterThan(score({ priority: "low" }));
  expect(score({}, 1)).toBeGreaterThan(score({}, 0));
  expect(score({ labelIds: ["security"] })).toBeGreaterThan(score({ labelIds: ["housekeeping"] }));
});

test("only the weightiest tag counts", () => {
  expect(score({ labelIds: ["security", "housekeeping", "bug"] })).toBe(
    score({ labelIds: ["security"] }),
  );
});

test("there are ten tags, each with its own priority", () => {
  expect(SEEDED_LABELS).toHaveLength(10);
  expect(new Set(SEEDED_LABELS.map((tag) => tag.priority)).size).toBe(10);
});

test("quick work scores above big work, with no estimate in between", () => {
  expect(score({ effortHours: 0.5 })).toBeGreaterThan(score());
  expect(score()).toBeGreaterThan(score({ effortHours: 8 }));
});

test("big work goes first when a due date is close, quick work when it's far off", () => {
  for (const days of [1, 3]) {
    const dueAtMs = NOW + days * DAY;
    expect(score({ dueAtMs, effortHours: 8 })).toBeGreaterThan(score({ dueAtMs, effortHours: 4 }));
  }
  const dueAtMs = NOW + 6 * DAY;
  expect(score({ dueAtMs, effortHours: 4 })).toBeGreaterThan(score({ dueAtMs, effortHours: 8 }));
});

test("past a week of room there's no due date pressure, unless the work itself eats into it", () => {
  const dueAtMs = NOW + 7.5 * DAY;
  expect(score({ dueAtMs, effortHours: 8 })).toBeGreaterThan(score({ effortHours: 8 }));
  expect(score({ dueAtMs, effortHours: 0.5 })).toBe(score({ effortHours: 0.5 }));
});

test("urgent threads never score below the floor", () => {
  expect(score({ priority: "urgent" })).toBe(75);
  expect(score({ priority: "urgent", effortHours: 8 })).toBe(75);
});

test("levels are placed between the lowest and highest in the org", () => {
  const position = levelPositions([
    { id: "a", name: "A", level: "l4" },
    { id: "b", name: "B", level: "l5" },
    { id: "c", name: "C", level: "l6" },
    { id: "d", name: "D" },
  ]);
  expect(["a", "b", "c", "d", "unknown"].map(position)).toEqual([0, 0.5, 1, 0, 0]);
  expect(levelPositions([{ id: "a", name: "A", level: "l3" }])("a")).toBe(0);
  expect(levelPositions([])("a")).toBe(0);
});

test("working slots are half hours from 9 to 5 on the next five weekdays", () => {
  const friday = NOW + 4 * DAY;
  const slots = workingSlots(friday + 16 * HOUR);
  // Friday 4:00 and 4:30, then Monday to Thursday.
  expect(slots[0]).toBe(friday + 16 * HOUR);
  expect(slots[1]).toBe(friday + 16.5 * HOUR);
  expect(slots[2]).toBe(friday + 3 * DAY + 9 * HOUR);
  expect(slots).toHaveLength(2 + 4 * 16);
  expect(slots.at(-1)).toBe(friday + 6 * DAY + 16.5 * HOUR);
});

test("working hours follow the clock across a daylight saving change", () => {
  // Clocks went back on Sunday November 1st; Friday October 30th is still UTC−7.
  const friday = NOW - 3 * DAY - HOUR;
  expect(workingSlots(friday)[0]).toBe(friday + 9 * HOUR);
});

test("the next planning run is half an hour before the working day", () => {
  expect(nextPlanningMs(at(0))).toBe(at(8, 30));
  expect(nextPlanningMs(at(8, 30))).toBe(at(8, 30) + DAY);
  expect(nextPlanningMs(at(12))).toBe(at(8, 30) + DAY);
});

const thread = (id: string, score: number, blocks: Schedule[] = [], minutes = 30): Plannable => ({
  id,
  score,
  minutes,
  blocks,
});

const plan = (threads: Plannable[], fixed: Schedule[] = [], nowMs = NOW) =>
  Object.fromEntries(planSchedule(threads, fixed, nowMs, workingSlots(nowMs)));

const totalHours = (blocks: Schedule[]): number =>
  blocks.reduce((sum, block) => sum + (block.endMs - block.startMs) / HOUR, 0);

test("new threads fill the earliest working time, highest score first", () => {
  expect(plan([thread("low", 10), thread("high", 90), thread("mid", 50)])).toEqual({
    high: [slot(at(9))],
    mid: [slot(at(9, 30))],
    low: [slot(at(10))],
  });
});

test("a block can be as long as the free time allows", () => {
  expect(plan([thread("big", 90, [], 8 * 60), thread("next", 50, [], 60)])).toEqual({
    big: [slot(at(9), 8 * 60)],
    next: [slot(at(9) + DAY, 60)],
  });
});

test("a thread breaks around a meeting and carries over into the next day", () => {
  expect(plan([thread("big", 90, [], 8 * 60)], [slot(at(11), 60)])).toEqual({
    big: [slot(at(9), 120), slot(at(12), 5 * 60), slot(at(9) + DAY, 60)],
  });
});

test("there's no limit on a thread's blocks in a day", () => {
  const meetings = [slot(at(10)), slot(at(11)), slot(at(12)), slot(at(13))];
  expect(plan([thread("big", 90, [], 4 * 60)], meetings)).toEqual({
    big: [
      slot(at(9), 60),
      slot(at(10, 30)),
      slot(at(11, 30)),
      slot(at(12, 30)),
      slot(at(13, 30), 90),
    ],
  });
});

test("work that won't fit in what's left of today continues tomorrow", () => {
  expect(plan([thread("big", 90, [], 4 * 60)], [], at(15))).toEqual({
    big: [slot(at(15), 120), slot(at(9) + DAY, 120)],
  });
});

test("work spans as many days as it takes, skipping the weekend", () => {
  const friday = at(16) + 4 * DAY;
  expect(plan([thread("big", 90, [], 4 * 60)], [], friday)).toEqual({
    big: [slot(friday, 60), slot(friday + 3 * DAY - 7 * HOUR, 3 * 60)],
  });
  expect(plan([thread("week", 90, [], 16 * 60)]).week).toEqual([
    slot(at(9), 8 * 60),
    slot(at(9) + DAY, 8 * 60),
  ]);
});

test("meetings and focus blocks are worked around", () => {
  expect(plan([thread("a", 90), thread("b", 50)], [slot(at(9), 45), slot(at(10), 30)])).toEqual({
    a: [slot(at(10, 30))],
    b: [slot(at(11))],
  });
});

test("an incoming thread takes a place ahead of ones it outscores by the margin", () => {
  const held = [thread("a", 40, [slot(at(9))]), thread("b", 30, [slot(at(9, 30))])];
  expect(plan([...held, thread("new", 80)])).toEqual({
    new: [slot(at(9))],
    a: [slot(at(9, 30))],
    b: [slot(at(10))],
  });
});

test("an incoming thread goes behind ones within the margin, however close", () => {
  const held = [thread("a", 40, [slot(at(9))]), thread("b", 30, [slot(at(9, 30))])];
  expect(plan([...held, thread("new", 49)])).toEqual({
    a: [slot(at(9))],
    new: [slot(at(9, 30))],
    b: [slot(at(10))],
  });
  expect(plan([...held, thread("new", 40)])).toEqual({
    a: [slot(at(9))],
    b: [slot(at(9, 30))],
    new: [slot(at(10))],
  });
});

test("a raised score moves a thread up; a lowered one lets others past", () => {
  const raised = [thread("a", 40, [slot(at(9))]), thread("b", 60, [slot(at(9, 30))])];
  expect(plan(raised)).toEqual({ b: [slot(at(9))], a: [slot(at(9, 30))] });
  const lowered = [thread("a", 10, [slot(at(9))]), thread("b", 40, [slot(at(9, 30))])];
  expect(plan(lowered)).toEqual({ b: [slot(at(9))], a: [slot(at(9, 30))] });
});

test("something important splits a long block that hasn't started", () => {
  const big = thread("big", 20, [slot(at(9), 8 * 60)], 8 * 60);
  expect(plan([big, thread("urgent", 90, [], 60)])).toEqual({
    urgent: [slot(at(9), 60)],
    big: [slot(at(10), 7 * 60), slot(at(9) + DAY, 60)],
  });
});

test("planning again changes nothing, for threads of any length", () => {
  const meeting = [slot(at(11), 60)];
  const threads = [
    thread("a", 90, [], 8 * 60),
    thread("b", 50, [], 90),
    thread("c", 45),
    thread("d", 44, [], 16 * 60),
  ];
  const first = plan(threads, meeting);
  const again = plan(
    threads.map((item) => ({ ...item, blocks: first[item.id] })),
    meeting,
  );
  expect(again).toEqual(first);
});

test("time under way or about to start stays put, even for something urgent", () => {
  const now = at(10);
  const running = thread("running", 5, [slot(at(9, 45))]);
  const soon = thread("soon", 5, [slot(at(10, 30))]);
  expect(plan([running, soon, thread("urgent", 99)], [], now)).toEqual({
    running: [slot(at(9, 45))],
    soon: [slot(at(10, 30))],
    urgent: [slot(at(11))],
  });
});

test("only the next stretch of a long block is held; the rest gives way to something important", () => {
  const now = at(10, 10);
  const big = thread("big", 20, [slot(at(9), 8 * 60)], 8 * 60);
  expect(plan([big], [], now)).toEqual({ big: [slot(at(9), 8 * 60)] });
  expect(plan([big, thread("urgent", 90, [], 60)], [], now)).toEqual({
    urgent: [slot(at(11), 60)],
    big: [slot(at(9), 120), slot(at(12), 5 * 60), slot(at(9) + DAY, 60)],
  });
});

test("whatever doesn't fit in the days ahead waits for a later run", () => {
  // Five 8-hour days ahead.
  const planned = plan([thread("a", 50, [], 44 * 60), thread("b", 40)]);
  expect(totalHours(planned.a)).toBe(40);
  expect(planned.b).toEqual([]);
});

test("nothing lands on a weekend or outside working hours", () => {
  const planned = plan([thread("week", 50, [], 40 * 60)], [], at(12));
  const offset = 8 * HOUR;
  for (const block of planned.week) {
    expect([0, 6]).not.toContain(new Date(block.startMs - offset).getUTCDay());
    expect(new Date(block.startMs - offset).getUTCHours()).toBeGreaterThanOrEqual(9);
    const end = new Date(block.endMs - offset);
    expect(end.getUTCHours() + end.getUTCMinutes() / 60).toBeLessThanOrEqual(17);
  }
});
