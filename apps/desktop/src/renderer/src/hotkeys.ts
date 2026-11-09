import { createSignal } from "solid-js";
import { save, saved } from "./startup";

// Every command you can press a key for, with its keys out of the box (Settings → Hotkeys rebinds any of them). Keys
// are written as macOS shows them, modifiers in its order: ⌃ ⌥ ⇧ ⌘, then the key. Plain keys work when you're not
// typing; with ⌘ or ⌃ they work anywhere. What each does is in session.ts, by id.
export const HOTKEYS = [
  { id: "search", label: "Search", section: "General", keys: "⌘K" },
  // What you changed last, undone and redone (the sync engine's undo queue); while you're typing, the text's own.
  { id: "undo", label: "Undo", section: "General", keys: "⌘Z" },
  { id: "redo", label: "Redo", section: "General", keys: "⇧⌘Z" },
  // As in Slack and GitHub: when you aren't typing, / opens it too.
  { id: "searchSlash", label: "Search (without ⌘)", section: "General", keys: "/" },
  { id: "settings", label: "Settings", section: "General", keys: "⌘," },
  { id: "hotkeys", label: "Show Hotkeys", section: "General", keys: "?" },
  { id: "back", label: "Back", section: "General", keys: "⌘[" },
  { id: "forward", label: "Forward", section: "General", keys: "⌘]" },
  { id: "sidebar", label: "Show or Hide the Sidebar", section: "General", keys: "⌘\\" },
  // The places ⌘1–⌘4 go to: Inbox, My Threads, All Spaces, Drafts.
  { id: "goInbox", label: "Inbox", section: "Sidebar", keys: "⌘1" },
  { id: "goMine", label: "My Threads", section: "Sidebar", keys: "⌘2" },
  { id: "goEverything", label: "All Spaces", section: "Sidebar", keys: "⌘3" },
  { id: "goDrafts", label: "Drafts", section: "Sidebar", keys: "⌘4" },
  { id: "newThread", label: "New Thread", section: "Create", keys: "⌘N" },
  { id: "compose", label: "Create a Thread from a Message", section: "Create", keys: "⇧⌘N" },
  { id: "next", label: "Next Thread", section: "Inbox", keys: "J" },
  { id: "previous", label: "Previous Thread", section: "Inbox", keys: "K" },
  { id: "done", label: "Mark Done", section: "Inbox", keys: "⌘E" },
  { id: "reply", label: "Reply", section: "Inbox", keys: "R" },
  { id: "closeThread", label: "Close the Thread", section: "Inbox", keys: "Esc" },
  { id: "resolve", label: "Resolve or Reopen the Thread", section: "Thread", keys: "⇧⌘E" },
  { id: "zoomIn", label: "Zoom In", section: "View", keys: "⌘=" },
  { id: "zoomOut", label: "Zoom Out", section: "View", keys: "⌘-" },
  { id: "zoomReset", label: "Actual Size", section: "View", keys: "⌘0" },
  { id: "viewAs", label: "View as Someone Else", section: "View", keys: "⌘U" },
] as const;
export type Hotkey = (typeof HOTKEYS)[number];
export type HotkeyId = Hotkey["id"];

// Only the keys you've changed, kept on this Mac; "" is a command you've left without any.
const [custom, setCustom] = createSignal<Partial<Record<HotkeyId, string>>>(saved("hotkeys", {}));
const byId = (id: HotkeyId): Hotkey => HOTKEYS.find((h) => h.id === id)!;
export const keysFor = (id: HotkeyId): string => custom()[id] ?? byId(id).keys;
export const changed = (id: HotkeyId): boolean => keysFor(id) !== byId(id).keys;
export const commandFor = (keys: string): HotkeyId | undefined =>
  keys === "" ? undefined : HOTKEYS.find((h) => keysFor(h.id) === keys)?.id;

// Keys go to one command: binding them takes them from any other.
export function bind(id: HotkeyId, keys: string): void {
  const next: Partial<Record<HotkeyId, string>> = { ...custom() };
  const taken = commandFor(keys);
  if (keys !== "" && taken && taken !== id) next[taken] = "";
  next[id] = keys;
  for (const h of HOTKEYS) if (next[h.id] === h.keys) delete next[h.id];
  setCustom(next);
  save("hotkeys", next);
}
export const reset = (id: HotkeyId): void => bind(id, byId(id).keys);
export function resetAll(): void {
  setCustom({});
  save("hotkeys", {});
}

const NAMED: Record<string, string> = {
  Escape: "Esc",
  Enter: "↵",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};
// A key press as keys are written above, or null for a modifier alone. Letters and digits come from the key's
// place, so ⌥ and ⇧ don't change them; a symbol carries its own ⇧ (⇧/ is ?).
export function keysOf(event: KeyboardEvent): string | null {
  if (["Meta", "Shift", "Alt", "Control", "CapsLock"].includes(event.key)) return null;
  const place = /^(?:Key|Digit)(.)$/.exec(event.code)?.[1];
  const key = NAMED[event.key] ?? place ?? event.key;
  const shifted = !NAMED[event.key] && !place;
  return (
    (event.ctrlKey ? "⌃" : "") +
    (event.altKey ? "⌥" : "") +
    (event.shiftKey && !shifted ? "⇧" : "") +
    (event.metaKey ? "⌘" : "") +
    key
  );
}

// Keys as key caps: each modifier, then the key.
export const caps = (keys: string): string[] => {
  const mods = /^[⌃⌥⇧⌘]*/.exec(keys)![0];
  return [...mods.split(""), keys.slice(mods.length)].filter(Boolean);
};
