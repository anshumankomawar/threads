import type { Person, Thread } from "model";
import { createContext, useContext } from "react";

// How links in a message show: thread links (`[[thread:<id>]]`) by the linked thread's current title, opening into
// the split view beside the thread you're in; mentions (`[[person:<id>]]`) by the person's name. `search` backs the
// `#` menu: threads whose title matches, most recently active first. `people` backs the `@` menu.
export type ThreadLinks = {
  titleOf: (threadId: string) => string | undefined;
  nameOf: (personId: string) => string | undefined;
  open: (threadId: string) => void;
  search: (query: string) => { id: string; title: string }[];
  people: Person[];
  // Every thread, for working out when a question reaches someone (their meetings and focus blocks).
  threads: Thread[];
};

export const ThreadLinksContext = createContext<ThreadLinks>({
  titleOf: () => undefined,
  nameOf: () => undefined,
  open: () => {},
  search: () => [],
  people: [],
  threads: [],
});

export const useThreadLinks = (): ThreadLinks => useContext(ThreadLinksContext);

// The thread being shown, so a link to it reads as plain text rather than a way to where you already are.
export const CurrentThreadContext = createContext<string | null>(null);
