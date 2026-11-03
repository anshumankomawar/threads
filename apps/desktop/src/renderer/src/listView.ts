import { useState } from "react";

// Whether lists of threads show as a list or a board: one choice for every page, remembered on this device.
export type ListView = "list" | "board";

const KEY = "list-view";

function saved(): ListView {
  try {
    return localStorage.getItem(KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

export function useListView(): [ListView, (next: ListView) => void] {
  const [view, setView] = useState<ListView>(saved);
  const choose = (next: ListView): void => {
    setView(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Remembering it is a convenience.
    }
  };
  return [view, choose];
}
