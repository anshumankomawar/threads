import type { Group, Label, Person, Thread } from "model";
import { createContext, useContext } from "solid-js";

// How links in a message show: thread links (`[[thread:<id>]]`) by the linked thread's current title, opening into
// the split view beside the thread you're in; mentions (`[[person:<id>]]`) by the person's name. `search` backs the
// `#` menu: threads whose title matches, most recently active first. `people` backs the `@` menu.
// Its lists are getters, so they stay current.
export type ThreadLinks = {
  titleOf: (threadId: string) => string | undefined;
  nameOf: (personId: string) => string | undefined;
  open: (threadId: string) => void;
  // Someone's profile, from their name on a message or a mention.
  openPerson: (personId: string) => void;
  search: (query: string) => { id: string; title: string }[];
  people: Person[];
  // Every thread, for the details panel's graph of branches.
  threads: Thread[];
  labels: Label[];
  groups: Group[];
};

export const ThreadLinksContext = createContext<ThreadLinks>({
  titleOf: () => undefined,
  nameOf: () => undefined,
  open: () => {},
  openPerson: () => {},
  search: () => [],
  people: [],
  threads: [],
  labels: [],
  groups: [],
});

export const useThreadLinks = (): ThreadLinks => useContext(ThreadLinksContext);

// The thread being shown, so a link to it reads as plain text rather than a way to where you already are. An accessor,
// since the thread on screen changes.
export const CurrentThreadContext = createContext<() => string | null>(() => null);
