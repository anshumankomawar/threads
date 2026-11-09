// A thread's dates as they're picked, and the day arithmetic everything that shows or sets them shares.

// One day, or a span of them, each at its midnight (local).
export type When = { start: Date; end: Date };

// A day's midnight (local).
export const startOfDay = (date: Date | number): Date => {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

// When something's due on a day: 5pm, as every due date is.
export const dueOn = (date: Date | number): Date => new Date(new Date(date).setHours(17, 0, 0, 0));

// So many days from today, by the calendar (not 24-hour steps, which a clock change throws off), due then.
export const dueIn = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dueOn(date);
};

// What a picked "when" sets on a thread: one day is when it's due; a span starts on its first day too.
export function whenFields(when: When): { startAt: Date | undefined; dueAt: Date } {
  return {
    startAt: when.start.getTime() === when.end.getTime() ? undefined : when.start,
    dueAt: dueOn(when.end),
  };
}
