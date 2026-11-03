import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowRight01Icon,
  InboxIcon,
  MoreHorizontalIcon,
  NoteEditIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PencilEdit02Icon,
  Search01Icon,
  SentIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { useResizablePanel } from "./useResizablePanel";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BucketGroup, Inbox, InboxItem } from "../inbox";
import { useMe } from "../me";
import { useThreadLinks } from "../threadLinks";
import { useThreadMenu } from "../threadMenu";
import { Identicon } from "./Identicon";
import {
  lastSentTo,
  plainThreadLinks,
  type Bucket,
  type Group,
  type Label,
  type Thread,
} from "model";
import { filterLabels, threadsWithLabel, type GroupLists, type GroupNotice } from "../groups";
import { THREAD_ICON } from "../threadIcon";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import type { ActivityItem } from "../activity";
import type { SavedDraft } from "../drafts";
import { formatRelativeTime } from "../format";
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

// Which buckets you've folded, remembered on this device.
const COLLAPSED_KEY = "collapsed-buckets";

function savedCollapsed(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

// The dragged thread travels as this type, so only inbox rows drop on buckets.
const DRAG_TYPE = "application/x-thread-id";

// One thread in the inbox: who it's from, its title and when it's due, and under them, as in email, what they last sent
// you, or for your own work why it matters (who asked, how soon, how urgent). Hovering shows why it's in its bucket,
// in the model's words. Drag it to another bucket to move it.
function InboxRow({
  item,
  active,
  unread,
  onOpen,
}: {
  item: InboxItem;
  active: boolean;
  unread: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const openMenu = useThreadMenu();
  const me = useMe();
  const { titleOf, nameOf } = useThreadLinks();
  const { thread } = item;
  const titleRef = useOverflowFade<HTMLSpanElement>();
  const sorted = thread.triage[me.id];
  const why = sorted?.manual ? "Placed here by you" : (sorted?.reason ?? "");
  const person = item.from;
  const latest = item.why === "sent" ? lastSentTo(thread, me.id) : undefined;
  const line =
    latest === undefined
      ? item.reason
      : `${latest.author.name.split(" ")[0]}: ${plainThreadLinks(latest.text, titleOf, nameOf)}`;
  return (
    <li className="thread-item">
      <div
        className="inbox-row"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, thread.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={(event) => openMenu(event, thread)}
        data-active={active}
        data-unread={unread}
        data-blocked={thread.status === "blocked"}
        title={why}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => activateOnKey(event, onOpen)}
      >
        <Identicon seed={person.id} size={16} />
        <span className="inbox-row-body">
          <span className="inbox-row-top">
            <span ref={titleRef} className="inbox-row-title">
              {thread.title}
            </span>
            {unread && <span className="unread-dot" aria-label="Unread" />}
            {item.dueLabel !== null && (
              <span className="inbox-row-due" data-overdue={item.overdue}>
                {item.dueLabel}
              </span>
            )}
          </span>
          <span className="inbox-row-why">{line}</span>
        </span>
      </div>
    </li>
  );
}

// Bucket edits, made from the inbox and saved to your profile.
export type BucketActions = {
  onNew: () => void;
  onEdit: (bucket: Bucket) => void;
  onMove: (bucketId: string, by: -1 | 1) => void;
  onDelete: (bucketId: string) => void;
  // Puts a thread in one of your buckets by hand.
  onPlace: (threadId: string, bucketId: string) => void;
};

// One bucket: its name and count, which folds it, and its threads. Threads dragged onto it move into it.
function BucketSection({
  group,
  collapsed,
  canDelete,
  first,
  last,
  activeThreadId,
  unreadIds,
  actions,
  onToggle,
  onOpenThread,
}: {
  group: BucketGroup;
  collapsed: boolean;
  canDelete: boolean;
  first: boolean;
  last: boolean;
  activeThreadId: string | null;
  unreadIds: Set<string>;
  actions: BucketActions;
  onToggle: () => void;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const { bucket, items } = group;
  const [dropping, setDropping] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuItems: ContextMenuItem[] = [
    { label: "Edit bucket…", run: () => actions.onEdit(bucket) },
    { label: "New bucket…", run: actions.onNew },
    "separator",
    ...(first ? [] : [{ label: "Move up", run: () => actions.onMove(bucket.id, -1) }]),
    ...(last ? [] : [{ label: "Move down", run: () => actions.onMove(bucket.id, 1) }]),
    ...(canDelete
      ? (["separator", { label: "Delete bucket", run: () => actions.onDelete(bucket.id) }] as const)
      : []),
  ];
  const openMenu = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };
  return (
    <section
      className="bucket"
      data-dropping={dropping}
      data-empty={items.length === 0}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        setDropping(false);
        const threadId = event.dataTransfer.getData(DRAG_TYPE);
        if (threadId === "") return;
        event.preventDefault();
        if (!items.some((item) => item.thread.id === threadId))
          actions.onPlace(threadId, bucket.id);
      }}
    >
      <div className="bucket-header" onContextMenu={openMenu}>
        <button
          type="button"
          className="bucket-toggle"
          aria-expanded={!collapsed}
          title={bucket.description}
          onClick={onToggle}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={10} className="bucket-chevron" aria-hidden />
          <span className="bucket-name">{bucket.name}</span>
          {items.length > 0 && <span className="bucket-count">{items.length}</span>}
        </button>
        <button
          type="button"
          className="icon-button bucket-more"
          aria-label={`${bucket.name} options`}
          onClick={openMenu}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} {...ICON_PROPS} />
        </button>
      </div>
      {!collapsed && items.length > 0 && (
        <ul className="thread-list" aria-label={bucket.name}>
          {items.map((item) => (
            <InboxRow
              key={item.thread.id}
              item={item}
              active={item.thread.id === activeThreadId}
              unread={unreadIds.has(item.thread.id)}
              onOpen={() => onOpenThread(item.thread.id)}
            />
          ))}
        </ul>
      )}
      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </section>
  );
}

// Your inbox: every thread assigned or sent to you, in your buckets, each sorted most important first. Threads the model
// hasn't got to yet wait at the top under "Sorting".
function InboxView({
  inbox,
  activeThreadId,
  unreadIds,
  actions,
  onOpenThread,
}: {
  inbox: Inbox;
  activeThreadId: string | null;
  unreadIds: Set<string>;
  actions: BucketActions;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  const toggle = (bucketId: string): void =>
    setCollapsed((current) => {
      const next = current.includes(bucketId)
        ? current.filter((id) => id !== bucketId)
        : [...current, bucketId];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Not remembered; it still folds.
      }
      return next;
    });
  const nothing = inbox.order.length === 0;
  return (
    <div className="inbox">
      {inbox.unsorted.length > 0 && (
        <section className="bucket">
          <div className="bucket-header">
            <span className="bucket-toggle bucket-sorting">
              <span className="bucket-name">Sorting</span>
              <span className="bucket-count">{inbox.unsorted.length}</span>
            </span>
          </div>
          <ul className="thread-list" aria-label="Sorting">
            {inbox.unsorted.map((item) => (
              <InboxRow
                key={item.thread.id}
                item={item}
                active={item.thread.id === activeThreadId}
                unread={unreadIds.has(item.thread.id)}
                onOpen={() => onOpenThread(item.thread.id)}
              />
            ))}
          </ul>
        </section>
      )}
      {nothing && <p className="conversation-empty">Nothing for you</p>}
      {inbox.buckets.map((group, index) => (
        <BucketSection
          key={group.bucket.id}
          group={group}
          collapsed={collapsed.includes(group.bucket.id)}
          canDelete={inbox.buckets.length > 1}
          first={index === 0}
          last={index === inbox.buckets.length - 1}
          activeThreadId={activeThreadId}
          unreadIds={unreadIds}
          actions={actions}
          onToggle={() => toggle(group.bucket.id)}
          onOpenThread={onOpenThread}
        />
      ))}
      <button type="button" className="bucket-new" onClick={actions.onNew}>
        <HugeiconsIcon icon={Add01Icon} size={12} aria-hidden />
        New bucket
      </button>
    </div>
  );
}

// Sent, your outbox: every open thread you own that anyone else is on, with who's on it and when it's due. Each
// leaves when it's closed.
function Sent({
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
    <ul className="thread-list" aria-label="Sent">
      {items.length === 0 && <li className="conversation-empty">Nothing out with anyone</li>}
      {items.map((item) => {
        const label = [item.who, item.dueLabel].filter((part) => part != null).join(" · ");
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
                <HugeiconsIcon icon={THREAD_ICON} size={12} />
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

// Your groups, everyone else's, and the labels people file things under, each with how many open threads it has. Any
// of them opens its threads in the main area.
function GroupList({
  groups,
  labels,
  threads,
  page,
  onOpenLabel,
  onOpenAll,
  onNewGroup,
}: {
  groups: GroupLists;
  labels: Label[];
  threads: Thread[];
  page: SidebarPage | null;
  onOpenLabel: (id: string) => void;
  onOpenAll: () => void;
  onNewGroup: () => void;
}): React.JSX.Element {
  const count = (labelId: string | null): number => threadsWithLabel(threads, labelId).length;
  const allCount = count(null);
  const activeLabel =
    page !== null && typeof page === "object" && "label" in page ? page.label : undefined;
  const row = (id: string, labelId: string, name: string): React.JSX.Element => {
    const open = (): void => onOpenLabel(labelId);
    const openThreads = count(labelId);
    return (
      <li key={id} className="thread-item">
        <div
          className="sidebar-row"
          data-active={activeLabel === labelId}
          role="button"
          tabIndex={0}
          onClick={open}
          onKeyDown={(event) => activateOnKey(event, open)}
        >
          <span className="sidebar-row-label">{name}</span>
          {openThreads > 0 && <span className="sidebar-row-meta">{openThreads}</span>}
        </div>
      </li>
    );
  };
  const section = (
    title: string,
    items: { id: string; labelId: string; name: string }[],
  ): React.JSX.Element | null =>
    items.length === 0 ? null : (
      <section className="conversation-group">
        <h2 className="conversation-group-label">{title}</h2>
        <ul className="thread-list" aria-label={title}>
          {items.map((item) => row(item.id, item.labelId, item.name))}
        </ul>
      </section>
    );
  const asItems = (list: Group[]): { id: string; labelId: string; name: string }[] =>
    list.map((group) => ({ id: group.id, labelId: group.labelId, name: group.name }));
  return (
    <>
      <button type="button" className="sidebar-new-group" onClick={onNewGroup}>
        New group
      </button>
      {/* Every thread in the organization; a group or label is this list, filtered. */}
      <ul className="thread-list" aria-label="All threads">
        <li className="thread-item">
          <div
            className="sidebar-row"
            data-active={page === "all"}
            role="button"
            tabIndex={0}
            onClick={onOpenAll}
            onKeyDown={(event) => activateOnKey(event, onOpenAll)}
          >
            <span className="sidebar-row-label">All threads</span>
            {allCount > 0 && <span className="sidebar-row-meta">{allCount}</span>}
          </div>
        </li>
      </ul>
      {section("Your groups", asItems(groups.mine))}
      {section("Other groups", asItems(groups.others))}
      {section(
        "Labels",
        filterLabels(labels).map((label) => ({
          id: label.id,
          labelId: label.id,
          name: label.name,
        })),
      )}
      {section("Archived groups", asItems(groups.archived))}
    </>
  );
}

// Threads written in the new-message panel and kept for later, newest first. Opening one shows it in the main area,
// like a thread, to edit and send; right-click deletes it.
function Drafts({
  drafts,
  activeDraftId,
  nowMs,
  onOpen,
  onDelete,
}: {
  drafts: SavedDraft[];
  activeDraftId: string | null;
  nowMs: number;
  onOpen: (draft: SavedDraft) => void;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  return (
    <ul className="thread-list" aria-label="Drafts">
      {drafts.length === 0 && (
        <li className="conversation-empty">No drafts. ⌘⇧N, then ⌘S, keeps one for later</li>
      )}
      {drafts.map((draft) => {
        const title =
          draft.draft?.title.trim() || draft.text.trim().split("\n")[0] || "Untitled draft";
        const open = (): void => onOpen(draft);
        return (
          <li key={draft.id} className="thread-item">
            <div
              className="sidebar-row"
              data-active={draft.id === activeDraftId}
              role="button"
              tabIndex={0}
              title={draft.text}
              onClick={open}
              onKeyDown={(event) => activateOnKey(event, open)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, id: draft.id });
              }}
            >
              <span className="sidebar-row-icon" aria-hidden>
                <HugeiconsIcon icon={NoteEditIcon} size={12} />
              </span>
              <span className="sidebar-row-label">{title}</span>
              <span className="sidebar-row-meta">{formatRelativeTime(draft.savedAtMs, nowMs)}</span>
            </div>
          </li>
        );
      })}
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: "Delete draft", run: () => onDelete(menu.id) }]}
          onClose={() => setMenu(null)}
        />
      )}
    </ul>
  );
}

// The sidebar shows one list at a time, picked by the icon tabs under its top bar, like Obsidian's side panes.
type SidebarTab = "inbox" | "sent" | "drafts" | "groups";

const TAB_KEY = "sidebar-tab";

const TABS: { tab: SidebarTab; label: string; icon: IconSvgElement }[] = [
  { tab: "inbox", label: "Inbox", icon: InboxIcon },
  { tab: "sent", label: "Sent", icon: SentIcon },
  { tab: "drafts", label: "Drafts", icon: NoteEditIcon },
  { tab: "groups", label: "Groups", icon: UserGroupIcon },
];

function savedTab(): SidebarTab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some(({ tab }) => tab === saved) ? (saved as SidebarTab) : "inbox";
  } catch {
    return "inbox";
  }
}

// The tab strip, as in Notion: the chosen tab opens out to show its name, the others fold back to their icon, with a
// count beside the Inbox, Sent and Drafts while they have anything. Your avatar at the far end opens your profile and
// the org (in the main area, like a thread).
function SidebarTabs({
  tab,
  inboxCount,
  sentCount,
  draftCount,
  profileOpen,
  onTab,
  onToggleProfile,
}: {
  tab: SidebarTab;
  inboxCount: number;
  sentCount: number;
  draftCount: number;
  profileOpen: boolean;
  onTab: (tab: SidebarTab) => void;
  onToggleProfile: () => void;
}): React.JSX.Element {
  const me = useMe();
  const counts: Record<SidebarTab, number> = {
    inbox: inboxCount,
    sent: sentCount,
    drafts: draftCount,
    groups: 0,
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

// What opens in the main area from the sidebar: settings, every thread, a label's threads (a group's, when it's a
// group's label), someone's profile, or a group's sprint.
export type SidebarPage =
  | "settings"
  | "all"
  | { label: string }
  | { person: string }
  | { sprint: string };

export function Sidebar({
  inbox,
  drafts,
  activeDraftId,
  onOpenDraft,
  onDeleteDraft,
  bucketActions,
  activity,
  groupNotices,
  groups,
  labels,
  threads,
  onNewGroup,
  onOpenLabel,
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
}: {
  inbox: Inbox;
  // Threads written but not sent (`drafts.ts`).
  drafts: SavedDraft[];
  // The draft open in the main area, if any.
  activeDraftId: string | null;
  onOpenDraft: (draft: SavedDraft) => void;
  onDeleteDraft: (id: string) => void;
  bucketActions: BucketActions;
  // What changed on your threads, for the notifications bell.
  activity: ActivityItem[];
  // Groups someone added you to, for the same bell.
  groupNotices: GroupNotice[];
  groups: GroupLists;
  labels: Label[];
  threads: Thread[];
  onNewGroup: () => void;
  onOpenLabel: (id: string) => void;
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
            groupNotices={groupNotices}
            onOpenGroup={(id) => {
              const group = [...groups.mine, ...groups.others, ...groups.archived].find(
                (candidate) => candidate.id === id,
              );
              if (group !== undefined) onOpenLabel(group.labelId);
            }}
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
        inboxCount={inbox.order.length}
        sentCount={inbox.sent.length}
        draftCount={drafts.length}
        profileOpen={profileOpen}
        onTab={chooseTab}
        onToggleProfile={onToggleProfile}
      />
      <div className="sidebar-content">
        {tab === "inbox" && (
          <InboxView
            inbox={inbox}
            activeThreadId={activeThreadId}
            unreadIds={unreadIds}
            actions={bucketActions}
            onOpenThread={onOpenThread}
          />
        )}
        {tab === "groups" && (
          <GroupList
            groups={groups}
            labels={labels}
            threads={threads}
            page={page}
            onOpenLabel={onOpenLabel}
            onOpenAll={() => onOpenPage("all")}
            onNewGroup={onNewGroup}
          />
        )}
        {tab === "drafts" && (
          <Drafts
            drafts={drafts}
            activeDraftId={activeDraftId}
            nowMs={nowMs}
            onOpen={onOpenDraft}
            onDelete={onDeleteDraft}
          />
        )}
        {tab === "sent" && (
          <Sent
            items={inbox.sent}
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
