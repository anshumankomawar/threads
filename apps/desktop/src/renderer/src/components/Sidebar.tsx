import {
  CalendarDays,
  ChevronDown,
  Ellipsis,
  MessageSquare,
  Plus,
  Search,
  SquarePen,
  Target,
} from "lucide-react";
import { useResizablePanel } from "./useResizablePanel";
import { useEffect, useRef, useState } from "react";
import type { Day, InboxItem } from "../inbox";
import { KIND_LABELS, type ThreadKind } from "../model";

// Marks the element with data-overflowing when its text is clipped, which turns on the fade mask.
function useOverflowFade<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      element.toggleAttribute("data-overflowing", element.scrollWidth > element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return ref;
}

// Delta's icons are 14px with roughly 1px strokes (1.7 on Lucide's 24px grid).
const ICON_PROPS = { size: 14, strokeWidth: 1.7, "aria-hidden": true } as const;

// Delta's sidebar icon: a 12px rounded square with the left panel filled in.
function SidebarIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect
        x="0.4"
        y="0.4"
        width="11.2"
        height="11.2"
        rx="2"
        stroke="currentColor"
        strokeWidth="0.8"
      />
      <path
        d="M2.4 0.4H5.25V11.6H2.4A2 2 0 0 1 0.4 9.6V2.4A2 2 0 0 1 2.4 0.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SidebarToggle({ onToggle }: { onToggle: () => void }): React.JSX.Element {
  return (
    <button type="button" className="topbar-button" aria-label="Toggle sidebar" onClick={onToggle}>
      <SidebarIcon />
    </button>
  );
}

// The same icon mirrored, for the details panel on the right.
function DetailsIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect
        x="0.4"
        y="0.4"
        width="11.2"
        height="11.2"
        rx="2"
        stroke="currentColor"
        strokeWidth="0.8"
      />
      <path
        d="M9.6 0.4H6.75V11.6H9.6A2 2 0 0 0 11.6 9.6V2.4A2 2 0 0 0 9.6 0.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function DetailsToggle({ onToggle }: { onToggle: () => void }): React.JSX.Element {
  return (
    <button type="button" className="topbar-button" aria-label="Toggle details" onClick={onToggle}>
      <DetailsIcon />
    </button>
  );
}

export function SearchButton({ onSearch }: { onSearch: () => void }): React.JSX.Element {
  return (
    <button type="button" className="topbar-button" aria-label="Search" onClick={onSearch}>
      <Search {...ICON_PROPS} />
    </button>
  );
}

function activateOnKey(event: React.KeyboardEvent, activate: () => void): void {
  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  activate();
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatHour(hour: number): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric" });
}

const KIND_ICONS: Record<ThreadKind, typeof MessageSquare> = {
  response: MessageSquare,
  meeting: CalendarDays,
  focus: Target,
};

// Every row shows its kind in the left indent: a speech bubble for responses, a calendar for meetings,
// a target for focus blocks.
function KindMarker({ kind }: { kind: ThreadKind }): React.JSX.Element {
  const Icon = KIND_ICONS[kind];
  return (
    <span className="kind-marker" aria-label={KIND_LABELS[kind]}>
      <Icon size={12} strokeWidth={1.7} aria-hidden />
    </span>
  );
}

function ThreadRow({
  item,
  active,
  unread,
  label,
  past = false,
  onOpen,
}: {
  item: InboxItem;
  active: boolean;
  unread: boolean;
  label: string | null;
  past?: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const titleRef = useOverflowFade<HTMLSpanElement>();
  const { thread } = item;

  return (
    <li className="thread-item">
      <div
        className="sidebar-row"
        aria-label={thread.title}
        data-active={active}
        data-past={past}
        title={item.reason}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => activateOnKey(event, onOpen)}
      >
        <KindMarker kind={thread.kind} />
        <span ref={titleRef} className="sidebar-row-label">
          {thread.title}
        </span>
        {unread && <span className="unread-dot" aria-label="Unread" />}
        {label !== null && (
          <span className="sidebar-row-meta" data-overdue={item.overdue}>
            {label}
          </span>
        )}
      </div>
    </li>
  );
}

// Your day: hour headings with today's scheduled threads under them and a line at the current time.
// Unscheduled and Later are hidden for now.
function DayView({
  day,
  nowMs,
  activeThreadId,
  unreadIds,
  onOpenThread,
}: {
  day: Day;
  nowMs: number;
  activeThreadId: string | null;
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const nowHour = new Date(nowMs).getHours();
  const row = (item: InboxItem, label: string | null, past = false): React.JSX.Element => (
    <ThreadRow
      key={item.thread.id}
      item={item}
      active={item.thread.id === activeThreadId}
      unread={unreadIds.has(item.thread.id)}
      label={label}
      past={past}
      onOpen={() => onOpenThread(item.thread.id)}
    />
  );
  const nowLine = (
    <li key="now" className="timeline-now" aria-label={`Now, ${formatClock(nowMs)}`}>
      <span className="timeline-now-time">{formatClock(nowMs)}</span>
    </li>
  );

  const hours = Array.from(
    { length: day.endHour - day.startHour + 1 },
    (_, i) => day.startHour + i,
  );
  const timeline: React.JSX.Element[] = [];
  if (nowHour < day.startHour) timeline.push(nowLine);
  for (const hour of hours) {
    timeline.push(
      <li key={`hour-${hour}`} className="timeline-hour" data-past={hour < nowHour}>
        <span>{formatHour(hour)}</span>
      </li>,
    );
    const items = day.timeline.filter(
      (item) => new Date(item.thread.schedule?.startMs ?? 0).getHours() === hour,
    );
    let nowShown = hour !== nowHour;
    for (const item of items) {
      const schedule = item.thread.schedule;
      if (schedule === null) continue;
      if (!nowShown && schedule.startMs > nowMs) {
        timeline.push(nowLine);
        nowShown = true;
      }
      timeline.push(row(item, formatClock(schedule.startMs), schedule.endMs <= nowMs));
    }
    if (!nowShown) timeline.push(nowLine);
  }
  if (nowHour > day.endHour) timeline.push(nowLine);

  return (
    <>
      <ul className="thread-list timeline" aria-label="Today">
        {timeline}
      </ul>
    </>
  );
}

// The inbox section: today's date in the header, the day view beneath.
function InboxSection({
  day,
  nowMs,
  activeThreadId,
  unreadIds,
  actions,
  onOpenThread,
}: {
  day: Day;
  nowMs: number;
  activeThreadId: string | null;
  unreadIds: Set<string>;
  actions: React.ReactNode;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = (): void => setCollapsed((value) => !value);
  const date = new Date(nowMs).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <section className="sidebar-section">
      <div
        className="sidebar-section-label"
        aria-expanded={!collapsed}
        data-collapsed={collapsed}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => activateOnKey(event, toggle)}
      >
        <span>Inbox</span>
        <span className="section-date">{date}</span>
        <span className="section-chevron">
          <ChevronDown {...ICON_PROPS} />
        </span>
        <span className="section-actions">{actions}</span>
      </div>
      {!collapsed && (
        <DayView
          day={day}
          nowMs={nowMs}
          activeThreadId={activeThreadId}
          unreadIds={unreadIds}
          onOpenThread={onOpenThread}
        />
      )}
    </section>
  );
}

export function Sidebar({
  day,
  nowMs,
  unreadIds,
  activeThreadId,
  onNewThread,
  onOpenThread,
  onToggle,
  onSearch,
}: {
  day: Day;
  nowMs: number;
  unreadIds: Set<string>;
  activeThreadId: string | null;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onToggle: () => void;
  onSearch: () => void;
}): React.JSX.Element {
  const { panelRef, width, handle } = useResizablePanel({
    storageKey: "sidebar-width",
    defaultWidth: 268,
    minWidth: 210,
    maxWidth: 400,
    edge: "right",
  });

  return (
    <aside ref={panelRef} className="sidebar" style={{ width }}>
      <div className="topbar sidebar-topbar">
        <SidebarToggle onToggle={onToggle} />
        <SearchButton onSearch={onSearch} />
        <span className="topbar-end">
          <button
            type="button"
            className="topbar-button"
            aria-label="New thread"
            onClick={onNewThread}
          >
            <SquarePen {...ICON_PROPS} />
          </button>
        </span>
      </div>
      <div className="sidebar-content">
        <InboxSection
          day={day}
          nowMs={nowMs}
          activeThreadId={activeThreadId}
          unreadIds={unreadIds}
          actions={
            <>
              <button
                type="button"
                className="icon-button"
                aria-label="Thread options"
                onClick={(event) => event.stopPropagation()}
              >
                <Ellipsis {...ICON_PROPS} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="New thread"
                onClick={(event) => {
                  event.stopPropagation();
                  onNewThread();
                }}
              >
                <Plus {...ICON_PROPS} />
              </button>
            </>
          }
          onOpenThread={onOpenThread}
        />
      </div>
      {handle}
    </aside>
  );
}
