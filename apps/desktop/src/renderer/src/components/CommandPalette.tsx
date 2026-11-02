import { useEffect, useRef, useState } from "react";
import type { Person, Thread, ThreadKind } from "model";
import { CLOUDFLARE_AVAILABLE, SOURCE_LABELS, type DataSource } from "../api";

type Tab = "all" | ThreadKind;

// Tabs filter to one kind of thread; Work is focus blocks.
const TABS: { id: Tab; label: string; shortcut: string }[] = [
  { id: "all", label: "All", shortcut: "⌘ 1" },
  { id: "response", label: "Threads", shortcut: "⌘ 2" },
  { id: "meeting", label: "Meetings", shortcut: "⌘ 3" },
  { id: "focus", label: "Work", shortcut: "⌘ 4" },
];

const NEW_ACTIONS: { kind: ThreadKind; label: string; shortcut?: string }[] = [
  { kind: "response", label: "New Thread", shortcut: "⌘ N" },
  { kind: "meeting", label: "New Meeting" },
  { kind: "focus", label: "New Focus Block" },
];

const SOURCES: DataSource[] = ["cloudflare", "local", "sample"];

const SOURCE_HINTS: Record<DataSource, string> = {
  cloudflare: "Shared",
  local: "Local Worker",
  sample: "Demo team",
};

const SECTION_TITLES: Record<ThreadKind, string> = {
  response: "Threads",
  meeting: "Meetings",
  focus: "Work",
};

// When a scheduled thread happens: "4:00 PM" today, "Mon 10:00 AM" otherwise.
function scheduleHint(thread: Thread): string | undefined {
  if (thread.schedule === null) return undefined;
  const start = new Date(thread.schedule.startMs);
  const time = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return start.toDateString() === new Date().toDateString()
    ? time
    : `${start.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

type Item = { id: string; label: string; shortcut?: string; run: () => void };
type Section = { title: string; items: Item[] };

// Delta's command palette: search input, filter tabs, then sectioned results.
export function CommandPalette({
  threads,
  source,
  me,
  onSwitchSource,
  onViewAs,
  onOpenProfile,
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
  onNewThread: (kind: ThreadKind) => void;
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

  const kinds: ThreadKind[] = tab === "all" ? ["response", "meeting", "focus"] : [tab];
  const sections: Section[] = [
    {
      title: "Quick Actions",
      items: NEW_ACTIONS.filter((action) => kinds.includes(action.kind)).map((action) => ({
        id: `new-${action.kind}`,
        label: action.label,
        shortcut: action.shortcut,
        run: run(() => onNewThread(action.kind)),
      })),
    },
    // Who you're viewing as, and where the data comes from.
    ...(tab === "all"
      ? [
          {
            title: "Views",
            items: [{ id: "profile", label: "Profile and organization", run: run(onOpenProfile) }],
          },
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
    ...kinds.map((kind) => ({
      title: SECTION_TITLES[kind],
      items: threads
        .filter((thread) => thread.kind === kind)
        .map((thread) => ({
          id: thread.id,
          label: thread.title,
          shortcut: kind === "response" ? undefined : scheduleHint(thread),
          run: run(() => onOpenThread(thread.id)),
        })),
    })),
  ]
    .map((section) => ({ ...section, items: section.items.filter((item) => matches(item.label)) }))
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
