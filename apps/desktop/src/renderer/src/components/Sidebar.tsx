import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Draft, Message, Thread, User } from "models";
import {
  active,
  allThreads,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  chooseMailbox,
  drafts,
  inbox,
  itemFor,
  listed,
  mailbox,
  mailboxTitle,
  myBuckets,
  open,
  sameMailbox,
  save,
  saved,
  setDialog,
  shortDate,
  shown,
  setSidebarOpen,
  showMenu,
  sidebarOpen,
  store,
  theme,
  threadMenu,
  unread,
  view,
  type Mailbox,
  type MenuItem,
} from "../session";
import { keysFor } from "../hotkeys";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { colors, fontSizes, sidebarSpace, slackSidebar, tb } from "../styles/tokens.stylex";
import { TbIcon } from "./TbIcon";
import type { TbIconName } from "../tbIcons";
import { plain } from "./ThreadView";

// Thunderbird's 3-pane window (comm-central's about3Pane.css, threadCard.css, tree-listbox.css, spacesToolbar.css and
// unifiedToolbar.css): the spaces bar, the unified toolbar, the folder pane, the thread pane in card view, and (in App)
// the message pane. Sizes are its pixels ÷ 1.1, for the renderer's 110% scale.

// A pane the splitter on its right resizes, remembering its width.
function resizable(key: string, range: { initial: number; min: number; max: number }) {
  const clamp = (n: number): number => Math.min(range.max, Math.max(range.min, Math.round(n)));
  const [width, setWidth] = createSignal(clamp(saved(key, range.initial)));
  const keep = (n: number): void => {
    setWidth(n);
    save(key, n);
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
  const Splitter = (props: { label: string }): JSX.Element => (
    <hr
      class={sx(s.splitter)}
      aria-label={props.label}
      aria-orientation="vertical"
      onPointerDown={drag}
      onDblClick={() => keep(range.initial)}
    />
  );
  return { width, Splitter };
}

const folderPane = resizable("tb-folder-width", { initial: 230, min: 160, max: 380 });
const threadPane = resizable("tb-thread-width", { initial: 380, min: 280, max: 700 });

// ── The unified toolbar ──

function ToolbarIcon(props: {
  label: string;
  icon: TbIconName;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      class={sx(base.bare, s.toolbarIcon, props.pressed && s.toolbarIconPressed)}
      aria-label={props.label}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed ? "true" : "false"}
      title={props.label}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <TbIcon name={props.icon} />
    </button>
  );
}

// Across the window's top: the folder pane's toggle with back and forward, the search bar in the middle, and Settings
// at the end. Writing is the folder pane's New Message.
export function UnifiedToolbar(): JSX.Element {
  return (
    <div data-bar class={sx(s.toolbar)}>
      <div class={sx(s.toolbarStart)}>
        <ToolbarIcon
          label={`${sidebarOpen() ? "Hide" : "Show"} folder pane (${keysFor("sidebar")})`}
          icon="layout"
          pressed={sidebarOpen()}
          onClick={() => setSidebarOpen(!sidebarOpen())}
        />
        <ToolbarIcon
          label={`Back (${keysFor("back")})`}
          icon="nav-back"
          disabled={!canGoBack()}
          onClick={goBack}
        />
        <ToolbarIcon
          label={`Forward (${keysFor("forward")})`}
          icon="nav-forward"
          disabled={!canGoForward()}
          onClick={goForward}
        />
      </div>
      <button
        class={sx(base.bare, s.search)}
        title={`Search (${keysFor("search")})`}
        onClick={() => setDialog({ kind: "search" })}
      >
        <TbIcon name="search" />
        <span class={sx(s.searchPlaceholder)}>Search…</span>
        <span class={sx(s.searchKeys)}>{keysFor("search")}</span>
      </button>
      <div class={sx(s.toolbarEnd)}>
        <ToolbarIcon
          label={`Settings (${keysFor("settings")})`}
          icon="settings"
          pressed={"settings" in view()}
          onClick={() => open({ settings: null })}
        />
      </div>
    </div>
  );
}

// ── The spaces bar ──

function SpaceButton(props: {
  label: string;
  icon: TbIconName;
  current?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      class={sx(base.bare, s.space, props.current && s.spaceCurrent)}
      aria-label={props.label}
      aria-current={props.current ? "true" : undefined}
      title={props.label}
      onClick={() => props.onClick()}
    >
      <TbIcon name={props.icon} size={18.18} />
    </button>
  );
}

// Thunderbird's spaces down the window's left: Mail (where you are) and the Address Book, Settings at the foot.
export function SpacesBar(): JSX.Element {
  const inMail = (): boolean => !("settings" in view()) && !("person" in view());
  return (
    <nav class={sx(s.spaces)} aria-label="Spaces">
      <div class={sx(s.spacesGroup)}>
        <SpaceButton
          label="Mail"
          icon="mail-lg"
          current={inMail()}
          onClick={() => open({ thread: null })}
        />
        <SpaceButton
          label="Address Book"
          icon="address-book-lg"
          current={"person" in view()}
          onClick={() => open({ settings: null })}
        />
      </div>
      <SpaceButton
        label="Settings"
        icon="settings-lg"
        current={"settings" in view()}
        onClick={() => open({ settings: null })}
      />
    </nav>
  );
}

// ── The folder pane ──

const [collapsed, setCollapsed] = createSignal<boolean>(saved("tb-buckets-collapsed", false));

// A folder row: its twisty (when it has children), its coloured icon, its name, and its count badge.
function Folder(props: {
  box: Mailbox;
  label: string;
  icon: TbIconName;
  color: string;
  depth: number;
  // Unread threads, in the grey (or, for new ones, blue) badge; `total` is a plain one (Drafts').
  count?: number;
  total?: number;
  twisty?: "open" | "closed";
  onTwisty?: () => void;
  menu?: () => MenuItem[];
}): JSX.Element {
  const on = (): boolean => sameMailbox(mailbox(), props.box);
  return (
    <li>
      <div
        role="treeitem"
        tabindex={0}
        aria-selected={on() ? "true" : "false"}
        class={sx(s.folder, on() && s.folderOn)}
        style={{ "padding-inline-start": `${props.depth * 16}px` }}
        onClick={() => chooseMailbox(props.box)}
        onContextMenu={(e) => {
          const items = props.menu?.();
          if (items) showMenu(e, items);
        }}
      >
        <span class={sx(s.twisty)}>
          <Show when={props.twisty}>
            <button
              class={sx(base.bare, s.twistyButton, props.twisty === "closed" && s.twistyClosed)}
              aria-label={props.twisty === "open" ? "Collapse" : "Expand"}
              onClick={(event) => {
                event.stopPropagation();
                props.onTwisty?.();
              }}
            >
              <TbIcon name="nav-down" size={10.91} />
            </button>
          </Show>
        </span>
        <span class={sx(s.folderIcon)} style={{ color: on() ? undefined : props.color }}>
          <TbIcon name={props.icon} />
        </span>
        <span class={sx(base.ellipsis, s.folderName, !!props.count && s.bold)}>{props.label}</span>
        <Show when={props.count}>
          <span class={sx(s.badge, s.badgeUnread)}>{props.count}</span>
        </Show>
        <Show when={!props.count && props.total}>
          <span class={sx(s.badge, s.badgeTotal)}>{props.total}</span>
        </Show>
      </div>
    </li>
  );
}

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
    { label: "Edit Bucket", run: () => setDialog({ kind: "bucket", bucket }) },
    { label: "New Bucket", run: () => setDialog({ kind: "bucket" }) },
    "separator",
    ...(at > 0 ? [{ label: "Move Up", run: () => moveBucket(bucket, -1) }] : []),
    ...(at < buckets.length - 1 ? [{ label: "Move Down", run: () => moveBucket(bucket, 1) }] : []),
    ...(buckets.length > 1
      ? ["separator" as const, { label: "Delete Bucket", run: () => void bucket.delete() }]
      : []),
  ];
}

const unreadIn = (threads: Thread[]): number =>
  threads.filter((t) => {
    const it = itemFor(t);
    return it !== undefined && !it.doneAt && unread(it);
  }).length;

export function Sidebar(): JSX.Element {
  const toggle = (): void => {
    setCollapsed(!collapsed());
    save("tb-buckets-collapsed", collapsed());
  };
  return (
    <aside
      class={stylex.attrs(s.folderPane, theme() === "slack" && slackSidebar).class}
      style={{ width: `${folderPane.width()}px` }}
      aria-label="Folders"
    >
      {/* #folderPaneHeaderBar: New Message, Thunderbird's primary button, and the pane's menu. */}
      <div class={sx(s.folderHeader)}>
        <button
          class={sx(base.bare, s.primary)}
          title={`New Message (${keysFor("newThread")})`}
          onClick={() => setDialog({ kind: "newThread" })}
        >
          <TbIcon name="add" />
          New Message
        </button>
        <button
          class={sx(base.bare, s.toolbarIcon)}
          aria-label="Folder pane options"
          title="Folder pane options"
          onClick={(e) =>
            showMenu(e, [{ label: "New Bucket", run: () => setDialog({ kind: "bucket" }) }])
          }
        >
          <TbIcon name="kebab" />
        </button>
      </div>
      <ul class={sx(base.list, s.tree)} role="tree">
        <li>
          <div class={sx(s.mode)}>All Folders</div>
        </li>
        <Folder
          box={{ kind: "inbox" }}
          label="Buckets"
          icon="inbox"
          color={tb.inbox}
          depth={0}
          count={unreadIn(inbox().order) || undefined}
          total={inbox().order.length || undefined}
          twisty={collapsed() ? "closed" : "open"}
          onTwisty={toggle}
          menu={() => [{ label: "New Bucket", run: () => setDialog({ kind: "bucket" }) }]}
        />
        <Show when={!collapsed()}>
          <Show when={inbox().unsorted.length > 0}>
            <Folder
              box={{ kind: "unsorted" }}
              label="Sorting"
              icon="folder"
              color={tb.folder}
              depth={1}
              total={inbox().unsorted.length}
            />
          </Show>
          <For each={inbox().sections}>
            {(section) => (
              <Folder
                box={{ kind: "bucket", id: section.bucket.id }}
                label={section.bucket.name}
                icon="folder"
                color={tb.folder}
                depth={1}
                count={unreadIn(section.items.map((it) => it.thread)) || undefined}
                total={section.items.length || undefined}
                menu={() => bucketMenu(section.bucket)}
              />
            )}
          </For>
        </Show>
        <Folder
          box={{ kind: "all" }}
          label="All Threads"
          icon="archive"
          color={tb.archive}
          depth={0}
          total={allThreads().length || undefined}
        />
        <Folder
          box={{ kind: "drafts" }}
          label="Drafts"
          icon="draft"
          color={tb.draft}
          depth={0}
          total={drafts().length || undefined}
        />
      </ul>
      <folderPane.Splitter label="Resize folder pane" />
    </aside>
  );
}

// ── The thread pane: cards ──

// Thunderbird's dates: the time today, else the date.
function stamp(date: Date): string {
  const today = new Date().setHours(0, 0, 0, 0);
  return new Date(date).setHours(0, 0, 0, 0) === today
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : `${shortDate(date)}, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

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

// A thread card (threadCard.css): its read-status column (a green dot while unread), then the sender in semibold with
// the date at the end, and the subject under it; unread, both bold.
function Card(props: { thread: Thread }): JSX.Element {
  const t = (): Thread => props.thread;
  const on = (): boolean => active() === t();
  const isUnread = (): boolean => {
    const it = itemFor(t());
    return it !== undefined && !it.doneAt && unread(it);
  };
  const last = createMemo(() => {
    let latest: Message | undefined;
    for (const message of t().messages)
      if (!latest || message.createdAt > latest.createdAt) latest = message;
    return latest;
  });
  let row!: HTMLLIElement;
  createEffect(on, (shown) => {
    if (shown) row.scrollIntoView({ block: "nearest" });
  });
  return (
    <li ref={row} class={sx(s.cardCell)}>
      <div
        role="row"
        tabindex={on() ? 0 : -1}
        aria-selected={on() ? "true" : "false"}
        data-active={on() ? "" : undefined}
        class={sx(s.card, on() && s.cardOn)}
        onClick={() => open({ thread: t().id })}
        onContextMenu={(e) => showMenu(e, threadMenu(t()))}
      >
        <span class={sx(s.readStatus)}>
          <Show when={isUnread()}>
            <span class={sx(s.unreadDot)} aria-label="Unread" />
          </Show>
        </span>
        <span class={sx(s.cardColumn)}>
          <span class={sx(s.cardRow)}>
            <span class={sx(base.ellipsis, s.sender, isUnread() && s.bold)}>
              {last()?.author?.name ?? t().owner?.name ?? "Someone"}
            </span>
            <span class={sx(s.date)}>{stamp(last()?.createdAt ?? t().createdAt)}</span>
          </span>
          <span class={sx(s.cardRow)}>
            <span class={sx(base.ellipsis, s.subject, isUnread() && s.bold)}>{t().title}</span>
          </span>
          <Show when={last()}>
            {(message) => (
              <span class={sx(base.ellipsis, s.snippet)}>{preview(message().body)}</span>
            )}
          </Show>
        </span>
      </div>
    </li>
  );
}

function DraftCard(props: { draft: Draft }): JSX.Element {
  const title = (): string =>
    props.draft.draft?.title || props.draft.text.split("\n")[0] || "(no subject)";
  const on = (): boolean => shown("draft") === props.draft.id;
  return (
    <li class={sx(s.cardCell)}>
      <div
        role="row"
        class={sx(s.card, on() && s.cardOn)}
        onClick={() => open({ draft: props.draft.id })}
        onContextMenu={(e) =>
          showMenu(e, [{ label: "Delete Draft", run: () => void props.draft.delete() }])
        }
      >
        <span class={sx(s.readStatus)} />
        <span class={sx(s.cardColumn)}>
          <span class={sx(s.cardRow)}>
            <span class={sx(base.ellipsis, s.sender, s.draftLabel)}>Draft</span>
            <span class={sx(s.date)}>{stamp(props.draft.updatedAt)}</span>
          </span>
          <span class={sx(s.cardRow)}>
            <span class={sx(base.ellipsis, s.subject)}>{title()}</span>
          </span>
        </span>
      </div>
    </li>
  );
}

export function MessageList(): JSX.Element {
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
  const isDrafts = (): boolean => mailbox().kind === "drafts";
  const count = (): number => (isDrafts() ? drafts().length : listed().order.length);
  let list!: HTMLUListElement;
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
      class={sx(s.threadPane)}
      style={{ width: `${threadPane.width()}px` }}
      aria-label={mailboxTitle(mailbox())}
    >
      {/* #threadPaneHeaderBar: the folder's name and how many, then the quick filter and view options. */}
      <div class={sx(s.threadHeader, !sidebarOpen() && s.threadHeaderAlone)}>
        <span class={sx(base.ellipsis, s.folderTitle)}>{mailboxTitle(mailbox())}</span>
        <span class={sx(s.messageCount)}>
          {count()} {isDrafts() ? "draft" : "thread"}
          {count() === 1 ? "" : "s"}
        </span>
        <span class={sx(s.threadHeaderEnd)}>
          <button
            class={sx(base.bare, s.headerButton)}
            title={`Quick Filter (${keysFor("search")})`}
            onClick={() => setDialog({ kind: "search" })}
          >
            <TbIcon name="search" />
            Quick Filter
          </button>
        </span>
      </div>
      <ul ref={list} class={sx(base.list, s.cards)} role="grid" onKeyDown={onKeyDown}>
        <Show
          when={isDrafts()}
          fallback={<For each={listed().order}>{(thread) => <Card thread={thread} />}</For>}
        >
          <For each={drafts()}>{(draft) => <DraftCard draft={draft} />}</For>
        </Show>
      </ul>
      {/* tree-listbox.css's placeholder: centred, faded, a heading and a line. */}
      <Show when={count() === 0}>
        <div class={sx(s.placeholder)}>
          <div class={sx(s.placeholderTitle)}>
            {mailbox().kind === "inbox" ? "No new messages" : "No messages"}
          </div>
          <div>{mailbox().kind === "inbox" ? "Everything here is done." : "Nothing here yet."}</div>
        </div>
      </Show>
      <threadPane.Splitter label="Resize thread pane" />
    </section>
  );
}

const ACCENT_10 = `color-mix(in srgb, ${tb.selected} 10%, ${tb.page})`;
const ACCENT_15 = `color-mix(in srgb, ${tb.selected} 15%, ${tb.page})`;

const s = stylex.create({
  splitter: {
    position: "absolute",
    top: 0,
    right: -3,
    bottom: 0,
    zIndex: 2,
    width: 5,
    margin: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    cursor: "ew-resize",
  },

  // unifiedToolbar.css: 4px of padding around 1lh + a button's border and padding, a 15% black line under it.
  toolbar: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "1fr minmax(200px, 420px) 1fr",
    flexShrink: 0,
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingLeft: sidebarSpace.afterLights,
    paddingRight: 6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "rgb(0 0 0 / 15%)",
    backgroundColor: colors.chrome,
  },
  toolbarStart: { display: "flex", gap: 2, alignItems: "center", minWidth: 0 },
  toolbarEnd: { display: "flex", gap: 2, justifyContent: "flex-end" },
  // A unified toolbar button: transparent, washed under the pointer, 3px corners.
  toolbarIcon: {
    display: "grid",
    placeItems: "center",
    width: 25,
    height: 25,
    borderRadius: 3,
    color: colors.textPrimary,
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": tb.bg3,
      ":active:not(:disabled)": tb.bg4,
    },
    opacity: { default: 1, ":disabled": 0.4 },
    cursor: "default",
    WebkitAppRegion: "no-drag",
  },
  toolbarIconPressed: { backgroundColor: tb.bg3 },
  // The search bar: 1.45lh + 4px, a 1px #a1a1aa (--color-gray-40) border, the page's white, 3px corners.
  search: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 23,
    padding: "0 7px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tb.border1,
    borderRadius: 3,
    color: colors.textTertiary,
    backgroundColor: tb.page,
    fontSize: fontSizes.body,
    cursor: "text",
    WebkitAppRegion: "no-drag",
  },
  searchPlaceholder: { flex: 1, textAlign: "left", lineHeight: 1 },
  searchKeys: { fontSize: fontSizes.small, lineHeight: 1 },

  // spacesToolbar.css: 7px padding, 15px gaps, 20px icons in 5px of padding; the current space in the primary
  // button's blue, its icon white. A faint gradient to its right edge, and a border.
  spaces: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    justifyContent: "space-between",
    padding: 6.36,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
    backgroundColor: tb.spaces,
    backgroundImage: "linear-gradient(90deg, transparent 0%, rgb(0 0 0 / 5%) 100%)",
  },
  spacesGroup: { display: "flex", flexDirection: "column", gap: 13.64 },
  space: {
    display: "grid",
    placeItems: "center",
    padding: 4.55,
    borderRadius: 3,
    color: colors.textPrimary,
    backgroundColor: { default: "transparent", ":hover": tb.bg3 },
    cursor: "default",
  },
  spaceCurrent: {
    color: tb.selectedText,
    backgroundColor: { default: tb.selected, ":hover": tb.selected },
  },

  // #folderPane: --sidebar-background (--layout-background-1).
  folderPane: {
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
  folderHeader: { display: "flex", gap: 4, alignItems: "center", padding: 6 },
  // The primary button: --selected-item-color with its text colour, 80% of it toward black under the pointer.
  primary: {
    display: "flex",
    flex: 1,
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    height: 25,
    padding: "0 10px",
    borderRadius: 3,
    color: tb.selectedText,
    backgroundColor: {
      default: tb.selected,
      ":hover": `color-mix(in srgb, ${tb.selected} 80%, black)`,
      ":active": `color-mix(in srgb, ${tb.selected} 70%, black)`,
    },
    fontSize: fontSizes.body,
    fontWeight: 600,
    cursor: "default",
  },
  tree: { flex: 1, minHeight: 0, padding: "0 3px 6px", overflowY: "auto" },
  // .mode-name: 600 at 1.1rem, 6px above and below, 12px in.
  mode: {
    padding: "5.45px 0 5.45px 10.91px",
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: 600,
  },
  // A folder row: --list-item-min-height (26px), 3px corners; hover --treeitem-background-hover, chosen the accent.
  folder: {
    display: "flex",
    alignItems: "center",
    minHeight: 23.64,
    paddingRight: 3,
    borderRadius: 3,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    backgroundColor: { default: "transparent", ":hover": tb.bg3 },
    cursor: "default",
    outline: "none",
  },
  folderOn: {
    color: tb.selectedText,
    backgroundColor: { default: tb.selected, ":hover": tb.selected },
  },
  twisty: { display: "grid", flexShrink: 0, placeItems: "center", width: 14.55, height: 14.55 },
  twistyButton: { display: "grid", placeItems: "center", color: "inherit", cursor: "default" },
  twistyClosed: { transform: "rotate(-90deg)" },
  folderIcon: { display: "flex", flexShrink: 0, marginLeft: 2 },
  // .name: 7px on either side.
  folderName: { flex: 1, marginInline: 6.36 },
  bold: { fontWeight: 700 },
  // .folder-count-badge: a capsule, 1px 4px, 0.85em bold, 16px at least; unread grey-50 with white text, total
  // grey-20 with near-black.
  badge: {
    flexShrink: 0,
    minWidth: 14.55,
    marginRight: 5.45,
    padding: "1px 3.64px",
    borderRadius: 1000,
    fontSize: fontSizes.small,
    fontVariantNumeric: "tabular-nums",
    lineHeight: "normal",
    textAlign: "center",
  },
  badgeUnread: { color: "#ffffff", backgroundColor: tb.badge, fontWeight: 700 },
  badgeTotal: { color: colors.textPrimary, backgroundColor: tb.bg3, fontWeight: 400 },

  // #threadPane, its header bar, and the cards' ground.
  threadPane: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minWidth: 0,
    backgroundColor: colors.chrome,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
    containerType: "inline-size",
  },
  threadHeader: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    flexShrink: 0,
    height: 34,
    padding: "0 6px 0 9px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
  },
  threadHeaderAlone: { paddingLeft: 9 },
  folderTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: 700 },
  messageCount: { flexShrink: 0, color: colors.textTertiary, fontSize: fontSizes.caption },
  threadHeaderEnd: { display: "flex", gap: 2, marginLeft: "auto" },
  headerButton: {
    display: "flex",
    gap: 5,
    alignItems: "center",
    height: 23,
    padding: "0 6px",
    borderRadius: 3,
    color: colors.textPrimary,
    backgroundColor: { default: tb.button, ":hover": tb.buttonHover, ":active": tb.buttonActive },
    fontSize: fontSizes.body,
    whiteSpace: "nowrap",
    cursor: "default",
  },
  // #threadTree[rows="thread-card"]: 2px above and below.
  cards: { flex: 1, minHeight: 0, padding: "2px 0", overflowY: "auto", outline: "none" },
  // .card-layout > td: 2px 3px around each card.
  cardCell: { padding: "1.82px 2.73px" },
  // .card-container: the page's white, a 1px --layout-border-0 line, 3px corners; hover the accent at 10% with a 70%
  // border, chosen at 15% with the accent's border.
  card: {
    display: "grid",
    gridTemplateColumns: "14.55px 1fr",
    paddingInline: "3px 7.27px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: tb.cardBorder,
      ":hover": `color-mix(in srgb, ${tb.selected} 70%, transparent)`,
    },
    borderRadius: 3,
    color: colors.textPrimary,
    backgroundColor: { default: tb.page, ":hover": ACCENT_10 },
    cursor: "default",
    outline: "none",
  },
  cardOn: {
    borderColor: { default: tb.selected, ":hover": tb.selected },
    backgroundColor: { default: ACCENT_15, ":hover": ACCENT_15 },
  },
  readStatus: { display: "grid", placeItems: "start center", paddingTop: 7.27 },
  // --read-status-fill and --read-status-stroke for an unread message: green-40 inside green-60.
  unreadDot: {
    width: 7.27,
    height: 7.27,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tb.unreadStroke,
    borderRadius: "50%",
    backgroundColor: tb.unreadFill,
  },
  // .thread-card-column: 3px between its rows and above and below them.
  cardColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 2.73,
    minWidth: 0,
    paddingBlock: 2.73,
  },
  // .thread-card-row: line-height 1.5, the sender and the date at either end.
  cardRow: {
    display: "flex",
    gap: 2.73,
    alignItems: "center",
    justifyContent: "space-between",
    lineHeight: 1.5,
  },
  // .sender: 600 at 0.95rem, 3px in. .date: 0.95rem at 85%.
  sender: { flex: 1, paddingLeft: 2.73, fontSize: fontSizes.caption, fontWeight: 600 },
  draftLabel: { color: colors.urgent },
  date: { flexShrink: 0, fontSize: fontSizes.caption, opacity: 0.85, whiteSpace: "nowrap" },
  subject: { flex: 1, paddingLeft: 2.73, fontSize: fontSizes.body },
  snippet: {
    paddingLeft: 2.73,
    paddingBottom: 1,
    color: colors.textTertiary,
    fontSize: fontSizes.caption,
  },
  // slot[name="placeholders"]: 60px down, faded to half, a 1.5rem semibold heading.
  placeholder: {
    position: "absolute",
    insetInline: 0,
    top: 100,
    padding: "0 36px",
    color: colors.textPrimary,
    opacity: 0.5,
    textAlign: "center",
  },
  placeholderTitle: { marginBottom: 11, fontSize: 17.73, fontWeight: 600, lineHeight: 1.2 },
});
