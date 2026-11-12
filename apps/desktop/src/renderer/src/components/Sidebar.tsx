import * as i from "@hugeicons/core-free-icons";
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
import { zTreeMarker } from "../styles/markers.stylex";
import { sx } from "../styles/sx";
import { z } from "../styles/zotero";
import { colors, fontSizes, slackSidebar, zotero } from "../styles/tokens.stylex";
import { icon, Icon, type IconSvgElement } from "./Icon";
import { plain } from "./ThreadView";

// Zotero 7's library view: the collections pane (the mailboxes), the items tree (the chosen one's threads), and (in
// App) the item pane (the thread you're reading). Its look is Zotero's SCSS (zotero/zotero scss/components/
// _collection-tree.scss, _item-tree.scss, _virtualized-table.scss, _toolbar.scss), redone in StyleX.

// Zotero's icons are 16px in a tree and 20px in a toolbar (÷ 1.1).
const TREE_ICON = { size: 14.55, "aria-hidden": "true" } as const;
const TOOLBAR_ICON = { size: 18.18, "aria-hidden": "true" } as const;

// A pane the edge on one side resizes, remembering its width: the right edge widens it to the right, the left edge
// (the item pane's, after the items tree) to the left.
export function resizable(
  key: string,
  range: { initial: number; min: number; max: number },
  side: "left" | "right" = "right",
) {
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
    const move = (e: PointerEvent): void =>
      void setWidth(clamp(from + (side === "right" ? 1 : -1) * (e.clientX - start)));
    const up = (): void => {
      edge.removeEventListener("pointermove", move);
      keep(width());
    };
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", up, { once: true });
  };
  const Edge = (props: { label: string }): JSX.Element => (
    <hr
      class={sx(s.edge, side === "left" ? s.edgeLeft : s.edgeRight)}
      aria-label={props.label}
      aria-orientation="vertical"
      onPointerDown={drag}
      onDblClick={() => keep(range.initial)}
    />
  );
  return { width, Edge };
}

// $min-width-collections-pane (200px) is also its width; $min-width-items-pane is 370px. (÷ 1.1.)
const sidebarColumn = resizable("zotero-collections-width", { initial: 182, min: 182, max: 320 });
const listColumn = resizable("zotero-items-width", { initial: 400, min: 336, max: 700 });

// ── Toolbar buttons ──

const ToolbarButton = (props: {
  label: string;
  icon: IconSvgElement;
  disabled?: boolean;
  // The items toolbar's are 4px apart on each side.
  spaced?: boolean;
  onClick: () => void;
}): JSX.Element => (
  <button
    class={sx(z.button, props.spaced && z.buttonSpaced)}
    aria-label={props.label}
    title={props.label}
    disabled={props.disabled}
    onClick={() => props.onClick()}
  >
    <Icon icon={props.icon} {...TOOLBAR_ICON} />
  </button>
);

// Shows or hides the collections pane, as Stacked mode's toggle sits in Zotero's items toolbar.
export const AppButtons = (): JSX.Element => (
  <ToolbarButton
    label={`${sidebarOpen() ? "Hide" : "Show"} Collections Pane (${keysFor("sidebar")})`}
    icon={i.SidebarLeftIcon}
    spaced
    onClick={() => setSidebarOpen(!sidebarOpen())}
  />
);

// Back and forward through the pages you've opened.
export const HistoryButtons = (): JSX.Element => (
  <>
    <ToolbarButton
      label={`Back (${keysFor("back")})`}
      icon={i.ArrowLeft01Icon}
      spaced
      disabled={!canGoBack()}
      onClick={goBack}
    />
    <ToolbarButton
      label={`Forward (${keysFor("forward")})`}
      icon={i.ArrowRight01Icon}
      spaced
      disabled={!canGoForward()}
      onClick={goForward}
    />
  </>
);

// ── The collections pane: mailboxes ──

// A row of the collections tree: indented 16px a level, a twisty (or its 16px spacer), a 16px icon, then its name.
// Zotero shows no counts, only a feed's unread state, in bold.
function CollectionRow(props: {
  box: Mailbox;
  label: string;
  icon: IconSvgElement;
  level: number;
  // Only on a row with children: whether they show.
  open?: boolean;
  onToggle?: () => void;
  unread?: boolean;
  title?: string;
  // What right-clicking it offers.
  menu?: () => MenuItem[];
}): JSX.Element {
  const on = (): boolean => sameMailbox(mailbox(), props.box);
  return (
    <div
      role="treeitem"
      tabindex={on() ? 0 : -1}
      aria-level={props.level + 1}
      aria-selected={on() ? "true" : "false"}
      aria-expanded={props.open === undefined ? undefined : props.open ? "true" : "false"}
      title={props.title}
      data-active={on() ? "" : undefined}
      class={sx(z.row, on() && z.rowSelected, props.unread && z.unread)}
      onClick={() => chooseMailbox(props.box)}
      onDblClick={() => props.onToggle?.()}
      onContextMenu={(e) => {
        const items = props.menu?.();
        if (items) showMenu(e, items);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" && props.open) props.onToggle?.();
        else if (e.key === "ArrowRight" && props.open === false) props.onToggle?.();
        else if (e.key === "Enter" || e.key === " ") chooseMailbox(props.box);
        else return;
        e.preventDefault();
      }}
    >
      <span class={sx(s.indent)} style={{ "padding-left": `${props.level * 14.55}px` }} />
      <Show when={props.onToggle} fallback={<span class={sx(s.spacerTwisty)} />}>
        <span
          class={sx(z.twisty, on() && z.rowIconSelected, !props.open && z.twistyClosed)}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle?.();
          }}
        >
          <Icon icon={i.ArrowDown01Icon} size={10.91} aria-hidden="true" />
        </span>
      </Show>
      <span class={sx(z.rowIcon, on() && z.rowIconSelected)}>
        <Icon icon={props.icon} {...TREE_ICON} />
      </span>
      <span class={sx(z.cellText, s.collectionText)}>{props.label}</span>
    </div>
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
      icon: icon(i.FolderAddIcon, 13),
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

const hasUnread = (threads: Thread[]): boolean =>
  threads.some((t) => {
    const it = itemFor(t);
    return it !== undefined && !it.doneAt && unread(it);
  });
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

const [libraryOpen, setLibraryOpen] = createSignal(saved("zotero-library-open", true));
const toggleLibrary = (): void => {
  setLibraryOpen(!libraryOpen());
  save("zotero-library-open", libraryOpen());
};

// ↑ and ↓ through a tree's rows, choosing each as Zotero's trees do.
function treeKeys(event: KeyboardEvent): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const tree = event.currentTarget as HTMLElement;
  const rows = [...tree.querySelectorAll<HTMLElement>("[role=treeitem]")];
  const at = rows.findIndex((row) => row.hasAttribute("data-active"));
  const next =
    rows[event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1)];
  if (!next) return;
  event.preventDefault();
  next.click();
  queueMicrotask(() => tree.querySelector<HTMLElement>("[data-active]")?.focus());
}

export function Sidebar(): JSX.Element {
  let tree!: HTMLDivElement;
  return (
    <aside
      class={stylex.attrs(s.collections, theme() === "slack" && slackSidebar).class}
      style={{ width: `${sidebarColumn.width()}px` }}
      aria-label="Collections"
    >
      {/* #zotero-toolbar-collection-tree: New Collection at the start, the collection search at the end. */}
      <div data-bar class={sx(z.toolbar, z.toolbarCollections)}>
        <ToolbarButton
          label="New Bucket…"
          icon={i.FolderAddIcon}
          onClick={() => setDialog({ kind: "bucket" })}
        />
        <span class={sx(z.spacer)} />
        <ToolbarButton
          label={`Search (${keysFor("search")})`}
          icon={i.Search01Icon}
          onClick={() => setDialog({ kind: "search" })}
        />
      </div>
      {/* My Library with its collections (your buckets) under it, then the special rows Zotero puts after them. */}
      <div
        ref={tree}
        role="tree"
        aria-label="Mailboxes"
        {...stylex.attrs(s.collectionsBody, zTreeMarker)}
        onKeyDown={treeKeys}
        onMouseDown={() =>
          queueMicrotask(() => tree.querySelector<HTMLElement>("[data-active]")?.focus())
        }
      >
        <CollectionRow
          box={{ kind: "inbox" }}
          label="My Library"
          icon={i.LibraryIcon}
          level={0}
          open={libraryOpen()}
          onToggle={toggleLibrary}
          title={`${mailboxTitle({ kind: "inbox" })}: ${count(inbox().order.length, "thread")}`}
          menu={() => [
            {
              label: "New Bucket",
              icon: icon(i.FolderAddIcon, 13),
              run: () => setDialog({ kind: "bucket" }),
            },
          ]}
        />
        <Show when={libraryOpen()}>
          {/* Your buckets, as subcollections. */}
          <For each={inbox().sections}>
            {(section) => (
              <CollectionRow
                box={{ kind: "bucket", id: section.bucket.id }}
                label={section.bucket.name}
                icon={i.Folder01Icon}
                level={1}
                unread={hasUnread(section.items.map((item) => item.thread))}
                title={count(section.items.length, "thread")}
                menu={() => bucketMenu(section.bucket)}
              />
            )}
          </For>
          {/* What's still being sorted, as Unfiled Items; then every thread and your drafts. */}
          <Show when={inbox().unsorted.length > 0}>
            <CollectionRow
              box={{ kind: "unsorted" }}
              label="Sorting"
              icon={i.FolderUnknownIcon}
              level={1}
              unread={hasUnread(inbox().unsorted.map((item) => item.thread))}
              title={count(inbox().unsorted.length, "thread")}
            />
          </Show>
          <CollectionRow
            box={{ kind: "all" }}
            label="All Threads"
            icon={i.MessageMultiple01Icon}
            level={1}
            title={count(allThreads().length, "thread")}
          />
          <CollectionRow
            box={{ kind: "drafts" }}
            label="Drafts"
            icon={i.NoteEditIcon}
            level={1}
            title={count(drafts().length, "draft")}
          />
        </Show>
      </div>
      <sidebarColumn.Edge label="Resize Collections Pane" />
    </aside>
  );
}

// ── The items tree: the chosen mailbox's threads ──

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

// A thread's latest message: a pass, not a sort.
function latest(thread: Thread): Message | undefined {
  let last: Message | undefined;
  for (const message of thread.messages)
    if (!last || message.createdAt > last.createdAt) last = message;
  return last;
}

// The quick search in the items toolbar: it narrows the tree to the rows whose title or creator has it.
const [query, setQuery] = createSignal("");
const matches = (...fields: (string | undefined)[]): boolean => {
  const q = query().trim().toLowerCase();
  return q === "" || fields.some((field) => field?.toLowerCase().includes(q));
};
const threadMatches = (t: Thread): boolean =>
  matches(t.title, (latest(t)?.author ?? t.owner)?.name, t.owner?.name);

// The default columns (itemTreeColumns.jsx): Title (flex 4) and Creator (flex 1), then Date Modified, and a fixed
// 26px count like Notes (#), here the messages.
type Column = "title" | "creator" | "date" | "count";

// A thread as an item: its title after a twisty spacer and its item-type icon, who wrote last, when, how many messages.
function Row(props: { thread: Thread; stripe: number }): JSX.Element {
  const t = (): Thread => props.thread;
  const on = (): boolean => active() === t();
  const isUnread = (): boolean => hasUnread([t()]);
  const last = createMemo(() => latest(t()));
  const from = () => last()?.author ?? t().owner;
  let row!: HTMLDivElement;
  // The open thread stays in view as J and K (or the arrows) move past the rows showing.
  createEffect(on, (shown) => {
    if (shown) row.scrollIntoView({ block: "nearest" });
  });
  return (
    <div
      ref={row}
      role="row"
      tabindex={on() ? 0 : -1}
      aria-selected={on() ? "true" : "false"}
      data-active={on() ? "" : undefined}
      title={last() ? `${from()?.name ?? ""}: ${preview(last()!.body)}` : undefined}
      class={sx(
        z.row,
        props.stripe % 2 === 1 && s.odd,
        on() && z.rowSelected,
        isUnread() && z.unread,
      )}
      onClick={() => open({ thread: t().id })}
      onContextMenu={(e) => showMenu(e, threadMenu(t()))}
    >
      <span role="gridcell" class={sx(s.cell, s.title)}>
        <span class={sx(s.spacerTwisty)} />
        <span class={sx(z.rowIcon, on() && z.rowIconSelected)}>
          <Icon icon={i.BubbleChatIcon} {...TREE_ICON} />
        </span>
        <span class={sx(z.cellText)}>{t().title}</span>
      </span>
      <span role="gridcell" class={sx(s.cell, s.creator)}>
        {from()?.name ?? ""}
      </span>
      <span role="gridcell" class={sx(s.cell, s.date)}>
        {stamp(last()?.createdAt ?? t().createdAt)}
      </span>
      <span role="gridcell" class={sx(s.cell, s.count)}>
        {t().messages.length || ""}
      </span>
    </div>
  );
}

const draftTitle = (draft: Draft): string =>
  draft.draft?.title || draft.text.split("\n")[0] || "Untitled draft";

// A draft in Drafts, which opens back in Compose: a note item, in the same columns.
function DraftRow(props: { draft: Draft; stripe: number }): JSX.Element {
  const on = (): boolean => shown("draft") === props.draft.id;
  return (
    <div
      role="row"
      tabindex={0}
      aria-selected={on() ? "true" : "false"}
      data-active={on() ? "" : undefined}
      class={sx(z.row, props.stripe % 2 === 1 && s.odd, on() && z.rowSelected)}
      onClick={() => open({ draft: props.draft.id })}
      onContextMenu={(e) =>
        showMenu(e, [
          {
            label: "Open Draft",
            icon: icon(i.NoteEditIcon, 13),
            run: () => open({ draft: props.draft.id }),
          },
          "separator",
          {
            label: "Delete Draft",
            icon: icon(i.Delete02Icon, 13),
            run: () => void props.draft.delete(),
          },
        ])
      }
    >
      <span role="gridcell" class={sx(s.cell, s.title)}>
        <span class={sx(s.spacerTwisty)} />
        <span class={sx(z.rowIcon, on() && z.rowIconSelected)}>
          <Icon icon={i.Note01Icon} {...TREE_ICON} />
        </span>
        <span class={sx(z.cellText)}>{draftTitle(props.draft)}</span>
      </span>
      <span role="gridcell" class={sx(s.cell, s.creator)} />
      <span role="gridcell" class={sx(s.cell, s.date)}>
        {stamp(props.draft.updatedAt)}
      </span>
      <span role="gridcell" class={sx(s.cell, s.count)} />
    </div>
  );
}

// A column header: its label, the resizer line on its start edge (not the first's), and a sort chevron if the tree is
// sorted by it.
function Header(props: {
  column: Column;
  label: JSX.Element;
  first?: boolean;
  sorted?: boolean;
}): JSX.Element {
  return (
    <span
      role="columnheader"
      aria-sort={props.sorted ? "descending" : undefined}
      class={sx(s.cell, s[props.column], s.headerCell)}
    >
      <Show when={!props.first}>
        <span class={sx(s.resizer)} aria-hidden="true" />
      </Show>
      <span class={sx(base.ellipsis, s.headerLabel, props.first && s.headerLabelFirst)}>
        {props.label}
      </span>
      <Show when={props.sorted}>
        <span class={sx(s.sortIndicator)} aria-hidden="true">
          <Icon icon={i.ArrowDown01Icon} size={10.91} />
        </span>
      </Show>
    </span>
  );
}

// `alone`, with nothing open beside it: it takes the window. `fill`, beside the item pane: it takes what that leaves.
export function MessageList(props: { alone?: boolean; fill?: boolean }): JSX.Element {
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
  // The chosen mailbox's groups, narrowed by the quick search.
  const groups = createMemo(() =>
    listed()
      .groups.map((group) => ({ ...group, threads: group.threads.filter(threadMatches) }))
      .filter((group) => group.threads.length > 0),
  );
  const order = (): Thread[] => groups().flatMap((group) => group.threads);
  const shownDrafts = (): Draft[] => drafts().filter((d) => matches(draftTitle(d), d.text));
  const total = (): number => (isDrafts() ? shownDrafts().length : order().length);
  let list!: HTMLDivElement;
  // ↑ and ↓ move through the tree (J and K do too, anywhere).
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = order();
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(active()!);
    const next =
      event.key === "ArrowDown"
        ? rows[Math.min(rows.length - 1, at + 1)]
        : rows[Math.max(0, at - 1)];
    open({ thread: next.id });
    queueMicrotask(() => list.querySelector<HTMLElement>("[data-active]")?.focus());
  };
  let search!: HTMLInputElement;
  return (
    <section
      class={sx(s.items, (props.alone || props.fill) && s.itemsFill)}
      style={{ width: props.alone || props.fill ? undefined : `${listColumn.width()}px` }}
      aria-label={mailboxTitle(mailbox())}
    >
      {/* #zotero-toolbar-item-tree: its buttons, then the quick search at the end. */}
      <div data-bar class={sx(z.toolbar, z.toolbarItems)}>
        <AppButtons />
        <HistoryButtons />
        <span class={sx(z.separator)} />
        <ToolbarButton
          label={`New Thread… (${keysFor("newThread")})`}
          icon={i.AddCircleIcon}
          spaced
          onClick={() => setDialog({ kind: "newThread" })}
        />
        <ToolbarButton
          label={`Write a Thread as a Message (${keysFor("compose")})`}
          icon={i.NoteAddIcon}
          spaced
          onClick={() => setDialog({ kind: "compose" })}
        />
        <span class={sx(z.spacer)} />
        {/* quick-search-textbox: a magnifier and the mode menu's chevron, then the field. */}
        <label
          class={sx(s.search)}
          onMouseDown={(e) => e.target === e.currentTarget && search.focus()}
        >
          <button
            class={sx(base.bare, s.searchMode)}
            aria-label={`Search Everything (${keysFor("search")})`}
            title={`Search Everything (${keysFor("search")})`}
            onClick={(e) => {
              e.preventDefault();
              setDialog({ kind: "search" });
            }}
          >
            <Icon icon={i.Search01Icon} size={14.55} aria-hidden="true" />
            <Icon icon={i.ArrowDown01Icon} size={7.27} aria-hidden="true" />
          </button>
          <input
            ref={search}
            class={sx(s.searchInput)}
            type="search"
            placeholder="Title, Creator"
            aria-label="Filter by title or creator"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
          />
          <Show when={query()}>
            <button
              class={sx(base.bare, s.searchClear)}
              aria-label="Clear"
              onClick={(e) => {
                e.preventDefault();
                setQuery("");
              }}
            >
              <Icon icon={i.Cancel01Icon} size={10.91} aria-hidden="true" />
            </button>
          </Show>
        </label>
      </div>
      <div
        {...stylex.attrs(s.table, zTreeMarker)}
        role="treegrid"
        aria-label={mailboxTitle(mailbox())}
      >
        <div role="row" class={sx(s.header)}>
          <Header column="title" label="Title" first />
          <Header column="creator" label="Creator" />
          {/* Every thread is listed latest first; the inbox, most urgent first. */}
          <Header
            column="date"
            label="Date Modified"
            sorted={mailbox().kind === "all" || isDrafts()}
          />
          <Header
            column="count"
            label={<Icon icon={i.BubbleChatIcon} size={12.73} aria-label="Messages" />}
          />
        </div>
        <div
          ref={list}
          class={sx(s.body)}
          onMouseDown={() =>
            queueMicrotask(() => list.querySelector<HTMLElement>("[data-active]")?.focus())
          }
          onKeyDown={onKeyDown}
        >
          <Show
            when={isDrafts()}
            fallback={
              <For each={groups()}>
                {(group, at) => (
                  <>
                    {/* The inbox in sections, each under a header row like a library's in a cross-library view, a
                        blank row before each but the first. */}
                    <Show when={mailbox().kind === "inbox"}>
                      <Show when={at() > 0}>
                        <div class={sx(s.spacerRow)} aria-hidden="true" />
                      </Show>
                      <div
                        class={sx(z.row, s.sectionHeader)}
                        onContextMenu={(e) => {
                          if (group.bucket) showMenu(e, bucketMenu(group.bucket));
                        }}
                      >
                        <span class={sx(z.rowIcon, s.sectionIcon)}>
                          <Icon
                            icon={group.bucket ? i.Folder01Icon : i.FolderUnknownIcon}
                            {...TREE_ICON}
                          />
                        </span>
                        <span class={sx(base.ellipsis)}>{group.bucket?.name ?? group.title}</span>
                      </div>
                    </Show>
                    <For each={group.threads}>
                      {(thread, index) => <Row thread={thread} stripe={index()} />}
                    </For>
                  </>
                )}
              </For>
            }
          >
            <For each={shownDrafts()}>
              {(draft, index) => <DraftRow draft={draft} stripe={index()} />}
            </For>
          </Show>
          <Show when={total() === 0}>
            <div class={sx(s.empty)}>
              {query().trim()
                ? "No matching threads"
                : mailbox().kind === "inbox"
                  ? "All caught up: nothing in your buckets needs you right now."
                  : isDrafts()
                    ? "No drafts"
                    : "No threads in this view"}
            </div>
          </Show>
        </div>
      </div>
      <Show when={!props.alone && !props.fill}>
        <listColumn.Edge label="Resize Items Pane" />
      </Show>
    </section>
  );
}

// The column widths: Title flex 4, Creator and Date Modified flex 1, the count a fixed 26px (÷ 1.1).
const s = stylex.create({
  // A splitter: 5px to grab, invisible; the pane's own border is the line.
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 1,
    width: 5,
    margin: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    cursor: "col-resize",
  },
  edgeRight: { right: -3 },
  edgeLeft: { left: -3 },

  // #zotero-collections-pane: --material-sidepane, a pane divider (the splitter's --material-border-quarternary).
  collections: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minWidth: zotero.collectionsWidth,
    backgroundColor: colors.zSidepane,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.zFillQuarternary,
  },
  // The collection tree's body: 8px in, 8px at the foot.
  collectionsBody: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingTop: 0,
    paddingInline: zotero.xs,
    paddingBottom: zotero.xs,
    outline: "none",
  },
  indent: { flexShrink: 0 },
  spacerTwisty: { flexShrink: 0, width: zotero.icon },
  // .cell.label: 4px at its end.
  collectionText: { paddingRight: zotero.min },

  // #zotero-items-pane-container.
  items: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minWidth: 0,
    backgroundColor: colors.zBackground,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.zFillQuarternary,
  },
  itemsFill: { flex: 1, flexShrink: 1, minWidth: "336.36px" },
  // A size of its own, so it's never wider than its items pane.
  search: {
    position: "relative",
    display: "flex",
    flexGrow: 1,
    alignItems: "center",
    width: "132.73px",
    maxWidth: "272.73px",
    height: zotero.button,
    marginLeft: zotero.min,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.zFillQuinary,
    borderRadius: zotero.radius,
    backgroundColor: colors.zBackground,
    WebkitAppRegion: "no-drag",
  },
  // The search-sign: 16px magnifier and the 8px chevron, 5px in, 18px before the text.
  searchMode: {
    display: "flex",
    flexShrink: 0,
    gap: 1.82,
    alignItems: "center",
    height: "100%",
    paddingLeft: "4.55px",
    paddingRight: "3.64px",
    color: colors.zFillSecondary,
    cursor: "default",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    padding: 0,
    paddingRight: "5.45px",
    borderStyle: "none",
    color: colors.zFillPrimary,
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: "transparent",
    outline: "none",
    "::placeholder": { color: colors.zFillTertiary },
    "::-webkit-search-cancel-button": { display: "none" },
  },
  searchClear: {
    display: "flex",
    flexShrink: 0,
    marginRight: "5.45px",
    color: colors.zFillPrimary,
    cursor: "default",
  },

  table: { display: "flex", flex: 1, flexDirection: "column", minHeight: 0, outline: "none" },
  // .virtualized-table-header: 8px in, a pane divider under it (#zotero-items-tree's).
  header: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    height: zotero.header,
    paddingInline: zotero.xs,
    overflow: "hidden",
    scrollbarGutter: "stable",
    color: colors.zFillPrimary,
    fontSize: fontSizes.body,
    backgroundColor: colors.zBackground,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.zPanedivider,
  },
  headerCell: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    height: "100%",
    backgroundColor: { default: "transparent", ":hover": colors.zMixQuinary },
  },
  headerLabel: { flex: 1 },
  // Over the twisty and the icon (firstColumnExtraWidth: 16 + 4, + the twisty's 16), so it lines up with the titles.
  headerLabelFirst: { paddingLeft: "32.73px" },
  // .resizer: a 1px --fill-quarternary line, 20px tall in the comfortable density.
  resizer: {
    position: "absolute",
    top: "50%",
    left: 0,
    width: 1,
    height: "18.18px",
    backgroundColor: colors.zFillQuarternary,
    transform: "translateY(-50%)",
  },
  sortIndicator: {
    display: "flex",
    flexShrink: 0,
    marginRight: "2.73px",
    color: colors.zFillPrimary,
  },
  // .virtualized-table-body: 4px over the rows, 8px in and at the foot.
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    scrollbarGutter: "stable",
    padding: "3.64px 7.27px 7.27px",
    outline: "none",
  },
  // .cell: 8px each side; the first has none at its start, its twisty and indent do it.
  cell: {
    display: "flex",
    alignItems: "center",
    minWidth: "27.27px",
    paddingInline: zotero.xs,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  title: { flex: "4 1 0", paddingLeft: 0 },
  creator: { display: "block", flex: "1 1 0", lineHeight: zotero.row },
  date: { display: "block", flex: "1 1 0", lineHeight: zotero.row },
  count: {
    flex: "0 0 23.64px",
    justifyContent: "center",
    minWidth: "23.64px",
    paddingInline: 0,
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
  },
  // .row.odd: --material-stripe.
  odd: { backgroundColor: colors.zStripe },
  // .library-header-row: on the pane's ground, square, 600 in --fill-secondary, its icon 4px before the name at 0.8.
  sectionHeader: {
    gap: zotero.min,
    paddingLeft: zotero.icon,
    paddingBottom: "2.73px",
    borderRadius: 0,
    color: colors.zFillSecondary,
    fontWeight: 600,
    backgroundColor: colors.zBackground,
  },
  sectionIcon: { opacity: 0.8 },
  spacerRow: { height: zotero.row },
  // Zotero's items-tree message: centred in the pane, in --fill-secondary.
  empty: {
    padding: "48px 24px",
    color: colors.zFillSecondary,
    fontSize: fontSizes.body,
    textAlign: "center",
  },
});
