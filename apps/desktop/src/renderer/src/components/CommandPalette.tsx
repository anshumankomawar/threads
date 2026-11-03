import { useEffect, useRef, useState } from "react";
import type { Label, Person, Thread } from "model";
import { CLOUDFLARE_AVAILABLE, SOURCE_LABELS, type DataSource } from "../api";
import { orgDetails } from "../org";

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

// Delta's command palette: search input, filter tabs, then sectioned results.
export function CommandPalette({
  threads,
  source,
  me,
  onSwitchSource,
  onViewAs,
  onOpenProfile,
  people,
  onOpenPerson,
  labels,
  onOpenLabel,
  sprints,
  onOpenSprint,
  onNewGroup,
  onNewThread,
  onOpenThread,
  onClose,
}: {
  threads: Thread[];
  source: DataSource;
  me: Person;
  onSwitchSource: (source: DataSource) => void;
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
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState(0);

  useEffect(() => inputRef.current?.focus(), []);

  const matches = (label: string): boolean =>
    label.toLowerCase().includes(query.trim().toLowerCase());
  const run = (action: () => void) => (): void => {
    action();
    onClose();
  };

  const groupsAndLabels: Section = {
    title: "Groups and Labels",
    items: [
      ...labels
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((label) => ({
          id: `label-${label.id}`,
          label: label.name,
          shortcut: label.groupId === null ? "Label" : "Group",
          run: run(() => onOpenLabel(label.id)),
        })),
      ...sprints.map((sprint) => ({
        id: `sprint-${sprint.id}`,
        label: sprint.label,
        shortcut: "Sprint",
        run: run(() => onOpenSprint(sprint.id)),
      })),
    ],
  };
  // Everyone else, by name; opening one shows their profile and the threads you're both in.
  const peopleSection: Section = {
    title: "People",
    items: people
      .filter((person) => person.id !== me.id)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((person) => ({
        id: `person-${person.id}`,
        label: person.name,
        shortcut: orgDetails(person) || undefined,
        keywords: [person.level, person.role].filter(Boolean).join(" "),
        run: run(() => onOpenPerson(person.id)),
      })),
  };
  const sections: Section[] = [
    {
      title: "Quick Actions",
      items:
        tab === "groups"
          ? [{ id: "new-group", label: "New Group", run: onNewGroup }]
          : [{ id: "new-thread", label: "New Thread", shortcut: "⌘ N", run: run(onNewThread) }],
    },
    // Who you're viewing as, and where the data comes from.
    ...(tab === "all"
      ? [
          {
            title: "Views",
            items: [
              { id: "profile", label: "Profile and organization", run: run(onOpenProfile) },
              { id: "new-group", label: "New Group", run: onNewGroup },
            ],
          },
          peopleSection,
          groupsAndLabels,
          {
            title: "Data",
            items: [
              {
                id: "view-as",
                label: `View As… (${me.name})`,
                shortcut: "⌘ U",
                run: onViewAs,
              },
              ...SOURCES.filter(
                (option) => option !== source && (option !== "cloudflare" || CLOUDFLARE_AVAILABLE),
              ).map((option) => ({
                id: `source-${option}`,
                label: `Use ${SOURCE_LABELS[option]} Data`,
                shortcut: SOURCE_HINTS[option],
                run: run(() => onSwitchSource(option)),
              })),
            ],
          },
        ]
      : []),
    ...(tab === "groups" ? [groupsAndLabels] : []),
    ...(tab === "people" ? [peopleSection] : []),
    ...(tab === "groups" || tab === "people"
      ? []
      : [
          {
            title: "Threads",
            items: threads.map((thread) => ({
              id: thread.id,
              label: thread.title,
              run: run(() => onOpenThread(thread.id)),
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
    .filter((section) => section.items.length > 0);

  const items = sections.flatMap((section) => section.items);
  const selectedIndex = Math.min(selected, Math.max(0, items.length - 1));

  const changeTab = (next: Tab): void => {
    setTab(next);
    setSelected(0);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      items[selectedIndex]?.run();
    } else if (event.metaKey && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      changeTab(TABS[Number(event.key) - 1].id);
    }
  };

  let index = 0;
  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Search"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search..."
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
          />
        </div>
        <div className="palette-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="palette-tab"
              aria-selected={tab === item.id}
              onClick={() => changeTab(item.id)}
            >
              <span>{item.label}</span>
              <span className="palette-tab-shortcut">{item.shortcut}</span>
            </button>
          ))}
        </div>
        <div className="palette-results">
          {sections.map((section) => (
            <div key={section.title} className="palette-section">
              <div className="palette-section-label">{section.title}</div>
              {section.items.map((item) => {
                const itemIndex = index++;
                return (
                  <div
                    key={item.id}
                    className="palette-row"
                    data-selected={itemIndex === selectedIndex}
                    role="option"
                    aria-selected={itemIndex === selectedIndex}
                    onMouseMove={() => setSelected(itemIndex)}
                    onClick={item.run}
                  >
                    <span className="palette-row-label">{item.label}</span>
                    {item.shortcut !== undefined && (
                      <span className="palette-row-shortcut">{item.shortcut}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
