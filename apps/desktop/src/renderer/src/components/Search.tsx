import * as i from "@hugeicons/core-free-icons";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Thread } from "models";
import {
  commands,
  suggestions,
  threadCommand,
  type Command,
  type Kind,
  type Page,
} from "../commands";
import { lastActive, runFrom, setDialog, store } from "../session";
import {
  choicesFor,
  isKey,
  lastWord,
  passes,
  says,
  tokenOf,
  type FilterKey,
  type Token,
} from "../searchQuery";
import { paletteSectionMarker } from "../styles/markers.stylex";
import { base } from "../styles/base";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { moved, OptionButton, type Option } from "./Menus";
import { focusOnShow } from "./Palettes";

// ⌘K (or /): everything in the app, from one field (commands.ts lists it). Before you type: the open thread's actions
// and where to go. As you type: the best matches of every kind, each under its heading.
// A command with choices of its own (Move to Bucket, Set Priority) opens them in its place; Backspace or Escape goes
// back. Tabs (⌘1–⌘5) or a first character narrow it to one kind: `>` commands, `#` threads, `@` people, `/` places.
// Threads filter as in Slack or Discord: typing a key (`from:`) suggests its values, and a finished one becomes a chip.
// ↵ runs the row; ⌘↵ peeks at a thread or person instead of leaving where you are.

const styles = stylex.create({
  // The chips sit in the input's row, before what's typed, and wrap if there are many.
  // Chips and the input wrap here, on the palette's edge.
  inputRow: { flexWrap: "wrap", gap: 4, height: "auto", minHeight: 44, padding: "8px 14px" },
  chip: {
    display: "flex",
    gap: 4,
    alignItems: "center",
    height: 22,
    padding: "0 4px 0 7px",
    borderRadius: radii.control,
    color: colors.accent,
    fontSize: fontSizes.body,
    backgroundColor: colors.accentFill,
    cursor: "default",
  },
  // The page you're in: what it's for, before what you type.
  pageChip: { padding: "0 7px", color: colors.textSecondary, backgroundColor: colors.bgTertiary },
  chipKey: { opacity: 0.75 },
  chipRemove: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    borderRadius: radii.control,
    color: "inherit",
    opacity: { default: 0.6, ":hover": 1 },
    cursor: "pointer",
  },
  input: { minWidth: 120 },
  empty: { padding: "18px 14px", color: colors.textTertiary },
  // What the keys do, quietly, along the bottom.
  footer: {
    display: "flex",
    flexShrink: 0,
    gap: 14,
    alignItems: "center",
    height: 30,
    padding: "0 14px",
    color: colors.textTertiary,
    fontSize: fontSizes.label,
  },
  key: { marginRight: 5, color: colors.textSecondary },
});

const close = (): void => setDialog(null);

// The kinds each tab shows, and the character that picks it as you start typing.
const CATEGORIES: { label: string; kinds: Kind[]; prefix?: string }[] = [
  { label: "All", kinds: ["action", "place", "person", "thread"] },
  { label: "Commands", kinds: ["action"], prefix: ">" },
  { label: "Threads", kinds: ["thread"], prefix: "#" },
  { label: "People", kinds: ["person"], prefix: "@" },
  { label: "Places", kinds: ["place"], prefix: "/" },
];

// How well `text` matches a typed word, 0 for not at all: the whole of it, its start, a word's start, then anywhere in
// it. No scattered letters: what you type reads as part of what it finds.
function scoreOne(text: string, q: string): number {
  if (text === q) return 100;
  if (text.startsWith(q)) return 80;
  if (text.split(/[\s\-_/(]+/).some((w) => w.startsWith(q))) return 60;
  const at = text.indexOf(q);
  return at >= 0 ? 40 - Math.min(at, 20) / 2 : 0;
}
// A command's match: every word typed has to match its title or the other words it's found by.
function score(c: Command, query: string): number {
  const words = query.split(/\s+/).filter(Boolean);
  const title = c.title.toLowerCase();
  const also = (c.keywords ?? "").toLowerCase();
  let total = 0;
  for (const w of words) {
    const s = Math.max(scoreOne(title, w), scoreOne(also, w) * 0.6);
    if (s === 0) return 0;
    total += s;
  }
  return total / words.length;
}

// Most per kind while searching, so one kind can't bury the rest.
const LIMIT: Record<Kind, number> = { action: 8, place: 8, person: 6, thread: 20 };

export function Search(props: { command?: string }): JSX.Element {
  const [tokens, setTokens] = createSignal<Token[]>([]);
  const [text, setText] = createSignal("");
  const [tab, setTab] = createSignal(0);
  // Opened at a command (the reply's / menu): its page from the start.
  const [pages, setPages] = createSignal<Page[]>(
    untrack(() => {
      const asked = props.command && commands().find((c) => c.id === props.command);
      return asked && asked.page ? [asked.page()] : [];
    }),
  );
  const [at, setAt] = createSignal(0);
  let input!: HTMLInputElement;
  const page = (): Page | undefined => pages().at(-1);

  // A first `>`, `#`, `@` or `/` picks a kind, as its tab does (-1: none).
  const prefixed = (): number =>
    page() || tokens().length > 0
      ? -1
      : CATEGORIES.findIndex((c) => c.prefix !== undefined && text().startsWith(c.prefix));
  const category = (): number => (prefixed() > 0 ? prefixed() : tab());
  const query = (): string => (prefixed() > 0 ? text().slice(1) : text()).trim().toLowerCase();
  const chooseTab = (n: number): void => {
    setTab(n);
    if (prefixed() > 0) setText(text().slice(1));
  };

  // The word being typed: a filter's key and the start of its value, or plain text.
  const typing = createMemo(() => {
    const { before, word } = lastWord(text());
    const keyed = /^(\w+):(.*)$/.exec(word);
    if (!page() && keyed && isKey(keyed[1]))
      return { before, word, key: keyed[1] as FilterKey, partial: keyed[2] };
    return { before, word, key: undefined, partial: "" };
  });

  const chooseToken = (token: Token): void => {
    setTokens([...tokens(), token]);
    setText(typing().before);
    input.focus();
  };
  const enter = (next: Page): void => {
    setPages([...pages(), next]);
    setText("");
    input.focus();
  };
  const back = (): void => {
    setPages(pages().slice(0, -1));
    setText("");
  };

  const toOption = (c: Command): Option => ({
    label: c.title,
    icon: c.seed ? undefined : c.icon,
    seed: c.seed,
    hint: c.keys,
    section: c.section,
    more: c.page !== undefined,
    run: () => {
      if (c.page) return enter(c.page());
      // A palette it opens (New Bucket's form) takes ⌘K's place in the same window, and can come back to it.
      runFrom({ kind: "search" }, () => c.run?.());
    },
  });

  // The commands listed: a page's choices; the threads that pass the chips; what's suggested; or the best matches of
  // every kind the tab allows, each kind under its heading, the heading with the best match first.
  const found = createMemo((): Command[] => {
    const q = query();
    const current = page();
    if (current) {
      const all = current.commands();
      return q ? all.filter((c) => score(c, q) > 0).sort((a, b) => score(b, q) - score(a, q)) : all;
    }
    if (tokens().length > 0) {
      const free = (typing().key ? typing().before : text()).trim().toLowerCase();
      return store
        .all(Thread)
        .filter((t) => tokens().every((token) => passes(t, token)) && says(t, free))
        .sort((a, b) => lastActive(b) - lastActive(a))
        .slice(0, 50)
        .map((t) => threadCommand(t));
    }
    const kinds = CATEGORIES[category()].kinds;
    if (!q) {
      if (category() === 0) return suggestions();
      if (kinds.includes("thread"))
        return [...store.all(Thread)]
          .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || lastActive(b) - lastActive(a))
          .slice(0, 30)
          .map((t) => threadCommand(t));
      return commands().filter((c) => kinds.includes(c.kind));
    }
    // Threads by their title, then by what's said in them.
    const threads = kinds.includes("thread")
      ? store.all(Thread).flatMap((t) => {
          const c = threadCommand(t);
          const s = score(c, q) || (says(t, q) ? 10 : 0);
          return s ? [{ c, s }] : [];
        })
      : [];
    const scored = [
      ...commands()
        .filter((c) => kinds.includes(c.kind))
        .map((c) => ({ c, s: score(c, q) }))
        .filter((r) => r.s > 0),
      ...threads,
    ].sort((a, b) => b.s - a.s);
    const taken: Record<Kind, number> = { action: 0, place: 0, person: 0, thread: 0 };
    const kept = scored.filter((r) => taken[r.c.kind]++ < LIMIT[r.c.kind]);
    const order = [...new Set(kept.map((r) => r.c.section))];
    return order.flatMap((section) => kept.filter((r) => r.c.section === section).map((r) => r.c));
  });

  // The rows: a filter's values while its key is typed (`from:`), otherwise the commands found.
  const rows = createMemo((): Option[] => {
    const { key, partial } = typing();
    if (key)
      return choicesFor(key, partial)
        .slice(0, 8)
        .map((c) => ({
          label: c.text,
          seed: c.seed,
          icon: c.seed ? undefined : i.FilterIcon,
          hint: `${key}:${c.typed}`,
          section: `${key[0].toUpperCase()}${key.slice(1)}`,
          run: () => chooseToken({ key, value: c.value, text: c.text }),
        }));
    return found().map(toOption);
  });
  createEffect(rows, () => {
    setAt(0);
  });
  const index = (): number => Math.min(at(), rows().length - 1);
  const sections = createMemo(() =>
    rows().reduce<{ title?: string; rows: { row: Option; at: number }[] }[]>((out, row, n) => {
      if (out.length === 0 || out.at(-1)!.title !== row.section)
        out.push({ title: row.section, rows: [] });
      out.at(-1)!.rows.push({ row, at: n });
      return out;
    }, []),
  );
  // The highlighted command, if it's one (not a filter's value).
  const highlighted = (): Command | undefined => (typing().key ? undefined : found()[index()]);

  const onKeyDown = (event: KeyboardEvent): void => {
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const next = moved(event.key, index(), rows().length);
    if (next !== undefined) setAt(next);
    // ⌘↵ peeks at a thread or person instead of opening it.
    else if (event.key === "Enter" && event.metaKey) {
      const c = highlighted();
      if (!c?.peek) return;
      close();
      c.peek();
    } else if (event.key === "Enter") rows()[index()]?.run();
    // Tab takes the highlighted value, as a shell completes.
    else if (event.key === "Tab" && typing().key) rows()[index()]?.run();
    // A finished `key:value` becomes a chip as you type the space after it.
    else if (event.key === " " && !page() && tokenOf(typing().word))
      chooseToken(tokenOf(typing().word)!);
    // Backspace at the start takes back the last chip, or leaves the page you're in.
    else if (event.key === "Backspace" && atStart && tokens().length > 0)
      setTokens(tokens().slice(0, -1));
    else if (event.key === "Backspace" && atStart && text() === "" && page()) back();
    // Escape leaves a page before it closes ⌘K.
    else if (event.key === "Escape" && page()) back();
    else if (event.metaKey && !page() && CATEGORIES[Number(event.key) - 1])
      chooseTab(Number(event.key) - 1);
    else return;
    event.preventDefault();
  };

  return (
    <>
      <div class={sx(palette.inputRow, styles.inputRow)} onClick={() => input.focus()}>
        <Show when={page()}>
          {(current) => <span class={sx(styles.chip, styles.pageChip)}>{current().title}</span>}
        </Show>
        <For each={tokens()}>
          {(token) => (
            <span class={sx(styles.chip)}>
              <span class={sx(styles.chipKey)}>{token.key}:</span>
              <span>{token.text}</span>
              <button
                class={sx(base.bare, styles.chipRemove)}
                aria-label={`Remove ${token.key}:${token.text}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setTokens(tokens().filter((t) => t !== token))}
              >
                ×
              </button>
            </span>
          )}
        </For>
        <input
          ref={(el) => {
            input = el;
            focusOnShow(el);
          }}
          autofocus
          class={sx(base.bare, palette.input, styles.input)}
          placeholder={page()?.placeholder ?? (tokens().length > 0 ? "" : "Search")}
          spellcheck={false}
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <Show when={!page() && tokens().length === 0}>
        <div class={sx(palette.filters)} role="tablist">
          <For each={CATEGORIES}>
            {(c, n) => (
              <button
                class={sx(base.bare, palette.filter, category() === n() && palette.filterChosen)}
                role="tab"
                aria-selected={category() === n() ? "true" : "false"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseTab(n())}
              >
                {c.label}
                <span class={sx(palette.filterKey)}>⌘ {n() + 1}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={rows().length > 0} fallback={<div class={sx(styles.empty)}>Nothing matches</div>}>
        <div class={sx(palette.results)} role="listbox">
          <For each={sections()}>
            {(section) => (
              <div {...stylex.attrs(palette.section, palette.divided, paletteSectionMarker)}>
                <Show when={section.title}>
                  <div class={sx(base.ellipsis, palette.sectionLabel, palette.labelText)}>
                    {section.title}
                  </div>
                </Show>
                <For each={section.rows}>
                  {({ row, at: n }) => (
                    <OptionButton
                      option={row}
                      selected={n === index()}
                      onHover={() => setAt(n)}
                      inset
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class={sx(styles.footer)}>
        <span>
          <span class={sx(styles.key)}>↵</span>
          {highlighted()?.page ? "Open" : "Run"}
        </span>
        <Show when={highlighted()?.peek}>
          <span>
            <span class={sx(styles.key)}>⌘↵</span>Peek
          </span>
        </Show>
        <Show when={page()}>
          <span>
            <span class={sx(styles.key)}>esc</span>Back
          </span>
        </Show>
        <Show when={!page() && tokens().length === 0 && !text()}>
          <span>
            <span class={sx(styles.key)}>&gt; # @ /</span>Commands, threads, people, places
          </span>
        </Show>
      </div>
    </>
  );
}
