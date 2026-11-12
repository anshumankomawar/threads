import type { JSONContent } from "@tiptap/react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light" | "slack";
export type Box = "inbox" | "unsorted" | "all" | "drafts" | (string & {});
export type View = { box: Box; thread?: string; settings?: boolean };
export type Draft = { id: string; content: JSONContent; text: string; at: number };
export type MenuItem = { label: string; run: () => void } | "separator";
export type Dialog = { kind: "search" | "find" } | { kind: "new"; draft?: Draft };

type UI = {
  history: View[];
  at: number;
  sidebar: boolean;
  theme: Theme;
  drafts: Draft[];
  dialog: Dialog | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
};

export const useUI = create<UI>()(
  persist(
    (): UI => ({
      history: [{ box: "inbox" }],
      at: 0,
      sidebar: true,
      theme: "dark",
      drafts: [],
      dialog: null,
      menu: null,
    }),
    { name: "ui", partialize: ({ sidebar, theme, drafts }) => ({ sidebar, theme, drafts }) },
  ),
);

const set = useUI.setState;
export const reset = () => set({ history: [{ box: "inbox" }], at: 0, drafts: [], dialog: null });

export const useView = () => useUI((ui) => ui.history[ui.at]);
export const currentView = () => useUI.getState().history[useUI.getState().at];

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
export const showMenu = (event: { clientX: number; clientY: number }, items: MenuItem[]) =>
  set({ menu: { x: event.clientX, y: event.clientY, items } });
export const hideMenu = () => set({ menu: null });

export const saveDraft = (draft: Draft) =>
  set(({ drafts }) => ({ drafts: [draft, ...drafts.filter(({ id }) => id !== draft.id)] }));
export const removeDraft = (id: string) =>
  set(({ drafts }) => ({ drafts: drafts.filter((draft) => draft.id !== id) }));

export function setTheme(theme: Theme) {
  set({ theme });
  applyTheme(theme);
}
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.desktop.setTheme(theme === "dark" ? "dark" : "light");
}
useUI.persist.onFinishHydration(({ theme }) => applyTheme(theme));
applyTheme(useUI.getState().theme);
