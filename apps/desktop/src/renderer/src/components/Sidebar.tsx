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
import type { BucketGroup, InboxItem } from "../inbox";
import { useApp } from "../app/state";
import { Icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { lastSentTo, plainThreadLinks, type Bucket, type Group, type Thread } from "model";
import { filterLabels, groupsFor, threadsWithLabel } from "../groups";
import { bucketIcons } from "../bucketIcons";
import { THREAD_ICON } from "../threadIcon";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { formatRelativeTime } from "../format";
import { NotificationsButton } from "./Notifications";
import * as stylex from "@stylexjs/stylex";
import { status, topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, sidebarSpace } from "../styles/tokens.stylex";

// How far everything in the sidebar sits from its edges, so icons, times and lines all line up. Rows' hover and
// selected fills are pills `rowGutter` in from the edges, rounded like the tab buttons; their content stays on the inset.
const INSET = sidebarSpace.inset;
const GUTTER = sidebarSpace.rowGutter;
// The inset, measured from inside a row's pill.
const INSIDE_PILL = `calc(${INSET} - ${GUTTER})`;
// Clipped text fades out over its last 24px instead of using an ellipsis (`overflowFade` marks it). Attribute
// conditions are written as `:is([…])`, which StyleX's types accept as a pseudo-class.
const FADE_RIGHT = {
  default: null,
  ":is([data-overflowing])": "linear-gradient(to right, #000 calc(100% - 24px), transparent)",
} as const;

const styles = stylex.create({
  // Delta's compact sidebar: width set inline (268px default), glass colors from Cursor Dark.
  sidebar: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minWidth: 0,
    height: "100%",
    backgroundColor: colors.sidebarSolid,
    // StyleX takes no border shorthands: each part on its own.
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
  },
  // The toggle icon sits as far from the last traffic light (larger on macOS 26) as the top bar's last icon sits from
  // the sidebar's right edge, the sidebar inset.
  topbar: {
    paddingLeft: "71.5px",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    padding: 0,
    listStyle: "none",
  },
  item: {
    minWidth: 0,
    listStyle: "none",
  },
  // Rows: 28px, labels at 31px, filled as an inset pill on hover and when selected.
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    height: "28px",
    margin: `0 ${GUTTER}`,
    padding: `0 ${INSIDE_PILL} 0 calc(31px - ${GUTTER})`,
    borderRadius: sidebarSpace.rowRadius,
    color: colors.textPrimary,
    cursor: "pointer",
    outline: "none",
    backgroundColor: { default: null, ":hover": colors.bgQuaternary },
  },
  rowActive: {
    backgroundColor: colors.bgTertiary,
  },
  rowLabel: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    maskImage: FADE_RIGHT,
  },
  // Unread: a dot after the title, plus a medium-weight title.
  rowLabelUnread: {
    fontWeight: 500,
  },
  // A plain sidebar list row (Sent, Drafts): icon, title, and who and when on the right.
  rowIcon: {
    position: "absolute",
    top: "50%",
    left: `calc(12px - ${GUTTER})`,
    display: "flex",
    color: colors.iconTertiary,
    transform: "translateY(-50%)",
  },
  rowMeta: {
    flexShrink: 0,
    marginLeft: "auto",
    paddingLeft: "8px",
    color: colors.textTertiary,
    fontSize: "12px",
    whiteSpace: "nowrap",
  },

  // The sidebar's tabs, under the top bar, as in Notion: the chosen one opens out to show its name in a soft pill, the
  // others are just their icon and get a lighter fill on hover.
  tabs: {
    display: "flex",
    flexShrink: 0,
    gap: "2px",
    alignItems: "center",
    // The tabs' icons sit 6px inside their buttons, so they land on the inset, under the new-thread button.
    padding: `4px calc(${INSET} - 6px) 6px`,
  },
  tabGroup: {
    display: "flex",
    gap: "2px",
  },
  tab: {
    display: "flex",
    alignItems: "center",
    height: "24px",
    minWidth: "26px",
    padding: "0 6px",
    borderStyle: "none",
    borderRadius: "6px",
    color: colors.iconTertiary,
    font: "inherit",
    fontSize: "12px",
    backgroundColor: { default: "transparent", ":hover": colors.bgQuaternary },
    cursor: "pointer",
  },
  // The pill and the bright colour switch at once; only the width moves.
  tabOn: {
    color: colors.textPrimary,
    backgroundColor: colors.bgTertiary,
  },
  // The name is uncovered as the chosen tab grows to its measured width (`--label-width`), and cut off as the old one
  // shrinks: no fade, slow at both ends and quickest in the middle.
  tabLabel: {
    width: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    transitionProperty: {
      default: "width, margin-left",
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    transitionDuration: "280ms",
    transitionTimingFunction: "cubic-bezier(0.45, 0, 0.25, 1)",
  },
  tabLabelShown: {
    width: "var(--label-width, auto)",
    marginLeft: "6px",
  },
  tabCount: {
    marginLeft: "4px",
    color: colors.textSecondary,
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
  },
  tabEnd: {
    marginLeft: "auto",
  },

  // The sidebar's bottom row, as in Delta: as tall as the top bar, your avatar and name.
  footer: {
    display: "flex",
    flexShrink: 0,
    gap: "8px",
    alignItems: "center",
    height: "34px",
    padding: `0 ${INSET}`,
    borderStyle: "none",
    color: colors.textPrimary,
    font: "inherit",
    textAlign: "left",
    backgroundColor: { default: "transparent", ":hover": colors.bgQuaternary },
    cursor: "pointer",
  },
  avatar: {
    flexShrink: 0,
  },
  footerName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  // The Groups tab's sections stand apart by space alone.
  groupSectionAfter: {
    marginTop: "8px",
  },
  groupLabel: {
    margin: 0,
    padding: `6px ${INSET} 4px`,
    color: colors.textTertiary,
    fontSize: "11px",
    fontWeight: 500,
  },
  // Lined up with the group label above it.
  empty: {
    margin: 0,
    padding: `4px ${INSET} 6px`,
    color: colors.textTertiary,
  },
  newGroup: {
    display: "block",
    padding: `6px ${INSET}`,
    borderStyle: "none",
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    font: "inherit",
    textAlign: "left",
    backgroundColor: "transparent",
    cursor: "pointer",
  },

  // The inbox: your buckets in order, each a quiet header (name and count, which folds it) over its threads. A bucket
  // lights up while a thread is dragged over it.
  inbox: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    paddingBottom: "12px",
  },
  bucket: {
    margin: `0 ${GUTTER}`,
    borderRadius: sidebarSpace.rowRadius,
    transitionProperty: "background-color",
    transitionDuration: "120ms",
    transitionTimingFunction: "ease",
  },
  // Buckets stand apart, so a bucket's faded last row doesn't run into the next one's name; folded ones sit closer.
  bucketAfterThreads: {
    marginTop: "12px",
  },
  bucketDropping: {
    backgroundColor: colors.bgQuaternary,
  },
  // A bucket's name stays at the top of the sidebar while you scroll through its threads, until the next one's takes
  // its place.
  bucketHeader: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    backgroundColor: colors.sidebarSolid,
    display: "flex",
    alignItems: "center",
    height: "26px",
    // The fold arrow ends on the inset, under the new-thread button; right-click has the bucket's options.
    padding: `0 ${INSIDE_PILL} 0 0`,
  },
  bucketToggle: {
    display: "flex",
    flex: 1,
    gap: "6px",
    alignItems: "center",
    minWidth: 0,
    height: "100%",
    // Its icon lines up with the tabs' icons above, on the sidebar inset.
    paddingBlock: 0,
    paddingRight: 0,
    paddingLeft: INSIDE_PILL,
    borderStyle: "none",
    color: { default: colors.textTertiary, ":hover": colors.textSecondary },
    font: "inherit",
    fontSize: "11px",
    fontWeight: 500,
    textAlign: "left",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  // Sorting isn't a bucket you fold: no icon or arrow, its name where the others' are.
  bucketSorting: {
    paddingLeft: `calc(${INSIDE_PILL} + 20px)`,
    color: colors.textTertiary,
    cursor: "default",
  },
  bucketEmpty: {
    opacity: 0.6,
  },
  // The fold arrow sits at the right end, beside the bucket's options.
  bucketChevron: {
    flexShrink: 0,
    marginLeft: "auto",
    transitionProperty: "transform",
    transitionDuration: "120ms",
    transitionTimingFunction: "ease",
  },
  bucketChevronOpen: {
    transform: "rotate(90deg)",
  },
  // Each bucket's own icon, in its own colour (`bucketLooks`).
  bucketIcon: {
    flexShrink: 0,
  },
  bucketName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  bucketCount: {
    color: colors.textTertiary,
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
  },
  // "6 more" under a bucket's last showing row, in line with the titles, opening the rest in place; "Show less" folds
  // them back.
  moreRows: {
    display: "block",
    margin: "2px 0 0",
    padding: `2px calc(${INSIDE_PILL} + 24px)`,
    borderStyle: "none",
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    font: "inherit",
    fontSize: "11px",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  // A bucket shows its first few threads (`BUCKET_ROWS`) and scrolls the rest, fading out at an end with more past it
  // (`rowCap` marks the ends).
  bucketThreads: {
    overflowY: "auto",
    scrollbarWidth: "none",
    overscrollBehavior: "contain",
    maskImage: {
      default: null,
      ":is([data-more-below])": "linear-gradient(to bottom, #000 calc(100% - 32px), transparent)",
      ":is([data-more-above])": "linear-gradient(to bottom, transparent, #000 32px)",
      ":is([data-more-above][data-more-below])":
        "linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 32px), transparent)",
    },
  },
  // One thread: who it's from beside its title and due date, and under them why it's here.
  inboxRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    padding: `5px ${INSIDE_PILL}`,
    borderRadius: sidebarSpace.rowRadius,
    cursor: "pointer",
    outline: "none",
    backgroundColor: { default: null, ":hover": colors.bgQuaternary },
  },
  // Blocked threads wait at the bottom of their bucket, dimmed: nothing to do on them yet.
  inboxRowBlocked: {
    opacity: 0.6,
  },
  inboxRowBody: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
  },
  inboxRowTop: {
    display: "flex",
    gap: "4px",
    alignItems: "center",
    minWidth: 0,
  },
  inboxRowTitle: {
    minWidth: 0,
    overflow: "hidden",
    color: colors.textPrimary,
    lineHeight: "18px",
    whiteSpace: "nowrap",
    maskImage: FADE_RIGHT,
  },
  // Unread is the bold title alone: a dot on every row of a busy inbox stops meaning anything.
  inboxRowTitleUnread: {
    fontWeight: 600,
  },
  inboxRowDue: {
    flexShrink: 0,
    marginLeft: "auto",
    paddingLeft: "8px",
    color: colors.textTertiary,
    fontSize: "11px",
    whiteSpace: "nowrap",
  },
  inboxRowWhy: {
    overflow: "hidden",
    color: colors.textTertiary,
    fontSize: "11px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // A new bucket, as one quiet line under the last.
  bucketNew: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    alignSelf: "flex-start",
    margin: "2px 0 0",
    padding: `2px ${INSET}`,
    borderStyle: "none",
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    font: "inherit",
    fontSize: "11px",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
});

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
export function SidebarToggle(): JSX.Element {
  const app = useApp();
  const open = (): boolean => app.ui.sidebarOpen();
  return (
    <button
      type="button"
      class={sx(topbar.button)}
      aria-label={open() ? "Hide sidebar" : "Show sidebar"}
      aria-pressed={open() ? "true" : "false"}
      onClick={() => app.ui.toggleSidebar()}
    >
      <Icon icon={open() ? PANEL_LEFT_OPEN : PanelLeftIcon} {...ICON_PROPS} />
    </button>
  );
}

// The same for the details panel on the right.
export function DetailsToggle(): JSX.Element {
  const app = useApp();
  const open = (): boolean => app.ui.detailsOpen();
  return (
    <button
      type="button"
      class={sx(topbar.button)}
      aria-label={open() ? "Hide details" : "Show details"}
      aria-pressed={open() ? "true" : "false"}
      onClick={() => app.ui.toggleDetails()}
    >
      <Icon icon={open() ? PANEL_RIGHT_OPEN : PanelRightIcon} {...ICON_PROPS} />
    </button>
  );
}

export function SearchButton(): JSX.Element {
  const app = useApp();
  return (
    <button
      type="button"
      class={sx(topbar.button)}
      aria-label="Search"
      onClick={() => app.ui.setSearchOpen(true)}
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
function InboxRow(props: { item: InboxItem }): JSX.Element {
  const app = useApp();
  const thread = (): Thread => props.item.thread;
  const active = (): boolean => app.nav.activeThreadId() === thread().id;
  const unread = (): boolean => app.inbox.unreadIds().has(thread().id);
  const open = (): void => app.nav.openThread(thread().id);
  const titleRef = overflowFade<HTMLSpanElement>();
  // The open thread stays in view in its bucket, as J and K move past the rows showing.
  let row!: HTMLDivElement;
  createEffect(active, (isActive) => {
    if (isActive) row.scrollIntoView({ block: "nearest" });
  });
  const why = (): string => {
    const sorted = thread().triage[app.me().id];
    return sorted?.manual ? "Placed here by you" : (sorted?.reason ?? "");
  };
  const line = (): string => {
    const latest = props.item.why === "sent" ? lastSentTo(thread(), app.me().id) : undefined;
    return latest === undefined
      ? props.item.reason
      : `${latest.author.name.split(" ")[0]}: ${plainThreadLinks(latest.text, app.links.titleOf, app.links.nameOf)}`;
  };
  return (
    <li class={sx(styles.item)}>
      <div
        ref={row}
        class={[
          sx(
            styles.inboxRow,
            active() && styles.rowActive,
            thread().status === "blocked" && !active() && styles.inboxRowBlocked,
          ),
          "inbox-row",
        ]}
        draggable="true"
        onDragStart={(event) => {
          event.dataTransfer?.setData(DRAG_TYPE, thread().id);
          if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={(event) => app.threads.openMenu(event, thread())}
        data-active={String(active())}
        data-unread={String(unread())}
        data-blocked={String(thread().status === "blocked")}
        title={why()}
        role="button"
        tabindex={0}
        onClick={open}
        onKeyDown={(event) => activateOnKey(event, open)}
      >
        <Identicon seed={props.item.from.id} size={16} class={sx(styles.avatar)} />
        <span class={sx(styles.inboxRowBody)}>
          <span class={sx(styles.inboxRowTop)}>
            <span
              ref={titleRef}
              class={sx(styles.inboxRowTitle, unread() && styles.inboxRowTitleUnread)}
            >
              {thread().title}
            </span>
            <Show when={props.item.dueLabel !== null}>
              <span class={sx(styles.inboxRowDue)}>{props.item.dueLabel}</span>
            </Show>
          </span>
          <span class={sx(styles.inboxRowWhy)}>{line()}</span>
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
function BucketThreads(props: { label: string; items: InboxItem[]; rows: number }): JSX.Element {
  const listRef = rowCap(
    () => props.rows,
    () => props.items,
  );
  return (
    <ul
      ref={listRef}
      class={[sx(styles.list, styles.bucketThreads), "thread-list", "bucket-threads"]}
      aria-label={props.label}
    >
      <For each={props.items} keyed={(item) => item.thread.id}>
        {(item) => <InboxRow item={item()} />}
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
  // Whether the bucket above it shows its threads, which sets this one further apart.
  afterThreads: boolean;
  onToggle: () => void;
}): JSX.Element {
  const actions = useApp().buckets.actions;
  const bucket = (): Bucket => props.group.bucket;
  const items = (): InboxItem[] => props.group.items;
  // A bucket shows its first few threads until you ask for the rest ("6 more").
  const [expanded, setExpanded] = createSignal(false);
  const hidden = (): number => items().length - BUCKET_ROWS;
  const [dropping, setDropping] = createSignal(false);
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null);
  const menuItems = (): ContextMenuItem[] => [
    { label: "Edit bucket…", run: () => actions.onEdit(bucket()) },
    { label: "New bucket…", run: actions.onNew },
    "separator",
    ...(props.first ? [] : [{ label: "Move up", run: () => actions.onMove(bucket().id, -1) }]),
    ...(props.last ? [] : [{ label: "Move down", run: () => actions.onMove(bucket().id, 1) }]),
    ...(props.canDelete
      ? ([
          "separator",
          { label: "Delete bucket", run: () => actions.onDelete(bucket().id) },
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
      class={[
        sx(
          styles.bucket,
          props.afterThreads && styles.bucketAfterThreads,
          dropping() && styles.bucketDropping,
        ),
        "bucket",
      ]}
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
          actions.onPlace(threadId, bucket().id);
      }}
    >
      <div class={sx(styles.bucketHeader)} onContextMenu={openMenu}>
        <button
          type="button"
          class={[
            sx(styles.bucketToggle, items().length === 0 && styles.bucketEmpty),
            "bucket-toggle",
          ]}
          aria-expanded={!props.collapsed ? "true" : "false"}
          title={bucket().description}
          onClick={() => props.onToggle()}
        >
          <Icon
            icon={props.icon ?? InboxIcon}
            size={14}
            class={sx(styles.bucketIcon)}
            aria-hidden="true"
          />
          <span class={sx(styles.bucketName)}>{bucket().name}</span>
          <Show when={items().length > 0}>
            <span class={sx(styles.bucketCount)}>{items().length}</span>
          </Show>
          <Icon
            icon={ArrowRight01Icon}
            size={10}
            class={sx(styles.bucketChevron, !props.collapsed && styles.bucketChevronOpen)}
            aria-hidden="true"
          />
        </button>
      </div>
      <Show when={!props.collapsed && items().length > 0}>
        <BucketThreads
          label={bucket().name}
          items={items()}
          rows={expanded() ? items().length : BUCKET_ROWS}
        />
      </Show>
      <Show when={!props.collapsed && hidden() > 0}>
        <button
          type="button"
          class={[sx(styles.moreRows), "bucket-more-rows"]}
          onClick={() => setExpanded(!expanded())}
        >
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
function InboxView(): JSX.Element {
  const app = useApp();
  const inbox = app.inbox.view;
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
  const nothing = (): boolean => inbox().order.length === 0;
  const icons = createMemo(() => bucketIcons(inbox().buckets.map((group) => group.bucket)));
  // A bucket that's open with threads in it; the one under it sits further apart.
  const showsThreads = (group: BucketGroup | undefined): boolean =>
    group !== undefined && group.items.length > 0 && !collapsed().includes(group.bucket.id);
  return (
    <div class={[sx(styles.inbox), "inbox"]}>
      <Show when={inbox().unsorted.length > 0}>
        <section class={[sx(styles.bucket), "bucket"]}>
          <div class={sx(styles.bucketHeader)}>
            <span class={[sx(styles.bucketToggle, styles.bucketSorting), "bucket-toggle"]}>
              <span class={sx(styles.bucketName)}>Sorting</span>
              <span class={sx(styles.bucketCount)}>{inbox().unsorted.length}</span>
            </span>
          </div>
          <ul class={[sx(styles.list), "thread-list"]} aria-label="Sorting">
            <For each={inbox().unsorted} keyed={(item) => item.thread.id}>
              {(item) => <InboxRow item={item()} />}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={nothing()}>
        <p class={sx(styles.empty)}>Nothing for you</p>
      </Show>
      <For each={inbox().buckets} keyed={(group) => group.bucket.id}>
        {(group, index) => (
          <BucketSection
            group={group()}
            icon={icons().get(group().bucket.id)}
            collapsed={collapsed().includes(group().bucket.id)}
            canDelete={inbox().buckets.length > 1}
            first={index() === 0}
            last={index() === inbox().buckets.length - 1}
            afterThreads={showsThreads(inbox().buckets[index() - 1])}
            onToggle={() => toggle(group().bucket.id)}
          />
        )}
      </For>
      <button
        type="button"
        class={sx(styles.bucketNew)}
        onClick={() => app.buckets.actions.onNew()}
      >
        <Icon icon={Add01Icon} size={12} aria-hidden="true" />
        New bucket
      </button>
    </div>
  );
}

// Sent, your outbox: every open thread you own that anyone else is on, with who's on it and when it's due. Each
// leaves when it's closed.
function Sent(): JSX.Element {
  const app = useApp();
  const items = (): InboxItem[] => app.inbox.view().sent;
  return (
    <ul class={[sx(styles.list), "thread-list"]} aria-label="Sent">
      <Show when={items().length === 0}>
        <li class={sx(styles.empty)}>Nothing out with anyone</li>
      </Show>
      <For each={items()} keyed={(item) => item.thread.id}>
        {(item) => {
          const label = (): string =>
            [item().who, item().dueLabel].filter((part) => part != null).join(" · ");
          const open = (): void => app.nav.openThread(item().thread.id);
          const active = (): boolean => item().thread.id === app.nav.activeThreadId();
          const unread = (): boolean => app.inbox.unreadIds().has(item().thread.id);
          return (
            <li class={sx(styles.item)}>
              <div
                class={[sx(styles.row, active() && styles.rowActive), "sidebar-row"]}
                onContextMenu={(event) => app.threads.openMenu(event, item().thread)}
                data-active={String(active())}
                title={item().reason}
                role="button"
                tabindex={0}
                onClick={open}
                onKeyDown={(event) => activateOnKey(event, open)}
              >
                <span class={sx(styles.rowIcon)} aria-hidden="true">
                  <Icon icon={THREAD_ICON} size={12} />
                </span>
                <span class={sx(styles.rowLabel, unread() && styles.rowLabelUnread)}>
                  {item().thread.title}
                </span>
                <Show when={unread()}>
                  <span class={sx(status.unread)} aria-label="Unread" />
                </Show>
                <Show when={label() !== ""}>
                  <span class={sx(styles.rowMeta)}>{label()}</span>
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
function GroupList(): JSX.Element {
  const app = useApp();
  const groups = createMemo(() => groupsFor(app.data.groups(), app.me()));
  const count = (labelId: string | null): number =>
    threadsWithLabel(app.data.threads(), labelId).length;
  const allCount = (): number => count(null);
  const openAll = (): void => app.nav.openPage("all");
  const activeLabel = (): string | undefined => {
    const page = app.nav.page();
    return page !== null && typeof page === "object" && "label" in page ? page.label : undefined;
  };
  // `name` is an accessor, so a renamed group updates in place; its label never changes.
  const row = (labelId: string, name: () => string): JSX.Element => {
    const open = (): void => app.nav.openLabel(labelId);
    const openThreads = (): number => count(labelId);
    return (
      <li class={sx(styles.item)}>
        <div
          class={[sx(styles.row, activeLabel() === labelId && styles.rowActive), "sidebar-row"]}
          data-active={String(activeLabel() === labelId)}
          role="button"
          tabindex={0}
          onClick={open}
          onKeyDown={(event) => activateOnKey(event, open)}
        >
          <span class={sx(styles.rowLabel)}>{name()}</span>
          <Show when={openThreads() > 0}>
            <span class={sx(styles.rowMeta)}>{openThreads()}</span>
          </Show>
        </div>
      </li>
    );
  };
  // As in Things, the sections stand apart by space alone; only archived groups, which aren't obvious, say what
  // they are.
  // `spaced` is whether a section shows above this one.
  const section = (
    title: string,
    items: () => { id: string; labelId: string; name: string }[],
    spaced: () => boolean,
  ): JSX.Element => (
    <Show when={items().length > 0}>
      <section class={[sx(spaced() && styles.groupSectionAfter), "conversation-group"]}>
        <h2 class={sx(styles.groupLabel)}>{title}</h2>
        <ul class={[sx(styles.list), "thread-list"]} aria-label={title}>
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
  const sections: [string, () => { id: string; labelId: string; name: string }[]][] = [
    ["Your groups", () => asItems(groups().mine)],
    ["Other groups", () => asItems(groups().others)],
    [
      "Labels",
      () =>
        filterLabels(app.data.labels()).map((label) => ({
          id: label.id,
          labelId: label.id,
          name: label.name,
        })),
    ],
    ["Archived groups", () => asItems(groups().archived)],
  ];
  const sectionViews = sections.map(([title, items], index) =>
    section(title, items, () =>
      sections.slice(0, index).some(([, earlier]) => earlier().length > 0),
    ),
  );
  return (
    <>
      <button
        type="button"
        class={sx(styles.newGroup)}
        onClick={() => app.ui.setNewGroupOpen(true)}
      >
        New group
      </button>
      {/* Every thread in the organization; a group or label is this list, filtered. */}
      <ul class={[sx(styles.list), "thread-list"]} aria-label="All threads">
        <li class={sx(styles.item)}>
          <div
            class={[sx(styles.row, app.nav.page() === "all" && styles.rowActive), "sidebar-row"]}
            data-active={String(app.nav.page() === "all")}
            role="button"
            tabindex={0}
            onClick={openAll}
            onKeyDown={(event) => activateOnKey(event, openAll)}
          >
            <span class={sx(styles.rowLabel)}>All threads</span>
            <Show when={allCount() > 0}>
              <span class={sx(styles.rowMeta)}>{allCount()}</span>
            </Show>
          </div>
        </li>
      </ul>
      {sectionViews}
    </>
  );
}

// Threads written in the new-message panel and kept for later, newest first. Opening one shows it in the main area,
// like a thread, to edit and send; right-click deletes it.
function Drafts(): JSX.Element {
  const app = useApp();
  const activeDraftId = (): string | undefined => app.nav.shownDraft()?.id;
  const [menu, setMenu] = createSignal<{ x: number; y: number; id: string } | null>(null);
  return (
    <ul class={[sx(styles.list), "thread-list"]} aria-label="Drafts">
      <Show when={app.drafts.list().length === 0}>
        <li class={sx(styles.empty)}>No drafts. ⌘⇧N, then ⌘S, keeps one for later</li>
      </Show>
      <For each={app.drafts.list()} keyed={(draft) => draft.id}>
        {(draft) => {
          const title = (): string =>
            draft().draft?.title.trim() || draft().text.trim().split("\n")[0] || "Untitled draft";
          const open = (): void => app.nav.openDraft(draft());
          return (
            <li class={sx(styles.item)}>
              <div
                class={[
                  sx(styles.row, draft().id === activeDraftId() && styles.rowActive),
                  "sidebar-row",
                ]}
                data-active={String(draft().id === activeDraftId())}
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
                <span class={sx(styles.rowIcon)} aria-hidden="true">
                  <Icon icon={NoteEditIcon} size={12} />
                </span>
                <span class={sx(styles.rowLabel)}>{title()}</span>
                <span class={sx(styles.rowMeta)}>
                  {formatRelativeTime(draft().savedAtMs, app.now())}
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
            items={[{ label: "Delete draft", run: () => app.drafts.remove(shown().id) }]}
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
function SidebarTabs(props: { tab: SidebarTab; onTab: (tab: SidebarTab) => void }): JSX.Element {
  const app = useApp();
  const counts = (): Record<SidebarTab, number> => ({
    inbox: app.inbox.view().order.length,
    sent: app.inbox.view().sent.length,
    drafts: app.drafts.list().length,
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
    <div class={sx(styles.tabs)}>
      <div ref={group} class={sx(styles.tabGroup)} role="tablist" aria-label="Sidebar">
        <For each={TABS}>
          {({ tab: value, label, icon }) => (
            <button
              type="button"
              role="tab"
              class={[sx(styles.tab, props.tab === value && styles.tabOn), "sidebar-tab"]}
              aria-selected={props.tab === value ? "true" : "false"}
              aria-label={label}
              title={label}
              onClick={() => props.onTab(value)}
            >
              <Icon icon={icon} {...ICON_PROPS} />
              <span
                class={[
                  sx(styles.tabLabel, props.tab === value && styles.tabLabelShown),
                  "sidebar-tab-label",
                ]}
                aria-hidden="true"
              >
                {label}
              </span>
              <Show when={counts()[value] > 0}>
                <span class={sx(styles.tabCount)}>{counts()[value]}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <button
        type="button"
        class={[
          sx(styles.tab, styles.tabEnd, app.nav.profileOpen() && styles.tabOn),
          "sidebar-tab",
        ]}
        aria-pressed={app.nav.profileOpen() ? "true" : "false"}
        aria-label="Your profile and organization"
        title="Your profile and organization"
        onClick={() => app.nav.toggleProfile()}
      >
        <Identicon seed={app.me().id} size={14} />
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

// The sidebar: its top bar, the tabs, the chosen tab's list, and you at the bottom.
export function Sidebar(): JSX.Element {
  const app = useApp();
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
    <aside
      ref={panel.ref}
      class={[sx(styles.sidebar), "sidebar"]}
      style={{ width: `${panel.width()}px` }}
    >
      <div class={[sx(topbar.bar, styles.topbar), "sidebar-topbar"]}>
        <SidebarToggle />
        <SearchButton />
        <span class={sx(topbar.end)}>
          <NotificationsButton />
          <button
            type="button"
            class={sx(topbar.button)}
            aria-label="New thread"
            onClick={() => app.ui.openNewThread()}
          >
            <Icon icon={PencilEdit02Icon} {...ICON_PROPS} />
          </button>
        </span>
      </div>
      <SidebarTabs tab={tab()} onTab={chooseTab} />
      <div class={[sx(styles.content), "sidebar-content"]}>
        <Show when={tab() === "inbox"}>
          <InboxView />
        </Show>
        <Show when={tab() === "groups"}>
          <GroupList />
        </Show>
        <Show when={tab() === "drafts"}>
          <Drafts />
        </Show>
        <Show when={tab() === "sent"}>
          <Sent />
        </Show>
      </div>
      {/* As in Delta: you, at the bottom. It opens settings. */}
      <button
        type="button"
        class={sx(styles.footer)}
        aria-current={app.nav.page() === "settings" ? "page" : undefined}
        onClick={() => app.nav.openPage("settings")}
      >
        <Identicon seed={app.me().id} size={16} class={sx(styles.avatar)} />
        <span class={sx(styles.footerName)}>{app.me().name}</span>
      </button>
      {panel.handle}
    </aside>
  );
}
