import {
  Add01Icon,
  ArrowRight01Icon,
  InboxIcon,
  NoteEditIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PencilEdit02Icon,
  Search01Icon,
  SentIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { useResizablePanel } from "./useResizablePanel";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { BucketGroup, Inbox, InboxItem } from "../inbox";
import { useMe } from "../me";
import { useThreadLinks } from "../threadLinks";
import { useThreadMenu } from "../threadMenu";
import { Icon, type IconSvgElement } from "./Icon";
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
import { bucketIcons } from "../bucketIcons";
import { THREAD_ICON } from "../threadIcon";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import type { ActivityItem } from "../activity";
import type { SavedDraft } from "../drafts";
import { formatRelativeTime } from "../format";
import { NotificationsButton } from "./Notifications";

// Marks the element with data-overflowing when its text is clipped, which turns on the fade mask. Call it in a
// component body and put what it returns on the element as its ref.
function overflowFade<T extends HTMLElement>(): (element: T) => void {
  let element: T | undefined;
  onSettled(() => {
    const target = element;
    if (target === undefined) return;
    const observer = new ResizeObserver(() => {
      target.toggleAttribute("data-overflowing", target.scrollWidth > target.clientWidth);
    });
    observer.observe(target);
    return () => observer.disconnect();
  });
  return (next) => {
    element = next;
  };
}

// How many of a bucket's threads show at once; the rest scroll inside it.
const BUCKET_ROWS = 5;

// Caps a list at `rows` rows, scrolling the rest, and marks the ends with more past them (data-more-above,
// data-more-below), which fade out to say so. Call it in the body of the component that renders the list, and put
// what it returns on the list as its ref. It measures again when `rows` or `contents` change, on scroll, and on resize.
function rowCap(rows: () => number, contents: () => unknown): (list: HTMLUListElement) => void {
  let list: HTMLUListElement | undefined;
  // The cap as last read; reading a prop outside a compute isn't allowed in Solid 2.
  let cap = 0;
  const update = (): void => {
    if (list === undefined) return;
    const first = list.children[0] as HTMLElement | undefined;
    const cut = list.children[cap] as HTMLElement | undefined;
    list.style.maxHeight =
      first === undefined || cut === undefined ? "" : `${cut.offsetTop - first.offsetTop}px`;
    list.toggleAttribute("data-more-above", list.scrollTop > 0);
    list.toggleAttribute(
      "data-more-below",
      list.scrollTop + list.clientHeight < list.scrollHeight - 1,
    );
  };
  onSettled(() => {
    const target = list;
    if (target === undefined) return;
    target.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => {
      target.removeEventListener("scroll", update);
      observer.disconnect();
    };
  });
  // The rows have rendered by the time an effect applies, so this measures what's on screen. `rows` and `contents`
  // are read in the compute: Solid 2 sets a prop's read up there, never in the apply or `onSettled`.
  createEffect(
    () => [rows(), contents()] as const,
    ([next]) => {
      cap = next;
      update();
    },
  );
  return (next) => {
    list = next;
  };
}

// Delta's icons are 14px with roughly 1px strokes (1.7 on Lucide's 24px grid).
const ICON_PROPS = { size: 14, "aria-hidden": "true" } as const;

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
export function SidebarToggle(props: { open: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="topbar-button"
      aria-label={props.open ? "Hide sidebar" : "Show sidebar"}
      aria-pressed={props.open ? "true" : "false"}
      onClick={() => props.onToggle()}
    >
      <Icon icon={props.open ? PANEL_LEFT_OPEN : PanelLeftIcon} {...ICON_PROPS} />
    </button>
  );
}

// The same for the details panel on the right.
export function DetailsToggle(props: { open: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="topbar-button"
      aria-label={props.open ? "Hide details" : "Show details"}
      aria-pressed={props.open ? "true" : "false"}
      onClick={() => props.onToggle()}
    >
      <Icon icon={props.open ? PANEL_RIGHT_OPEN : PanelRightIcon} {...ICON_PROPS} />
    </button>
  );
}

export function SearchButton(props: { onSearch: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="topbar-button"
      aria-label="Search"
      onClick={() => props.onSearch()}
    >
      <Icon icon={Search01Icon} {...ICON_PROPS} />
    </button>
  );
}

function activateOnKey(event: KeyboardEvent, activate: () => void): void {
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
function InboxRow(props: {
  item: InboxItem;
  active: boolean;
  unread: boolean;
  onOpen: () => void;
}): JSX.Element {
  const openMenu = useThreadMenu();
  const me = useMe();
  const links = useThreadLinks();
  const thread = (): Thread => props.item.thread;
  const titleRef = overflowFade<HTMLSpanElement>();
  // The open thread stays in view in its bucket, as J and K move past the rows showing.
  let row!: HTMLDivElement;
  createEffect(
    () => props.active,
    (active) => {
      if (active) row.scrollIntoView({ block: "nearest" });
    },
  );
  const why = (): string => {
    const sorted = thread().triage[me().id];
    return sorted?.manual ? "Placed here by you" : (sorted?.reason ?? "");
  };
  const line = (): string => {
    const latest = props.item.why === "sent" ? lastSentTo(thread(), me().id) : undefined;
    return latest === undefined
      ? props.item.reason
      : `${latest.author.name.split(" ")[0]}: ${plainThreadLinks(latest.text, links.titleOf, links.nameOf)}`;
  };
  return (
    <li class="thread-item">
      <div
        ref={row}
        class="inbox-row"
        draggable="true"
        onDragStart={(event) => {
          event.dataTransfer?.setData(DRAG_TYPE, thread().id);
          if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={(event) => openMenu(event, thread())}
        data-active={String(props.active)}
        data-unread={String(props.unread)}
        data-blocked={String(thread().status === "blocked")}
        title={why()}
        role="button"
        tabindex={0}
        onClick={() => props.onOpen()}
        onKeyDown={(event) => activateOnKey(event, props.onOpen)}
      >
        <Identicon seed={props.item.from.id} size={16} />
        <span class="inbox-row-body">
          <span class="inbox-row-top">
            <span ref={titleRef} class="inbox-row-title">
              {thread().title}
            </span>
            <Show when={props.item.dueLabel !== null}>
              <span class="inbox-row-due">{props.item.dueLabel}</span>
            </Show>
          </span>
          <span class="inbox-row-why">{line()}</span>
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

// A bucket's threads, capped at `rows` rows (`rowCap`).
function BucketThreads(props: {
  label: string;
  items: InboxItem[];
  rows: number;
  activeThreadId: string | null;
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): JSX.Element {
  const listRef = rowCap(
    () => props.rows,
    () => props.items,
  );
  return (
    <ul ref={listRef} class="thread-list bucket-threads" aria-label={props.label}>
      <For each={props.items} keyed={(item) => item.thread.id}>
        {(item) => (
          <InboxRow
            item={item()}
            active={item().thread.id === props.activeThreadId}
            unread={props.unreadIds.has(item().thread.id)}
            onOpen={() => props.onOpenThread(item().thread.id)}
          />
        )}
      </For>
    </ul>
  );
}

// One bucket: its name and count, which folds it, and its threads. Threads dragged onto it move into it.
function BucketSection(props: {
  group: BucketGroup;
  icon: IconSvgElement | undefined;
  collapsed: boolean;
  canDelete: boolean;
  first: boolean;
  last: boolean;
  activeThreadId: string | null;
  unreadIds: Set<string>;
  actions: BucketActions;
  onToggle: () => void;
  onOpenThread: (id: string) => void;
}): JSX.Element {
  const bucket = (): Bucket => props.group.bucket;
  const items = (): InboxItem[] => props.group.items;
  // A bucket shows its first few threads until you ask for the rest ("6 more").
  const [expanded, setExpanded] = createSignal(false);
  const hidden = (): number => items().length - BUCKET_ROWS;
  const [dropping, setDropping] = createSignal(false);
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null);
  const menuItems = (): ContextMenuItem[] => [
    { label: "Edit bucket…", run: () => props.actions.onEdit(bucket()) },
    { label: "New bucket…", run: props.actions.onNew },
    "separator",
    ...(props.first
      ? []
      : [{ label: "Move up", run: () => props.actions.onMove(bucket().id, -1) }]),
    ...(props.last
      ? []
      : [{ label: "Move down", run: () => props.actions.onMove(bucket().id, 1) }]),
    ...(props.canDelete
      ? ([
          "separator",
          { label: "Delete bucket", run: () => props.actions.onDelete(bucket().id) },
        ] as const)
      : []),
  ];
  const openMenu = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };
  return (
    <section
      class="bucket"
      data-dropping={String(dropping())}
      data-empty={String(items().length === 0)}
      onDragOver={(event) => {
        if (event.dataTransfer === null || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        setDropping(false);
        const threadId = event.dataTransfer?.getData(DRAG_TYPE) ?? "";
        if (threadId === "") return;
        event.preventDefault();
        if (!items().some((item) => item.thread.id === threadId))
          props.actions.onPlace(threadId, bucket().id);
      }}
    >
      <div class="bucket-header" onContextMenu={openMenu}>
        <button
          type="button"
          class="bucket-toggle"
          aria-expanded={!props.collapsed ? "true" : "false"}
          title={bucket().description}
          onClick={() => props.onToggle()}
        >
          <Icon icon={props.icon ?? InboxIcon} size={14} class="bucket-icon" aria-hidden="true" />
          <span class="bucket-name">{bucket().name}</span>
          <Show when={items().length > 0}>
            <span class="bucket-count">{items().length}</span>
          </Show>
          <Icon icon={ArrowRight01Icon} size={10} class="bucket-chevron" aria-hidden="true" />
        </button>
      </div>
      <Show when={!props.collapsed && items().length > 0}>
        <BucketThreads
          label={bucket().name}
          items={items()}
          rows={expanded() ? items().length : BUCKET_ROWS}
          activeThreadId={props.activeThreadId}
          unreadIds={props.unreadIds}
          onOpenThread={props.onOpenThread}
        />
      </Show>
      <Show when={!props.collapsed && hidden() > 0}>
        <button type="button" class="bucket-more-rows" onClick={() => setExpanded(!expanded())}>
          {expanded() ? "Show less" : `${hidden()} more`}
        </button>
      </Show>
      <Show when={menu()}>
        {(shown) => (
          <ContextMenu
            x={shown().x}
            y={shown().y}
            items={menuItems()}
            onClose={() => setMenu(null)}
          />
        )}
      </Show>
    </section>
  );
}

// Your inbox: every thread assigned or sent to you, in your buckets, each sorted most important first. Threads the model
// hasn't got to yet wait at the top under "Sorting".
function InboxView(props: {
  inbox: Inbox;
  activeThreadId: string | null;
  unreadIds: Set<string>;
  actions: BucketActions;
  onOpenThread: (id: string) => void;
}): JSX.Element {
  const [collapsed, setCollapsed] = createSignal(savedCollapsed());
  const toggle = (bucketId: string): void => {
    const current = collapsed();
    const next = current.includes(bucketId)
      ? current.filter((id) => id !== bucketId)
      : [...current, bucketId];
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      // Not remembered; it still folds.
    }
  };
  const nothing = (): boolean => props.inbox.order.length === 0;
  const icons = createMemo(() => bucketIcons(props.inbox.buckets.map((group) => group.bucket)));
  return (
    <div class="inbox">
      <Show when={props.inbox.unsorted.length > 0}>
        <section class="bucket">
          <div class="bucket-header">
            <span class="bucket-toggle bucket-sorting">
              <span class="bucket-name">Sorting</span>
              <span class="bucket-count">{props.inbox.unsorted.length}</span>
            </span>
          </div>
          <ul class="thread-list" aria-label="Sorting">
            <For each={props.inbox.unsorted} keyed={(item) => item.thread.id}>
              {(item) => (
                <InboxRow
                  item={item()}
                  active={item().thread.id === props.activeThreadId}
                  unread={props.unreadIds.has(item().thread.id)}
                  onOpen={() => props.onOpenThread(item().thread.id)}
                />
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={nothing()}>
        <p class="conversation-empty">Nothing for you</p>
      </Show>
      <For each={props.inbox.buckets} keyed={(group) => group.bucket.id}>
        {(group, index) => (
          <BucketSection
            group={group()}
            icon={icons().get(group().bucket.id)}
            collapsed={collapsed().includes(group().bucket.id)}
            canDelete={props.inbox.buckets.length > 1}
            first={index() === 0}
            last={index() === props.inbox.buckets.length - 1}
            activeThreadId={props.activeThreadId}
            unreadIds={props.unreadIds}
            actions={props.actions}
            onToggle={() => toggle(group().bucket.id)}
            onOpenThread={props.onOpenThread}
          />
        )}
      </For>
      <button type="button" class="bucket-new" onClick={() => props.actions.onNew()}>
        <Icon icon={Add01Icon} size={12} aria-hidden="true" />
        New bucket
      </button>
    </div>
  );
}

// Sent, your outbox: every open thread you own that anyone else is on, with who's on it and when it's due. Each
// leaves when it's closed.
function Sent(props: {
  items: InboxItem[];
  activeThreadId: string | null;
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): JSX.Element {
  const openMenu = useThreadMenu();
  return (
    <ul class="thread-list" aria-label="Sent">
      <Show when={props.items.length === 0}>
        <li class="conversation-empty">Nothing out with anyone</li>
      </Show>
      <For each={props.items} keyed={(item) => item.thread.id}>
        {(item) => {
          const label = (): string =>
            [item().who, item().dueLabel].filter((part) => part != null).join(" · ");
          const open = (): void => props.onOpenThread(item().thread.id);
          return (
            <li class="thread-item">
              <div
                class="sidebar-row"
                onContextMenu={(event) => openMenu(event, item().thread)}
                data-active={String(item().thread.id === props.activeThreadId)}
                title={item().reason}
                role="button"
                tabindex={0}
                onClick={open}
                onKeyDown={(event) => activateOnKey(event, open)}
              >
                <span class="sidebar-row-icon" aria-hidden="true">
                  <Icon icon={THREAD_ICON} size={12} />
                </span>
                <span class="sidebar-row-label">{item().thread.title}</span>
                <Show when={props.unreadIds.has(item().thread.id)}>
                  <span class="unread-dot" aria-label="Unread" />
                </Show>
                <Show when={label() !== ""}>
                  <span class="sidebar-row-meta">{label()}</span>
                </Show>
              </div>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

// Your groups, everyone else's, and the labels people file things under, each with how many open threads it has. Any
// of them opens its threads in the main area.
function GroupList(props: {
  groups: GroupLists;
  labels: Label[];
  threads: Thread[];
  page: SidebarPage | null;
  onOpenLabel: (id: string) => void;
  onOpenAll: () => void;
  onNewGroup: () => void;
}): JSX.Element {
  const count = (labelId: string | null): number => threadsWithLabel(props.threads, labelId).length;
  const allCount = (): number => count(null);
  const activeLabel = (): string | undefined => {
    const page = props.page;
    return page !== null && typeof page === "object" && "label" in page ? page.label : undefined;
  };
  // `name` is an accessor, so a renamed group updates in place; its label never changes.
  const row = (labelId: string, name: () => string): JSX.Element => {
    const open = (): void => props.onOpenLabel(labelId);
    const openThreads = (): number => count(labelId);
    return (
      <li class="thread-item">
        <div
          class="sidebar-row"
          data-active={String(activeLabel() === labelId)}
          role="button"
          tabindex={0}
          onClick={open}
          onKeyDown={(event) => activateOnKey(event, open)}
        >
          <span class="sidebar-row-label">{name()}</span>
          <Show when={openThreads() > 0}>
            <span class="sidebar-row-meta">{openThreads()}</span>
          </Show>
        </div>
      </li>
    );
  };
  // As in Things, the sections stand apart by space alone; only archived groups, which aren't obvious, say what
  // they are.
  const section = (
    title: string,
    items: () => { id: string; labelId: string; name: string }[],
  ): JSX.Element => (
    <Show when={items().length > 0}>
      <section class="conversation-group">
        <h2 class="conversation-group-label">{title}</h2>
        <ul class="thread-list" aria-label={title}>
          <For each={items()} keyed={(item) => item.id}>
            {(item) =>
              row(
                untrack(() => item().labelId),
                () => item().name,
              )
            }
          </For>
        </ul>
      </section>
    </Show>
  );
  const asItems = (list: Group[]): { id: string; labelId: string; name: string }[] =>
    list.map((group) => ({ id: group.id, labelId: group.labelId, name: group.name }));
  return (
    <>
      <button type="button" class="sidebar-new-group" onClick={() => props.onNewGroup()}>
        New group
      </button>
      {/* Every thread in the organization; a group or label is this list, filtered. */}
      <ul class="thread-list" aria-label="All threads">
        <li class="thread-item">
          <div
            class="sidebar-row"
            data-active={String(props.page === "all")}
            role="button"
            tabindex={0}
            onClick={() => props.onOpenAll()}
            onKeyDown={(event) => activateOnKey(event, props.onOpenAll)}
          >
            <span class="sidebar-row-label">All threads</span>
            <Show when={allCount() > 0}>
              <span class="sidebar-row-meta">{allCount()}</span>
            </Show>
          </div>
        </li>
      </ul>
      {section("Your groups", () => asItems(props.groups.mine))}
      {section("Other groups", () => asItems(props.groups.others))}
      {section("Labels", () =>
        filterLabels(props.labels).map((label) => ({
          id: label.id,
          labelId: label.id,
          name: label.name,
        })),
      )}
      {section("Archived groups", () => asItems(props.groups.archived))}
    </>
  );
}

// Threads written in the new-message panel and kept for later, newest first. Opening one shows it in the main area,
// like a thread, to edit and send; right-click deletes it.
function Drafts(props: {
  drafts: SavedDraft[];
  activeDraftId: string | null;
  nowMs: number;
  onOpen: (draft: SavedDraft) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const [menu, setMenu] = createSignal<{ x: number; y: number; id: string } | null>(null);
  return (
    <ul class="thread-list" aria-label="Drafts">
      <Show when={props.drafts.length === 0}>
        <li class="conversation-empty">No drafts. ⌘⇧N, then ⌘S, keeps one for later</li>
      </Show>
      <For each={props.drafts} keyed={(draft) => draft.id}>
        {(draft) => {
          const title = (): string =>
            draft().draft?.title.trim() || draft().text.trim().split("\n")[0] || "Untitled draft";
          const open = (): void => props.onOpen(draft());
          return (
            <li class="thread-item">
              <div
                class="sidebar-row"
                data-active={String(draft().id === props.activeDraftId)}
                role="button"
                tabindex={0}
                title={draft().text}
                onClick={open}
                onKeyDown={(event) => activateOnKey(event, open)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ x: event.clientX, y: event.clientY, id: draft().id });
                }}
              >
                <span class="sidebar-row-icon" aria-hidden="true">
                  <Icon icon={NoteEditIcon} size={12} />
                </span>
                <span class="sidebar-row-label">{title()}</span>
                <span class="sidebar-row-meta">
                  {formatRelativeTime(draft().savedAtMs, props.nowMs)}
                </span>
              </div>
            </li>
          );
        }}
      </For>
      <Show when={menu()}>
        {(shown) => (
          <ContextMenu
            x={shown().x}
            y={shown().y}
            items={[{ label: "Delete draft", run: () => props.onDelete(shown().id) }]}
            onClose={() => setMenu(null)}
          />
        )}
      </Show>
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
function SidebarTabs(props: {
  tab: SidebarTab;
  inboxCount: number;
  sentCount: number;
  draftCount: number;
  profileOpen: boolean;
  onTab: (tab: SidebarTab) => void;
  onToggleProfile: () => void;
}): JSX.Element {
  const me = useMe();
  const counts = (): Record<SidebarTab, number> => ({
    inbox: props.inboxCount,
    sent: props.sentCount,
    drafts: props.draftCount,
    groups: 0,
  });
  // Each name's own width, so the chosen tab grows to exactly fit it (animating to a guessed maximum finishes early
  // and looks rushed).
  let group!: HTMLDivElement;
  createEffect(
    () => props.tab,
    () => {
      for (const label of group.querySelectorAll<HTMLElement>(".sidebar-tab-label"))
        label.style.setProperty("--label-width", `${label.scrollWidth}px`);
    },
  );

  return (
    <div class="sidebar-tabs">
      <div ref={group} class="sidebar-tab-group" role="tablist" aria-label="Sidebar">
        <For each={TABS}>
          {({ tab: value, label, icon }) => (
            <button
              type="button"
              role="tab"
              class="sidebar-tab"
              aria-selected={props.tab === value ? "true" : "false"}
              aria-label={label}
              title={label}
              onClick={() => props.onTab(value)}
            >
              <Icon icon={icon} {...ICON_PROPS} />
              <span class="sidebar-tab-label" aria-hidden="true">
                {label}
              </span>
              <Show when={counts()[value] > 0}>
                <span class="sidebar-tab-count">{counts()[value]}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <button
        type="button"
        class="sidebar-tab sidebar-tab-end"
        aria-pressed={props.profileOpen ? "true" : "false"}
        aria-label="Your profile and organization"
        title="Your profile and organization"
        onClick={() => props.onToggleProfile()}
      >
        <Identicon seed={me().id} size={14} />
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

export function Sidebar(props: {
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
}): JSX.Element {
  const me = useMe();
  const panel = useResizablePanel({
    storageKey: "sidebar-width",
    defaultWidth: 268,
    minWidth: 210,
    maxWidth: 400,
    edge: "right",
  });
  const [tab, setTab] = createSignal<SidebarTab>(savedTab());
  const chooseTab = (next: SidebarTab): void => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Not remembered this time; the tab still switches.
    }
  };

  return (
    <aside ref={panel.ref} class="sidebar" style={{ width: `${panel.width()}px` }}>
      <div class="topbar sidebar-topbar">
        <SidebarToggle open onToggle={props.onToggle} />
        <SearchButton onSearch={props.onSearch} />
        <span class="topbar-end">
          <NotificationsButton
            items={props.activity}
            groupNotices={props.groupNotices}
            onOpenGroup={(id) => {
              const group = [
                ...props.groups.mine,
                ...props.groups.others,
                ...props.groups.archived,
              ].find((candidate) => candidate.id === id);
              if (group !== undefined) props.onOpenLabel(group.labelId);
            }}
            nowMs={props.nowMs}
            activeThreadId={props.activeThreadId}
            onOpenThread={props.onOpenThread}
            onMarkAllRead={props.onMarkAllRead}
          />
          <button
            type="button"
            class="topbar-button"
            aria-label="New thread"
            onClick={() => props.onNewThread()}
          >
            <Icon icon={PencilEdit02Icon} {...ICON_PROPS} />
          </button>
        </span>
      </div>
      <SidebarTabs
        tab={tab()}
        inboxCount={props.inbox.order.length}
        sentCount={props.inbox.sent.length}
        draftCount={props.drafts.length}
        profileOpen={props.profileOpen}
        onTab={chooseTab}
        onToggleProfile={props.onToggleProfile}
      />
      <div class="sidebar-content">
        <Show when={tab() === "inbox"}>
          <InboxView
            inbox={props.inbox}
            activeThreadId={props.activeThreadId}
            unreadIds={props.unreadIds}
            actions={props.bucketActions}
            onOpenThread={props.onOpenThread}
          />
        </Show>
        <Show when={tab() === "groups"}>
          <GroupList
            groups={props.groups}
            labels={props.labels}
            threads={props.threads}
            page={props.page}
            onOpenLabel={props.onOpenLabel}
            onOpenAll={() => props.onOpenPage("all")}
            onNewGroup={props.onNewGroup}
          />
        </Show>
        <Show when={tab() === "drafts"}>
          <Drafts
            drafts={props.drafts}
            activeDraftId={props.activeDraftId}
            nowMs={props.nowMs}
            onOpen={props.onOpenDraft}
            onDelete={props.onDeleteDraft}
          />
        </Show>
        <Show when={tab() === "sent"}>
          <Sent
            items={props.inbox.sent}
            activeThreadId={props.activeThreadId}
            unreadIds={props.unreadIds}
            onOpenThread={props.onOpenThread}
          />
        </Show>
      </div>
      {/* As in Delta: you, at the bottom. It opens settings. */}
      <button
        type="button"
        class="sidebar-footer"
        aria-current={props.page === "settings" ? "page" : undefined}
        onClick={() => props.onOpenPage("settings")}
      >
        <Identicon seed={me().id} size={16} />
        <span class="sidebar-footer-name">{me().name}</span>
      </button>
      {panel.handle}
    </aside>
  );
}
