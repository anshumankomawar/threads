import type { Person, Priority } from "./model";

// The labels every workspace starts with, and the only ones that count towards a thread's score, from 1 to 100. Labels
// people make have no priority, so nobody can jump the queue by making one.
export const SEEDED_LABELS = [
  { id: "incident", name: "Incident", priority: 100 },
  { id: "security", name: "Security", priority: 95 },
  { id: "customer-escalation", name: "Customer escalation", priority: 85 },
  { id: "compliance", name: "Compliance", priority: 80 },
  { id: "revenue", name: "Revenue", priority: 70 },
  { id: "launch", name: "Launch", priority: 60 },
  { id: "bug", name: "Bug", priority: 50 },
  { id: "planning", name: "Planning", priority: 30 },
  { id: "tech-debt", name: "Tech debt", priority: 20 },
  { id: "housekeeping", name: "Housekeeping", priority: 10 },
] as const;

// How much work a thread is, in hours, in half-hour steps.
export const EFFORT_OPTIONS = [0.5, 1, 2, 4, 8, 16, 24, 40];
export const MIN_EFFORT_HOURS = 0.5;
// At this much work and beyond, a thread gets no credit for being quick.
const BIG_WORK_HOURS = 8;

export function formatEffort(hours: number): string {
  return hours < 1 ? `${hours * 60}m` : `${hours}h`;
}

const PRIORITY_VALUE: Record<Priority, number> = {
  none: 0,
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  urgent: 1,
};

const WEIGHTS = { due: 0.3, priority: 0.3, level: 0.2, tag: 0.1, effort: 0.1 };
const URGENT_FLOOR = 75;
const DUE_WINDOW_HOURS = 7 * 24;
// Hours of clock time an hour of work takes up: 8 working hours fill one 24-hour day.
const CLOCK_HOURS_PER_WORK_HOUR = 3;

// A due date presses harder the less room is left around the work: nothing beyond a week of room, everything once
// overdue. Bigger work feels it sooner.
function dueUrgency(dueAtMs: number | null, effortHours: number | null, nowMs: number): number {
  if (dueAtMs === null) return 0;
  const hoursLeft = (dueAtMs - nowMs) / 3_600_000;
  if (hoursLeft < 0) return 1;
  const room = hoursLeft - (effortHours ?? 0) * CLOCK_HOURS_PER_WORK_HOUR;
  return Math.min(1, Math.max(0, 1 - room / DUE_WINDOW_HOURS));
}

// With time to spare, quick work gets ahead of big work (no estimate sits in the middle). As a due date closes in that
// preference fades into the due date's own pressure, so big work due soon goes first instead of being put off.
function effortPull(effortHours: number | null, urgency: number): number {
  const quickness =
    effortHours === null
      ? 0.5
      : Math.max(0, 1 - (effortHours - MIN_EFFORT_HOURS) / (BIG_WORK_HOURS - MIN_EFFORT_HOURS));
  return urgency + (1 - urgency) * quickness;
}

export type ScoreFields = {
  priority: Priority;
  dueAtMs: number | null;
  effortHours?: number | null;
  labelIds?: string[];
};

// How important a thread is, from 1 to 100, which orders it within its inbox bucket. `askerLevel` is
// `levelPositions` of whoever is waiting on the answer. Only the most important label counts, so piling labels on
// doesn't raise it. Urgent threads never fall below the floor.
export function threadScore(fields: ScoreFields, askerLevel: number, nowMs: number): number {
  const effortHours = fields.effortHours ?? null;
  const urgency = dueUrgency(fields.dueAtMs, effortHours, nowMs);
  const tag = Math.max(
    0,
    ...SEEDED_LABELS.filter(({ id }) => fields.labelIds?.includes(id)).map(
      ({ priority }) => priority / 100,
    ),
  );
  const weighted =
    WEIGHTS.due * urgency +
    WEIGHTS.priority * PRIORITY_VALUE[fields.priority] +
    WEIGHTS.level * askerLevel +
    WEIGHTS.tag * tag +
    WEIGHTS.effort * effortPull(effortHours, urgency);
  const score = 1 + 99 * weighted;
  return (
    Math.round((fields.priority === "urgent" ? Math.max(URGENT_FLOOR, score) : score) * 10) / 10
  );
}

const levelNumber = (person: Person): number | null => {
  const number = Number(person.level?.slice(1));
  return Number.isFinite(number) && person.level !== undefined ? number : null;
};

// Where each person's level sits in the org, from 0 (the lowest) to 1 (the highest). No level counts as the lowest.
export function levelPositions(people: Iterable<Person>): (personId: string) => number {
  const levels = new Map<string, number>();
  for (const person of people) {
    const level = levelNumber(person);
    if (level !== null) levels.set(person.id, level);
  }
  const min = Math.min(...levels.values());
  const max = Math.max(...levels.values());
  return (personId) => {
    const level = levels.get(personId);
    return level === undefined || max === min ? 0 : (level - min) / (max - min);
  };
}

// Whose answer a thread's score weighs: the other person from whoever it's waiting on.
export function askerId(
  requesterId: string,
  assigneeId: string | null,
  turn: string | null,
): string {
  return turn === requesterId && assigneeId !== null ? assigneeId : requesterId;
}
