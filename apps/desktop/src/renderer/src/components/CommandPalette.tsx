import type { Label, Person, Thread } from "model";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { CLOUDFLARE_AVAILABLE, SOURCE_LABELS, type DataSource } from "../api";
import { orgDetails } from "../org";
import type { Theme } from "../theme";

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
export function CommandPalette(props: {
  threads: Thread[];
  source: DataSource;
  me: Person;
  onSwitchSource: (source: DataSource) => void;
  theme: Theme;
  onToggleTheme: () => void;
  onViewAs: () => void;
  onOpenProfile: () => void;
  people: Person[];
  onOpenPerson: (id: string) => void;
  labels: Label[];
  onOpenLabel: (id: string) => void;
  // Groups' sprints, each named with its group.
  sprints: { id: string; label: string }[];
  onOpenSprint: (id: string) => void;
  onNewGroup: () => void;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
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

  const sections = createMemo((): { title: string; items: Row[] }[] => {
    const groupsAndLabels: Section = {
      title: "Groups and Labels",
      items: [
        ...props.labels
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((label) => ({
            id: `label-${label.id}`,
            label: label.name,
            shortcut: label.groupId === null ? "Label" : "Group",
            run: run(() => props.onOpenLabel(label.id)),
          })),
        ...props.sprints.map((sprint) => ({
          id: `sprint-${sprint.id}`,
          label: sprint.label,
          shortcut: "Sprint",
          run: run(() => props.onOpenSprint(sprint.id)),
        })),
      ],
    };
    // Everyone else, by name; opening one shows their profile and the threads you're both in.
    const peopleSection: Section = {
      title: "People",
      items: props.people
        .filter((person) => person.id !== props.me.id)
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((person) => ({
          id: `person-${person.id}`,
          label: person.name,
          shortcut: orgDetails(person) || undefined,
          keywords: [person.level, person.role].filter(Boolean).join(" "),
          run: run(() => props.onOpenPerson(person.id)),
        })),
    };
    const current = tab();
    let index = 0;
    return [
      {
        title: "Quick Actions",
        items:
          current === "groups"
            ? [{ id: "new-group", label: "New Group", run: props.onNewGroup }]
            : [
                {
                  id: "new-thread",
                  label: "New Thread",
                  shortcut: "⌘ N",
                  run: run(props.onNewThread),
                },
              ],
      },
      // Who you're viewing as, and where the data comes from.
      ...(current === "all"
        ? [
            {
              title: "Views",
              items: [
                { id: "profile", label: "Profile and organization", run: run(props.onOpenProfile) },
                { id: "new-group", label: "New Group", run: props.onNewGroup },
                {
                  id: "theme",
                  label: props.theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
                  keywords: "theme appearance light dark mode",
                  run: run(props.onToggleTheme),
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
                  label: `View As… (${props.me.name})`,
                  shortcut: "⌘ U",
                  run: props.onViewAs,
                },
                ...SOURCES.filter(
                  (option) =>
                    option !== props.source && (option !== "cloudflare" || CLOUDFLARE_AVAILABLE),
                ).map((option) => ({
                  id: `source-${option}`,
                  label: `Use ${SOURCE_LABELS[option]} Data`,
                  shortcut: SOURCE_HINTS[option],
                  run: run(() => props.onSwitchSource(option)),
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
              items: props.threads.map((thread) => ({
                id: thread.id,
                label: thread.title,
                run: run(() => props.onOpenThread(thread.id)),
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
    <div class="palette-overlay" onMouseDown={() => props.onClose()}>
      <div
        class="palette"
        role="dialog"
        aria-label="Search"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class="palette-input-row">
          <input
            ref={input}
            class="palette-input"
            placeholder="Search..."
            spellcheck="false"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setSelected(0);
            }}
          />
        </div>
        <div class="palette-tabs" role="tablist">
          <For each={TABS}>
            {(item) => (
              <button
                type="button"
                role="tab"
                class="palette-tab"
                aria-selected={tab() === item.id ? "true" : "false"}
                onClick={() => changeTab(item.id)}
              >
                <span>{item.label}</span>
                <span class="palette-tab-shortcut">{item.shortcut}</span>
              </button>
            )}
          </For>
        </div>
        <div class="palette-results">
          <For each={sections()}>
            {(section) => (
              <div class="palette-section">
                <div class="palette-section-label">{section.title}</div>
                <For each={section.items}>
                  {(item) => (
                    <div
                      class="palette-row"
                      data-selected={String(item.index === selectedIndex())}
                      role="option"
                      aria-selected={item.index === selectedIndex() ? "true" : "false"}
                      onMouseMove={() => setSelected(item.index)}
                      onClick={() => item.run()}
                    >
                      <span class="palette-row-label">{item.label}</span>
                      <Show when={item.shortcut !== undefined}>
                        <span class="palette-row-shortcut">{item.shortcut}</span>
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
