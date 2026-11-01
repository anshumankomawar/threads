import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  MessageSquare,
  Plus,
  Search,
  SquarePen,
  Target,
} from "lucide-react";
import { useResizablePanel } from "./useResizablePanel";
import { useEffect, useRef, useState } from "react";
import type { Day, InboxItem, TimelineItem } from "../inbox";
import { KIND_LABELS, type ThreadKind } from "model";
import { formatRange } from "../format";

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

// A day: hour headings with that day's scheduled threads under them, and on today a line at the current time.
// The arrows step a day back or forward; the date goes back to today.
function DayView({
  day,
  nowMs,
  activeThreadId,
  unreadIds,
  onOpenThread,
  onShiftDay,
}: {
  day: Day;
  nowMs: number;
  activeThreadId: string | null;
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
  onShiftDay: (days: number | null) => void;
}): React.JSX.Element {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const isToday = day.dayMs === today.getTime();
  // Before today every hour has passed; after it, none has.
  const nowHour = isToday ? new Date(nowMs).getHours() : day.dayMs < today.getTime() ? 24 : -1;

  // The whole day scrolls in a fixed height; opening a day brings the current hour (or 9 AM on other days) to the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusHour = isToday ? Math.max(0, new Date(nowMs).getHours() - 1) : 9;
  useEffect(() => {
    const scroller = scrollRef.current;
    // The hour itself, or the nearest one before it if it's inside a block (and so not shown).
    const hour = [...(scroller?.querySelectorAll<HTMLElement>("[data-hour]") ?? [])]
      .filter((element) => Number(element.dataset.hour) <= focusHour)
      .at(-1);
    if (scroller && hour) scroller.scrollTop = hour.offsetTop - scroller.offsetTop;
  }, [day.dayMs, focusHour]);
  // A block's row shows its time, so hour marks inside a block are left out: a 10–12 block reads 10 AM, the block,
  // then 12 PM.
  const hourStart = (hour: number): number => {
    const date = new Date(day.dayMs);
    date.setHours(hour, 0, 0, 0);
    return date.getTime();
  };
  const blocks = day.timeline.map((item) => item.block);
  const inside = (ms: number): boolean =>
    blocks.some((block) => block.startMs < ms && block.endMs > ms);
  const row = (item: TimelineItem, past = false): React.JSX.Element => {
    const { block } = item;
    return (
      <ThreadRow
        key={`${item.thread.id}:${block.startMs}`}
        item={item}
        active={item.thread.id === activeThreadId}
        unread={unreadIds.has(item.thread.id)}
        label={formatRange(block.startMs, block.endMs)}
        past={past}
        onOpen={() => onOpenThread(item.thread.id)}
      />
    );
  };
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
  if (isToday && nowHour < day.startHour) timeline.push(nowLine);
  for (const hour of hours) {
    if (!inside(hourStart(hour)))
      timeline.push(
        <li
          key={`hour-${hour}`}
          className="timeline-hour"
          data-past={hour < nowHour}
          data-hour={hour}
        >
          <span>{formatHour(hour)}</span>
        </li>,
      );
    const items = day.timeline.filter((item) => new Date(item.block.startMs).getHours() === hour);
    let nowShown = !isToday || hour !== nowHour;
    for (const item of items) {
      const { block } = item;
      if (!nowShown && block.startMs > nowMs) {
        timeline.push(nowLine);
        nowShown = true;
      }
      timeline.push(row(item, block.endMs <= nowMs));
    }
    if (!nowShown) timeline.push(nowLine);
  }
  if (isToday && nowHour > day.endHour) timeline.push(nowLine);

  return (
    <>
      <div className="schedule-date">
        <button
          type="button"
          className="schedule-date-label"
          title={isToday ? undefined : "Back to today"}
          disabled={isToday}
          onClick={() => onShiftDay(null)}
        >
          {new Date(day.dayMs).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </button>
        <span className="schedule-date-nav">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous day"
            onClick={() => onShiftDay(-1)}
          >
            <ChevronLeft {...ICON_PROPS} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next day"
            onClick={() => onShiftDay(1)}
          >
            <ChevronRight {...ICON_PROPS} />
          </button>
        </span>
      </div>
      <div ref={scrollRef} className="timeline-scroll">
        <ul className="thread-list timeline" aria-label="Day">
          {timeline}
        </ul>
      </div>
    </>
  );
}

// A list of threads labelled with a person: the inbox (what's waiting on you, by who it's from) or the outbox (what
// you're waiting on, by who has it).
function InboxList({
  label,
  empty,
  withWhen = false,
  items,
  activeThreadId,
  unreadIds,
  onOpenThread,
}: {
  label: string;
  empty: string;
  // Adds when it's slotted after the person: the outbox shows when they'll get to it.
  withWhen?: boolean;
  items: InboxItem[];
  activeThreadId: string | null;
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  if (items.length === 0) return <div className="sidebar-empty">{empty}</div>;
  return (
    <ul className="thread-list" aria-label={label}>
      {items.map((item) => (
        <ThreadRow
          key={item.thread.id}
          item={item}
          active={item.thread.id === activeThreadId}
          unread={unreadIds.has(item.thread.id)}
          label={
            item.from === null
              ? item.dueLabel
              : [item.from.name.split(" ")[0], withWhen ? item.dueLabel : null]
                  .filter((part) => part !== null)
                  .join(" · ")
          }
          onOpen={() => onOpenThread(item.thread.id)}
        />
      ))}
    </ul>
  );
}

// A collapsible sidebar section; hovering the header reveals the chevron and any actions.
function SidebarSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = (): void => setCollapsed((value) => !value);

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
        <span>{title}</span>
        <span className="section-chevron">
          <ChevronDown {...ICON_PROPS} />
        </span>
        {actions !== undefined && <span className="section-actions">{actions}</span>}
      </div>
      {!collapsed && children}
    </section>
  );
}

export function Sidebar({
  day,
  nowMs,
  unreadIds,
  activeThreadId,
  orgOpen,
  onNewThread,
  onOpenThread,
  onToggleOrg,
  onToggle,
  onSearch,
  onShiftDay,
}: {
  day: Day;
  nowMs: number;
  unreadIds: Set<string>;
  activeThreadId: string | null;
  orgOpen: boolean;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onToggleOrg: () => void;
  onToggle: () => void;
  onSearch: () => void;
  onShiftDay: (days: number | null) => void;
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
        {/* Org opens in the main area, like a thread. */}
        <div
          className="sidebar-row sidebar-nav-row"
          data-active={orgOpen}
          role="button"
          tabIndex={0}
          onClick={onToggleOrg}
          onKeyDown={(event) => activateOnKey(event, onToggleOrg)}
        >
          <span className="sidebar-row-label">Organization</span>
        </div>
        <SidebarSection title="Schedule">
          <DayView
            day={day}
            nowMs={nowMs}
            activeThreadId={activeThreadId}
            unreadIds={unreadIds}
            onOpenThread={onOpenThread}
            onShiftDay={onShiftDay}
          />
        </SidebarSection>
        <SidebarSection
          title="Inbox"
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
        >
          <InboxList
            label="Inbox"
            empty="Nothing in your inbox"
            items={day.unscheduled}
            activeThreadId={activeThreadId}
            unreadIds={unreadIds}
            onOpenThread={onOpenThread}
          />
        </SidebarSection>
        <SidebarSection title="Outbox">
          <InboxList
            label="Outbox"
            empty="Nothing waiting on others"
            withWhen
            items={day.outbox}
            activeThreadId={activeThreadId}
            unreadIds={unreadIds}
            onOpenThread={onOpenThread}
          />
        </SidebarSection>
      </div>
      {handle}
    </aside>
  );
}
