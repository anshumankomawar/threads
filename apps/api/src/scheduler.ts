import type { Schedule } from "model";

// The organization's working hours. Every schedule is laid out in them.
export const WORKING_HOURS = { timeZone: "America/Los_Angeles", startHour: 9, endHour: 17 };

const SLOT_MS = 30 * 60_000;
export const MIN_BLOCK_MINUTES = 30;
// Time starting this soon, or already under way, stays put: nobody's plan changes as they sit down to it.
const FREEZE_MS = 30 * 60_000;
const WORKING_DAYS_AHEAD = 5;
// How many points higher a thread has to score to take a place ahead of another, so small differences don't reshuffle
// the day.
const DISPLACE_MARGIN = 10;
const MAX_DAYS_SCANNED = 14;

const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: WORKING_HOURS.timeZone,
  weekday: "short",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

function localTime(ms: number): { weekday: string; day: string; hour: number; minute: number } {
  const parts = Object.fromEntries(clock.formatToParts(ms).map(({ type, value }) => [type, value]));
  return {
    weekday: parts.weekday,
    day: parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

const nextSlotBoundary = (ms: number): number => Math.ceil(ms / SLOT_MS) * SLOT_MS;

// Every half hour that can hold work from now through the next few working days.
export function workingSlots(nowMs: number): number[] {
  const slots: number[] = [];
  const workingDays = new Set<string>();
  const end = nowMs + MAX_DAYS_SCANNED * 24 * 60 * 60_000;
  for (let start = nextSlotBoundary(nowMs); start < end; start += SLOT_MS) {
    const { weekday, day, hour } = localTime(start);
    if (weekday === "Sat" || weekday === "Sun") continue;
    if (hour < WORKING_HOURS.startHour || hour >= WORKING_HOURS.endHour) continue;
    workingDays.add(day);
    if (workingDays.size > WORKING_DAYS_AHEAD) break;
    slots.push(start);
  }
  return slots;
}

// When to next look over every schedule: half an hour before the working day starts.
export function nextPlanningMs(nowMs: number): number {
  let start = nextSlotBoundary(nowMs + 1);
  for (;;) {
    const { hour, minute } = localTime(start);
    if (hour === WORKING_HOURS.startHour - 1 && minute === 30) return start;
    start += SLOT_MS;
  }
}

// How much of these blocks has gone by.
export function minutesSpent(blocks: Schedule[], nowMs: number): number {
  return blocks.reduce(
    (minutes, block) =>
      minutes + Math.max(0, Math.min(block.endMs, nowMs) - block.startMs) / 60_000,
    0,
  );
}

export type Plannable = {
  id: string;
  score: number;
  // How much time it still needs, counting any blocks it holds now.
  minutes: number;
  // The blocks it holds that aren't over yet.
  blocks: Schedule[];
};

// Joins blocks that touch, so unbroken time reads as one block.
function joined(blocks: Schedule[]): Schedule[] {
  const result: Schedule[] = [];
  for (const block of [...blocks].sort((a, b) => a.startMs - b.startMs)) {
    const last = result.at(-1);
    if (last !== undefined && block.startMs <= last.endMs)
      result[result.length - 1] = { ...last, endMs: Math.max(last.endMs, block.endMs) };
    else result.push(block);
  }
  return result;
}

// Where one person's threads go, given the fixed time they can't use (meetings, focus blocks). The only limits on a
// thread's blocks are the working hours left and that fixed time: it takes free half hours until it has the time it
// needs, as one long block or several, across as many days as that takes.
//
// Threads keep their order unless one outscores the thread ahead of it by the margin. Threads holding no blocks join
// the end by score and climb from there. In that order, each takes the earliest working time still free. Whatever
// doesn't fit in the days ahead waits for a later run. Time under way or about to start stays put, but only that
// stretch: the rest of a long block can still give way to something more important.
export function planSchedule(
  threads: Plannable[],
  fixed: Schedule[],
  nowMs: number,
  slots: number[],
): Map<string, Schedule[]> {
  const frozenUntil = nextSlotBoundary(nowMs + FREEZE_MS + 1);
  const free = new Set(
    slots.filter(
      (start) => !fixed.some((block) => block.startMs < start + SLOT_MS && start < block.endMs),
    ),
  );
  const frozen = new Map<string, Schedule[]>();
  for (const thread of threads) {
    const parts = thread.blocks
      .filter((block) => block.startMs < frozenUntil)
      .map((block) => ({ ...block, endMs: Math.min(block.endMs, frozenUntil) }));
    frozen.set(thread.id, parts);
    for (const part of parts)
      for (const start of slots)
        if (part.startMs < start + SLOT_MS && start < part.endMs) free.delete(start);
  }

  const earliest = (thread: Plannable): number => Math.min(...thread.blocks.map((b) => b.startMs));
  const holding = threads.filter((thread) => thread.blocks.length > 0);
  const waiting = threads.filter((thread) => thread.blocks.length === 0);
  holding.sort((a, b) => earliest(a) - earliest(b) || a.id.localeCompare(b.id));
  waiting.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const order = [...holding, ...waiting];
  for (let index = 1; index < order.length; index++) {
    for (let at = index; at > 0 && order[at].score > order[at - 1].score + DISPLACE_MARGIN; at--) {
      [order[at - 1], order[at]] = [order[at], order[at - 1]];
    }
  }

  const plan = new Map<string, Schedule[]>();
  for (const thread of order) {
    const parts = frozen.get(thread.id) ?? [];
    let neededMs =
      thread.minutes * 60_000 - parts.reduce((sum, part) => sum + part.endMs - part.startMs, 0);
    const claimed: Schedule[] = [];
    for (const start of slots) {
      if (neededMs <= 0) break;
      if (!free.has(start)) continue;
      free.delete(start);
      claimed.push({ startMs: start, endMs: start + SLOT_MS });
      neededMs -= SLOT_MS;
    }
    plan.set(thread.id, joined([...parts, ...claimed]));
  }
  return plan;
}
