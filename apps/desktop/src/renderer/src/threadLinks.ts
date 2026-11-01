import { createContext, useContext } from "react";

// How thread links (`[[thread:<id>]]` in a message) show and open: by the linked thread's current title, into the
// split view beside the thread you're in.
export type ThreadLinks = {
  titleOf: (threadId: string) => string | undefined;
  open: (threadId: string) => void;
};

export const ThreadLinksContext = createContext<ThreadLinks>({
  titleOf: () => undefined,
  open: () => {},
});

export const useThreadLinks = (): ThreadLinks => useContext(ThreadLinksContext);
