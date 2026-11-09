import { Thread } from "models";
import { store } from "./session";

// A thread's branches are its parts: threads branched from it, or put under it (⌘K's Add Branch, Branch Of). How many
// of them are resolved is its progress. A link in a message is only a link: it makes nothing part of anything.

export const branchesOf = (thread: Thread): Thread[] =>
  store.where(Thread, "branchedFromId", thread.id);

// How many of its branches are resolved, if it has any.
export function progressOf(thread: Thread): { done: number; total: number } | undefined {
  const branches = branchesOf(thread);
  if (branches.length === 0) return undefined;
  return { done: branches.filter((t) => !t.isOpen).length, total: branches.length };
}

// Whether `other` is `thread` or under it, so making `thread` a branch of it would loop.
export function isUnder(other: Thread, thread: Thread): boolean {
  for (let at: Thread | undefined = other; at; at = at.branchedFrom) if (at === thread) return true;
  return false;
}
