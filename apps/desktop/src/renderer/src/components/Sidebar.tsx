import * as i from "@hugeicons/core-free-icons";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Draft, InboxItem, Message, Thread, User } from "models";
import {
  active,
  chooseMailbox,
  drafts,
  inbox,
  itemFor,
  listed,
  mailbox,
  mailboxTitle,
  markDone,
  markUndone,
  myBuckets,
  open,
  placeIn,
  sameMailbox,
  save,
  saved,
  setDialog,
  shortDate,
  shown,
  showMenu,
  store,
  theme,
  threadMenu,
  unread,
  view,
  type Mailbox,
  type MenuItem,
} from "../session";
import { bucketIcons } from "../bucketIcons";
import { keysFor } from "../hotkeys";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii, slackSidebar } from "../styles/tokens.stylex";
import { icon, Icon, type IconSvgElement } from "./Icon";
import { MenuChip } from "./Menus";
import { plain } from "./ThreadView";

// Things 3's way of showing a list: a quiet sidebar of coloured places, a page with a big title and plain rows that
// each start with a checkbox, and a toolbar along the foot.

// Things' colours for its places, one for each kind of list.
const TINT = {
  blue: "#3d8ef6",
  yellow: "#f6c032",
  red: "#ef4a5f",
  teal: "#4fb3a4",
  beige: "#c7b386",
  green: "#59bf63",
  purple: "#a77cf0",
  gray: "#8e8e93",
} as const;
// Buckets take these in turn, as Things' areas would.
const BUCKET_TINTS = [TINT.yellow, TINT.red, TINT.teal, TINT.purple, TINT.beige, TINT.green];

const tintOf = (box: Mailbox): string => {
  if (box.kind === "inbox") return TINT.blue;
  if (box.kind === "all") return TINT.teal;
  if (box.kind === "done") return TINT.green;
  if (box.kind === "drafts") return TINT.beige;
  if (box.kind === "unsorted") return TINT.gray;
  const at = myBuckets().findIndex((b) => b.id === box.id);
  return BUCKET_TINTS[Math.max(0, at) % BUCKET_TINTS.length];
};
const iconOf = (box: Mailbox): IconSvgElement => {
  if (box.kind === "inbox") return i.InboxIcon;
  if (box.kind === "all") return i.Layers01Icon;
  if (box.kind === "done") return i.CheckmarkSquare02Icon;
  if (box.kind === "drafts") return i.Archive02Icon;
  if (box.kind === "unsorted") return i.Clock01Icon;
  return bucketIcons(myBuckets()).get(box.id) ?? i.InboxIcon;
};

// A column the edge on its right resizes, remembering its width.
function resizable(key: string, range: { initial: number; min: number; max: number }) {
  const clamp = (px: number): number => Math.min(range.max, Math.max(range.min, Math.round(px)));
  const [width, setWidth] = createSignal(clamp(saved(key, range.initial)));
  const keep = (px: number): void => {
    setWidth(px);
    save(key, px);
  };
  const drag = (event: PointerEvent): void => {
    const edge = event.currentTarget as HTMLElement;
    const start = event.clientX;
    const from = width();
    edge.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent): void => void setWidth(clamp(from + e.clientX - start));
    const up = (): void => {
      edge.removeEventListener("pointermove", move);
      keep(width());
    };
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", up, { once: true });
  };
  const Edge = (props: { label: string }): JSX.Element => (
    <hr
      class={sx(s.edge)}
      aria-label={props.label}
      aria-orientation="vertical"
      onPointerDown={drag}
      onDblClick={() => keep(range.initial)}
    />
  );
  return { width, Edge };
}

const sidebarColumn = resizable("things-sidebar-width", { initial: 220, min: 180, max: 320 });

// ── The sidebar: places, in loose groups ──

function Place(props: { box: Mailbox; label: string; count?: number; menu?: () => MenuItem[] }) {
  const on = (): boolean => sameMailbox(mailbox(), props.box) && !active();
  const choose = (): void => {
    chooseMailbox(props.box);
    // Choosing a place shows its list, as Things does, whatever was open.
    open({ thread: null });
  };
  return (
    <li>
      <div
        role="button"
        tabindex={0}
        aria-current={on() ? "true" : undefined}
        class={sx(s.place, on() && s.placeOn)}
        onClick={choose}
        onContextMenu={(e) => {
          const items = props.menu?.();
          if (items) showMenu(e, items);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          choose();
        }}
      >
        <span class={sx(s.placeIcon)} style={{ color: tintOf(props.box) }}>
          <Icon icon={iconOf(props.box)} size={15} aria-hidden="true" />
        </span>
        <span class={sx(base.ellipsis, s.placeName)}>{props.label}</span>
        <Show when={props.count}>
          <span class={sx(s.count)}>{props.count}</span>
        </Show>
      </div>
    </li>
  );
}

// Swaps a bucket with its neighbour above (-1) or below (1).
function moveBucket(bucket: Bucket, by: number): void {
  const buckets = myBuckets();
  const other = buckets[buckets.indexOf(bucket) + by];
  if (!other) return;
  [bucket.position, other.position] = [other.position, bucket.position];
  bucket.save();
  other.save();
}

function bucketMenu(bucket: Bucket): MenuItem[] {
  const buckets = myBuckets();
  const at = buckets.indexOf(bucket);
  return [
    {
      label: "Edit Bucket",
      icon: icon(i.PencilEdit01Icon, 13),
      run: () => setDialog({ kind: "bucket", bucket }),
    },
    {
      label: "New Bucket",
      icon: icon(i.Add01Icon, 13),
      run: () => setDialog({ kind: "bucket" }),
    },
    "separator",
    ...(at > 0 ? [{ label: "Move Up", run: () => moveBucket(bucket, -1) }] : []),
    ...(at < buckets.length - 1 ? [{ label: "Move Down", run: () => moveBucket(bucket, 1) }] : []),
    // Sorting needs somewhere to put things.
    ...(buckets.length > 1
      ? [
          "separator" as const,
          {
            label: "Delete Bucket",
            icon: icon(i.Delete02Icon, 13),
            run: () => void bucket.delete(),
          },
        ]
      : []),
  ];
}

export function Sidebar(): JSX.Element {
  return (
    <aside
      class={stylex.attrs(s.sidebar, theme() === "slack" && slackSidebar).class}
      style={{ width: `${sidebarColumn.width()}px` }}
    >
      {/* Clear of the window's buttons, with nothing else up there: Things keeps its top bare. */}
      <nav class={sx(s.nav)} aria-label="Places">
        <ul class={sx(base.list, s.group)}>
          <Place
            box={{ kind: "inbox" }}
            label="Buckets"
            count={inbox().order.length}
            menu={() => [
              {
                label: "New Bucket",
                icon: icon(i.Add01Icon, 13),
                run: () => setDialog({ kind: "bucket" }),
              },
            ]}
          />
        </ul>
        <ul class={sx(base.list, s.group)}>
          <Show when={inbox().unsorted.length > 0}>
            <Place box={{ kind: "unsorted" }} label="Sorting" count={inbox().unsorted.length} />
          </Show>
          <For each={inbox().sections}>
            {(section) => (
              <Place
                box={{ kind: "bucket", id: section.bucket.id }}
                label={section.bucket.name}
                count={section.items.length}
                menu={() => bucketMenu(section.bucket)}
              />
            )}
          </For>
        </ul>
        <ul class={sx(base.list, s.group)}>
          <Place box={{ kind: "all" }} label="All Threads" />
          <Place box={{ kind: "drafts" }} label="Drafts" count={drafts().length} />
        </ul>
        <ul class={sx(base.list, s.group)}>
          <Place box={{ kind: "done" }} label="Done" />
        </ul>
      </nav>
      {/* As Things' foot: a new list on the left, settings on the right. */}
      <div class={sx(s.foot)}>
        <button
          class={sx(base.bare, s.footButton)}
          title={`New Thread (${keysFor("newThread")})`}
          onClick={() => setDialog({ kind: "newThread" })}
        >
          <Icon icon={i.Add01Icon} size={12} aria-hidden="true" />
          New Thread
        </button>
        <button
          class={sx(base.bare, s.footIcon)}
          aria-label="Settings"
          title={`Settings (${keysFor("settings")})`}
          onClick={() => open({ settings: null })}
        >
          <Icon icon={i.SlidersHorizontalIcon} size={14} aria-hidden="true" />
        </button>
      </div>
      <sidebarColumn.Edge label="Resize Sidebar" />
    </aside>
  );
}

// ── The page: a big title and plain rows ──

// As Mail stamps a message: the time today, "Yesterday", then the date.
function stamp(date: Date): string {
  const today = new Date();
  const day = (d: Date): number => new Date(d).setHours(0, 0, 0, 0);
  if (day(date) === day(today))
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (day(today) - day(date) === 86_400_000) return "Yesterday";
  return shortDate(date);
}

// What a message says, without the @mentions most start with.
const mentionNames = store.view(() => store.all(User).map((u) => `@${u.name} `));
function preview(body: string): string {
  let text = plain(body);
  const names = mentionNames();
  let lead = names.find((name) => text.startsWith(name));
  while (lead) {
    text = text.slice(lead.length);
    lead = names.find((name) => text.startsWith(name));
  }
  return text;
}

// Things' checkbox: a rounded square that fills with a tick. Ticking one waits a moment, so you see it ticked,
// before the thread leaves the list, as a to-do does.
function Checkbox(props: { item?: InboxItem }): JSX.Element {
  const [ticking, setTicking] = createSignal(false);
  const ticked = (): boolean => ticking() || !!props.item?.doneAt;
  return (
    <Show
      when={props.item}
      fallback={
        <span class={sx(s.bubble)} aria-hidden="true">
          <Icon icon={i.Message01Icon} size={13} />
        </span>
      }
    >
      {(item) => (
        <button
          class={sx(base.bare, s.check, ticked() && s.checkOn)}
          role="checkbox"
          aria-checked={ticked() ? "true" : "false"}
          aria-label={ticked() ? "Back to your buckets" : "Mark done"}
          title={ticked() ? "Back to your buckets" : `Mark done (${keysFor("done")})`}
          onClick={(event) => {
            event.stopPropagation();
            if (item().doneAt) return markUndone(item());
            setTicking(true);
            setTimeout(() => {
              setTicking(false);
              markDone(item());
            }, 450);
          }}
        >
          <Show when={ticked()}>
            <Icon icon={i.Tick02Icon} size={11} aria-hidden="true" />
          </Show>
        </button>
      )}
    </Show>
  );
}

// A thread as a to-do: its checkbox, a yellow dot while there's something new, its title, who wrote last and what,
// and when.
function Row(props: { thread: Thread }): JSX.Element {
  const t = (): Thread => props.thread;
  const on = (): boolean => active() === t();
  const item = (): InboxItem | undefined => itemFor(t());
  const isUnread = (): boolean => {
    const it = item();
    return it !== undefined && !it.doneAt && unread(it);
  };
  const last = createMemo(() => {
    let latest: Message | undefined;
    for (const message of t().messages)
      if (!latest || message.createdAt > latest.createdAt) latest = message;
    return latest;
  });
  return (
    <li>
      <div
        role="button"
        tabindex={0}
        aria-current={on() ? "true" : undefined}
        class={sx(s.row, on() && s.rowOn)}
        onClick={() => open({ thread: t().id })}
        onContextMenu={(e) => showMenu(e, threadMenu(t()))}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          open({ thread: t().id });
        }}
      >
        <Checkbox item={item()} />
        <Show when={isUnread()}>
          <span class={sx(s.newDot)} aria-label="New" />
        </Show>
        <span class={sx(base.ellipsis, s.rowTitle, !!item()?.doneAt && s.rowDone)}>
          {t().title}
        </span>
        <Show when={last()}>
          {(message) => (
            <span class={sx(base.ellipsis, s.rowNote)}>
              {message().author?.name ?? "Someone"}: {preview(message().body)}
            </span>
          )}
        </Show>
        <span class={sx(s.rowWhen)}>{stamp(last()?.createdAt ?? t().createdAt)}</span>
      </div>
    </li>
  );
}

function DraftRow(props: { draft: Draft }): JSX.Element {
  const title = (): string =>
    props.draft.draft?.title || props.draft.text.split("\n")[0] || "Untitled draft";
  return (
    <li>
      <div
        role="button"
        tabindex={0}
        class={sx(s.row, shown("draft") === props.draft.id && s.rowOn)}
        onClick={() => open({ draft: props.draft.id })}
        onContextMenu={(e) =>
          showMenu(e, [
            {
              label: "Delete Draft",
              icon: icon(i.Delete02Icon, 13),
              run: () => void props.draft.delete(),
            },
          ])
        }
      >
        <span class={sx(s.bubble)} aria-hidden="true">
          <Icon icon={i.NoteEditIcon} size={13} />
        </span>
        <span class={sx(base.ellipsis, s.rowTitle)}>{title()}</span>
        <span class={sx(s.rowWhen)}>{stamp(props.draft.updatedAt)}</span>
      </div>
    </li>
  );
}

// Keeps the chosen place real: opening a draft shows Drafts, and a bucket that's gone goes back to Buckets.
export function useMailboxUpkeep(): void {
  createEffect(view, (next) => {
    if ("draft" in next && mailbox().kind !== "drafts") chooseMailbox({ kind: "drafts" });
  });
  createEffect(
    () => {
      const box = mailbox();
      return box.kind === "bucket" && !store.findById(Bucket, box.id);
    },
    (gone) => void (gone && chooseMailbox({ kind: "inbox" })),
  );
}

// The chosen place as Things shows a list: its icon and title, its notes (a bucket's description), then its rows under
// their headings.
export function ListPage(): JSX.Element {
  const box = (): Mailbox => mailbox();
  const isDrafts = (): boolean => box().kind === "drafts";
  const total = (): number => (isDrafts() ? drafts().length : listed().order.length);
  const notes = (): string | undefined => {
    const b = box();
    return b.kind === "bucket" ? store.findById(Bucket, b.id)?.description : undefined;
  };
  return (
    <div class={sx(s.page)}>
      <div class={sx(s.column)}>
        <h1 class={sx(s.title)}>
          <span class={sx(s.titleIcon)} style={{ color: tintOf(box()) }}>
            <Icon icon={iconOf(box())} size={22} aria-hidden="true" />
          </span>
          {mailboxTitle(box())}
        </h1>
        <Show when={notes()}>{(text) => <p class={sx(s.notes)}>{text()}</p>}</Show>
        <Show
          when={isDrafts()}
          fallback={
            <For each={listed().groups}>
              {(group) => (
                <section class={sx(s.section)}>
                  <Show when={box().kind === "inbox"}>
                    <h2
                      class={sx(s.heading)}
                      onContextMenu={(e) => {
                        if (group.bucket) showMenu(e, bucketMenu(group.bucket));
                      }}
                    >
                      {group.bucket?.name ?? group.title}
                    </h2>
                  </Show>
                  <ul class={sx(base.list)}>
                    <For each={group.threads}>{(thread) => <Row thread={thread} />}</For>
                  </ul>
                </section>
              )}
            </For>
          }
        >
          <ul class={sx(base.list, s.section)}>
            <For each={drafts()}>{(draft) => <DraftRow draft={draft} />}</For>
          </ul>
        </Show>
        {/* Things leaves an empty list to its faint icon. */}
        <Show when={total() === 0}>
          <div class={sx(s.empty)} style={{ color: tintOf(box()) }}>
            <Icon icon={iconOf(box())} size={56} aria-hidden="true" />
          </div>
        </Show>
      </div>
    </div>
  );
}

// ── The toolbar along the page's foot ──

function ToolButton(props: {
  label: string;
  icon: IconSvgElement;
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      class={sx(base.bare, s.tool)}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={() => props.onClick?.()}
    >
      <Icon icon={props.icon} size={15} aria-hidden="true" />
    </button>
  );
}

// New, Done and Move for the thread that's open (as Things' when and move), and Search.
export function Toolbar(): JSX.Element {
  const item = (): InboxItem | undefined => {
    const t = active();
    const it = t && itemFor(t);
    return it && !it.doneAt ? it : undefined;
  };
  return (
    <div class={sx(s.toolbar)}>
      <ToolButton
        label={`New Thread (${keysFor("newThread")})`}
        icon={i.Add01Icon}
        onClick={() => setDialog({ kind: "newThread" })}
      />
      <ToolButton
        label={`Mark Done (${keysFor("done")})`}
        icon={i.CheckmarkSquare02Icon}
        disabled={!item()}
        onClick={() => {
          const it = item();
          if (it) markDone(it);
        }}
      />
      <Show
        when={item()}
        fallback={<ToolButton label="Move to a Bucket" icon={i.ArrowRight02Icon} disabled />}
      >
        {(it) => (
          <MenuChip
            look={[base.bare, s.tool]}
            title="Move to a Bucket"
            label={<Icon icon={i.ArrowRight02Icon} size={15} aria-hidden="true" />}
            items={myBuckets().map((bucket) => ({
              label: bucket.name,
              checked: it().bucketId === bucket.id,
              run: () => placeIn(it(), bucket),
            }))}
          />
        )}
      </Show>
      <ToolButton
        label={`Search (${keysFor("search")})`}
        icon={i.Search01Icon}
        onClick={() => setDialog({ kind: "search" })}
      />
    </div>
  );
}

// Things' sizes are its points ÷ 1.1 here, for the renderer's 110% scale.
const s = stylex.create({
  edge: {
    position: "absolute",
    top: 0,
    right: -3,
    bottom: 0,
    zIndex: 1,
    width: 5,
    margin: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    cursor: "col-resize",
  },

  sidebar: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    backgroundColor: colors.sidebar,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
  },
  // Under the window's buttons, the first place a little below them.
  nav: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: 16,
    minHeight: 0,
    padding: "46px 10px 12px",
    overflowY: "auto",
  },
  group: { display: "flex", flexDirection: "column", gap: 1 },
  place: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    height: 24,
    padding: "0 8px 0 6px",
    borderRadius: 6,
    color: colors.textPrimary,
    fontSize: fontSizes.name,
    fontWeight: 500,
    cursor: "default",
    outline: "none",
  },
  placeOn: { backgroundColor: colors.bgTertiary },
  placeIcon: { display: "flex", flexShrink: 0, justifyContent: "center", width: 18 },
  placeName: { flex: 1 },
  count: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    fontVariantNumeric: "tabular-nums",
  },
  foot: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    height: 34,
    padding: "0 12px 0 14px",
  },
  footButton: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    fontSize: fontSizes.body,
    cursor: "pointer",
  },
  footIcon: {
    display: "flex",
    color: { default: colors.iconTertiary, ":hover": colors.textPrimary },
    cursor: "pointer",
  },

  page: { flex: 1, minHeight: 0, overflowY: "auto" },
  // Things' page: one column in the middle, its title well down from the top.
  column: { maxWidth: 680, margin: "0 auto", padding: "30px 40px 64px" },
  title: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    margin: 0,
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.01em",
  },
  titleIcon: { display: "flex" },
  notes: { margin: "8px 0 0", color: colors.textSecondary, fontSize: fontSizes.name },
  section: { marginTop: 22 },
  // A heading in a list: bold, in the accent, over a hairline.
  heading: {
    margin: "0 0 6px",
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
    color: colors.accent,
    fontSize: fontSizes.name,
    fontWeight: 700,
  },
  row: {
    display: "flex",
    gap: 9,
    alignItems: "center",
    height: 30,
    margin: "0 -8px",
    padding: "0 8px",
    borderRadius: 6,
    color: colors.textPrimary,
    fontSize: fontSizes.name,
    cursor: "default",
    outline: "none",
  },
  rowOn: { backgroundColor: colors.bgTertiary },
  check: {
    display: "grid",
    flexShrink: 0,
    placeItems: "center",
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: colors.iconTertiary,
    borderRadius: 4,
    color: "#ffffff",
    cursor: "pointer",
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
  },
  checkOn: { borderColor: TINT.blue, backgroundColor: TINT.blue },
  bubble: {
    display: "flex",
    flexShrink: 0,
    justifyContent: "center",
    width: 14,
    color: colors.iconTertiary,
  },
  newDot: {
    flexShrink: 0,
    width: 7,
    height: 7,
    marginRight: -3,
    borderRadius: "50%",
    backgroundColor: TINT.yellow,
  },
  rowTitle: { flexShrink: 0, maxWidth: "60%" },
  rowDone: { color: colors.textTertiary },
  rowNote: { flex: 1, color: colors.textTertiary, fontSize: fontSizes.body },
  rowWhen: {
    flexShrink: 0,
    marginLeft: "auto",
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontVariantNumeric: "tabular-nums",
  },
  empty: { display: "flex", justifyContent: "center", paddingTop: 120, opacity: 0.25 },

  toolbar: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-evenly",
    height: 34,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.strokeTertiary,
  },
  tool: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 24,
    borderRadius: radii.control,
    color: colors.iconTertiary,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": colors.bgTertiary },
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.35 },
  },
});
