import type { Group, Label, Person, Thread } from "model";
import { createContext } from "solid-js";

// How links in a message resolve and open; `search` backs the `#` menu, `people` the `@` menu. Lists are getters.
export type ThreadLinks = {
  titleOf: (threadId: string) => string | undefined;
  nameOf: (personId: string) => string | undefined;
  open: (threadId: string) => void;
  openPerson: (personId: string) => void;
  search: (query: string) => { id: string; title: string }[];
  people: Person[];
  threads: Thread[];
  labels: Label[];
  groups: Group[];
};

// The thread on screen, so a link to it reads as plain text.
export const CurrentThreadContext = createContext<() => string | null>(() => null);
