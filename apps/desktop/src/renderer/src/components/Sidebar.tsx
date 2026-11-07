import * as i from "@hugeicons/core-free-icons";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Draft, InboxItem, Label, Subspace, Thread, View } from "models";
import {
  active,
  allThreads,
  byName,
  firstName,
  myBuckets,
  shortDate,
  shown,
  inbox,
  markDone,
  me,
  workspace,
  open,
  sent,
  setDialog,
  setSidebarOpen,
  sidebarOpen,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  showMenu,
  threadMenu,
  store,
  unread,
  view,
  save,
  saved,
} from "../session";
import { bucketIcons } from "../bucketIcons";
import { makeSubspace } from "./Palettes";
import { topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { base } from "../styles/base";
import { colors, layers, motion, radii, sidebarSpace } from "../styles/tokens.stylex";
import { ago, plain } from "./ThreadView";
import { icon, Icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { tab, Tabs } from "./Tabs";

// Rows' fills are pills `GUTTER` in from the edges; their content stays on the sidebar's inset.
const INSET = sidebarSpace.inset;
const GUTTER = sidebarSpace.rowGutter;
const PILL = `calc(${INSET} - ${GUTTER})`;
const FADE = "linear-gradient(to right, #000 calc(100% - 24px), transparent)";
const center = { display: "flex", alignItems: "center" } as const;
const column = { display: "flex", flexDirection: "column" } as const;
const EDGE = `linear-gradient(to right, transparent 2px, ${colors.resizeEdge} 2px, ${colors.resizeEdge} 3px, transparent 3px)`;
const WIDTH = { initial: 268, min: 210, max: 400 };
const clampWidth = (px: number): number => Math.min(WIDTH.max, Math.max(WIDTH.min, Math.round(px)));
const [width, setWidth] = createSignal(clampWidth(saved("sidebar-width", WIDTH.initial)));
const keepWidth = (px: number): void => {
  setWidth(px);
  save("sidebar-width", px);
};

// Dragging the right edge resizes the sidebar (straight on the element, saved on release); a double-click resets it.
function resize(event: PointerEvent & { currentTarget: HTMLHRElement }): void {
  event.preventDefault();
  const edge = event.currentTarget;
  const panel = edge.parentElement!;
  const [startX, start] = [event.clientX, panel.getBoundingClientRect().width];
  const at = (x: number): number => clampWidth(start + x - startX);
  const move = (e: PointerEvent): void => void (panel.style.width = `${at(e.clientX)}px`);
  const end = (e: PointerEvent): void => {
    edge.removeEventListener("pointermove", move);
    delete edge.dataset.resizing;
    keepWidth(at(e.clientX));
  };
  edge.setPointerCapture(event.pointerId);
  edge.dataset.resizing = "";
  edge.addEventListener("pointermove", move);
  edge.addEventListener("pointerup", end, { once: true });
  edge.addEventListener("pointercancel", end, { once: true });
}

const s = stylex.create({
  sidebar: {
    ...column,
    position: "relative",
    flexShrink: 0,
    height: "100%",
    minWidth: 0,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
    backgroundColor: colors.chrome,
  },
  // The resize edge: a 1px line over the border on hover and while dragging.
  edge: {
    position: "absolute",
    top: 0,
    right: -2,
    bottom: 0,
    zIndex: layers.titlebar,
    width: 4,
    margin: 0,
    borderStyle: "none",
    cursor: "col-resize",
    backgroundImage: { default: null, ":hover": EDGE, ":is([data-resizing])": EDGE },
  },
  topbar: { paddingLeft: sidebarSpace.afterLights },
  history: { display: "flex", marginRight: 6 },
  tight: { width: 18 },
  content: { ...column, flexGrow: 1, minHeight: 0, overflowY: "auto" },
  list: { ...column, margin: 0, padding: 0, listStyle: "none" },
  item: { minWidth: 0, listStyle: "none" },
  pointer: { cursor: "pointer" },
  row: { ...center, position: "relative", gap: 4, height: 28, margin: `0 ${GUTTER}` },
  rowPad: { padding: `0 ${PILL} 0 calc(31px - ${GUTTER})`, borderRadius: radii.row },
  rowLook: { color: colors.textPrimary, outline: "none" },
  active: { backgroundColor: colors.bgTertiary },
  label: { maskImage: { default: null, ":is([data-overflowing])": FADE } },
  rowIcon: { position: "absolute", top: "50%", left: `calc(12px - ${GUTTER})`, display: "flex" },
  rowIconLook: { color: colors.iconTertiary, transform: "translateY(-50%)" },
  meta: { flexShrink: 0, marginLeft: "auto", paddingLeft: 8, whiteSpace: "nowrap", fontSize: 12 },
  faint: { color: colors.textTertiary },
  small: { fontSize: 11 },
  tabs: { ...center, flexShrink: 0, gap: 2, padding: `4px calc(${INSET} - 6px) 6px` },
  tabular: { fontVariantNumeric: "tabular-nums" },
  end: { marginLeft: "auto" },
  fixed: { flexShrink: 0 },
  caption: { margin: 0, fontSize: 11, fontWeight: 500 },
  empty: { margin: 0, padding: `4px ${INSET} 6px` },
  section: { ...column, paddingBottom: 10 },
  // The + lines up with the rows' counts: its 12px glyph sits 5px inside its 22px button.
  sectionHeader: { ...center, height: 26, padding: `0 calc(${GUTTER} + ${PILL} - 5px) 0 ${INSET}` },
  inlineInput: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    outline: "none",
    "::placeholder": { color: colors.textTertiary },
  },
  inbox: { ...column, gap: 6, paddingBottom: 12 },
  bucket: { margin: `0 ${GUTTER}`, borderRadius: radii.row },
  bucketAfter: { marginTop: 12 },
  quick: { transitionDuration: "120ms", transitionTimingFunction: "ease" },
  // A bucket's name stays at the top of the sidebar while you scroll through its threads.
  header: { ...center, position: "sticky", top: 0, zIndex: 1, height: 26 },
  headerLook: { padding: `0 ${PILL} 0 0`, backgroundColor: colors.chrome },
  toggle: { ...center, flex: 1, gap: 6, minWidth: 0, height: "100%" },
  toggleLook: { padding: `0 0 0 ${PILL}`, textAlign: "left" },
  toggleColor: { color: { default: colors.textTertiary, ":hover": colors.textSecondary } },
  sorting: { paddingLeft: `calc(${PILL} + 20px)`, color: colors.textTertiary, cursor: "default" },
  faded: { opacity: 0.6 },
  chevron: {
    flexShrink: 0,
    marginLeft: "auto",
    transitionProperty: { default: "transform", [motion.reduced]: "none" },
  },
  chevronOpen: { transform: "rotate(90deg)" },
  count: { color: colors.textTertiary, fontWeight: 400 },
  link: { margin: "2px 0 0", fontSize: 11 },
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
  inboxRow: { ...center, gap: 8, padding: `5px ${PILL}`, borderRadius: radii.row },
  body: { ...column, flex: 1, minWidth: 0 },
  top: { ...center, gap: 4, minWidth: 0 },
  title: { lineHeight: "18px" },
  bold: { fontWeight: 600 },
  done: {
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    borderRadius: radii.row,
    cursor: "pointer",
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      ":focus-visible": 1,
    },
  },
  doneShown: { opacity: 1 },
});

const BUCKET_ROWS = 5;
const ICON = { size: 14, "aria-hidden": "true" } as const;

// Hugeicons' panel icon with the side pane filled, for a sidebar that's open.
const LEFT_PANE =
  "M9 3H8C6 3 4.9 3.2 4.17 4.17C3.2 4.9 3 6 3 8V16C3 18 3.2 19.1 4.17 19.83C4.9 20.8 6 21 8 21H9Z";
const sidebarIcon = (open: boolean): IconSvgElement =>
  open
    ? [...i.PanelLeftIcon, ["path", { d: LEFT_PANE, fill: "currentColor", key: "pane" }]]
    : i.PanelLeftIcon;

const dueLabel = (c: Thread): string | undefined => c.dueAt && shortDate(c.dueAt);

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

const menuFor = (c: Thread) => (event: MouseEvent) => showMenu(event, threadMenu(c));

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
        class={sx(s.row, s.rowPad, base.hover, s.rowLook, s.pointer, props.active && s.active)}
        title={props.title}
        onContextMenu={(e) => props.onMenu?.(e)}
        {...pressable(() => props.onClick())}
      >
        <span class={sx(s.rowIcon, s.rowIconLook)} aria-hidden="true">
          <Icon icon={props.icon} size={12} />
        </span>
        <span ref={fade} class={sx(base.clip, s.label)}>
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
    ? `${firstName(last.author)}: ${plain(last.body)}`
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
          base.hover,
          s.rowLook,
          s.pointer,
          on() && s.active,
          c().state === "blocked" && !on() && s.faded,
          // Its done button shows while the row is hovered.
          stylex.defaultMarker(),
        )}
        title={props.item.manual ? "Placed here by you" : props.item.reason}
        onContextMenu={(e) => menuFor(c())(e)}
        {...pressable(() => open({ thread: c().id }))}
      >
        <Identicon seed={c().ownerId ?? ""} size={16} class={sx(s.fixed)} />
        <span class={sx(s.body)}>
          <span class={sx(s.top)}>
            <span ref={fade} class={sx(base.clip, s.label, s.title, unread(props.item) && s.bold)}>
              {c().title}
            </span>
            <Show when={dueLabel(c())}>
              <span class={sx(s.meta, s.faint, s.small)}>{dueLabel(c())}</span>
            </Show>
          </span>
          <span class={sx(base.ellipsis, s.faint, s.small)}>{lineOf(props.item)}</span>
        </span>
        <button
          class={sx(base.bare, base.hover, base.dim, s.done, on() && s.doneShown)}
          title="Done (⌘E)"
          aria-label="Mark done"
          onClick={(event) => {
            event.stopPropagation();
            markDone(props.item);
          }}
        >
          <Icon icon={i.Tick02Icon} size={14} />
        </button>
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
    const buckets = myBuckets();
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
            // Sorting needs somewhere to put things.
            ...(myBuckets().length > 1
              ? [{ label: "Delete bucket", run: () => void props.bucket.delete() }]
              : []),
          ])
        }
      >
        <button
          class={sx(
            base.bare,
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
          <span class={sx(base.ellipsis)}>{props.bucket.name}</span>
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
        <button
          class={sx(base.bare, base.dim, s.link, s.more, s.pointer)}
          onClick={() => setExpanded(!expanded())}
        >
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
              <span class={sx(base.ellipsis)}>Sorting</span>
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
        class={sx(base.bare, base.dim, s.link, s.newBucket, s.pointer)}
        onClick={() => setDialog({ kind: "bucket" })}
      >
        {icon(i.Add01Icon)}
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

// A titled part of a list, as in Notion's sidebar. With `onAdd`, a + on the title (shown on hover) makes a new one in
// place: type its name, Enter makes it, Escape or clicking away doesn't.
function Section(props: {
  title: string;
  onAdd?: (name: string) => void;
  placeholder?: string;
  children: JSX.Element;
}): JSX.Element {
  const [adding, setAdding] = createSignal(false);
  // Once: Enter takes the input away, which blurs it too.
  let done = false;
  const start = (): void => {
    done = false;
    setAdding(true);
  };
  const finish = (input: HTMLInputElement, make: boolean): void => {
    if (done) return;
    done = true;
    setAdding(false);
    if (make && input.value.trim()) props.onAdd!(input.value.trim());
  };
  return (
    <section class={sx(s.section)}>
      <div class={sx(s.sectionHeader, stylex.defaultMarker())}>
        <span class={sx(s.caption, s.faint)}>{props.title}</span>
        <Show when={props.onAdd}>
          <button
            class={sx(base.bare, base.dim, s.done, s.end, adding() && s.doneShown)}
            aria-label={`New ${props.title.toLowerCase().replace(/s$/, "")}`}
            title={`New ${props.title.toLowerCase().replace(/s$/, "")}`}
            onClick={start}
          >
            {icon(i.Add01Icon)}
          </button>
        </Show>
      </div>
      <ul class={sx(s.list)} aria-label={props.title}>
        <Show when={adding()}>
          <li class={sx(s.item)}>
            <div class={sx(s.row, s.rowPad, s.active)}>
              <input
                ref={(input) => queueMicrotask(() => input.focus())}
                class={sx(base.bare, s.inlineInput)}
                placeholder={props.placeholder}
                onKeyDown={(event) => {
                  if (event.key === "Enter") finish(event.currentTarget, true);
                  else if (event.key === "Escape") finish(event.currentTarget, false);
                  else return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onBlur={(event) => finish(event.currentTarget, true)}
              />
            </div>
          </li>
        </Show>
        {props.children}
      </ul>
    </section>
  );
}

// Where threads live and how you look at them: all of them and your views, the subspaces, and the labels.
function SpacesTab(): JSX.Element {
  const openIn = (field: "labelIds" | "subspaceIds", id: string): string =>
    String(store.all(Thread).filter((t) => t.isOpen && t[field].includes(id)).length);
  return (
    <>
      <Section title="Views">
        <Row
          icon={i.Layers01Icon}
          label="All threads"
          active={allThreads()}
          onClick={() => open({ view: null })}
        />
        <For each={byName(store.all(View))}>
          {(v) => (
            <Row
              icon={i.FilterIcon}
              label={v.name}
              active={shown("view") === v.id}
              onClick={() => open({ view: v.id })}
            />
          )}
        </For>
      </Section>
      <Section
        title="Subspaces"
        placeholder="Subspace name"
        onAdd={(name) => open({ subspace: makeSubspace(name).id })}
      >
        <For each={byName(store.all(Subspace))}>
          {(sub) => (
            <Row
              icon={sub.visibility === "private" ? i.SquareLock01Icon : i.UserMultipleIcon}
              label={sub.name}
              meta={openIn("subspaceIds", sub.id)}
              active={shown("subspace") === sub.id}
              onClick={() => open({ subspace: sub.id })}
            />
          )}
        </For>
      </Section>
      <Section
        title="Labels"
        placeholder="Label name"
        onAdd={(name) => store.create(Label, { name, workspace: workspace() })}
      >
        <For each={byName(store.all(Label))}>
          {(label) => (
            <Row
              icon={i.Tag01Icon}
              label={label.name}
              meta={openIn("labelIds", label.id)}
              active={shown("label") === label.id}
              onClick={() => open({ label: label.id })}
            />
          )}
        </For>
      </Section>
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
  { label: "Spaces", icon: i.Layers01Icon, tab: SpacesTab },
];

const TopButton = (props: {
  label: string;
  icon: IconSvgElement;
  disabled?: boolean;
  // Narrower, to sit tight against its neighbour.
  tight?: boolean;
  onClick: () => void;
}): JSX.Element => (
  <button
    class={sx(topbar.button, props.tight && s.tight)}
    aria-label={props.label}
    title={props.label}
    disabled={props.disabled}
    onClick={() => props.onClick()}
  >
    <Icon icon={props.icon} {...ICON} />
  </button>
);

// Beside the window's buttons: on the sidebar's top row, or the main bar's while it's hidden.
export const AppButtons = (): JSX.Element => (
  <>
    <TopButton
      label={sidebarOpen() ? "Hide sidebar" : "Show sidebar"}
      icon={sidebarIcon(sidebarOpen())}
      onClick={() => setSidebarOpen(!sidebarOpen())}
    />
    <TopButton label="Search" icon={i.Search01Icon} onClick={() => setDialog({ kind: "search" })} />
  </>
);

// Back and forward through the pages you've opened, side by side before the main bar's title.
export const HistoryButtons = (): JSX.Element => (
  <span class={sx(s.history)}>
    <TopButton
      label="Back (⌘[)"
      icon={i.ArrowLeft01Icon}
      tight
      disabled={!canGoBack()}
      onClick={goBack}
    />
    <TopButton
      label="Forward (⌘])"
      icon={i.ArrowRight01Icon}
      tight
      disabled={!canGoForward()}
      onClick={goForward}
    />
  </span>
);

// The top bar, the tabs, and the chosen tab's list.
export function Sidebar(): JSX.Element {
  const [chosen, choose] = createSignal(TABS[0]);
  const profile = (): boolean => (view() as { person?: string }).person === me().id;
  return (
    <aside class={sx(s.sidebar)} style={{ width: `${width()}px` }}>
      <div class={sx(topbar.bar, s.topbar)}>
        <AppButtons />
        <span class={sx(topbar.end)}>
          <TopButton
            label="New thread"
            icon={i.PencilEdit02Icon}
            onClick={() => setDialog({ kind: "newThread" })}
          />
        </span>
      </div>
      <div class={sx(s.tabs)}>
        <Tabs label="Sidebar" tabs={TABS} chosen={chosen()} onChoose={choose} />
        <button
          class={sx(base.bare, base.hover, tab.tab, s.end, profile() && tab.on)}
          aria-pressed={profile() ? "true" : "false"}
          aria-label="Your profile"
          title="Your profile"
          onClick={() => open({ person: me().id })}
        >
          <Identicon seed={me().id} size={14} />
        </button>
      </div>
      <div class={sx(s.content)}>
        <Dynamic component={chosen().tab} />
      </div>
      <hr
        class={sx(s.edge)}
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        onPointerDown={resize}
        onDblClick={() => keepWidth(WIDTH.initial)}
      />
    </aside>
  );
}
