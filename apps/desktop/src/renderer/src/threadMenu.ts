import type { Thread } from "model";
import { createContext, useContext } from "solid-js";

// Right-clicking a thread anywhere in the app opens the same menu (open, open beside, close or reopen, archive). Rows
// call this with the event and the thread; App owns the menu.
export type OpenThreadMenu = (event: MouseEvent, thread: Thread) => void;

export const ThreadMenuContext = createContext<OpenThreadMenu>(() => {});

export function useThreadMenu(): OpenThreadMenu {
  return useContext(ThreadMenuContext);
}
