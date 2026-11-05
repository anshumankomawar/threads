import type { ComposeDraft } from "model";
import { createMemo, createSignal } from "solid-js";

// A thread you've written in the new-message panel (⌘⇧N) but not sent: what you typed, and the draft of the thread as
// you left it, with any edits. Nothing is sent until you send it, so drafts live on this device only, per data
// source, like an email client's unsent drafts.
export type SavedDraft = {
  id: string;
  text: string;
  // Null when it was saved before there was a draft to keep.
  draft: ComposeDraft | null;
  savedAtMs: number;
};

const keyFor = (source: string): string => `drafts-${source}`;

function load(source: string): SavedDraft[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(keyFor(source)) ?? "[]");
    return Array.isArray(saved) ? (saved as SavedDraft[]) : [];
  } catch {
    return [];
  }
}

function store(source: string, drafts: SavedDraft[]): void {
  try {
    localStorage.setItem(keyFor(source), JSON.stringify(drafts));
  } catch {
    // Not kept this time; the draft stays in the list until the app reloads.
  }
}

// Your drafts for a data source (an accessor, since it can change), newest first, with saving (adding or replacing by
// id, as of now) and deleting.
export function useDrafts(source: () => string): {
  drafts: () => SavedDraft[];
  save: (draft: SavedDraft) => void;
  remove: (id: string) => void;
} {
  // Bumped on every save or delete, so the list is read again from storage.
  const [version, setVersion] = createSignal(0);
  const drafts = createMemo(() => {
    version();
    return load(source());
  });
  const update = (next: SavedDraft[]): void => {
    store(source(), next);
    setVersion((count) => count + 1);
  };
  return {
    drafts,
    // Stamped with now, so the newest edit is first.
    save: (draft) =>
      update([
        { ...draft, savedAtMs: Date.now() },
        ...load(source()).filter((other) => other.id !== draft.id),
      ]),
    remove: (id) => update(load(source()).filter((draft) => draft.id !== id)),
  };
}
