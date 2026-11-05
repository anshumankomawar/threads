import { involves, type Entry, type Person, type Thread } from "model";

// Activity lines worth a notification, by how the server words them (the middle two only older threads have).
// Routine edits (priority, due dates, estimates) stay out.
const NOTEWORTHY =
  /^(changed status to|reopened this|renamed this|took this on|assigned this to|created this on behalf of|made .* the requester|is blocked on|is unblocked|moved )/;
const WINDOW_MS = 7 * 24 * 60 * 60_000;
const LIMIT = 30;

export type ActivityItem = {
  thread: Thread;
  actor: Person;
  entry: Entry;
  // A new thread's description is "opened" (`descriptionOf`).
  summary: "opened" | "replied" | "event";
  atMs: number;
  // How many things happened since you last looked.
  unread: number;
};

const author = (entry: Entry): Person => (entry.kind === "event" ? entry.actor : entry.author);

// Per thread you're in, newest first: the latest thing someone else did there in the past week.
export function activityFor(
  threads: Thread[],
  me: Person,
  seenAt: (thread: Thread) => number,
  nowMs: number,
): ActivityItem[] {
  return threads
    .flatMap((thread): ActivityItem[] => {
      if (thread.status === "archived" || !involves(thread, me.id)) return [];
      const relevant = thread.entries.filter(
        (entry) =>
          author(entry).id !== me.id &&
          entry.createdAtMs >= nowMs - WINDOW_MS &&
          (entry.kind !== "event" || NOTEWORTHY.test(entry.text)),
      );
      const latest = relevant.at(-1);
      if (latest === undefined) return [];
      const summary =
        latest.kind === "event" ? "event" : latest.id === thread.id ? "opened" : "replied";
      const unread = relevant.filter((entry) => entry.createdAtMs > seenAt(thread)).length;
      return [
        { thread, actor: author(latest), entry: latest, summary, atMs: latest.createdAtMs, unread },
      ];
    })
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, LIMIT);
}
