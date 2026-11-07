import { Message, Thread, threadLinksIn } from "models";
import { store } from "./session";

// Threads linked to threads: by a `[[thread:…]]` link in one's description or messages, or by branching one from
// another (the thread it came from links to the branch). There's no kind of link and no parent: a thread that links to
// others is simply made of them, and how many of those are resolved is its progress.

export const links = store.view(() => {
  const out = new Map<string, Set<string>>();
  const back = new Map<string, Set<string>>();
  const add = (from: string, to: string): void => {
    if (from === to) return;
    if (!out.has(from)) out.set(from, new Set());
    if (!back.has(to)) back.set(to, new Set());
    out.get(from)!.add(to);
    back.get(to)!.add(from);
  };
  for (const t of store.all(Thread)) {
    for (const id of threadLinksIn(t.description ?? "")) add(t.id, id);
    if (t.branchedFromId) add(t.branchedFromId, t.id);
  }
  for (const m of store.all(Message)) for (const id of threadLinksIn(m.body)) add(m.threadId, id);
  return { out, back };
});

const found = (ids: Set<string> | undefined): Thread[] =>
  [...(ids ?? [])].flatMap((id) => store.findById(Thread, id) ?? []);

// The threads `thread` links to, and those that link to it.
export const linksFrom = (thread: Thread): Thread[] => found(links().out.get(thread.id));
export const linksTo = (thread: Thread): Thread[] =>
  found(links().back.get(thread.id)).filter((t) => !links().out.get(thread.id)?.has(t.id));

// How many of the threads it links to are resolved, if it links to any.
export function progressOf(thread: Thread): { done: number; total: number } | undefined {
  const linked = linksFrom(thread);
  if (linked.length === 0) return undefined;
  return { done: linked.filter((t) => !t.isOpen).length, total: linked.length };
}
