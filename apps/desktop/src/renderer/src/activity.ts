import { involves, type Entry, type Person, type Thread } from "model";

// What changed on your threads that doesn't need you to act: replies and the status lines worth knowing about (closed,
// reopened, renamed, handed over, blocked, unblocked, messages moved). Conversations aren't
// here (they have their own list), nor are routine edits to priority, due dates and estimates.
// Read straight from the threads, like everything else; nothing is stored.

// Activity lines worth a mention, by how the server words them.
const NOTEWORTHY = [
  /^changed status to/,
  /^reopened this/,
  /^renamed this/,
  /^took this on/,
  /^assigned this to/,
  /^created this on behalf of/,
  /^made .* the requester/,
  /^is blocked on/,
  /^is unblocked/,
  /^moved /,
];

// How far back activity goes.
const WINDOW_MS = 7 * 24 * 60 * 60_000;
const LIMIT = 30;

export type ActivityItem = {
  thread: Thread;
  // The newest thing that happened, and who did it.
  actor: Person;
  entry: Entry;
  // A new thread's description is "opened" (`descriptionOf`).
  summary: "opened" | "replied" | "event";
  atMs: number;
  // How many things happened since you last looked; 0 when you're caught up.
  unread: number;
};

function author(entry: Entry): Person | null {
  if (entry.kind === "event") return entry.actor;
  if (entry.kind === "message" || entry.kind === "resolution") return entry.author;
  return null;
}

// One row per thread, newest first: the latest thing someone else did there in the past week.
export function activityFor(
  threads: Thread[],
  me: Person,
  seenAt: (thread: Thread) => number,
  nowMs: number,
): ActivityItem[] {
  return threads
    .flatMap((thread): ActivityItem[] => {
      // Archived threads are put away, news and all.
      if (thread.status === "archived" || !involves(thread, me.id)) return [];
      const relevant = thread.entries.filter((entry) => {
        const person = author(entry);
        if (person === null || person.id === me.id || entry.createdAtMs < nowMs - WINDOW_MS)
          return false;
        return entry.kind !== "event" || NOTEWORTHY.some((pattern) => pattern.test(entry.text));
      });
      const latest = relevant.at(-1);
      const actor = latest && author(latest);
      if (latest === undefined || !actor) return [];
      return [
        {
          thread,
          actor,
          entry: latest,
          summary:
            latest.kind === "event" ? "event" : latest.id === thread.id ? "opened" : "replied",
          atMs: latest.createdAtMs,
          unread: relevant.filter((entry) => entry.createdAtMs > seenAt(thread)).length,
        },
      ];
    })
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, LIMIT);
}
