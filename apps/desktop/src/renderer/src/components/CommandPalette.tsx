import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { CLOUDFLARE_AVAILABLE, SOURCE_LABELS, type DataSource } from "../api";
import { useApp } from "../app/state";
import { orgDetails } from "../org";
import { paletteSectionMarker } from "../styles/markers.stylex";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { colors } from "../styles/tokens.stylex";

type Tab = "all" | "threads" | "groups" | "people";

// Tabs narrow the results to threads, to groups and labels, or to people.
const TABS: { id: Tab; label: string; shortcut: string }[] = [
  { id: "all", label: "All", shortcut: "⌘ 1" },
  { id: "threads", label: "Threads", shortcut: "⌘ 2" },
  { id: "groups", label: "Groups and labels", shortcut: "⌘ 3" },
  { id: "people", label: "People", shortcut: "⌘ 4" },
];

const SOURCES: DataSource[] = ["cloudflare", "local", "sample"];

const SOURCE_HINTS: Record<DataSource, string> = {
  cloudflare: "Shared",
  local: "Local Worker",
  sample: "Demo team",
};

// `keywords` are matched as well as the label, such as someone's level and role.
type Item = { id: string; label: string; shortcut?: string; keywords?: string; run: () => void };
type Section = { title: string; items: Item[] };
// An item with its place in the flattened results, for keyboard selection.
type Row = Item & { index: number };

// Delta's command palette: search input, filter tabs, then sectioned results.
export function CommandPalette(props: { onClose: () => void }): JSX.Element {
  const app = useApp();
  let input!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [tab, setTab] = createSignal<Tab>("all");
  const [selected, setSelected] = createSignal(0);

  onSettled(() => input.focus());

  const matches = (label: string): boolean =>
    label.toLowerCase().includes(query().trim().toLowerCase());
  const run = (action: () => void) => (): void => {
    action();
    props.onClose();
  };
  // Swaps this palette for the new group one.
  const newGroup = (): void => {
    props.onClose();
    app.ui.setNewGroupOpen(true);
  };
  // Groups' sprints, each named with its group.
  const sprints = (): { id: string; label: string }[] =>
    app.data.groups().flatMap((group) =>
      app.groups.sprintsOf(group.id).map((sprint) => ({
        id: sprint.id,
        label: `${group.name} › ${sprint.name}`,
      })),
    );

  const sections = createMemo((): { title: string; items: Row[] }[] => {
    const groupsAndLabels: Section = {
      title: "Groups and Labels",
      items: [
        ...app.data
          .labels()
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((label) => ({
            id: `label-${label.id}`,
            label: label.name,
            shortcut: label.groupId === null ? "Label" : "Group",
            run: run(() => app.nav.openLabel(label.id)),
          })),
        ...sprints().map((sprint) => ({
          id: `sprint-${sprint.id}`,
          label: sprint.label,
          shortcut: "Sprint",
          run: run(() => app.nav.openSprint(sprint.id)),
        })),
      ],
    };
    // Everyone else, by name; opening one shows their profile and the threads you're both in.
    const peopleSection: Section = {
      title: "People",
      items: app.data
        .people()
        .filter((person) => person.id !== app.me().id)
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((person) => ({
          id: `person-${person.id}`,
          label: person.name,
          shortcut: orgDetails(person) || undefined,
          keywords: [person.level, person.role].filter(Boolean).join(" "),
          run: run(() => app.nav.openPerson(person.id)),
        })),
    };
    const current = tab();
    let index = 0;
    return [
      {
        title: "Quick Actions",
        items:
          current === "groups"
            ? [{ id: "new-group", label: "New Group", run: newGroup }]
            : [
                {
                  id: "new-thread",
                  label: "New Thread",
                  shortcut: "⌘ N",
                  run: run(() => app.ui.openNewThread()),
                },
              ],
      },
      // Who you're viewing as, and where the data comes from.
      ...(current === "all"
        ? [
            {
              title: "Views",
              items: [
                { id: "profile", label: "Profile and organization", run: run(app.nav.openProfile) },
                { id: "new-group", label: "New Group", run: newGroup },
                {
                  id: "theme",
                  label: app.ui.theme() === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
                  keywords: "theme appearance light dark mode",
                  run: run(app.ui.toggleTheme),
                },
              ],
            },
            peopleSection,
            groupsAndLabels,
            {
              title: "Data",
              items: [
                {
                  id: "view-as",
                  label: `View As… (${app.me().name})`,
                  shortcut: "⌘ U",
                  run: app.ui.openViewAs,
                },
                ...SOURCES.filter(
                  (option) =>
                    option !== app.source() && (option !== "cloudflare" || CLOUDFLARE_AVAILABLE),
                ).map((option) => ({
                  id: `source-${option}`,
                  label: `Use ${SOURCE_LABELS[option]} Data`,
                  shortcut: SOURCE_HINTS[option],
                  run: run(() => app.switchSource(option)),
                })),
              ],
            },
          ]
        : []),
      ...(current === "groups" ? [groupsAndLabels] : []),
      ...(current === "people" ? [peopleSection] : []),
      ...(current === "groups" || current === "people"
        ? []
        : [
            {
              title: "Threads",
              items: app.data.threads().map((thread) => ({
                id: thread.id,
                label: thread.title,
                run: run(() => app.nav.openThread(thread.id)),
              })),
            },
          ]),
    ]
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => matches(item.label) || (item.keywords !== undefined && matches(item.keywords)),
        ),
      }))
      .filter((section) => section.items.length > 0)
      .map((section) => ({
        ...section,
        items: section.items.map((item) => ({ ...item, index: index++ })),
      }));
  });

  const items = createMemo(() => sections().flatMap((section) => section.items));
  const selectedIndex = (): number => Math.min(selected(), Math.max(0, items().length - 1));

  const changeTab = (next: Tab): void => {
    setTab(next);
    setSelected(0);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = items().length;
      if (count === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex() + step + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      items()[selectedIndex()]?.run();
    } else if (event.metaKey && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      changeTab(TABS[Number(event.key) - 1].id);
    }
  };

  return (
    <div class={sx(palette.overlay)} onMouseDown={() => props.onClose()}>
      <div
        class={sx(palette.panel)}
        role="dialog"
        aria-label="Search"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class={sx(palette.inputRow)}>
          <input
            ref={input}
            class={sx(palette.input)}
            placeholder="Search..."
            spellcheck="false"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setSelected(0);
            }}
          />
        </div>
        <div class={sx(styles.tabs)} role="tablist">
          <For each={TABS}>
            {(item) => (
              <button
                type="button"
                role="tab"
                class={sx(styles.tab, tab() === item.id && styles.tabSelected)}
                aria-selected={tab() === item.id ? "true" : "false"}
                onClick={() => changeTab(item.id)}
              >
                <span>{item.label}</span>
                <span class={sx(styles.tabShortcut)}>{item.shortcut}</span>
              </button>
            )}
          </For>
        </div>
        <div class={sx(palette.results)}>
          <For each={sections()}>
            {(section) => (
              <div {...stylex.attrs(palette.section, paletteSectionMarker)}>
                <div class={sx(palette.sectionLabel)}>{section.title}</div>
                <For each={section.items}>
                  {(item) => (
                    <div
                      class={sx(palette.row, item.index === selectedIndex() && palette.rowSelected)}
                      role="option"
                      aria-selected={item.index === selectedIndex() ? "true" : "false"}
                      onMouseMove={() => setSelected(item.index)}
                      onClick={() => item.run()}
                    >
                      <span class={sx(palette.rowLabel)}>{item.label}</span>
                      <Show when={item.shortcut !== undefined}>
                        <span class={sx(palette.rowShortcut)}>{item.shortcut}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// The filter tabs under the search field.
const styles = stylex.create({
  // .palette-tabs
  tabs: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "4px",
    height: "35px",
    padding: "0 8px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.panelDivider,
  },
  // .palette-tab
  tab: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    height: "20px",
    padding: "0 4px",
    borderStyle: "none",
    borderRadius: "3px",
    color: colors.textSecondary,
    font: "inherit",
    fontSize: "10.5px",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  // .palette-tab[aria-selected="true"]
  tabSelected: {
    color: colors.accent,
    backgroundColor: colors.accentFill,
  },
  // .palette-tab-shortcut
  tabShortcut: {
    paddingRight: "2px",
    opacity: 0.8,
  },
});
