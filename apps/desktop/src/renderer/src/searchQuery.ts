import { Label, PRIORITIES, Subspace, Thread, User } from "models";
import { itemFor, me, store, unread } from "./session";
import { LABELS } from "./components/ThreadView";

// ⌘K's search filters, typed into the search itself as in Slack or Discord: `from:` `to:` `in:` `label:` `is:`
// `priority:` `has:`. A finished one becomes a chip; what's left is text to find in threads' titles and messages.

export type FilterKey = "from" | "to" | "in" | "label" | "is" | "priority" | "has";

// One filter, once it's chosen: its key, the value it tests (an id where it names a record), and how its chip reads.
export type Token = { key: FilterKey; value: string; text: string };

// A value a key can take: what it tests, how it reads, and how it's typed (`from:maya`).
type Choice = { value: string; text: string; typed: string; seed?: string };

const typedName = (name: string): string => name.toLowerCase().replaceAll(/\s+/g, "-");

const KEYS: Record<FilterKey, { hint: string; choices: () => Choice[] }> = {
  from: {
    hint: "someone who wrote in it",
    choices: () =>
      store
        .all(User)
        .map((u) => ({ value: u.id, text: u.name, typed: typedName(u.name), seed: u.id })),
  },
  to: {
    hint: "someone it's assigned to",
    choices: () =>
      store
        .all(User)
        .map((u) => ({ value: u.id, text: u.name, typed: typedName(u.name), seed: u.id })),
  },
  in: {
    hint: "a space it's in",
    choices: () =>
      store.all(Subspace).map((s) => ({ value: s.id, text: s.name, typed: typedName(s.name) })),
  },
  label: {
    hint: "a label it has",
    choices: () =>
      store.all(Label).map((l) => ({ value: l.id, text: l.name, typed: typedName(l.name) })),
  },
  is: {
    hint: "open, resolved, blocked, unread or mine",
    choices: () =>
      ["open", "resolved", "blocked", "unread", "mine"].map((v) => ({
        value: v,
        text: v,
        typed: v,
      })),
  },
  priority: {
    hint: "urgent, high, medium, low or none",
    choices: () =>
      [...PRIORITIES].reverse().map((p) => ({ value: p, text: LABELS[p].toLowerCase(), typed: p })),
  },
  has: {
    hint: "a due date",
    choices: () => [{ value: "due", text: "due date", typed: "due" }],
  },
};

export const isKey = (word: string): word is FilterKey => word in KEYS;

// The word being typed at the end of what's in the input: a key and the start of its value (`from:ma`), else the
// start of a key or plain text.
export function lastWord(text: string): { before: string; word: string } {
  const at = text.search(/\S+$/);
  return at === -1
    ? { before: text, word: "" }
    : { before: text.slice(0, at), word: text.slice(at) };
}

// The choices for `key` that start with (or contain) what's typed after its colon, best first.
export function choicesFor(key: FilterKey, partial: string): Choice[] {
  const q = partial.toLowerCase();
  const all = KEYS[key].choices();
  if (!q) return all;
  const starts = all.filter((c) => c.typed.startsWith(q) || c.text.toLowerCase().startsWith(q));
  const contains = all.filter(
    (c) => !starts.includes(c) && (c.typed.includes(q) || c.text.toLowerCase().includes(q)),
  );
  return [...starts, ...contains];
}

// A whole `key:value` word, if it names exactly one choice: typing a space after it makes it a chip.
export function tokenOf(word: string): Token | undefined {
  const match = /^(\w+):(\S+)$/.exec(word);
  if (!match || !isKey(match[1])) return undefined;
  const key = match[1];
  const value = match[2].toLowerCase();
  const exact = KEYS[key].choices().filter((c) => c.typed === value || c.value === value);
  return exact.length === 1 ? { key, value: exact[0].value, text: exact[0].text } : undefined;
}

// Whether a thread passes a filter.
export function passes(thread: Thread, token: Token): boolean {
  switch (token.key) {
    case "from":
      return (
        thread.ownerId === token.value ||
        thread.messages.filter((m) => m.authorId === token.value).length > 0
      );
    case "to":
      return thread.assigneeIds.includes(token.value);
    case "in":
      return thread.subspaceIds.includes(token.value);
    case "label":
      return thread.labelIds.includes(token.value);
    case "priority":
      return thread.priority === token.value;
    case "has":
      return thread.dueAt !== undefined;
    case "is": {
      if (token.value === "mine")
        return thread.ownerId === me().id || thread.assigneeIds.includes(me().id);
      if (token.value === "unread") {
        const item = itemFor(thread);
        return item !== undefined && !item.doneAt && unread(item);
      }
      return thread.state === token.value;
    }
  }
}

// A thread's words, lowercased, kept while its title, description and messages stay as they were (messages are only
// ever added or deleted, so their count says when), rather than joined again for every thread on every keystroke.
const haystacks = new WeakMap<Thread, { key: string; text: string }>();
function haystack(thread: Thread): string {
  const description = thread.description ?? "";
  const key = `${thread.title}\u0000${description}\u0000${thread.messages.length}`;
  const kept = haystacks.get(thread);
  if (kept?.key === key) return kept.text;
  const text = [thread.title, description, ...[...thread.messages].map((m) => m.body)]
    .join("\n")
    .toLowerCase();
  haystacks.set(thread, { key, text });
  return text;
}

// Whether a thread mentions all of `text`'s words, in its title or any message.
export function says(thread: Thread, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const found = haystack(thread);
  return words.every((w) => found.includes(w));
}
