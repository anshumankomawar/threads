import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BubbleChatIcon,
  Calendar03Icon,
  PanelLeftIcon,
  PanelRightIcon,
  PencilEdit02Icon,
  Search01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { useResizablePanel } from "./useResizablePanel";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { homeDayMs, startOfDay, type Day, type InboxItem, type TimelineItem } from "../inbox";
import { useMe } from "../me";
import { useThreadLinks } from "../threadLinks";
import { useThreadMenu } from "../threadMenu";
import { Identicon } from "./Identicon";
import { plainThreadLinks, withoutLeadingMentions, type Thread } from "model";
import { latestFromOthers, type Conversations } from "../conversations";
import { KIND_ICONS } from "../kindIcons";
import { formatRange } from "../format";
import type { ActivityItem } from "../activity";
import { NotificationsButton } from "./Notifications";

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
const ICON_PROPS = { size: 14, "aria-hidden": true } as const;

// Hugeicons' panel icons with their side pane filled, for a panel that's open (the free set has no filled ones). The
// fill follows the outline's rounded corner and stops at the divider.
const LEFT_PANE =
  "M9 3H8C6 3 4.9 3.2 4.17 4.17C3.2 4.9 3 6 3 8V16C3 18 3.2 19.1 4.17 19.83C4.9 20.8 6 21 8 21H9Z";
const RIGHT_PANE =
  "M15 3H16C18 3 19.1 3.2 19.83 4.17C20.8 4.9 21 6 21 8V16C21 18 20.8 19.1 19.83 19.83C19.1 20.8 18 21 16 21H15Z";
const filled = (icon: IconSvgElement, pane: string): IconSvgElement => [
  ...icon,
  ["path", { d: pane, fill: "currentColor", key: "pane" }],
];
const PANEL_LEFT_OPEN = filled(PanelLeftIcon, LEFT_PANE);
const PANEL_RIGHT_OPEN = filled(PanelRightIcon, RIGHT_PANE);

// As in Delta: the sidebar's icon has its pane filled while the sidebar is open, and is an outline while it's closed.
export function SidebarToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="topbar-button"
      aria-label={open ? "Hide sidebar" : "Show sidebar"}
      aria-pressed={open}
      onClick={onToggle}
    >
      <HugeiconsIcon icon={open ? PANEL_LEFT_OPEN : PanelLeftIcon} {...ICON_PROPS} />
    </button>
  );
}

// The same for the details panel on the right.
export function DetailsToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="topbar-button"
      aria-label={open ? "Hide details" : "Show details"}
      aria-pressed={open}
      onClick={onToggle}
    >
      <HugeiconsIcon icon={open ? PANEL_RIGHT_OPEN : PanelRightIcon} {...ICON_PROPS} />
    </button>
  );
}

export function SearchButton({ onSearch }: { onSearch: () => void }): React.JSX.Element {
  return (
    <button type="button" className="topbar-button" aria-label="Search" onClick={onSearch}>
      <HugeiconsIcon icon={Search01Icon} {...ICON_PROPS} />
    </button>
  );
}

function activateOnKey(event: React.KeyboardEvent, activate: () => void): void {
  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  activate();
}

const MIN_GAP_MS = 30 * 60_000;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// One agenda row: the start time, then the block. The one under way is marked "now".
function AgendaRow({
  item,
  nowMs,
  active,
  unread,
  onOpen,
}: {
  item: TimelineItem;
  nowMs: number;
  active: boolean;
  unread: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const titleRef = useOverflowFade<HTMLSpanElement>();
  const openMenu = useThreadMenu();
  const { block, thread } = item;
  const icon = KIND_ICONS[thread.kind];
  return (
    <li className="thread-item">
      <div
        className="agenda-row"
        onContextMenu={(event) => openMenu(event, thread)}
        data-active={active}
        data-past={block.endMs <= nowMs}
        title={`${formatRange(block.startMs, block.endMs)} · ${item.reason}`}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => activateOnKey(event, onOpen)}
      >
        <span className="agenda-time">{formatTime(block.startMs)}</span>
        <span className="agenda-icon" aria-hidden>
          <HugeiconsIcon icon={icon} size={12} />
        </span>
        <span ref={titleRef} className="sidebar-row-label">
          {thread.title}
        </span>
        {unread && <span className="unread-dot" aria-label="Unread" />}
      </div>
    </li>
  );
}

// Now, as a thin blue line in a narrow gap between two rows, so it never touches a block: the time in the time column,
// then the line from the icon column to the edge. It moves when a block starts or ends; the time ticks every minute.
function NowLine({ nowMs }: { nowMs: number }): React.JSX.Element {
  return (
    <li className="agenda-now" aria-label={`Now, ${formatTime(nowMs)}`}>
      <span className="agenda-now-time" aria-hidden>
        {formatTime(nowMs)}
      </span>
      <span className="agenda-now-rule" aria-hidden />
    </li>
  );
}

// A day as an agenda: just its blocks in order, the free time between them as one quiet line, and what's already
// done dimmed. The arrows step a day back or forward; the date goes back to today.
function AgendaView({
  day,
  nowMs: realNowMs,
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
  // The day treated as today (Monday at the weekend), with now as this time of day on it.
  const home = homeDayMs(realNowMs);
  const isToday = day.dayMs === home;
  const nowMs = isToday ? home + (realNowMs - startOfDay(realNowMs)) : realNowMs;
  const done = day.timeline.filter((item) => item.block.endMs <= nowMs);
  const upcoming = day.timeline.filter((item) => item.block.endMs > nowMs);

  // The day in order: what's done, then free time and what's to come. Free time is from the end of the block before
  // it (or from now, today) until the next block starts.
  type Entry =
    | { kind: "item"; item: TimelineItem }
    | { kind: "free"; fromMs: number; untilMs: number };
  const entries: Entry[] = done.map((item) => ({ kind: "item", item }));
  let freeFrom = isToday ? Math.max(nowMs, done.at(-1)?.block.endMs ?? 0) : null;
  for (const item of upcoming) {
    if (freeFrom !== null && item.block.startMs - freeFrom >= MIN_GAP_MS)
      entries.push({ kind: "free", fromMs: freeFrom, untilMs: item.block.startMs });
    entries.push({ kind: "item", item });
    freeFrom = Math.max(freeFrom ?? 0, item.block.endMs);
  }

  // Today, where now falls: after the block under way (or the last thing in the day), else before whatever starts
  // next.
  let nowBefore = -1;
  if (isToday && entries.length > 0) {
    const next = entries.findIndex((entry) =>
      entry.kind === "free" ? entry.fromMs >= nowMs : entry.item.block.endMs > nowMs,
    );
    const entry = entries[next];
    nowBefore =
      next === -1
        ? entries.length
        : entry.kind === "item" && entry.item.block.startMs < nowMs
          ? next + 1
          : next;
  }

  const rows = entries.map((entry) => {
    if (entry.kind === "free")
      return (
        <li key={`free:${entry.untilMs}`} className="agenda-free">
          Free until {formatTime(entry.untilMs)}
        </li>
      );
    const { item } = entry;
    return (
      <AgendaRow
        key={`${item.thread.id}:${item.block.startMs}`}
        item={item}
        nowMs={nowMs}
        active={item.thread.id === activeThreadId}
        unread={unreadIds.has(item.thread.id)}
        onOpen={() => onOpenThread(item.thread.id)}
      />
    );
  });
  if (nowBefore !== -1) rows.splice(nowBefore, 0, <NowLine key="now" nowMs={nowMs} />);

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
            <HugeiconsIcon icon={ArrowLeft01Icon} {...ICON_PROPS} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next day"
            onClick={() => onShiftDay(1)}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} {...ICON_PROPS} />
          </button>
        </span>
      </div>
      <ul className="thread-list agenda" aria-label="Day">
        {rows}
        {day.timeline.length === 0 && <li className="sidebar-empty">Nothing scheduled</li>}
      </ul>
    </>
  );
}

// Your open conversations, in two groups: Unread (someone else wrote since you last looked) and Read. Each row is the
// latest message, who wrote it, and the thread the conversation is in. Opening one shows it beside that thread.
function ConversationList({
  conversations,
  splitThreadId,
  onOpenThread,
}: {
  conversations: Conversations;
  splitThreadId: string | null;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const { titleOf, nameOf } = useThreadLinks();
  const me = useMe();
  const openMenu = useThreadMenu();
  const row = (conversation: Thread, unread: boolean): React.JSX.Element => {
    const latest =
      latestFromOthers(conversation, me.id) ??
      conversation.entries.findLast((entry) => entry.kind === "message");
    const author = latest?.kind === "message" ? latest.author : conversation.requester;
    // The words, without the mentions a message opens with.
    const text =
      latest?.kind === "message"
        ? plainThreadLinks(withoutLeadingMentions(latest.text), titleOf, nameOf)
        : conversation.title;
    const where =
      conversation.branchedFromId === null ? undefined : titleOf(conversation.branchedFromId);
    const open = (): void => onOpenThread(conversation.id);
    return (
      <li key={conversation.id} className="thread-item">
        <div
          className="conversation-row"
          onContextMenu={(event) => openMenu(event, conversation)}
          data-active={conversation.id === splitThreadId}
          data-unread={unread}
          role="button"
          tabIndex={0}
          onClick={open}
          onKeyDown={(event) => activateOnKey(event, open)}
        >
          <Identicon seed={author.id} size={16} />
          <span className="conversation-body">
            <span className="conversation-text">{text}</span>
            <span className="conversation-meta">
              <span className="conversation-author">
                {author.id === me.id ? "You" : author.name.split(" ")[0]}
              </span>
              {where !== undefined && ` · ${where}`}
            </span>
          </span>
          {unread && <span className="unread-dot" aria-label="Unread" />}
        </div>
      </li>
    );
  };
  // Unread always shows, so it's clear when there's nothing new; Read shows once there's something in it.
  return (
    <>
      <section className="conversation-group">
        <h2 className="conversation-group-label">Unread</h2>
        {conversations.unread.length === 0 ? (
          <p className="conversation-empty">Nothing new</p>
        ) : (
          <ul className="thread-list" aria-label="Unread">
            {conversations.unread.map((conversation) => row(conversation, true))}
          </ul>
        )}
      </section>
      {conversations.read.length > 0 && (
        <section className="conversation-group">
          <h2 className="conversation-group-label">Read</h2>
          <ul className="thread-list" aria-label="Read">
            {conversations.read.map((conversation) => row(conversation, false))}
          </ul>
        </section>
      )}
    </>
  );
}

// What you're tracking: what you've asked others for, whether you made it or someone made it on your behalf, and your
// blocked threads: the title, who has it, and when they'll get to it. It leaves when they close it.
function Tracking({
  items,
  activeThreadId,
  unreadIds,
  onOpenThread,
}: {
  items: InboxItem[];
  activeThreadId: string | null;
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const openMenu = useThreadMenu();
  return (
    <ul className="thread-list" aria-label="Tracking">
      {items.map((item) => {
        const icon = KIND_ICONS[item.thread.kind];
        const label = [item.from?.name.split(" ")[0], item.dueLabel]
          .filter((part) => part != null)
          .join(" · ");
        const open = (): void => onOpenThread(item.thread.id);
        return (
          <li key={item.thread.id} className="thread-item">
            <div
              className="sidebar-row"
              onContextMenu={(event) => openMenu(event, item.thread)}
              data-active={item.thread.id === activeThreadId}
              title={item.reason}
              role="button"
              tabIndex={0}
              onClick={open}
              onKeyDown={(event) => activateOnKey(event, open)}
            >
              <span className="sidebar-row-icon" aria-hidden>
                <HugeiconsIcon icon={icon} size={12} />
              </span>
              <span className="sidebar-row-label">{item.thread.title}</span>
              {unreadIds.has(item.thread.id) && <span className="unread-dot" aria-label="Unread" />}
              {label !== "" && <span className="sidebar-row-meta">{label}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// The sidebar shows one list at a time, picked by the icon tabs under its top bar, like Obsidian's side panes.
type SidebarTab = "schedule" | "conversations" | "tracking";

const TAB_KEY = "sidebar-tab";

const TABS: { tab: SidebarTab; label: string; icon: IconSvgElement }[] = [
  { tab: "schedule", label: "Schedule", icon: Calendar03Icon },
  { tab: "conversations", label: "Conversations", icon: BubbleChatIcon },
  { tab: "tracking", label: "Tracking", icon: ViewIcon },
];

function savedTab(): SidebarTab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some(({ tab }) => tab === saved) ? (saved as SidebarTab) : "schedule";
  } catch {
    return "schedule";
  }
}

// The tab strip, as in Notion: the chosen tab opens out to show its name, the others fold back to their icon, with a
// count beside Conversations (the unread ones) and Tracking while they have anything. Your avatar at the far end opens your profile and
// the org (in the main area, like a thread).
function SidebarTabs({
  tab,
  conversationCount,
  trackingCount,
  profileOpen,
  onTab,
  onToggleProfile,
}: {
  tab: SidebarTab;
  conversationCount: number;
  trackingCount: number;
  profileOpen: boolean;
  onTab: (tab: SidebarTab) => void;
  onToggleProfile: () => void;
}): React.JSX.Element {
  const me = useMe();
  const counts: Record<SidebarTab, number> = {
    schedule: 0,
    conversations: conversationCount,
    tracking: trackingCount,
  };
  // Each name's own width, so the chosen tab grows to exactly fit it (animating to a guessed maximum finishes early
  // and looks rushed).
  const groupRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (const label of groupRef.current?.querySelectorAll<HTMLElement>(".sidebar-tab-label") ?? [])
      label.style.setProperty("--label-width", `${label.scrollWidth}px`);
  });

  return (
    <div className="sidebar-tabs">
      <div ref={groupRef} className="sidebar-tab-group" role="tablist" aria-label="Sidebar">
        {TABS.map(({ tab: value, label, icon }) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="sidebar-tab"
            aria-selected={tab === value}
            aria-label={label}
            title={label}
            onClick={() => onTab(value)}
          >
            <HugeiconsIcon icon={icon} {...ICON_PROPS} />
            <span className="sidebar-tab-label" aria-hidden>
              {label}
            </span>
            {counts[value] > 0 && <span className="sidebar-tab-count">{counts[value]}</span>}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="sidebar-tab sidebar-tab-end"
        aria-pressed={profileOpen}
        aria-label="Your profile and organization"
        title="Your profile and organization"
        onClick={onToggleProfile}
      >
        <Identicon seed={me.id} size={14} />
      </button>
    </div>
  );
}

// What opens in the main area from the sidebar: what's yours with no time yet, or settings.
export type SidebarPage = "unplaced" | "settings";

export function Sidebar({
  day,
  conversations,
  splitThreadId,
  activity,
  onMarkAllRead,
  nowMs,
  unreadIds,
  activeThreadId,
  profileOpen,
  page,
  onNewThread,
  onOpenThread,
  onToggleProfile,
  onOpenPage,
  onToggle,
  onSearch,
  onShiftDay,
}: {
  day: Day;
  conversations: Conversations;
  // The thread open beside the main one, which is where a conversation opens.
  splitThreadId: string | null;
  // What changed on your threads, for the notifications bell.
  activity: ActivityItem[];
  onMarkAllRead: () => void;
  nowMs: number;
  unreadIds: Set<string>;
  activeThreadId: string | null;
  profileOpen: boolean;
  page: SidebarPage | null;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onToggleProfile: () => void;
  onOpenPage: (page: SidebarPage) => void;
  onToggle: () => void;
  onSearch: () => void;
  onShiftDay: (days: number | null) => void;
}): React.JSX.Element {
  const me = useMe();
  const { panelRef, width, handle } = useResizablePanel({
    storageKey: "sidebar-width",
    defaultWidth: 268,
    minWidth: 210,
    maxWidth: 400,
    edge: "right",
  });
  const [tab, setTab] = useState<SidebarTab>(savedTab);
  const chooseTab = (next: SidebarTab): void => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Not remembered this time; the tab still switches.
    }
  };

  return (
    <aside ref={panelRef} className="sidebar" style={{ width }}>
      <div className="topbar sidebar-topbar">
        <SidebarToggle open onToggle={onToggle} />
        <SearchButton onSearch={onSearch} />
        <span className="topbar-end">
          <NotificationsButton
            items={activity}
            nowMs={nowMs}
            activeThreadId={activeThreadId}
            onOpenThread={onOpenThread}
            onMarkAllRead={onMarkAllRead}
          />
          <button
            type="button"
            className="topbar-button"
            aria-label="New thread"
            onClick={onNewThread}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} {...ICON_PROPS} />
          </button>
        </span>
      </div>
      <SidebarTabs
        tab={tab}
        conversationCount={conversations.unread.length}
        trackingCount={day.tracking.length}
        profileOpen={profileOpen}
        onTab={chooseTab}
        onToggleProfile={onToggleProfile}
      />
      <div className="sidebar-content">
        {tab === "conversations" && (
          <ConversationList
            conversations={conversations}
            splitThreadId={splitThreadId}
            onOpenThread={onOpenThread}
          />
        )}
        {tab === "schedule" && (
          <>
            <AgendaView
              day={day}
              nowMs={nowMs}
              activeThreadId={activeThreadId}
              unreadIds={unreadIds}
              onOpenThread={onOpenThread}
              onShiftDay={onShiftDay}
            />
            {/* The schedule is your inbox; what's yours without time yet is one line under it. */}
            {day.unplaced.length > 0 && (
              <button
                type="button"
                className="agenda-unplaced"
                data-active={page === "unplaced"}
                onClick={() => onOpenPage("unplaced")}
              >
                {day.unplaced.length} not scheduled yet
              </button>
            )}
          </>
        )}
        {tab === "tracking" && (
          <Tracking
            items={day.tracking}
            activeThreadId={activeThreadId}
            unreadIds={unreadIds}
            onOpenThread={onOpenThread}
          />
        )}
      </div>
      {/* As in Delta: you, at the bottom. It opens settings. */}
      <button
        type="button"
        className="sidebar-footer"
        aria-current={page === "settings" ? "page" : undefined}
        onClick={() => onOpenPage("settings")}
      >
        <Identicon seed={me.id} size={16} />
        <span className="sidebar-footer-name">{me.name}</span>
      </button>
      {handle}
    </aside>
  );
}
