import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Draft, Message, Thread, User } from "models";
import {
  active,
  allThreads,
  canGoBack,
  canGoForward,
  chooseMailbox,
  drafts,
  goBack,
  goForward,
  inbox,
  itemFor,
  listed,
  mailbox,
  mailboxTitle,
  me,
  myBuckets,
  open,
  sameMailbox,
  save,
  saved,
  setDialog,
  setSidebarOpen,
  shortDate,
  theme,
  shown,
  showMenu,
  sidebarOpen,
  store,
  threadMenu,
  unread,
  view,
  type Mailbox,
  type MenuItem,
} from "../session";
import { keysFor } from "../hotkeys";
import { base } from "../styles/base";
import { topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii, slackSidebar, space } from "../styles/tokens.stylex";
import { icon, Icon, type IconName } from "./Icon";
import { Identicon } from "./Identicon";
import { plain } from "./ThreadView";

// Mail's three columns: the mailboxes, the chosen one's threads, and (in App) the thread you're reading.

const ICON = { size: 14, "aria-hidden": "true" } as const;

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

const sidebarColumn = resizable("mail-sidebar-width", { initial: 220, min: 180, max: 320 });
const listColumn = resizable("mail-list-width", { initial: 340, min: 280, max: 600 });

// ── The top bars' buttons ──

export const TopButton = (props: {
  label: string;
  icon: IconName;
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

// Beside the window's buttons: the sidebar's toggle (search is ⌘K), on the sidebar's top row or the list's while it's
// hidden.
export const AppButtons = (): JSX.Element => (
  <>
    <TopButton
      label={sidebarOpen() ? "Hide sidebar" : "Show sidebar"}
      icon={"layout"}
      onClick={() => setSidebarOpen(!sidebarOpen())}
    />
  </>
);

// Back and forward through the pages you've opened, side by side before the list's title.
export const HistoryButtons = (): JSX.Element => (
  <span class={sx(s.history)}>
    <TopButton
      label={`Back (${keysFor("back")})`}
      icon={"nav-back"}
      tight
      disabled={!canGoBack()}
      onClick={goBack}
    />
    <TopButton
      label={`Forward (${keysFor("forward")})`}
      icon={"nav-forward"}
      tight
      disabled={!canGoForward()}
      onClick={goForward}
    />
  </span>
);

// ── The sidebar: mailboxes ──

// A mailbox in the sidebar: its icon, name and count.
// Thunderbird's folder colours (folderColors.css), light and dark: the inbox blue, folders yellow, the archive brown,
// drafts purple.
const FOLDER = {
  inbox: "light-dark(#1373d9, #58c9ff)",
  folder: "light-dark(#eabd08, #fee78a)",
  archive: "light-dark(#713f12, #fee78a)",
  draft: "light-dark(#ae55f7, #ddb4fe)",
};

function MailboxRow(props: {
  box: Mailbox;
  label: string;
  icon: IconName;
  // Its icon's colour (FOLDER).
  color?: string;
  count?: number;
  indent?: boolean;
  // What right-clicking it offers.
  menu?: () => MenuItem[];
}): JSX.Element {
  const on = (): boolean => sameMailbox(mailbox(), props.box);
  return (
    <li>
      <div
        role="button"
        tabindex={0}
        aria-current={on() ? "true" : undefined}
        class={sx(s.mailbox, props.indent && s.indent, on() && s.selected)}
        onClick={() => chooseMailbox(props.box)}
        onContextMenu={(e) => {
          const items = props.menu?.();
          if (items) showMenu(e, items);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          chooseMailbox(props.box);
        }}
      >
        <span class={sx(s.mailboxIcon)} style={{ color: props.color }}>
          <Icon icon={props.icon} {...ICON} />
        </span>
        <span class={sx(base.clip, s.mailboxName)}>{props.label}</span>
        {/* Even none, so a mailbox reads as empty rather than uncounted. */}
        <Show when={props.count !== undefined}>
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
      icon: icon("pencil", 13),
      run: () => setDialog({ kind: "bucket", bucket }),
    },
    {
      label: "New Bucket",
      icon: icon("add", 13),
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
            icon: icon("trash", 13),
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
      {/* Your inbox and its buckets, then every thread, then your drafts. */}
      <nav class={sx(s.nav)} aria-label="Mailboxes">
        <ul class={sx(base.list, s.stack)}>
          <MailboxRow
            box={{ kind: "inbox" }}
            label="Buckets"
            icon={"inbox"}
            color={FOLDER.inbox}
            count={inbox().order.length}
            menu={() => [
              {
                label: "New Bucket",
                icon: icon("add", 13),
                run: () => setDialog({ kind: "bucket" }),
              },
            ]}
          />
          <Show when={inbox().unsorted.length > 0}>
            <MailboxRow
              box={{ kind: "unsorted" }}
              label="Sorting"
              icon={"folder"}
              color={FOLDER.folder}
              count={inbox().unsorted.length}
              indent
            />
          </Show>
          {/* Your buckets, under the inbox they sort. */}
          <For each={inbox().sections}>
            {(section) => (
              <MailboxRow
                box={{ kind: "bucket", id: section.bucket.id }}
                label={section.bucket.name}
                icon={"folder"}
                color={FOLDER.folder}
                count={section.items.length}
                indent
                menu={() => bucketMenu(section.bucket)}
              />
            )}
          </For>
        </ul>
        <ul class={sx(base.list, s.stack, s.nearby)}>
          <MailboxRow
            box={{ kind: "all" }}
            label="All Threads"
            icon={"archive"}
            color={FOLDER.archive}
            count={allThreads().length}
          />
          <MailboxRow
            box={{ kind: "drafts" }}
            label="Drafts"
            icon={"draft"}
            color={FOLDER.draft}
            count={drafts().length}
          />
        </ul>
        {/* Thunderbird's primary button, under the mailboxes it files into. */}
        <button
          class={sx(base.bare, s.newMessage)}
          title={`New Message (${keysFor("newThread")})`}
          onClick={() => setDialog({ kind: "newThread" })}
        >
          <span class={sx(s.newMessageIcon)}>
            <Icon icon="add" aria-hidden="true" />
          </span>
          New Message
        </button>
      </nav>
      <div class={sx(s.footer)}>
        {/* You: one button to your profile and settings, on one page. */}
        <button
          class={sx(base.bare, s.profile)}
          aria-label="Profile and Settings"
          title={`Profile and Settings (${keysFor("settings")})`}
          onClick={() => open({ settings: null })}
        >
          <Identicon seed={me().id} size={18.18} />
          <span class={sx(base.clip)}>{me().name}</span>
        </button>
      </div>
      <sidebarColumn.Edge label="Resize Sidebar" />
    </aside>
  );
}

// ── The list: the chosen mailbox's threads ──

// As Mail stamps a message: the time today, "Yesterday", then the date.
function stamp(date: Date): string {
  const today = new Date();
  const day = (d: Date): number => new Date(d).setHours(0, 0, 0, 0);
  if (day(date) === day(today))
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (day(today) - day(date) === 86_400_000) return "Yesterday";
  return shortDate(date);
}

// What a message says, without the @mentions most start with (the list shows who it's from already).
// Everyone's @name, once for every row rather than per row.
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

// A thread as Mail lists a message: its title and when, then who wrote last and the start of what they wrote.
function Row(props: { thread: Thread }): JSX.Element {
  const t = (): Thread => props.thread;
  const on = (): boolean => active() === t();
  const isUnread = (): boolean => {
    const it = itemFor(t());
    return it !== undefined && !it.doneAt && unread(it);
  };
  // Its latest message, found once (a pass, not a sort) for the places that show it.
  const last = createMemo(() => {
    let latest: Message | undefined;
    for (const message of t().messages)
      if (!latest || message.createdAt > latest.createdAt) latest = message;
    return latest;
  });
  const from = () => last()?.author ?? t().owner;
  let row!: HTMLDivElement;
  // The open thread stays in view as J and K (or the arrows) move past the rows showing.
  createEffect(on, (shown) => {
    if (shown) row.scrollIntoView({ block: "nearest" });
  });
  return (
    <li>
      <div
        ref={row}
        role="button"
        tabindex={on() ? 0 : -1}
        data-active={on() ? "" : undefined}
        aria-current={on() ? "true" : undefined}
        class={sx(s.row, on() && s.selected)}
        onClick={() => open({ thread: t().id })}
        onContextMenu={(e) => showMenu(e, threadMenu(t()))}
      >
        <span class={sx(s.rowBody)}>
          {/* What it's about first, then who wrote last: the topic is what you scan a list for. */}
          <span class={sx(s.rowTop)}>
            <span class={sx(s.subjectLine)}>
              <span class={sx(base.clip, s.subject)}>{t().title}</span>
            </span>
            {/* Unread: a dot before when, on the right, so read rows lose no width to an empty column. */}
            <span class={sx(s.stamp)}>
              <Show when={isUnread()}>
                <span class={sx(s.unreadDot)} aria-label="Unread" />
              </Show>
              {stamp(last()?.createdAt ?? t().createdAt)}
            </span>
          </span>
          <span class={sx(s.second)}>
            <span class={sx(s.preview)}>
              <span class={sx(s.from)}>{from()?.name ?? ""}</span>
              <Show when={last()}>{(message) => <> {preview(message().body)}</>}</Show>
            </span>
          </span>
        </span>
      </div>
    </li>
  );
}

const draftTitle = (draft: Draft): string =>
  draft.draft?.title || draft.text.split("\n")[0] || "Untitled draft";

// A draft in Drafts, which opens back in Compose.
function DraftRow(props: { draft: Draft }): JSX.Element {
  // Its drafted title, else its first line; the rest is the preview.
  const lines = (): string[] => props.draft.text.split("\n");
  const rest = (): string =>
    props.draft.draft?.title ? props.draft.text : lines().slice(1).join(" ");
  const on = (): boolean => shown("draft") === props.draft.id;
  return (
    <li>
      <div
        role="button"
        tabindex={0}
        data-active={on() ? "" : undefined}
        aria-current={on() ? "true" : undefined}
        class={sx(s.row, on() && s.selected)}
        onClick={() => open({ draft: props.draft.id })}
        onContextMenu={(e) =>
          showMenu(e, [
            {
              label: "Open Draft",
              icon: icon("draft", 13),
              run: () => open({ draft: props.draft.id }),
            },
            "separator",
            {
              label: "Delete Draft",
              icon: icon("trash", 13),
              run: () => void props.draft.delete(),
            },
          ])
        }
      >
        <span class={sx(s.rowBody)}>
          <span class={sx(s.rowTop)}>
            <span class={sx(base.clip, s.from)}>{draftTitle(props.draft)}</span>
            <span class={sx(s.stamp)}>{stamp(props.draft.updatedAt)}</span>
          </span>
          <Show when={rest()}>
            <span class={sx(s.second)}>
              <span class={sx(s.preview)}>{rest()}</span>
            </span>
          </Show>
        </span>
      </div>
    </li>
  );
}

// `alone`, with nothing open beside it: it takes the window.
export function MessageList(props: { alone?: boolean }): JSX.Element {
  // Opening a draft (from ⌘K, say) lists the drafts.
  createEffect(view, (next) => {
    if ("draft" in next && mailbox().kind !== "drafts") chooseMailbox({ kind: "drafts" });
  });
  // A bucket that's gone (deleted here or elsewhere) goes back to the inbox rather than an empty list with no name.
  createEffect(
    () => {
      const box = mailbox();
      return box.kind === "bucket" && !store.findById(Bucket, box.id);
    },
    (gone) => void (gone && chooseMailbox({ kind: "inbox" })),
  );
  const isDrafts = (): boolean => mailbox().kind === "drafts";
  const total = (): number => (isDrafts() ? drafts().length : listed().order.length);
  const unreadCount = (): number =>
    listed().order.filter((t) => {
      const it = itemFor(t);
      return it !== undefined && !it.doneAt && unread(it);
    }).length;
  const subtitle = (): string => {
    const n = unreadCount();
    if (n > 0) return `${n} unread`;
    const count = total();
    const noun = isDrafts() ? "draft" : "thread";
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  };
  let list!: HTMLDivElement;
  // ↑ and ↓ move through the list, as in Mail (J and K do too, anywhere).
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const order = listed().order;
    if (order.length === 0) return;
    event.preventDefault();
    const at = order.indexOf(active()!);
    const next =
      event.key === "ArrowDown"
        ? order[Math.min(order.length - 1, at + 1)]
        : order[Math.max(0, at - 1)];
    open({ thread: next.id });
    queueMicrotask(() => list.querySelector<HTMLElement>("[data-active]")?.focus());
  };
  return (
    <section
      class={sx(s.list, props.alone && s.listAlone)}
      style={{ width: props.alone ? undefined : `${listColumn.width()}px` }}
      aria-label={mailboxTitle(mailbox())}
    >
      {/* The mailbox's name and count, heading the list (the toolbar above runs across the window). */}
      <div class={sx(s.listHeader)}>
        <span class={sx(s.listHeading)}>
          <span class={sx(base.clip, s.listTitle)}>{mailboxTitle(mailbox())}</span>
          <span class={sx(s.listSubtitle)}>{subtitle()}</span>
        </span>
      </div>
      <div
        ref={list}
        class={sx(s.listScroll)}
        onMouseDown={() =>
          queueMicrotask(() => list.querySelector<HTMLElement>("[data-active]")?.focus())
        }
        onKeyDown={onKeyDown}
      >
        <Show
          when={isDrafts()}
          fallback={
            <For each={listed().groups}>
              {(group) => (
                <>
                  <Show when={mailbox().kind === "inbox"}>
                    <div
                      class={sx(s.groupHeader)}
                      onContextMenu={(e) => {
                        if (group.bucket) showMenu(e, bucketMenu(group.bucket));
                      }}
                    >
                      <Icon
                        icon="folder"
                        style={{ color: FOLDER.folder }}
                        size={11}
                        aria-hidden="true"
                      />
                      {group.bucket?.name ?? group.title}
                      <span class={sx(s.groupCount)}>{group.threads.length}</span>
                    </div>
                  </Show>
                  <ul class={sx(base.list, s.stack)}>
                    <For each={group.threads}>{(thread) => <Row thread={thread} />}</For>
                  </ul>
                </>
              )}
            </For>
          }
        >
          <ul class={sx(base.list, s.stack)}>
            <For each={drafts()}>{(draft) => <DraftRow draft={draft} />}</For>
          </ul>
        </Show>
        <Show when={total() === 0}>
          <div class={sx(s.empty)}>
            <Icon
              icon={mailbox().kind === "inbox" ? "inbox" : "inbox"}
              size={28}
              aria-hidden="true"
            />
            <span class={sx(s.emptyTitle)}>
              {mailbox().kind === "inbox" ? "All caught up" : "Nothing here"}
            </span>
            <Show when={mailbox().kind === "inbox"}>
              <span>Nothing in your buckets needs you right now.</span>
            </Show>
          </div>
        </Show>
      </div>
      <Show when={!props.alone}>
        <listColumn.Edge label="Resize List" />
      </Show>
    </section>
  );
}

const s = stylex.create({
  // The resize edge on a column's right.
  edge: {
    position: "absolute",
    top: 0,
    right: -3,
    bottom: 0,
    zIndex: 1,
    width: 5,
    margin: 0,
    borderStyle: "none",
    // Invisible: only the cursor says it's there; the column's own border is the line.
    backgroundColor: "transparent",
    cursor: "col-resize",
  },
  history: { display: "flex", marginRight: 6 },
  tight: { width: 18 },

  sidebar: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    backgroundColor: colors.chrome,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
  },
  // Under the top bar, its first line where every column's starts (17pt under the top bar). Each size here is the
  // macOS app's points ÷ 1.1, for the 110% scale.
  nav: {
    flex: 1,
    minHeight: 0,
    paddingTop: 8.37,
    paddingInline: space.inset,
    paddingBottom: 12,
    overflowY: "auto",
  },
  // Thunderbird's primary button: its accent (blue-60, lighter in dark) with the accent's text colour, 3px corners,
  // darker under the pointer.
  newMessage: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: 25,
    marginTop: 12,
    borderRadius: 3,
    color: "light-dark(#ffffff, #18181b)",
    backgroundColor: {
      default: "light-dark(#1373d9, #58c9ff)",
      ":hover": "light-dark(#0f5cae, #46a1cc)",
      ":active": "light-dark(#0d5098, #3d8db3)",
    },
    fontSize: fontSizes.body,
    fontWeight: 600,
    // One line exactly the text's height, so the label centres on the plus rather than riding its line box.
    lineHeight: 1,
    cursor: "default",
  },
  // The label's capitals centre a pixel lower than its line box: the plus comes down to meet them.
  newMessageIcon: { display: "flex", transform: "translateY(1px)" },
  // The chosen row, on its own ground; nothing changes under the pointer (as macOS lists show it).
  selected: { backgroundColor: colors.bgTertiary },
  // A little space between rows, so neighbouring fills don't run together.
  stack: { display: "flex", flexDirection: "column", gap: 1.82 },
  // 30pt tall, rounded 8pt, 8pt in from its ends, its icon in an 18pt column 8pt before its 13pt name.
  mailbox: {
    display: "flex",
    gap: space.inset,
    alignItems: "center",
    height: 27.27,
    paddingInline: space.inset,
    borderRadius: radii.item,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    cursor: "default",
    outline: "none",
  },
  // A bucket under Inbox: indented by a margin, not padding, so its ground starts just before its icon.
  indent: { marginLeft: 14 },
  mailboxIcon: {
    display: "flex",
    flexShrink: 0,
    justifyContent: "center",
    width: 16.36,
    color: colors.iconTertiary,
  },
  mailboxName: { flex: 1 },
  count: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontVariantNumeric: "tabular-nums",
  },
  // Just apart from the rows above.
  nearby: { marginTop: space.inset },
  // You 16pt in and 12pt up from the corner, at 20pt, 8pt before your 13pt name.
  footer: {
    display: "flex",
    flexShrink: 0,
    gap: 4,
    alignItems: "center",
    marginInline: space.inset,
    marginBottom: 4.55,
  },
  profile: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    gap: space.inset,
    alignItems: "center",
    paddingBlock: 6.36,
    paddingInline: space.inset,
    borderRadius: radii.item,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    backgroundColor: { default: "transparent", ":hover": colors.bgQuaternary },
  },

  list: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minWidth: 0,
    backgroundColor: colors.chrome,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
  },
  // Its title on the same line as the sidebar's first row and the thread's first name (centred 22px down).
  listHeader: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    height: 44,
    paddingTop: 0.92,
    paddingInline: 16,
  },
  // Nothing open beside it: it takes the room, with no edge to divide.
  listAlone: { flex: 1, borderRightWidth: 0 },
  // The mailbox's name and, after it on the same line, how many are unread (or listed).
  listHeading: { display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 },
  listTitle: { color: colors.textPrimary, fontSize: fontSizes.name, fontWeight: 500 },
  listSubtitle: { flexShrink: 0, color: colors.textTertiary, fontSize: fontSizes.small },
  // Cards 8pt in from the column's sides and 2pt apart.
  listScroll: {
    position: "relative",
    isolation: "isolate",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingInline: space.inset,
    paddingBottom: 24,
    outline: "none",
  },
  // A bucket's name at 12pt medium, 12pt in, 10pt above and 2pt over its cards.
  groupHeader: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    padding: "9.09px 10.91px 1.82px",
    color: colors.textTertiary,
    fontSize: fontSizes.caption,
    fontWeight: 500,
  },
  groupCount: { fontWeight: 400 },
  // No hairlines between rows: compact cards, set apart by the space between them. A card: 12pt in from its sides and
  // 10pt from its top and bottom, rounded 10pt, its two parts 5pt apart.
  row: {
    display: "flex",
    alignItems: "flex-start",
    // Compact, at the sidebar's scale: 6px above and below, rounded as its rows are.
    padding: "6px 9px",
    borderRadius: 7.27,
    color: colors.textPrimary,
    cursor: "default",
    outline: "none",
  },
  unreadDot: {
    flexShrink: 0,
    width: 6.36,
    height: 6.36,
    borderRadius: "50%",
    backgroundColor: colors.systemBlue,
  },
  rowBody: { display: "flex", flex: 1, flexDirection: "column", gap: 1, minWidth: 0 },
  // The first line, at the sidebar's 13pt: the title, then the unread dot and when.
  rowTop: { display: "flex", gap: space.inset, alignItems: "center", fontSize: fontSizes.body },
  // Who wrote last, at the start of the preview: a little stronger than their words.
  from: { color: colors.textSecondary, fontWeight: 500 },
  stamp: {
    display: "flex",
    flexShrink: 0,
    gap: 4.55,
    alignItems: "center",
    color: colors.textTertiary,
    fontVariantNumeric: "tabular-nums",
  },
  subjectLine: { display: "flex", flex: 1, gap: 4.55, alignItems: "center", minWidth: 0 },
  subject: { fontWeight: 600, lineHeight: "15px" },
  // The rest at 12pt: the preview, one line.
  second: {
    display: "flex",
    gap: space.inset,
    alignItems: "last baseline",
    fontSize: fontSizes.caption,
    lineHeight: "14px",
  },
  preview: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: colors.textTertiary,
    whiteSpace: "nowrap",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
    padding: "64px 24px",
    color: colors.textTertiary,
    textAlign: "center",
  },
  emptyTitle: { color: colors.textSecondary, fontSize: fontSizes.input, fontWeight: 600 },
});
