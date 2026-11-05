import * as i from "@hugeicons/core-free-icons";
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { lastSentTo, plainThreadLinks, type Bucket } from "model";
import { useApp } from "../app/state";
import { bucketIcons } from "../bucketIcons";
import { formatRelativeTime } from "../format";
import { filterLabels, groupsFor, threadsWithLabel } from "../groups";
import type { BucketGroup, InboxItem } from "../inbox";
import { status, topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, sidebarSpace } from "../styles/tokens.stylex";
import { THREAD_ICON } from "../threadIcon";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { NotificationsButton } from "./Notifications";
import { SidePanel, store, stored } from "./SidePanel";

// Rows' fills are pills `GUTTER` in from the edges; their content stays on the sidebar's inset.
const INSET = sidebarSpace.inset;
const GUTTER = sidebarSpace.rowGutter;
const RADIUS = sidebarSpace.rowRadius;
const PILL = `calc(${INSET} - ${GUTTER})`;
const FADE = "linear-gradient(to right, #000 calc(100% - 24px), transparent)";
const center = { display: "flex", alignItems: "center" } as const;
const column = { display: "flex", flexDirection: "column" } as const;
const quiet = { borderStyle: "none", font: "inherit", backgroundColor: "transparent" } as const;
const clip = { minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" } as const;
const hoverBg = { default: "transparent", ":hover": colors.bgQuaternary } as const;
const dim = { default: colors.textTertiary, ":hover": colors.textPrimary } as const;

const s = stylex.create({
  topbar: { paddingLeft: 71.5 },
  content: { ...column, flexGrow: 1, minHeight: 0, overflowY: "auto" },
  list: { ...column, padding: 0, listStyle: "none" },
  item: { minWidth: 0, listStyle: "none" },
  pointer: { cursor: "pointer" },
  row: { ...center, position: "relative", gap: 4, height: 28, margin: `0 ${GUTTER}` },
  rowPad: { padding: `0 ${PILL} 0 calc(31px - ${GUTTER})`, borderRadius: RADIUS },
  rowLook: { color: colors.textPrimary, outline: "none", backgroundColor: hoverBg },
  active: { backgroundColor: colors.bgTertiary },
  label: { ...clip, maskImage: { default: null, ":is([data-overflowing])": FADE } },
  medium: { fontWeight: 500 },
  rowIcon: { position: "absolute", top: "50%", left: `calc(12px - ${GUTTER})`, display: "flex" },
  rowIconLook: { color: colors.iconTertiary, transform: "translateY(-50%)" },
  meta: { flexShrink: 0, marginLeft: "auto", paddingLeft: 8, whiteSpace: "nowrap", fontSize: 12 },
  faint: { color: colors.textTertiary },
  small: { fontSize: 11 },
  tabs: { ...center, flexShrink: 0, gap: 2, padding: `4px calc(${INSET} - 6px) 6px` },
  tabGroup: { display: "flex", gap: 2 },
  tab: { ...center, ...quiet, height: 24, minWidth: 26, padding: "0 6px", borderRadius: 6 },
  tabLook: { color: colors.iconTertiary, fontSize: 12, backgroundColor: hoverBg },
  on: { color: colors.textPrimary, backgroundColor: colors.bgTertiary },
  // The chosen tab grows to its name's measured width (`--label-width`) as the old one shrinks.
  tabLabel: { ...clip, width: 0, transitionDuration: "280ms" },
  tabMotion: {
    transitionProperty: {
      default: "width, margin-left",
      "@media (prefers-reduced-motion: reduce)": "none",
    },
  },
  tabEase: { transitionTimingFunction: "cubic-bezier(0.45, 0, 0.25, 1)" },
  tabLabelShown: { width: "var(--label-width, auto)", marginLeft: 6 },
  tabCount: { marginLeft: 4, color: colors.textSecondary, fontSize: 11 },
  tabular: { fontVariantNumeric: "tabular-nums" },
  end: { marginLeft: "auto" },
  footer: { ...center, ...quiet, flexShrink: 0, gap: 8, height: 34, padding: `0 ${INSET}` },
  footerLook: { color: colors.textPrimary, textAlign: "left", backgroundColor: hoverBg },
  fixed: { flexShrink: 0 },
  ellipsis: { ...clip, textOverflow: "ellipsis" },
  sectionAfter: { marginTop: 8 },
  caption: { margin: 0, fontSize: 11, fontWeight: 500 },
  groupLabel: { padding: `6px ${INSET} 4px` },
  empty: { margin: 0, padding: `4px ${INSET} 6px` },
  newGroup: { ...quiet, display: "block", padding: `6px ${INSET}`, color: dim, textAlign: "left" },
  inbox: { ...column, gap: 6, paddingBottom: 12 },
  bucket: { margin: `0 ${GUTTER}`, borderRadius: RADIUS, transitionProperty: "background-color" },
  bucketAfter: { marginTop: 12 },
  quick: { transitionDuration: "120ms", transitionTimingFunction: "ease" },
  dropping: { backgroundColor: colors.bgQuaternary },
  // A bucket's name stays at the top of the sidebar while you scroll through its threads.
  header: { ...center, position: "sticky", top: 0, zIndex: 1, height: 26 },
  headerLook: { padding: `0 ${PILL} 0 0`, backgroundColor: colors.sidebarSolid },
  toggle: { ...center, ...quiet, flex: 1, gap: 6, minWidth: 0, height: "100%" },
  toggleLook: { padding: `0 0 0 ${PILL}`, textAlign: "left" },
  toggleColor: { color: { default: colors.textTertiary, ":hover": colors.textSecondary } },
  sorting: { paddingLeft: `calc(${PILL} + 20px)`, color: colors.textTertiary, cursor: "default" },
  faded: { opacity: 0.6 },
  chevron: { flexShrink: 0, marginLeft: "auto", transitionProperty: "transform" },
  chevronOpen: { transform: "rotate(90deg)" },
  count: { color: colors.textTertiary, fontWeight: 400 },
  link: { ...quiet, margin: "2px 0 0", color: dim, fontSize: 11 },
  more: { display: "block", padding: `2px calc(${PILL} + 24px)` },
  newBucket: { ...center, gap: 6, alignSelf: "flex-start", padding: `2px ${INSET}` },
  // A bucket shows `BUCKET_ROWS` threads and scrolls the rest, fading at an end with more past it.
  capped: {
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
  inboxRow: { ...center, gap: 8, padding: `5px ${PILL}`, borderRadius: RADIUS },
  body: { ...column, flex: 1, minWidth: 0 },
  top: { ...center, gap: 4, minWidth: 0 },
  title: { lineHeight: "18px" },
  bold: { fontWeight: 600 },
});

const BUCKET_ROWS = 5;
const DRAG_TYPE = "application/x-thread-id";
const ICON = { size: 14, "aria-hidden": "true" } as const;

// Hugeicons' panel icons with the side pane filled, for a panel that's open.
const LEFT_PANE =
  "M9 3H8C6 3 4.9 3.2 4.17 4.17C3.2 4.9 3 6 3 8V16C3 18 3.2 19.1 4.17 19.83C4.9 20.8 6 21 8 21H9Z";
const RIGHT_PANE =
  "M15 3H16C18 3 19.1 3.2 19.83 4.17C20.8 4.9 21 6 21 8V16C21 18 20.8 19.1 19.83 19.83C19.1 20.8 18 21 16 21H15Z";
const filled = (icon: IconSvgElement, d: string): IconSvgElement => [
  ...icon,
  ["path", { d, fill: "currentColor", key: "pane" }],
];

// One menu for the whole sidebar, and which buckets you've folded, remembered on this device.
type Menu = { x: number; y: number; items: ContextMenuItem[] };
const [menu, setMenu] = createSignal<Menu | null>(null);
const showMenu = (event: MouseEvent, items: ContextMenuItem[]): void => {
  event.preventDefault();
  event.stopPropagation();
  setMenu({ x: event.clientX, y: event.clientY, items });
};
const COLLAPSED_KEY = "collapsed-buckets";
const [collapsed, setCollapsed] = createSignal<string[]>(
  (() => {
    try {
      const saved: unknown = JSON.parse(stored(COLLAPSED_KEY) ?? "[]");
      return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  })(),
);
const toggleBucket = (id: string): void => {
  const next = collapsed().includes(id)
    ? collapsed().filter((other) => other !== id)
    : [...collapsed(), id];
  setCollapsed(next);
  store(COLLAPSED_KEY, JSON.stringify(next));
};

// A div that acts as a button, for rows that hold other content.
const pressable = (open: () => void) =>
  ({
    role: "button",
    tabindex: 0,
    onClick: open,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " "))
        return;
      event.preventDefault();
      open();
    },
  }) as const;

// A ref that marks clipped text with data-overflowing, which fades it out instead of an ellipsis.
function overflowFade(): (element: HTMLElement) => void {
  let element!: HTMLElement;
  onSettled(() => {
    const target = element;
    const fade = () =>
      target.toggleAttribute("data-overflowing", target.scrollWidth > target.clientWidth);
    const observer = new ResizeObserver(fade);
    observer.observe(target);
    return () => observer.disconnect();
  });
  return (next) => (element = next);
}

type TopProps = { label: string; icon: IconSvgElement; pressed?: boolean; onClick: () => void };
function TopButton(props: TopProps): JSX.Element {
  const pressed = (): "true" | "false" | undefined =>
    props.pressed === undefined ? undefined : props.pressed ? "true" : "false";
  return (
    <button
      class={sx(topbar.button)}
      aria-label={props.label}
      aria-pressed={pressed()}
      onClick={() => props.onClick()}
    >
      <Icon icon={props.icon} {...ICON} />
    </button>
  );
}

// The panels' icons have their pane filled while the panel is open.
type PaneProps = { name: string; open: boolean; icon: IconSvgElement; pane: string };
function PaneToggle(props: PaneProps & { onClick: () => void }): JSX.Element {
  const label = (): string => `${props.open ? "Hide" : "Show"} ${props.name}`;
  const icon = (): IconSvgElement => (props.open ? filled(props.icon, props.pane) : props.icon);
  return <TopButton label={label()} icon={icon()} pressed={props.open} onClick={props.onClick} />;
}

export function SidebarToggle(): JSX.Element {
  const { ui } = useApp();
  const open = (): boolean => ui.sidebarOpen();
  return (
    <PaneToggle
      name="sidebar"
      open={open()}
      icon={i.PanelLeftIcon}
      pane={LEFT_PANE}
      onClick={ui.toggleSidebar}
    />
  );
}

export function DetailsToggle(): JSX.Element {
  const { ui } = useApp();
  const open = (): boolean => ui.detailsOpen();
  return (
    <PaneToggle
      name="details"
      open={open()}
      icon={i.PanelRightIcon}
      pane={RIGHT_PANE}
      onClick={ui.toggleDetails}
    />
  );
}

export function SearchButton(): JSX.Element {
  const { ui } = useApp();
  return <TopButton label="Search" icon={i.Search01Icon} onClick={() => ui.setSearchOpen(true)} />;
}

// A one-line row (Sent, Drafts, Groups): an icon, its name, an unread dot, and something on the right.
type RowBasics = { label: string; active: boolean; onOpen: () => void; icon?: IconSvgElement };
type RowExtras = { unread?: boolean; meta?: string | number | null; title?: string };
function Row(props: RowBasics & RowExtras & { onMenu?: (event: MouseEvent) => void }): JSX.Element {
  const fade = overflowFade();
  return (
    <li class={sx(s.item)}>
      <div
        class={sx(s.row, s.rowPad, s.rowLook, s.pointer, props.active && s.active)}
        title={props.title}
        onContextMenu={(event) => props.onMenu?.(event)}
        {...pressable(() => props.onOpen())}
      >
        <Show when={props.icon}>
          {(icon) => (
            <span class={sx(s.rowIcon, s.rowIconLook)} aria-hidden="true">
              <Icon icon={icon()} size={12} />
            </span>
          )}
        </Show>
        <span ref={fade} class={sx(s.label, props.unread && s.medium)}>
          {props.label}
        </span>
        <Show when={props.unread}>
          <span class={sx(status.unread)} aria-label="Unread" />
        </Show>
        <Show when={props.meta}>
          <span class={sx(s.meta, s.faint)}>{props.meta}</span>
        </Show>
      </div>
    </li>
  );
}

// A thread in the inbox: who it's from, its title and due date, and under them what they last sent you or why it's
// here. Hovering says why it's in its bucket; drag it to another bucket to move it.
function InboxRow(props: { item: InboxItem }): JSX.Element {
  const app = useApp();
  const thread = () => props.item.thread;
  const active = (): boolean => app.nav.activeThreadId() === thread().id;
  const fade = overflowFade();
  let row!: HTMLDivElement;
  // The open thread stays in view as J and K move past the rows showing.
  createEffect(active, (on) => {
    if (on) row.scrollIntoView({ block: "nearest" });
  });
  const why = (): string => {
    const sorted = thread().triage[app.me().id];
    return sorted?.manual ? "Placed here by you" : (sorted?.reason ?? "");
  };
  const line = (): string => {
    const latest = props.item.why === "sent" ? lastSentTo(thread(), app.me().id) : undefined;
    if (latest === undefined) return props.item.reason;
    return `${latest.author.name.split(" ")[0]}: ${plainThreadLinks(latest.text, app.links.titleOf, app.links.nameOf)}`;
  };
  const looks = () => [active() && s.active, thread().status === "blocked" && !active() && s.faded];
  const unread = (): boolean => app.inbox.unreadIds().has(thread().id);
  return (
    <li class={sx(s.item)}>
      <div
        ref={row}
        class={[sx(s.inboxRow, s.rowLook, s.pointer, looks()), "inbox-row"]}
        draggable="true"
        onDragStart={(event) => {
          event.dataTransfer?.setData(DRAG_TYPE, thread().id);
          if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={(event) => app.threads.openMenu(event, thread())}
        title={why()}
        {...pressable(() => app.nav.openThread(thread().id))}
      >
        <Identicon seed={props.item.from.id} size={16} class={sx(s.fixed)} />
        <span class={sx(s.body)}>
          <span class={sx(s.top)}>
            <span ref={fade} class={sx(s.label, s.title, unread() && s.bold)}>
              {thread().title}
            </span>
            <Show when={props.item.dueLabel}>
              <span class={sx(s.meta, s.faint, s.small)}>{props.item.dueLabel}</span>
            </Show>
          </span>
          <span class={sx(s.ellipsis, s.faint, s.small)}>{line()}</span>
        </span>
      </div>
    </li>
  );
}

type RowsProps = { label: string; items: InboxItem[]; ref?: (list: HTMLUListElement) => void };
function Rows(props: RowsProps & { capped?: boolean }): JSX.Element {
  return (
    <ul ref={props.ref} class={sx(s.list, props.capped && s.capped)} aria-label={props.label}>
      <For each={props.items} keyed={(item) => item.thread.id}>
        {(item) => <InboxRow item={item()} />}
      </For>
    </ul>
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

// One bucket: its name and count, which folds it, and its threads, capped at `BUCKET_ROWS` until "6 more" opens the
// rest. Threads dropped on it move into it.
function BucketSection(props: {
  group: BucketGroup;
  index: number;
  icon?: IconSvgElement;
}): JSX.Element {
  const app = useApp();
  const actions = app.buckets.actions;
  const bucket = (): Bucket => props.group.bucket;
  const items = (): InboxItem[] => props.group.items;
  const all = (): BucketGroup[] => app.inbox.view().buckets;
  const open = (): boolean => !collapsed().includes(bucket().id);
  // The bucket above shows its threads, which sets this one further apart.
  const afterThreads = (): boolean => {
    const above = all()[props.index - 1];
    return above !== undefined && above.items.length > 0 && !collapsed().includes(above.bucket.id);
  };
  const [expanded, setExpanded] = createSignal(false);
  const [dropping, setDropping] = createSignal(false);
  const hidden = (): number => items().length - BUCKET_ROWS;
  const move = (label: string, by: -1 | 1) => ({
    label,
    run: () => actions.onMove(bucket().id, by),
  });
  const remove = { label: "Delete bucket", run: () => actions.onDelete(bucket().id) };
  const menuItems = (): ContextMenuItem[] => [
    { label: "Edit bucket…", run: () => actions.onEdit(bucket()) },
    { label: "New bucket…", run: actions.onNew },
    "separator",
    ...(props.index === 0 ? [] : [move("Move up", -1)]),
    ...(props.index === all().length - 1 ? [] : [move("Move down", 1)]),
    ...(all().length > 1 ? (["separator", remove] as const) : []),
  ];
  // The rows cap: as tall as the first `rows` rows, marking an end with more past it. The cap is kept as last read,
  // since Solid 2 reads props only in a compute.
  let list: HTMLUListElement | undefined;
  let cap = 0;
  const measure = (): void => {
    if (list === undefined) return;
    const [first, cut] = [list.children[0], list.children[cap]] as (HTMLElement | undefined)[];
    list.style.maxHeight = first && cut ? `${cut.offsetTop - first.offsetTop}px` : "";
    list.toggleAttribute("data-more-above", list.scrollTop > 0);
    list.toggleAttribute(
      "data-more-below",
      list.scrollTop + list.clientHeight < list.scrollHeight - 1,
    );
  };
  const observer = new ResizeObserver(measure);
  onSettled(() => () => observer.disconnect());
  createEffect(
    () => [expanded() ? items().length : BUCKET_ROWS, items(), open()] as const,
    ([rows]) => {
      cap = rows;
      measure();
    },
  );
  const capList = (el: HTMLUListElement): void => {
    list = el;
    el.addEventListener("scroll", measure, { passive: true });
    observer.observe(el);
  };
  return (
    <section
      class={sx(s.bucket, s.quick, afterThreads() && s.bucketAfter, dropping() && s.dropping)}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        setDropping(false);
        const id = event.dataTransfer?.getData(DRAG_TYPE) ?? "";
        if (id === "") return;
        event.preventDefault();
        if (!items().some((item) => item.thread.id === id)) actions.onPlace(id, bucket().id);
      }}
    >
      <div
        class={sx(s.header, s.headerLook)}
        onContextMenu={(event) => showMenu(event, menuItems())}
      >
        <button
          class={sx(
            s.toggle,
            s.toggleLook,
            s.toggleColor,
            s.caption,
            s.pointer,
            !items().length && s.faded,
          )}
          aria-expanded={open() ? "true" : "false"}
          title={bucket().description}
          onClick={() => toggleBucket(bucket().id)}
        >
          <Icon icon={props.icon ?? i.InboxIcon} {...ICON} class={sx(s.fixed)} />
          <span class={sx(s.ellipsis)}>{bucket().name}</span>
          <Show when={items().length > 0}>
            <span class={sx(s.count, s.tabular)}>{items().length}</span>
          </Show>
          <Icon
            icon={i.ArrowRight01Icon}
            {...ICON}
            size={10}
            class={sx(s.chevron, s.quick, open() && s.chevronOpen)}
          />
        </button>
      </div>
      <Show when={open() && items().length > 0}>
        <Rows label={bucket().name} items={items()} ref={capList} capped />
      </Show>
      <Show when={open() && hidden() > 0}>
        <button class={sx(s.link, s.more, s.pointer)} onClick={() => setExpanded(!expanded())}>
          {expanded() ? "Show less" : `${hidden()} more`}
        </button>
      </Show>
    </section>
  );
}

// Your inbox in your buckets; threads the model hasn't sorted yet wait at the top under "Sorting".
function InboxView(): JSX.Element {
  const app = useApp();
  const inbox = app.inbox.view;
  const icons = createMemo(() => bucketIcons(inbox().buckets.map((group) => group.bucket)));
  return (
    <div class={sx(s.inbox)}>
      <Show when={inbox().unsorted.length > 0}>
        <section class={sx(s.bucket, s.quick)}>
          <div class={sx(s.header, s.headerLook)}>
            <span class={sx(s.toggle, s.toggleLook, s.caption, s.sorting)}>
              <span class={sx(s.ellipsis)}>Sorting</span>
              <span class={sx(s.count, s.tabular)}>{inbox().unsorted.length}</span>
            </span>
          </div>
          <Rows label="Sorting" items={inbox().unsorted} />
        </section>
      </Show>
      <Show when={inbox().order.length === 0}>
        <p class={sx(s.empty, s.faint)}>Nothing for you</p>
      </Show>
      <For each={inbox().buckets} keyed={(group) => group.bucket.id}>
        {(group, index) => (
          <BucketSection group={group()} index={index()} icon={icons().get(group().bucket.id)} />
        )}
      </For>
      <button
        class={sx(s.link, s.newBucket, s.pointer)}
        onClick={() => app.buckets.actions.onNew()}
      >
        <Icon icon={i.Add01Icon} size={12} aria-hidden="true" />
        New bucket
      </button>
    </div>
  );
}

// A list of rows, with a line in its place while it's empty.
function List(props: {
  label: string;
  empty?: string | false;
  children: JSX.Element;
}): JSX.Element {
  return (
    <ul class={sx(s.list)} aria-label={props.label}>
      <Show when={props.empty}>
        <li class={sx(s.empty, s.faint)}>{props.empty}</li>
      </Show>
      {props.children}
    </ul>
  );
}

// Sent, your outbox: every open thread you own that anyone else is on, until it's closed.
function Sent(): JSX.Element {
  const app = useApp();
  const items = (): InboxItem[] => app.inbox.view().sent;
  return (
    <List label="Sent" empty={items().length === 0 && "Nothing out with anyone"}>
      <For each={items()} keyed={(item) => item.thread.id}>
        {(item) => (
          <Row
            icon={THREAD_ICON}
            label={item().thread.title}
            title={item().reason}
            meta={[item().who, item().dueLabel].filter((part) => part != null).join(" · ")}
            unread={app.inbox.unreadIds().has(item().thread.id)}
            active={item().thread.id === app.nav.activeThreadId()}
            onOpen={() => app.nav.openThread(item().thread.id)}
            onMenu={(event) => app.threads.openMenu(event, item().thread)}
          />
        )}
      </For>
    </List>
  );
}

// Threads written in the new-message panel and kept for later, newest first; right-click deletes one.
function Drafts(): JSX.Element {
  const app = useApp();
  const none = (): string | false =>
    app.drafts.list().length === 0 && "No drafts. ⌘⇧N, then ⌘S, keeps one for later";
  return (
    <List label="Drafts" empty={none()}>
      <For each={app.drafts.list()} keyed={(draft) => draft.id}>
        {(draft) => (
          <Row
            icon={i.NoteEditIcon}
            label={
              draft().draft?.title.trim() || draft().text.trim().split("\n")[0] || "Untitled draft"
            }
            title={draft().text}
            meta={formatRelativeTime(draft().savedAtMs, app.now())}
            active={draft().id === app.nav.shownDraft()?.id}
            onOpen={() => app.nav.openDraft(draft())}
            onMenu={(event) =>
              showMenu(event, [{ label: "Delete draft", run: () => app.drafts.remove(draft().id) }])
            }
          />
        )}
      </For>
    </List>
  );
}

// All threads, then your groups, everyone else's, labels and archived groups, each with its open threads' count.
function GroupList(): JSX.Element {
  const app = useApp();
  const groups = createMemo(() => groupsFor(app.data.groups(), app.me()));
  const count = (labelId: string | null): number =>
    threadsWithLabel(app.data.threads(), labelId).length;
  type Item = { id: string; labelId: string; name: string };
  const labels = (): Item[] =>
    filterLabels(app.data.labels()).map((l) => ({ ...l, labelId: l.id }));
  const sections: [string, () => Item[]][] = [
    ["Your groups", () => groups().mine],
    ["Other groups", () => groups().others],
    ["Labels", labels],
    ["Archived groups", () => groups().archived],
  ];
  const spaced = (index: number): boolean =>
    sections.slice(0, index).some(([, items]) => items().length > 0);
  return (
    <>
      <button class={sx(s.newGroup, s.pointer)} onClick={() => app.ui.setNewGroupOpen(true)}>
        New group
      </button>
      <List label="All threads">
        <Row
          label="All threads"
          meta={count(null)}
          active={app.nav.page() === "all"}
          onOpen={() => app.nav.openPage("all")}
        />
      </List>
      <For each={sections}>
        {([title, items], index) => (
          <Show when={items().length > 0}>
            <section class={sx(spaced(index()) && s.sectionAfter)}>
              <h2 class={sx(s.caption, s.groupLabel, s.faint)}>{title}</h2>
              <List label={title}>
                <For each={items()} keyed={(item) => item.id}>
                  {(item) => (
                    <Row
                      label={item().name}
                      meta={count(item().labelId)}
                      active={app.nav.shownLabel()?.id === item().labelId}
                      onOpen={() => app.nav.openLabel(item().labelId)}
                    />
                  )}
                </For>
              </List>
            </section>
          </Show>
        )}
      </For>
    </>
  );
}

type SidebarTab = "inbox" | "sent" | "drafts" | "groups";
const TAB_KEY = "sidebar-tab";
const TABS = [
  { tab: "inbox", label: "Inbox", icon: i.InboxIcon, view: InboxView },
  { tab: "sent", label: "Sent", icon: i.SentIcon, view: Sent },
  { tab: "drafts", label: "Drafts", icon: i.NoteEditIcon, view: Drafts },
  { tab: "groups", label: "Groups", icon: i.UserGroupIcon, view: GroupList },
] as const;

// What opens in the main area from the sidebar: settings, every thread, a label's threads, or someone's profile.
export type SidebarPage = "settings" | "all" | { label: string } | { person: string };

// The top bar, the tabs (the chosen one opens out to show its name), the chosen tab's list, and you at the bottom.
export function Sidebar(): JSX.Element {
  const app = useApp();
  const [tab, setTab] = createSignal<SidebarTab>(
    TABS.find((t) => t.tab === stored(TAB_KEY))?.tab ?? "inbox",
  );
  const counts = (): Record<SidebarTab, number> => ({
    inbox: app.inbox.view().order.length,
    sent: app.inbox.view().sent.length,
    drafts: app.drafts.list().length,
    groups: 0,
  });
  const labels: HTMLElement[] = [];
  // Each name's own width, so the chosen tab grows to exactly fit it.
  createEffect(tab, () => {
    for (const label of labels) label.style.setProperty("--label-width", `${label.scrollWidth}px`);
  });
  const profile = (): boolean => app.nav.profileOpen();
  return (
    <SidePanel size={{ name: "sidebar-width", initial: 268, min: 210, max: 400, edge: "right" }}>
      <div class={sx(topbar.bar, s.topbar)}>
        <SidebarToggle />
        <SearchButton />
        <span class={sx(topbar.end)}>
          <NotificationsButton />
          <TopButton
            label="New thread"
            icon={i.PencilEdit02Icon}
            onClick={() => app.ui.openNewThread()}
          />
        </span>
      </div>
      <div class={sx(s.tabs)}>
        <div class={sx(s.tabGroup)} role="tablist" aria-label="Sidebar">
          <For each={TABS}>
            {({ tab: value, label, icon }) => (
              <button
                role="tab"
                class={sx(s.tab, s.tabLook, s.pointer, tab() === value && s.on)}
                aria-selected={tab() === value ? "true" : "false"}
                aria-label={label}
                title={label}
                onClick={() => {
                  setTab(value);
                  store(TAB_KEY, value);
                }}
              >
                <Icon icon={icon} {...ICON} />
                <span
                  ref={(el) => labels.push(el)}
                  class={sx(s.tabLabel, s.tabMotion, s.tabEase, tab() === value && s.tabLabelShown)}
                  aria-hidden="true"
                >
                  {label}
                </span>
                <Show when={counts()[value] > 0}>
                  <span class={sx(s.tabCount, s.tabular)}>{counts()[value]}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
        <button
          class={sx(s.tab, s.tabLook, s.pointer, s.end, profile() && s.on)}
          aria-pressed={profile() ? "true" : "false"}
          aria-label="Your profile and organization"
          title="Your profile and organization"
          onClick={() => app.nav.toggleProfile()}
        >
          <Identicon seed={app.me().id} size={14} />
        </button>
      </div>
      <div class={sx(s.content)}>
        <Dynamic component={TABS.find((t) => t.tab === tab())!.view} />
      </div>
      <button
        class={sx(s.footer, s.footerLook, s.pointer)}
        aria-current={app.nav.page() === "settings" ? "page" : undefined}
        onClick={() => app.nav.openPage("settings")}
      >
        <Identicon seed={app.me().id} size={16} class={sx(s.fixed)} />
        <span class={sx(s.ellipsis)}>{app.me().name}</span>
      </button>
      <Show when={menu()}>
        {(shown) => <ContextMenu {...shown()} onClose={() => setMenu(null)} />}
      </Show>
    </SidePanel>
  );
}
