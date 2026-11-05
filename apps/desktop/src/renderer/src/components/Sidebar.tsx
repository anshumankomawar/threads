import * as i from "@hugeicons/core-free-icons";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Draft, InboxItem, Label, Thread } from "models";
import {
  active,
  inbox,
  me,
  open,
  sent,
  setDialog,
  setSidebarOpen,
  setSplit,
  showMenu,
  store,
  unread,
  view,
} from "../session";
import { bucketIcons } from "../bucketIcons";
import { topbar } from "../styles/controls";
import { tabLabel } from "../styles/markers.stylex";
import { sx } from "../styles/sx";
import { colors, sidebarSpace } from "../styles/tokens.stylex";
import { ago, plain } from "./ThreadView";
import { Icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";

// Rows' fills are pills `GUTTER` in from the edges; their content stays on the sidebar's inset.
const INSET = sidebarSpace.inset;
const GUTTER = sidebarSpace.rowGutter;
const RADIUS = sidebarSpace.rowRadius;
const PILL = `calc(${INSET} - ${GUTTER})`;
const FADE = "linear-gradient(to right, #000 calc(100% - 24px), transparent)";
const center = { display: "flex", alignItems: "center" } as const;
const column = { display: "flex", flexDirection: "column" } as const;
const quiet = {
  padding: 0,
  borderStyle: "none",
  font: "inherit",
  backgroundColor: "transparent",
} as const;
const clip = { minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" } as const;
const hoverBg = { default: "transparent", ":hover": colors.bgQuaternary } as const;
const dim = { default: colors.textTertiary, ":hover": colors.textPrimary } as const;
const reduced = "@media (prefers-reduced-motion: reduce)";

const s = stylex.create({
  sidebar: {
    ...column,
    position: "relative",
    flexShrink: 0,
    width: 268,
    height: "100%",
    minWidth: 0,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
    backgroundColor: colors.sidebarSolid,
  },
  topbar: { paddingLeft: 71.5 },
  content: { ...column, flexGrow: 1, minHeight: 0, overflowY: "auto" },
  list: { ...column, margin: 0, padding: 0, listStyle: "none" },
  item: { minWidth: 0, listStyle: "none" },
  pointer: { cursor: "pointer" },
  row: { ...center, position: "relative", gap: 4, height: 28, margin: `0 ${GUTTER}` },
  rowPad: { padding: `0 ${PILL} 0 calc(31px - ${GUTTER})`, borderRadius: RADIUS },
  rowLook: { color: colors.textPrimary, outline: "none", backgroundColor: hoverBg },
  active: { backgroundColor: colors.bgTertiary },
  label: { ...clip, maskImage: { default: null, ":is([data-overflowing])": FADE } },
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
  tabMotion: { transitionProperty: { default: "width, margin-left", [reduced]: "none" } },
  tabEase: { transitionTimingFunction: "cubic-bezier(0.45, 0, 0.25, 1)" },
  tabLabelShown: { width: tabLabel["--label-width"], marginLeft: 6 },
  tabCount: { marginLeft: 4, color: colors.textSecondary, fontSize: 11 },
  tabular: { fontVariantNumeric: "tabular-nums" },
  end: { marginLeft: "auto" },
  fixed: { flexShrink: 0 },
  ellipsis: { ...clip, textOverflow: "ellipsis" },
  caption: { margin: 0, fontSize: 11, fontWeight: 500 },
  empty: { margin: 0, padding: `4px ${INSET} 6px` },
  newLabel: { ...quiet, display: "block", padding: `6px ${INSET}`, color: dim, textAlign: "left" },
  inbox: { ...column, gap: 6, paddingBottom: 12 },
  bucket: { margin: `0 ${GUTTER}`, borderRadius: RADIUS },
  bucketAfter: { marginTop: 12 },
  quick: { transitionDuration: "120ms", transitionTimingFunction: "ease" },
  // A bucket's name stays at the top of the sidebar while you scroll through its threads.
  header: { ...center, position: "sticky", top: 0, zIndex: 1, height: 26 },
  headerLook: { padding: `0 ${PILL} 0 0`, backgroundColor: colors.sidebarSolid },
  toggle: { ...center, ...quiet, flex: 1, gap: 6, minWidth: 0, height: "100%" },
  toggleLook: { padding: `0 0 0 ${PILL}`, textAlign: "left" },
  toggleColor: { color: { default: colors.textTertiary, ":hover": colors.textSecondary } },
  sorting: { paddingLeft: `calc(${PILL} + 20px)`, color: colors.textTertiary, cursor: "default" },
  faded: { opacity: 0.6 },
  chevron: {
    flexShrink: 0,
    marginLeft: "auto",
    transitionProperty: { default: "transform", [reduced]: "none" },
  },
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
const ICON = { size: 14, "aria-hidden": "true" } as const;

// Hugeicons' panel icon with the side pane filled, for a sidebar that's open.
const LEFT_PANE =
  "M9 3H8C6 3 4.9 3.2 4.17 4.17C3.2 4.9 3 6 3 8V16C3 18 3.2 19.1 4.17 19.83C4.9 20.8 6 21 8 21H9Z";
export const sidebarIcon = (open: boolean): IconSvgElement =>
  open
    ? [...i.PanelLeftIcon, ["path", { d: LEFT_PANE, fill: "currentColor", key: "pane" }]]
    : i.PanelLeftIcon;

const dueLabel = (c: Thread): string | undefined =>
  c.dueAt?.toLocaleDateString(undefined, { month: "short", day: "numeric" });

// A div that acts as a button, for rows that hold other content.
const pressable = (run: () => void) =>
  ({
    role: "button",
    tabindex: 0,
    onClick: run,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " "))
        return;
      event.preventDefault();
      run();
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

const menuFor = (c: Thread) => (event: MouseEvent) =>
  showMenu(event, [
    { label: "Open beside", run: () => setSplit(c.id) },
    {
      label: c.isOpen ? "Resolve" : "Reopen",
      run: () => ((c.state = c.isOpen ? "resolved" : "open"), c.save()),
    },
  ]);

// A one-line row (Sent, Drafts, Labels): an icon, its name, and something on the right.
function Row(props: {
  label: string;
  icon: IconSvgElement;
  meta?: string;
  active?: boolean;
  title?: string;
  onClick: () => void;
  onMenu?: (e: MouseEvent) => void;
}): JSX.Element {
  const fade = overflowFade();
  return (
    <li class={sx(s.item)}>
      <div
        class={sx(s.row, s.rowPad, s.rowLook, s.pointer, props.active && s.active)}
        title={props.title}
        onContextMenu={(e) => props.onMenu?.(e)}
        {...pressable(() => props.onClick())}
      >
        <span class={sx(s.rowIcon, s.rowIconLook)} aria-hidden="true">
          <Icon icon={props.icon} size={12} />
        </span>
        <span ref={fade} class={sx(s.label)}>
          {props.label}
        </span>
        <Show when={props.meta}>
          <span class={sx(s.meta, s.faint)}>{props.meta}</span>
        </Show>
      </div>
    </li>
  );
}

// What someone last sent you, else why it's here.
const lineOf = (item: InboxItem): string => {
  const last = item.thread.messages.sorted("createdAt").findLast((m) => m.authorId !== me().id);
  return last
    ? `${last.author.name.split(" ")[0]}: ${plain(last.body)}`
    : item.manual
      ? "Placed here by you"
      : (item.reason ?? "");
};

// A thread in the inbox: who it's from, its title and due date, and under them what they last sent you.
function InboxRow(props: { item: InboxItem }): JSX.Element {
  const c = (): Thread => props.item.thread;
  const on = (): boolean => active() === c();
  const fade = overflowFade();
  let row!: HTMLDivElement;
  // The open thread stays in view as J and K move past the rows showing.
  createEffect(on, (shown) => {
    if (shown) row.scrollIntoView({ block: "nearest" });
  });
  return (
    <li class={sx(s.item)}>
      <div
        ref={row}
        class={sx(
          s.inboxRow,
          s.rowLook,
          s.pointer,
          on() && s.active,
          c().state === "blocked" && !on() && s.faded,
        )}
        title={props.item.manual ? "Placed here by you" : props.item.reason}
        onContextMenu={(e) => menuFor(c())(e)}
        {...pressable(() => open({ thread: c().id }))}
      >
        <Identicon seed={c().ownerId ?? ""} size={16} class={sx(s.fixed)} />
        <span class={sx(s.body)}>
          <span class={sx(s.top)}>
            <span ref={fade} class={sx(s.label, s.title, unread(props.item) && s.bold)}>
              {c().title}
            </span>
            <Show when={dueLabel(c())}>
              <span class={sx(s.meta, s.faint, s.small)}>{dueLabel(c())}</span>
            </Show>
          </span>
          <span class={sx(s.ellipsis, s.faint, s.small)}>{lineOf(props.item)}</span>
        </span>
      </div>
    </li>
  );
}

function Rows(props: {
  label: string;
  items: InboxItem[];
  capped?: boolean;
  ref?: (list: HTMLUListElement) => void;
}): JSX.Element {
  return (
    <ul ref={props.ref} class={sx(s.list, props.capped && s.capped)} aria-label={props.label}>
      <For each={props.items}>{(item) => <InboxRow item={item} />}</For>
    </ul>
  );
}

const [folded, setFolded] = createSignal<string[]>([]);

// One bucket: its name and count, which folds it, and its threads, capped at `BUCKET_ROWS` until "6 more" opens
// the rest.
function BucketSection(props: {
  bucket: Bucket;
  items: InboxItem[];
  icon?: IconSvgElement;
  after: boolean;
}): JSX.Element {
  const shut = (): boolean => folded().includes(props.bucket.id);
  const [expanded, setExpanded] = createSignal(false);
  const hidden = (): number => props.items.length - BUCKET_ROWS;
  const move = (by: number) => () => {
    const buckets = store.where(Bucket, "userId", me().id).sort((a, b) => a.position - b.position);
    const at = buckets.indexOf(props.bucket);
    const other = buckets[at + by];
    if (!other) return;
    [props.bucket.position, other.position] = [other.position, props.bucket.position];
    props.bucket.save();
    other.save();
  };
  // The rows cap: as tall as the first `cap` rows, marking an end with more past it.
  let list: HTMLUListElement | undefined;
  let cap = BUCKET_ROWS;
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
    () => [expanded() ? props.items.length : BUCKET_ROWS, props.items, shut()] as const,
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
    <section class={sx(s.bucket, props.after && s.bucketAfter)}>
      <div
        class={sx(s.header, s.headerLook)}
        onContextMenu={(e) =>
          showMenu(e, [
            {
              label: "Edit bucket…",
              run: () => setDialog({ kind: "bucket", bucket: props.bucket }),
            },
            { label: "New bucket…", run: () => setDialog({ kind: "bucket" }) },
            "separator",
            { label: "Move up", run: move(-1) },
            { label: "Move down", run: move(1) },
            "separator",
            { label: "Delete bucket", run: () => void props.bucket.delete() },
          ])
        }
      >
        <button
          class={sx(
            s.toggle,
            s.toggleLook,
            s.toggleColor,
            s.caption,
            s.pointer,
            props.items.length === 0 && s.faded,
          )}
          aria-expanded={shut() ? "false" : "true"}
          title={props.bucket.description}
          onClick={() =>
            setFolded(
              shut()
                ? folded().filter((f) => f !== props.bucket.id)
                : [...folded(), props.bucket.id],
            )
          }
        >
          <Icon icon={props.icon ?? i.InboxIcon} {...ICON} class={sx(s.fixed)} />
          <span class={sx(s.ellipsis)}>{props.bucket.name}</span>
          <Show when={props.items.length > 0}>
            <span class={sx(s.count, s.tabular)}>{props.items.length}</span>
          </Show>
          <Icon
            icon={i.ArrowRight01Icon}
            {...ICON}
            size={10}
            class={sx(s.chevron, s.quick, !shut() && s.chevronOpen)}
          />
        </button>
      </div>
      <Show when={!shut() && props.items.length > 0}>
        <Rows label={props.bucket.name} items={props.items} ref={capList} capped />
      </Show>
      <Show when={!shut() && hidden() > 0}>
        <button class={sx(s.link, s.more, s.pointer)} onClick={() => setExpanded(!expanded())}>
          {expanded() ? "Show less" : `${hidden()} more`}
        </button>
      </Show>
    </section>
  );
}

// Your inbox in your buckets; threads the model hasn't sorted yet wait at the top under "Sorting".
function InboxTab(): JSX.Element {
  const icons = (): Map<string, IconSvgElement> =>
    bucketIcons(inbox().sections.map((g) => g.bucket));
  // The bucket above shows its threads, which sets this one further apart.
  const after = (index: number): boolean => {
    const above = inbox().sections[index - 1];
    return !!above && above.items.length > 0 && !folded().includes(above.bucket.id);
  };
  return (
    <div class={sx(s.inbox)}>
      <Show when={inbox().unsorted.length > 0}>
        <section class={sx(s.bucket)}>
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
      <For each={inbox().sections}>
        {(g, index) => (
          <BucketSection
            bucket={g.bucket}
            items={g.items}
            icon={icons().get(g.bucket.id)}
            after={after(index())}
          />
        )}
      </For>
      <button
        class={sx(s.link, s.newBucket, s.pointer)}
        onClick={() => setDialog({ kind: "bucket" })}
      >
        <Icon icon={i.Add01Icon} size={12} aria-hidden="true" />
        New bucket
      </button>
    </div>
  );
}

// A list of rows, with a line in its place while it's empty.
function List(props: { label: string; empty?: string | false; children: JSX.Element }) {
  return (
    <ul class={sx(s.list)} aria-label={props.label}>
      <Show when={props.empty}>
        <li class={sx(s.empty, s.faint)}>{props.empty}</li>
      </Show>
      {props.children}
    </ul>
  );
}

function SentTab(): JSX.Element {
  return (
    <List label="Sent" empty={sent().length === 0 && "Nothing out with anyone"}>
      <For each={sent()}>
        {(c) => (
          <Row
            icon={i.Message01Icon}
            label={c.title}
            meta={dueLabel(c)}
            active={active() === c}
            onClick={() => open({ thread: c.id })}
            onMenu={menuFor(c)}
          />
        )}
      </For>
    </List>
  );
}

function DraftsTab(): JSX.Element {
  const drafts = (): Draft[] => store.where(Draft, "userId", me().id);
  return (
    <List label="Drafts" empty={drafts().length === 0 && "No drafts. ⌘⇧N, then esc, keeps one"}>
      <For each={drafts()}>
        {(draft) => (
          <Row
            icon={i.NoteEditIcon}
            label={draft.draft?.title || draft.text.split("\n")[0] || "Untitled draft"}
            title={draft.text}
            meta={ago(draft.updatedAt)}
            onClick={() => setDialog({ kind: "compose", draftId: draft.id })}
            onMenu={(e) => showMenu(e, [{ label: "Delete draft", run: () => void draft.delete() }])}
          />
        )}
      </For>
    </List>
  );
}

function LabelsTab(): JSX.Element {
  const shownLabel = (): string | undefined => (view() as { label?: string }).label;
  const openIn = (label: Label): number =>
    store.all(Thread).filter((t) => t.isOpen && t.labelIds.includes(label.id)).length;
  return (
    <>
      <button class={sx(s.newLabel, s.pointer)} onClick={() => setDialog({ kind: "newLabel" })}>
        New label
      </button>
      <List label="Labels">
        <For each={store.all(Label).sort((a, b) => a.name.localeCompare(b.name))}>
          {(label) => (
            <Row
              icon={i.Tag01Icon}
              label={label.name}
              meta={String(openIn(label))}
              active={shownLabel() === label.id}
              onClick={() => open({ label: label.id })}
            />
          )}
        </For>
      </List>
    </>
  );
}

const TABS = [
  { label: "Inbox", icon: i.InboxIcon, count: () => inbox().order.length, tab: InboxTab },
  { label: "Sent", icon: i.SentIcon, count: () => sent().length, tab: SentTab },
  {
    label: "Drafts",
    icon: i.NoteEditIcon,
    count: () => store.where(Draft, "userId", me().id).length,
    tab: DraftsTab,
  },
  { label: "Labels", icon: i.Tag01Icon, count: () => 0, tab: LabelsTab },
];

export const TopButton = (props: {
  label: string;
  icon: IconSvgElement;
  onClick: () => void;
}): JSX.Element => (
  <button class={sx(topbar.button)} aria-label={props.label} onClick={() => props.onClick()}>
    <Icon icon={props.icon} {...ICON} />
  </button>
);

// The top bar, the tabs (the chosen one opens out to show its name), and the chosen tab's list.
export function Sidebar(): JSX.Element {
  const [tab, setTab] = createSignal(TABS[0]);
  const labels: HTMLElement[] = [];
  // Each name's own width, so the chosen tab grows to exactly fit it.
  createEffect(tab, () => {
    for (const label of labels) label.style.setProperty("--label-width", `${label.scrollWidth}px`);
  });
  const profile = (): boolean => (view() as { person?: string }).person === me().id;
  return (
    <aside class={sx(s.sidebar)}>
      <div class={sx(topbar.bar, s.topbar)}>
        <TopButton
          label="Hide sidebar"
          icon={sidebarIcon(true)}
          onClick={() => setSidebarOpen(false)}
        />
        <TopButton
          label="Search"
          icon={i.Search01Icon}
          onClick={() => setDialog({ kind: "search" })}
        />
        <span class={sx(topbar.end)}>
          <TopButton
            label="New thread"
            icon={i.PencilEdit02Icon}
            onClick={() => setDialog({ kind: "newThread" })}
          />
        </span>
      </div>
      <div class={sx(s.tabs)}>
        <div class={sx(s.tabGroup)} role="tablist" aria-label="Sidebar">
          <For each={TABS}>
            {(t) => (
              <button
                class={sx(s.tab, s.tabLook, s.pointer, tab() === t && s.on)}
                role="tab"
                aria-selected={tab() === t ? "true" : "false"}
                aria-label={t.label}
                title={t.label}
                onClick={() => setTab(t)}
              >
                <Icon icon={t.icon} {...ICON} />
                <span
                  ref={(el) => labels.push(el)}
                  class={sx(s.tabLabel, s.tabMotion, s.tabEase, tab() === t && s.tabLabelShown)}
                  aria-hidden="true"
                >
                  {t.label}
                </span>
                <Show when={t.count() > 0}>
                  <span class={sx(s.tabCount, s.tabular)}>{t.count()}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
        <button
          class={sx(s.tab, s.tabLook, s.pointer, s.end, profile() && s.on)}
          aria-pressed={profile() ? "true" : "false"}
          aria-label="Your profile"
          title="Your profile"
          onClick={() => open({ person: me().id })}
        >
          <Identicon seed={me().id} size={14} />
        </button>
      </div>
      <div class={sx(s.content)}>
        <Dynamic component={tab().tab} />
      </div>
    </aside>
  );
}
