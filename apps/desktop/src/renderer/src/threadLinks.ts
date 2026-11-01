import { createContext, useContext } from "react";

// How thread links (`[[thread:<id>]]` in a message) show and open: by the linked thread's current title, into the
// split view beside the thread you're in.
// `search` backs the `#` menu: threads whose title matches, most recently active first.
export type ThreadLinks = {
  titleOf: (threadId: string) => string | undefined;
  open: (threadId: string) => void;
  search: (query: string) => { id: string; title: string }[];
};

export const ThreadLinksContext = createContext<ThreadLinks>({
  titleOf: () => undefined,
  open: () => {},
  search: () => [],
});

export const useThreadLinks = (): ThreadLinks => useContext(ThreadLinksContext);

// The thread being shown, so a link to it reads as plain text rather than a way to where you already are.
export const CurrentThreadContext = createContext<string | null>(null);
