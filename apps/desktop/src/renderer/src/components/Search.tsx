import * as i from "@hugeicons/core-free-icons";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Label, Subspace, Thread, User, View } from "models";
import {
  account,
  applyTheme,
  open,
  otherSources,
  setDialog,
  signOut,
  SOURCES,
  store,
  switchTo,
  theme,
} from "../session";
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
import { keysFor } from "../hotkeys";
import { moved, OptionButton, type Option } from "./Menus";
import { Modal } from "./Palettes";

// ⌘K: search everything, or narrow it to threads with filters typed into the search as in Slack or Discord. Typing a
// key (`from:`) suggests its values; picking one, or finishing one and typing a space, makes it a chip before the
// text, and Backspace at the start takes the last one back. With any chip, it finds the threads that pass them all
// and say the rest of what's typed.

const styles = stylex.create({
  // The chips sit in the input's row, before what's typed, and wrap if there are many.
  inputRow: { flexWrap: "wrap", gap: 4, height: "auto", minHeight: 37, padding: "6px 10px" },
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
});

const done = (run: () => unknown) => (): void => {
  setDialog(null);
  run();
};

const CATEGORIES = ["All", "Threads", "Spaces", "People"];

export function Search(): JSX.Element {
  const [tokens, setTokens] = createSignal<Token[]>([]);
  const [text, setText] = createSignal("");
  const [category, setCategory] = createSignal(0);
  const [at, setAt] = createSignal(0);
  let input!: HTMLInputElement;

  // The word being typed: a filter's key and the start of its value, the start of a key, or plain text.
  const typing = createMemo(() => {
    const { before, word } = lastWord(text());
    const keyed = /^(\w+):(.*)$/.exec(word);
    if (keyed && isKey(keyed[1]))
      return { before, word, key: keyed[1] as FilterKey, partial: keyed[2] };
    return { before, word, key: undefined, partial: "" };
  });
  // What's typed, less a filter being typed at its end.
  const free = (): string => (typing().key ? typing().before : text()).trim();

  const chooseToken = (token: Token): void => {
    setTokens([...tokens(), token]);
    setText(typing().before);
    input.focus();
  };

  // A filter's values, once its key is typed (`from:`).
  const suggestions = (): Option[] => {
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
    // Otherwise none: the menu is the results for what's typed. The placeholder says filters exist.
    return [];
  };

  const commands = (): Option[] => [
    {
      label: "New thread",
      hint: keysFor("newThread"),
      section: "Quick actions",
      run: () => setDialog({ kind: "newThread" }),
    },
    { label: "New label", section: "Quick actions", run: () => setDialog({ kind: "newLabel" }) },
    {
      label: "New subspace",
      section: "Quick actions",
      run: () => setDialog({ kind: "newSubspace" }),
    },
    { label: "Personal", section: "Views", run: done(() => open({ personal: null })) },
    { label: "Workspace", section: "Views", run: done(() => open({ view: null })) },
    {
      label: "Settings",
      hint: keysFor("settings"),
      section: "Views",
      run: done(() => open({ settings: null })),
    },
    {
      label: theme() === "dark" ? "Switch to light mode" : "Switch to dark mode",
      section: "Views",
      run: done(() => applyTheme(theme() === "dark" ? "light" : "dark")),
    },
    // Signed in, you're who you signed in as; only Sample is viewed as anyone.
    ...(account
      ? [
          {
            label: `Sign out (${account.email})`,
            section: "Account",
            run: done(() => void signOut()),
          },
        ]
      : []),
    ...(account
      ? []
      : [
          {
            label: "View as",
            hint: keysFor("viewAs"),
            section: "Data",
            run: () => setDialog({ kind: "viewAs" }),
          },
        ]),
    ...otherSources.map((s) => ({
      label: `Use ${SOURCES[s]} data`,
      section: "Data",
      run: () => switchTo({ source: s }),
    })),
  ];

  const threadRow = (t: Thread): Option => ({
    label: t.title,
    section: "Threads",
    run: done(() => open({ thread: t.id })),
  });

  // With filters, the threads that pass them all and say what's typed; without, everything that matches by name.
  const results = (): Option[] => {
    const query = free().toLowerCase();
    if (tokens().length > 0)
      return store
        .all(Thread)
        .filter((t) => tokens().every((token) => passes(t, token)) && says(t, query))
        .slice(0, 50)
        .map(threadRow);
    const c = category();
    const named = <T extends { name?: string; title?: string }>(r: T): boolean =>
      (r.name ?? r.title ?? "").toLowerCase().includes(query);
    return [
      ...(c === 0 ? commands().filter((o) => o.label.toLowerCase().includes(query)) : []),
      ...(c === 0 || c === 3 ? store.all(User).filter(named) : []).map((u) => ({
        label: u.name,
        section: "People",
        seed: u.id,
        run: done(() => open({ person: u.id })),
      })),
      ...(c === 0 || c === 2 ? store.all(Subspace).filter(named) : []).map((sub) => ({
        label: sub.name,
        section: "Subspaces",
        run: done(() => open({ subspace: sub.id })),
      })),
      ...(c === 0 || c === 2 ? store.all(View).filter(named) : []).map((v) => ({
        label: v.name,
        section: "Views",
        run: done(() => open({ view: v.id })),
      })),
      ...(c === 0 || c === 2 ? store.all(Label).filter(named) : []).map((l) => ({
        label: l.name,
        section: "Labels",
        run: done(() => open({ label: l.id })),
      })),
      ...(c === 0 || c === 1
        ? store
            .all(Thread)
            .filter((t) => (query ? says(t, query) : true))
            .map(threadRow)
        : []),
    ];
  };

  const rows = createMemo((): Option[] => {
    const offered = suggestions();
    // While a filter's value is being typed, only its values.
    return typing().key ? offered : [...offered, ...results()];
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

  const onKeyDown = (event: KeyboardEvent): void => {
    const next = moved(event.key, index(), rows().length);
    if (next !== undefined) setAt(next);
    else if (event.key === "Enter") rows()[index()]?.run();
    // Tab takes the highlighted value, as a shell completes.
    else if (event.key === "Tab" && typing().key) rows()[index()]?.run();
    // A finished `key:value` becomes a chip as you type the space after it.
    else if (event.key === " " && tokenOf(typing().word)) chooseToken(tokenOf(typing().word)!);
    else if (
      event.key === "Backspace" &&
      input.selectionStart === 0 &&
      input.selectionEnd === 0 &&
      tokens().length > 0
    )
      setTokens(tokens().slice(0, -1));
    else if (event.metaKey && CATEGORIES[Number(event.key) - 1]) setCategory(Number(event.key) - 1);
    else return;
    event.preventDefault();
  };

  return (
    <Modal>
      <div class={sx(palette.inputRow, styles.inputRow)} onClick={() => input.focus()}>
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
          ref={input}
          autofocus
          class={sx(base.bare, palette.input, styles.input)}
          placeholder={tokens().length > 0 ? "" : "Search, or filter with from: in: is: label:"}
          spellcheck={false}
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <Show when={tokens().length === 0}>
        <div class={sx(palette.filters)} role="tablist">
          <For each={CATEGORIES}>
            {(label, n) => (
              <button
                class={sx(base.bare, palette.filter, category() === n() && palette.filterChosen)}
                role="tab"
                aria-selected={category() === n() ? "true" : "false"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setCategory(n())}
              >
                {label}
                <span class={sx(palette.filterKey)}>⌘ {n() + 1}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={rows().length > 0}>
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
                    <OptionButton option={row} selected={n === index()} onHover={() => setAt(n)} />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Modal>
  );
}
