import type { ComposeDraft } from "model";
import { createMemo, createSignal } from "solid-js";

// A thread written in the new-message panel (⌘⇧N) but not sent. Drafts live on this device only, per data source,
// like an email client's unsent drafts.
export type SavedDraft = {
  id: string;
  text: string;
  // Null when it was saved before there was a draft to keep.
  draft: ComposeDraft | null;
  savedAtMs: number;
};

function load(source: string): SavedDraft[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`drafts-${source}`) ?? "[]");
    return Array.isArray(saved) ? (saved as SavedDraft[]) : [];
  } catch {
    return [];
  }
}

// Your drafts for a data source, newest first.
export function useDrafts(source: () => string): {
  drafts: () => SavedDraft[];
  save: (draft: SavedDraft) => void;
  remove: (id: string) => void;
} {
  // Bumped on every change, so the list is read again from storage.
  const [version, setVersion] = createSignal(0);
  const drafts = createMemo(() => (version(), load(source())));
  const update = (change: (drafts: SavedDraft[]) => SavedDraft[]): void => {
    try {
      localStorage.setItem(`drafts-${source()}`, JSON.stringify(change(load(source()))));
    } catch {
      // Not kept this time.
    }
    setVersion((count) => count + 1);
  };
  const without = (id: string) => (all: SavedDraft[]) => all.filter((draft) => draft.id !== id);
  return {
    drafts,
    save: (draft) =>
      update((all) => [{ ...draft, savedAtMs: Date.now() }, ...without(draft.id)(all)]),
    remove: (id) => update(without(id)),
  };
}
