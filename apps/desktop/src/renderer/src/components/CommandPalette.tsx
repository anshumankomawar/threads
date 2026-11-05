import { createSignal, For } from "solid-js";
import type { JSX } from "@solidjs/web";
import { CLOUDFLARE_AVAILABLE, SOURCE_LABELS, type DataSource } from "../api";
import { useApp } from "../app/state";
import { orgDetails } from "../org";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { createList, matching, others, Palette } from "./Palette";

type Tab = "all" | "threads" | "groups" | "people";
const TABS: [Tab, string][] = [
  ["all", "All"],
  ["threads", "Threads"],
  ["groups", "Groups and labels"],
  ["people", "People"],
];
const HINTS: Record<DataSource, string> = {
  cloudflare: "Shared",
  local: "Local Worker",
  sample: "Demo team",
};

// `keywords` match as well as the label, such as someone's level and role.
type Item = {
  section: string;
  label: string;
  run: () => void;
  shortcut?: string;
  keywords?: string;
};

// Delta's command palette: search input, filter tabs, then sectioned results.
export function CommandPalette(props: { onClose: () => void }): JSX.Element {
  const app = useApp();
  const [query, setQuery] = createSignal("");
  const [tab, setTab] = createSignal<Tab>("all");
  const item = (section: string, label: string, run: () => void, shortcut?: string): Item => ({
    section,
    label,
    shortcut,
    run: () => {
      run();
      props.onClose();
    },
  });
  const byName = <T extends { name: string }>(all: T[]): T[] =>
    all.toSorted((a, b) => a.name.localeCompare(b.name));
  // Swaps this palette for the new group one.
  const newGroup = (section: string): Item =>
    item(section, "New Group", () => app.ui.setNewGroupOpen(true));
  const items = (): Item[] => {
    const { nav, ui } = app;
    const labels = byName(app.data.labels()).map((l) =>
      item(
        "Groups and Labels",
        l.name,
        () => nav.openLabel(l.id),
        l.groupId === null ? "Label" : "Group",
      ),
    );
    const people = byName(others(app.data.people(), app.me())).map((p) => ({
      ...item("People", p.name, () => nav.openPerson(p.id), orgDetails(p) || undefined),
      keywords: [p.level, p.role].filter(Boolean).join(" "),
    }));
    const threads = app.data
      .threads()
      .map((t) => item("Threads", t.title, () => nav.openThread(t.id)));
    const theme = ui.theme() === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode";
    const sources = (["cloudflare", "local", "sample"] as const).filter(
      (option) => option !== app.source() && (option !== "cloudflare" || CLOUDFLARE_AVAILABLE),
    );
    const all = [
      item("Views", "Profile", nav.openProfile),
      newGroup("Views"),
      { ...item("Views", theme, ui.toggleTheme), keywords: "theme appearance light dark mode" },
      ...people,
      ...labels,
      { ...item("Data", `View As… (${app.me().name})`, () => {}, "⌘ U"), run: ui.openViewAs },
      ...sources.map((source) =>
        item(
          "Data",
          `Use ${SOURCE_LABELS[source]} Data`,
          () => app.switchSource(source),
          HINTS[source],
        ),
      ),
      ...threads,
    ];
    const quick =
      tab() === "groups"
        ? newGroup("Quick Actions")
        : item("Quick Actions", "New Thread", ui.openNewThread, "⌘ N");
    const shown = { all, threads, groups: labels, people }[tab()];
    const matches = (i: Item): boolean =>
      [i.label, i.keywords ?? ""].some((s) => matching(s, query()));
    return [quick, ...shown].filter(matches);
  };
  const list = createList(items);
  const changeTab = (next: Tab): void => {
    setTab(next);
    list.set(0);
  };
  return (
    <Palette
      label="Search"
      placeholder="Search..."
      value={query()}
      onInput={setQuery}
      onClose={props.onClose}
      list={list}
      group={(i) => i.section}
      row={(i) => ({ label: i.label, shortcut: i.shortcut })}
      onPick={(i) => i.run()}
      onKey={(event) => {
        const next = TABS[Number(event.key) - 1];
        return event.metaKey && next !== undefined && (changeTab(next[0]), true);
      }}
      tabs={
        <div class={sx(palette.tabs, palette.tabsLine)} role="tablist">
          <For each={TABS}>
            {([id, label], at) => (
              <button
                type="button"
                role="tab"
                class={sx(palette.tab, palette.tabLook, tab() === id && palette.tabSelected)}
                aria-selected={tab() === id ? "true" : "false"}
                onClick={() => changeTab(id)}
              >
                <span>{label}</span>
                <span class={sx(palette.tabShortcut)}>⌘ {at() + 1}</span>
              </button>
            )}
          </For>
        </div>
      }
    />
  );
}
