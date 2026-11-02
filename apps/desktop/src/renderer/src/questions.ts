import {
  isDone,
  mentionsIn,
  workdayOf,
  type Person,
  type Schedule,
  type Thread,
  type Workday,
} from "model";

// How questions (mentions) reach people and how the asker sees them land. A question reaches someone straight away,
// unless they're in a meeting or focus block, when it waits for the end; they're expected to answer by their next
// catch-up window (their `Workday`'s catch-up half hours on a weekday, which the scheduler keeps free for this).

// The next catch-up window starting after a time, in someone's working day.
export function nextCatchUp(afterMs: number, workday: Workday): number {
  const day = new Date(afterMs);
  day.setHours(0, 0, 0, 0);
  for (let offset = 0; offset < 8; offset++) {
    const weekday = day.getDay();
    if (weekday !== 0 && weekday !== 6)
      for (const { hour, minute } of workday.catchUp) {
        const at = new Date(day);
        at.setHours(hour, minute, 0, 0);
        if (at.getTime() > afterMs) return at.getTime();
      }
    day.setDate(day.getDate() + 1);
  }
  return afterMs;
}

// Someone's meetings and focus blocks: when nothing should interrupt them.
export function quietTimes(threads: Thread[], personId: string): Schedule[] {
  return threads.flatMap((thread) =>
    !isDone(thread.status) &&
    thread.schedule !== null &&
    (thread.kind === "meeting"
      ? thread.attendees.some((person) => person.id === personId)
      : thread.kind === "focus" && (thread.assignee ?? thread.requester).id === personId)
      ? [thread.schedule]
      : [],
  );
}

// When a question asked at a time reaches someone: then, or when the quiet block it landed in ends.
export function reachesAt(atMs: number, quiet: Schedule[]): number {
  return quiet.find((block) => block.startMs <= atMs && atMs < block.endMs)?.endMs ?? atMs;
}

// Whether a question has gone past the catch-up window it was meant to be answered in. Someone with no catch-up times
// set is never overdue.
export function isOverdue(
  atMs: number,
  quiet: Schedule[],
  nowMs: number,
  workday: Workday,
): boolean {
  if (workday.catchUp.length === 0) return false;
  return nowMs > nextCatchUp(reachesAt(atMs, quiet), workday) + 30 * 60_000;
}

export type AskStatus =
  | { kind: "answered"; person: Person }
  | { kind: "seen"; person: Person }
  | { kind: "overdue"; person: Person }
  | { kind: "waiting"; person: Person; reachesAtMs: number };

// How a question you asked is doing, for each person it asked: answered (they've written since), seen (they opened
// the thread since), overdue (it missed their catch-up window), or on its way (when it reaches them).
export function askStatuses(
  thread: Thread,
  messageId: string,
  people: Person[],
  threads: Thread[],
  nowMs: number,
): AskStatus[] {
  const message = thread.entries.find((entry) => entry.id === messageId);
  if (message?.kind !== "message") return [];
  return mentionsIn(message.text).flatMap((personId): AskStatus[] => {
    const person = people.find((candidate) => candidate.id === personId);
    if (person === undefined || personId === message.author.id) return [];
    const answered = thread.entries.some(
      (entry) =>
        entry.kind === "message" &&
        entry.author.id === personId &&
        entry.createdAtMs > message.createdAtMs,
    );
    if (answered) return [{ kind: "answered", person }];
    if ((thread.seenBy[personId] ?? 0) >= message.createdAtMs) return [{ kind: "seen", person }];
    const quiet = quietTimes(threads, personId);
    if (isOverdue(message.createdAtMs, quiet, nowMs, workdayOf(person)))
      return [{ kind: "overdue", person }];
    return [{ kind: "waiting", person, reachesAtMs: reachesAt(message.createdAtMs, quiet) }];
  });
}
