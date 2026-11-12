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
  markDone,
  me,
  myBuckets,
  open,
  sameMailbox,
  save,
  saved,
  setDialog,
  setSidebarOpen,
  shortDate,
  shown,
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
import { topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { cat, colors, fontSizes, fonts, sidebarSpace, slackSidebar } from "../styles/tokens.stylex";
import { Icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { plain } from "./ThreadView";

// The U.S. Graphics Company's general catalog, as an inbox (its stylesheet, usgraphics-wds.css, gives every size and
// colour here, each pixel ÷ 1.1 for the renderer's 110% scale): sheets of paper on grey, nav buttons in black frames,
// sections under ruled headings, tables of coded rows with a green button at the end.

// ── Columns ──

// A column the edge on its right resizes, remembering its width.
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

const sidebarColumn = resizable("catalog-sidebar-width", { initial: 230, min: 190, max: 340 });
const listColumn = resizable("catalog-list-width", { initial: 520, min: 360, max: 900 });

// ── Codes: every thread a SKU ──

// TH-001 for the first thread ever made, and on; a draft is DR-01.
const numbers = store.view(() => {
  const order = [...store.all(Thread)].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return new Map(order.map((t, n) => [t.id, n + 1]));
});
const codeOf = (thread: Thread): string =>
  `TH-${String(numbers().get(thread.id) ?? 0).padStart(3, "0")}`;

// A code's tint is its bucket's, as the catalog tints a product line: the buckets in turn take its light yellow,
// pink, blue and mint; a thread in none is plain.
const TINTS = [cat.yellow, cat.pink, cat.blue, cat.mint];
const tintOf = (thread: Thread): string => {
  const bucketId = itemFor(thread)?.bucketId;
  const at = myBuckets().findIndex((b) => b.id === bucketId);
  return at === -1 ? cat.sheet : TINTS[at % TINTS.length];
};
const bucketTint = (bucket: Bucket): string =>
  TINTS[Math.max(0, myBuckets().indexOf(bucket)) % TINTS.length];

function Sku(props: { code: string; tint: string }): JSX.Element {
  return (
    <span class={sx(s.sku)} style={{ "background-color": props.tint }}>
      {props.code}
    </span>
  );
}

// ── The top bars' buttons ──

const TopButton = (props: {
  label: string;
  icon: IconSvgElement;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element => (
  <button
    class={sx(topbar.button)}
    aria-label={props.label}
    title={props.label}
    disabled={props.disabled}
    onClick={() => props.onClick()}
  >
    <Icon icon={props.icon} size={12} aria-hidden="true" />
  </button>
);

export const AppButtons = (): JSX.Element => (
  <>
    <TopButton
      label={sidebarOpen() ? "Hide sidebar" : "Show sidebar"}
      icon={i.PanelLeftIcon}
      onClick={() => setSidebarOpen(!sidebarOpen())}
    />
    <TopButton label="Search" icon={i.Search01Icon} onClick={() => setDialog({ kind: "search" })} />
  </>
);

export const HistoryButtons = (): JSX.Element => (
  <>
    <TopButton
      label={`Back (${keysFor("back")})`}
      icon={i.ArrowLeft01Icon}
      disabled={!canGoBack()}
      onClick={goBack}
    />
    <TopButton
      label={`Forward (${keysFor("forward")})`}
      icon={i.ArrowRight01Icon}
      disabled={!canGoForward()}
      onClick={goForward}
    />
  </>
);

// ── The sidebar: the catalog's nav ──

// A mailbox as the catalog's nav buttons: a framed white button, its name, its count in the data face; the one you're
// in has the red dot.
function NavButton(props: {
  box: Mailbox;
  label: string;
  count?: number;
  indent?: boolean;
  menu?: () => MenuItem[];
}): JSX.Element {
  const on = (): boolean => sameMailbox(mailbox(), props.box);
  return (
    <li class={sx(props.indent && s.indent)}>
      <button
        class={sx(base.bare, s.nav)}
        aria-current={on() ? "true" : undefined}
        onClick={() => chooseMailbox(props.box)}
        onContextMenu={(e) => {
          const items = props.menu?.();
          if (items) showMenu(e, items);
        }}
      >
        <Show when={on()}>
          <span class={sx(s.navDot)} aria-hidden="true" />
        </Show>
        <span class={sx(base.ellipsis, s.navLabel)}>{props.label}</span>
        <Show when={props.count !== undefined}>
          <span class={sx(s.navCount)}>{props.count}</span>
        </Show>
      </button>
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

export function Sidebar(): JSX.Element {
  return (
    <aside
      class={stylex.attrs(s.sidebar, theme() === "slack" && slackSidebar).class}
      style={{ width: `${sidebarColumn.width()}px` }}
    >
      <div data-bar class={sx(topbar.bar, s.sidebarBar)}>
        <AppButtons />
        <span class={sx(topbar.end)}>
          <TopButton
            label={`New Thread (${keysFor("newThread")})`}
            icon={i.PencilEdit02Icon}
            onClick={() => setDialog({ kind: "newThread" })}
          />
        </span>
      </div>
      <div class={sx(s.sidebarBody)}>
        {/* The catalog's title box: a frame, a dotted frame inside it, and the name in the data face. */}
        <div class={sx(s.titleBox)}>
          <div class={sx(s.titleBoxInner)}>
            <div class={sx(s.titleBoxName)}>Threads</div>
            <div>General Inbox</div>
          </div>
        </div>
        <nav aria-label="Mailboxes">
          <ul class={sx(base.list, s.navList)}>
            <NavButton
              box={{ kind: "inbox" }}
              label="Buckets"
              count={inbox().order.length}
              menu={() => [{ label: "New Bucket", run: () => setDialog({ kind: "bucket" }) }]}
            />
            <Show when={inbox().unsorted.length > 0}>
              <NavButton
                box={{ kind: "unsorted" }}
                label="Sorting"
                count={inbox().unsorted.length}
                indent
              />
            </Show>
            <For each={inbox().sections}>
              {(section) => (
                <NavButton
                  box={{ kind: "bucket", id: section.bucket.id }}
                  label={section.bucket.name}
                  count={section.items.length}
                  indent
                  menu={() => bucketMenu(section.bucket)}
                />
              )}
            </For>
          </ul>
          <ul class={sx(base.list, s.navList, s.navListAfter)}>
            <NavButton box={{ kind: "all" }} label="All Threads" count={allThreads().length} />
            <NavButton box={{ kind: "drafts" }} label="Drafts" count={drafts().length} />
          </ul>
        </nav>
      </div>
      <div class={sx(s.footer)}>
        <button
          class={sx(base.bare, s.nav)}
          title={`Profile and Settings (${keysFor("settings")})`}
          onClick={() => open({ settings: null })}
        >
          <Identicon seed={me().id} size={12} />
          <span class={sx(base.ellipsis, s.navLabel)}>{me().name}</span>
        </button>
      </div>
      <sidebarColumn.Edge label="Resize Sidebar" />
    </aside>
  );
}

// ── The list: a catalog page ──

// The catalog's dates are plain: the time today, else month and day.
function stamp(date: Date): string {
  const today = new Date().setHours(0, 0, 0, 0);
  return new Date(date).setHours(0, 0, 0, 0) === today
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : shortDate(date);
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

// A thread as a catalog line: its code, its title and who said what last, when, and DONE where ORDER would be.
function ThreadRow(props: { thread: Thread; done: boolean }): JSX.Element {
  const t = (): Thread => props.thread;
  const on = (): boolean => active() === t();
  const item = () => itemFor(t());
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
  let row!: HTMLTableRowElement;
  createEffect(on, (shown) => {
    if (shown) row.scrollIntoView({ block: "nearest" });
  });
  return (
    <tr
      ref={row}
      class={sx(s.tr, on() && s.trOn)}
      aria-current={on() ? "true" : undefined}
      onClick={() => open({ thread: t().id })}
      onContextMenu={(e) => showMenu(e, threadMenu(t()))}
    >
      <td class={sx(s.td, s.fit)}>
        <Sku code={codeOf(t())} tint={tintOf(t())} />
      </td>
      <td class={sx(s.td)}>
        <span class={sx(s.subject)}>
          <Show when={isUnread()}>
            <span class={sx(s.navDot, s.unreadDot)} aria-label="Unread" />
          </Show>
          <span class={sx(isUnread() && s.bold)}>{t().title}</span>
          <Show when={last()}>
            {(message) => (
              <span class={sx(s.preview)}>
                {" "}
                — {message().author?.name ?? "Someone"}: {preview(message().body)}
              </span>
            )}
          </Show>
        </span>
      </td>
      <td class={sx(s.td, s.fit, s.data, s.right)}>{stamp(last()?.createdAt ?? t().createdAt)}</td>
      <Show when={props.done}>
        <td class={sx(s.td, s.fit, s.center)}>
          <Show when={item() && !item()!.doneAt} fallback={<span>—</span>}>
            <button
              class={sx(base.bare, s.ctrl)}
              title={`Mark done (${keysFor("done")})`}
              onClick={(event) => {
                event.stopPropagation();
                markDone(item()!);
              }}
            >
              Done →
            </button>
          </Show>
        </td>
      </Show>
    </tr>
  );
}

function DraftRow(props: { draft: Draft; n: number }): JSX.Element {
  const title = (): string =>
    props.draft.draft?.title || props.draft.text.split("\n")[0] || "Untitled draft";
  const on = (): boolean => shown("draft") === props.draft.id;
  return (
    <tr
      class={sx(s.tr, on() && s.trOn)}
      onClick={() => open({ draft: props.draft.id })}
      onContextMenu={(e) =>
        showMenu(e, [{ label: "Delete Draft", run: () => void props.draft.delete() }])
      }
    >
      <td class={sx(s.td, s.fit)}>
        <Sku code={`DR-${String(props.n).padStart(2, "0")}`} tint={cat.pink} />
      </td>
      <td class={sx(s.td)}>
        <span class={sx(s.subject)}>{title()}</span>
      </td>
      <td class={sx(s.td, s.fit, s.data, s.right)}>{stamp(props.draft.updatedAt)}</td>
    </tr>
  );
}

// A catalog table: its head over a black rule, its rows in grey cells, a grey edge on its left.
function Table(props: { done?: boolean; children: JSX.Element }): JSX.Element {
  return (
    <table class={sx(s.table)}>
      <thead>
        <tr>
          <th class={sx(s.th, s.fit)}>Code</th>
          <th class={sx(s.th)}>Thread</th>
          <th class={sx(s.th, s.fit, s.right)}>Date</th>
          <Show when={props.done}>
            <th class={sx(s.th, s.fit)}>Mark</th>
          </Show>
        </tr>
      </thead>
      <tbody>{props.children}</tbody>
    </table>
  );
}

// Nothing listed: one row, its code cell hatched as the catalog marks what's discontinued.
const EmptyRow = (props: { text: string; span: number }): JSX.Element => (
  <tr>
    <td class={sx(s.td, s.fit)}>
      <span class={sx(s.hatch)} aria-hidden="true" />
    </td>
    <td class={sx(s.td, s.muted)} colspan={props.span - 1}>
      {props.text}
    </td>
  </tr>
);

export function MessageList(props: { alone?: boolean }): JSX.Element {
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
  const box = (): Mailbox => mailbox();
  const isDrafts = (): boolean => box().kind === "drafts";
  // DONE stands where something can be done: anything in your buckets.
  const doable = (): boolean => box().kind !== "all" && !isDrafts();
  const count = (): number => (isDrafts() ? drafts().length : listed().order.length);
  const lede = (): string => {
    const b = box();
    if (b.kind === "bucket") return store.findById(Bucket, b.id)?.description ?? "";
    if (b.kind === "inbox") return "Everything waiting on you, sorted into your buckets.";
    if (b.kind === "unsorted") return "New threads, still being sorted into your buckets.";
    if (b.kind === "all") return "Every thread in the workspace, the latest first.";
    return "Threads you started writing and haven't sent.";
  };
  return (
    <section
      class={sx(s.column, props.alone && s.columnAlone)}
      style={{ width: props.alone ? undefined : `${listColumn.width()}px` }}
      aria-label={mailboxTitle(box())}
    >
      <div data-bar class={sx(topbar.bar, s.columnBar, !sidebarOpen() && s.columnBarAlone)}>
        <Show when={!sidebarOpen()}>
          <AppButtons />
        </Show>
        <HistoryButtons />
      </div>
      <div class={sx(s.sheet)}>
        <div class={sx(s.page, props.alone && s.pageAlone)}>
          {/* As the catalog opens a section: its name centred over a black rule, then what it's for. */}
          <h1 class={sx(s.heading)}>
            {mailboxTitle(box())}
            <span class={sx(s.headingCount)}>
              {" "}
              ({count()} {isDrafts() ? "drafts" : "threads"})
            </span>
          </h1>
          <hr class={sx(s.rule)} />
          <Show when={lede()}>
            <p class={sx(s.lede)}>{lede()}</p>
          </Show>
          <Show
            when={!isDrafts()}
            fallback={
              <Table>
                <For each={drafts()} fallback={<EmptyRow text="No drafts" span={3} />}>
                  {(draft, n) => <DraftRow draft={draft} n={n() + 1} />}
                </For>
              </Table>
            }
          >
            <Show
              when={box().kind === "inbox"}
              fallback={
                <Table done={doable()}>
                  <For
                    each={listed().order}
                    fallback={<EmptyRow text="Nothing here" span={doable() ? 4 : 3} />}
                  >
                    {(thread) => <ThreadRow thread={thread} done={doable()} />}
                  </For>
                </Table>
              }
            >
              {/* Each bucket a subsection: its name over a dashed rule, its description, its table. */}
              <For
                each={listed().groups}
                fallback={
                  <Table done>
                    <EmptyRow text="All caught up" span={4} />
                  </Table>
                }
              >
                {(group) => (
                  <section class={sx(s.group)}>
                    <h2
                      class={sx(s.subheading)}
                      onContextMenu={(e) => {
                        if (group.bucket) showMenu(e, bucketMenu(group.bucket));
                      }}
                    >
                      <Show when={group.bucket}>
                        {(bucket) => (
                          <Sku code={`BK-${bucket().position + 1}`} tint={bucketTint(bucket())} />
                        )}
                      </Show>
                      {group.bucket?.name ?? group.title}
                    </h2>
                    <hr class={sx(s.dashed)} />
                    <Show when={group.bucket?.description}>
                      <p class={sx(s.lede)}>{group.bucket!.description}</p>
                    </Show>
                    <Table done>
                      <For each={group.threads}>
                        {(thread) => <ThreadRow thread={thread} done />}
                      </For>
                    </Table>
                  </section>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
      <Show when={!props.alone}>
        <listColumn.Edge label="Resize List" />
      </Show>
    </section>
  );
}

const s = stylex.create({
  edge: {
    position: "absolute",
    top: 0,
    right: -4,
    bottom: 0,
    zIndex: 1,
    width: 7,
    margin: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    cursor: "col-resize",
  },

  // The grey around the sheets.
  sidebar: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    backgroundColor: colors.chrome,
  },
  sidebarBar: { paddingLeft: sidebarSpace.afterLights },
  sidebarBody: { flex: 1, minHeight: 0, padding: "7.27px 10.91px", overflowY: "auto" },
  // The catalog's title box: a 1px frame, a dotted frame 6px inside it, its lines in the data face, spaced out.
  titleBox: {
    marginBottom: 16.36,
    padding: 5.45,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: cat.ink,
    backgroundColor: cat.sheet,
  },
  titleBoxInner: {
    padding: "7.27px 9.09px",
    borderWidth: 1,
    borderStyle: "dotted",
    borderColor: cat.ink,
    color: cat.ink,
    fontFamily: fonts.mono,
    fontSize: fontSizes.body,
    lineHeight: "20.36px",
    letterSpacing: "1.27px",
    textAlign: "center",
    textTransform: "uppercase",
  },
  titleBoxName: { fontWeight: 700 },
  navList: { display: "flex", flexDirection: "column", gap: 7.27 },
  navListAfter: { marginTop: 16.36 },
  indent: { marginLeft: 12.73 },
  // .btn-nav: 1px black frame, 1.5rem tall, white, a hard 2px #bbb shadow; black with white type under the pointer.
  nav: {
    display: "flex",
    gap: 6.36,
    alignItems: "center",
    width: "100%",
    height: 21.82,
    padding: "3.5px 7.27px 0.64px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: cat.ink,
    color: { default: cat.ink, ":hover": cat.sheet },
    backgroundColor: { default: cat.sheet, ":hover": cat.ink },
    boxShadow: `2px 2px ${cat.hardButton}`,
    fontSize: fontSizes.body,
    lineHeight: "12.73px",
    cursor: "pointer",
  },
  navLabel: { flex: 1 },
  // .nav-active-icon: a 10px red dot in a black ring.
  navDot: {
    flexShrink: 0,
    width: 9.09,
    height: 9.09,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#000000",
    borderRadius: "50%",
    backgroundColor: cat.red,
  },
  navCount: { fontFamily: fonts.mono, fontSize: fontSizes.small, letterSpacing: "1.27px" },
  footer: { flexShrink: 0, padding: "7.27px 10.91px 10.91px" },

  // A column of the page: the grey ground, its bar, and a sheet of paper under it.
  column: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minWidth: 0,
    backgroundColor: colors.chrome,
  },
  columnAlone: { flex: 1 },
  columnBar: { paddingLeft: 3.64 },
  columnBarAlone: { paddingLeft: sidebarSpace.afterLights },
  // The catalog's page: white, a 1px #888 frame, a hard 2px #ccc shadow.
  sheet: {
    flex: 1,
    minHeight: 0,
    margin: "0 7.27px 9.09px 0",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: cat.frame,
    backgroundColor: cat.sheet,
    boxShadow: `2px 2px ${cat.hardSheet}`,
    overflowY: "auto",
  },
  page: { padding: "6.36px 12.73px 25.45px", color: cat.ink },
  pageAlone: { maxWidth: 1100, margin: "0 auto" },
  // h2 in the catalog: 14px bold, centred, over a 1px black rule.
  heading: {
    margin: "7.64px 0 0",
    fontSize: fontSizes.body,
    fontWeight: 700,
    lineHeight: 1.2,
    textAlign: "center",
  },
  headingCount: { color: cat.gray, fontWeight: 400 },
  rule: {
    height: 0,
    margin: "9.55px 0 6.36px",
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: cat.ink,
  },
  lede: { margin: "0 0 12.73px", lineHeight: "19.09px" },
  group: { marginTop: 19.09 },
  // A subsection: bold, on the left, over a dashed rule (the catalog's hr).
  subheading: {
    display: "flex",
    gap: 7.27,
    alignItems: "center",
    margin: 0,
    fontSize: fontSizes.body,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  dashed: {
    height: 0,
    margin: "6.36px 0",
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: "dashed",
    borderTopColor: cat.ink,
  },

  // .table: collapsed cells, a 2px dotted #ddd top, a hard 2px #ddd shadow, and .table-light-silver's 4px #aaa left
  // edge.
  table: {
    width: "100%",
    borderCollapse: "collapse",
    borderSpacing: 0,
    borderTopWidth: 2,
    borderTopStyle: "dotted",
    borderTopColor: cat.hardTable,
    borderLeftWidth: 4,
    borderLeftStyle: "solid",
    borderLeftColor: cat.edge,
    boxShadow: `2px 2px ${cat.hardTable}`,
    fontSize: fontSizes.body,
    textAlign: "left",
    tableLayout: "auto",
  },
  // .table th: bold, a black rule under it, a grey one at its right, 1.85rem tall.
  th: {
    height: 23.55,
    padding: "2.55px 5.09px 0",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: cat.ink,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: cat.rule,
    fontWeight: 700,
    lineHeight: "15.27px",
    whiteSpace: "nowrap",
  },
  tr: { cursor: "default", backgroundColor: { default: null, ":hover": colors.bgQuaternary } },
  // .table tr.active: a 10% black wash.
  trOn: { backgroundColor: colors.bgTertiary },
  // .table td: #bfbfbf cells, 1.85rem tall, cut off with an ellipsis.
  td: {
    maxWidth: 0,
    height: 23.55,
    padding: "2.55px 5.09px 0",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: cat.rule,
    lineHeight: "17.82px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // .rowfit: as narrow as what's in it.
  fit: { width: "1%", maxWidth: "none" },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  muted: { color: cat.gray },
  data: { fontFamily: fonts.mono, fontSize: fontSizes.small, letterSpacing: "0.64px" },
  subject: { display: "inline" },
  bold: { fontWeight: 700 },
  unreadDot: { display: "inline-block", marginRight: 5.45, verticalAlign: "-0.05em" },
  preview: { color: cat.gray },
  // .sku: the data face in capitals, spaced .1rem, in a dotted frame, on its line's tint.
  sku: {
    display: "inline-block",
    paddingLeft: 3.82,
    paddingRight: 2.55,
    borderWidth: 1,
    borderStyle: "dotted",
    borderColor: cat.ink,
    color: cat.ink,
    fontFamily: fonts.mono,
    fontSize: fontSizes.body,
    fontWeight: 400,
    letterSpacing: "1.27px",
    lineHeight: "15.27px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  // .btn-ctrl, as the catalog's green ORDER: the data face in capitals, a black frame, a hard #bbb shadow; black under
  // the pointer.
  ctrl: {
    height: 17.82,
    padding: "0 6.36px 0 9.55px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: cat.ink,
    color: "#ffffff",
    backgroundColor: { default: cat.green, ":hover": "#000000" },
    boxShadow: `2px 2px ${cat.hardButton}`,
    fontFamily: fonts.mono,
    fontSize: fontSizes.body,
    letterSpacing: "1.27px",
    lineHeight: "15.27px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  // .pattern-hatch-gray: #777 stripes at -45°, a quarter rem wide.
  hatch: {
    display: "block",
    width: 50.91,
    height: 15.27,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: cat.ink,
    backgroundImage: `repeating-linear-gradient(-45deg, ${cat.gray}, ${cat.gray} 3.18px, transparent 3.18px, transparent 6.36px)`,
  },
});
