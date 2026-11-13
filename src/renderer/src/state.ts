import { createLocalStorage, createPreference } from "@ui-sdk/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Box = "inbox" | "unsorted" | "all" | "drafts" | (string & {});
export type View = { box: Box; thread?: string; settings?: boolean };
export type Draft = { id: string; text: string; at: number };
export type Dialog = { kind: "search" | "find" } | { kind: "new"; draft?: Draft };

export const theme = createPreference({
  values: ["dark", "light"],
  defaultValue: "dark",
  attribute: "data-theme",
  global: true,
  storage: createLocalStorage("theme"),
});

type UI = {
  history: View[];
  at: number;
  sidebar: boolean;
  drafts: Draft[];
  dialog: Dialog | null;
};

export const useUI = create<UI>()(
  persist(
    (): UI => ({ history: [{ box: "inbox" }], at: 0, sidebar: true, drafts: [], dialog: null }),
    { name: "ui", partialize: ({ sidebar, drafts }) => ({ sidebar, drafts }) },
  ),
);

const set = useUI.setState;
export const reset = () => set({ history: [{ box: "inbox" }], at: 0, drafts: [], dialog: null });

export const useView = () => useUI((ui) => ui.history[ui.at]);

export function go(view: Partial<View>) {
  const { history, at } = useUI.getState();
  const next = { ...history[at], settings: false, ...view };
  set({ history: [...history.slice(0, at + 1), next], at: at + 1, dialog: null });
}
export const back = () => set(({ at }) => ({ at: Math.max(0, at - 1) }));
export const forward = () =>
  set(({ at, history }) => ({ at: Math.min(history.length - 1, at + 1) }));

export const setDialog = (dialog: Dialog | null) => set({ dialog });
export const toggleSidebar = () => set(({ sidebar }) => ({ sidebar: !sidebar }));

export const saveDraft = (draft: Draft) =>
  set(({ drafts }) => ({ drafts: [draft, ...drafts.filter(({ id }) => id !== draft.id)] }));
export const removeDraft = (id: string) =>
  set(({ drafts }) => ({ drafts: drafts.filter((draft) => draft.id !== id) }));
