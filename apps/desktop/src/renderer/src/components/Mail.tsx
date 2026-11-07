import * as i from "@hugeicons/core-free-icons";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Draft, Label, Subspace, Thread, User, View } from "models";
import {
  active,
  byName,
  inbox,
  itemFor,
  lastActive,
  markDone,
  me,
  myBuckets,
  open,
  placeIn,
  save,
  saved,
  setDialog,
  shortDate,
  showMenu,
  sidebarOpen,
  store,
  threadMenu,
  unread,
  view,
  type MenuItem,
} from "../session";
import {
  chooseMailbox,
  drafts,
  listed,
  mailbox,
  mailboxTitle,
  sameMailbox,
  type Mailbox,
} from "../mail";
import { bucketIcons } from "../bucketIcons";
import { base } from "../styles/base";
import { topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes, motion, radii, sidebarSpace } from "../styles/tokens.stylex";
import { AppButtons } from "./Sidebar";
import { Icon, type IconSvgElement } from "./Icon";
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
const listColumn = resizable("mail-list-width", { initial: 340, min: 280, max: 520 });

// ── The sidebar: mailboxes ──

// A mailbox in the sidebar: its icon, name and count.
function Mailbox(props: {
  box: Mailbox;
  label: string;
  icon: IconSvgElement;
  count?: number;
  indent?: boolean;
  disclosure?: { open: boolean; toggle: () => void };
  // What right-clicking it offers.
  menu?: () => MenuItem[];
}): JSX.Element {
  const on = (): boolean => sameMailbox(mailbox(), props.box);
  return (
    <li class={sx(s.mailboxItem)}>
      <div
        role="button"
        tabindex={0}
        aria-current={on() ? "true" : undefined}
        class={sx(s.mailbox, props.indent && s.indent, on() && s.mailboxOn)}
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
        <Show when={!props.indent}>
          <span class={sx(s.disclosureSlot)}>
            <Show when={props.disclosure}>
              {(d) => (
                <button
                  class={sx(base.bare, s.disclosure, d().open && s.disclosureOpen)}
                  aria-label={d().open ? "Collapse" : "Expand"}
                  aria-expanded={d().open ? "true" : "false"}
                  onClick={(e) => (e.stopPropagation(), d().toggle())}
                >
                  <Icon icon={i.ArrowRight01Icon} size={10} aria-hidden="true" />
                </button>
              )}
            </Show>
          </span>
        </Show>
        <span class={sx(s.mailboxIcon)}>
          <Icon icon={props.icon} {...ICON} />
        </span>
        <span class={sx(base.ellipsis, s.mailboxName)}>{props.label}</span>
        <Show when={props.count}>
          <span class={sx(s.count)}>{props.count}</span>
        </Show>
      </div>
    </li>
  );
}

// Folds its content away and back, easing its height (a grid row from 0fr to 1fr) and fading it, as a disclosure does in
// macOS. What's folded stays mounted, so it can animate both ways, but out of reach of the keyboard.
function Collapse(props: { open: boolean; children: JSX.Element }): JSX.Element {
  return (
    <div class={sx(s.collapse, props.open && s.collapseOpen)} inert={!props.open}>
      <div class={sx(s.collapseInner)}>{props.children}</div>
    </div>
  );
}

const [folded, setFolded] = createSignal<string[]>(saved("mail-folded", []));
const toggleFold = (key: string): void => {
  const next = folded().includes(key) ? folded().filter((k) => k !== key) : [...folded(), key];
  setFolded(next);
  save("mail-folded", next);
};

// A sidebar section: a heading that folds it (as Mail's do), with an add button that shows on hover.
function Section(props: {
  title: string;
  add?: { label: string; run: () => void };
  children: JSX.Element;
}): JSX.Element {
  const shut = (): boolean => folded().includes(props.title);
  return (
    <section class={sx(s.section)}>
      <div
        class={sx(s.sectionHeader, stylex.defaultMarker())}
        onContextMenu={(e) => {
          const add = props.add;
          if (add) showMenu(e, [{ label: `${add.label}…`, run: add.run }]);
        }}
      >
        <button
          class={sx(base.bare, s.sectionTitle)}
          aria-expanded={shut() ? "false" : "true"}
          onClick={() => toggleFold(props.title)}
        >
          {props.title}
          <span class={sx(s.sectionChevron, !shut() && s.sectionChevronOpen)} aria-hidden="true">
            <Icon icon={i.ArrowRight01Icon} size={9} />
          </span>
        </button>
        <Show when={props.add}>
          {(add) => (
            <button
              class={sx(base.bare, s.sectionAdd)}
              aria-label={add().label}
              title={add().label}
              onClick={() => add().run()}
            >
              <Icon icon={i.Add01Icon} size={12} aria-hidden="true" />
            </button>
          )}
        </Show>
      </div>
      <Collapse open={!shut()}>
        <ul class={sx(s.mailboxes)}>{props.children}</ul>
      </Collapse>
    </section>
  );
}

// Which spaces and labels are open in the sidebar to show their threads (all start shut).
const [expanded, setExpanded] = createSignal<string[]>(saved("mail-expanded", []));
const toggleExpanded = (key: string): void => {
  const next = expanded().includes(key)
    ? expanded().filter((k) => k !== key)
    : [...expanded(), key];
  setExpanded(next);
  save("mail-expanded", next);
};

// A space or label that opens out, under its name, to its open threads, newest first: five rows tall, scrolling for
// the rest. Opening one of them lists the space's (or label's) threads beside the sidebar too.
function Expandable(props: {
  box: { kind: "subspace" | "label"; id: string };
  label: string;
  icon: IconSvgElement;
}): JSX.Element {
  const key = (): string => `${props.box.kind}:${props.box.id}`;
  const open_ = (): boolean => expanded().includes(key());
  const field = (): "subspaceIds" | "labelIds" =>
    props.box.kind === "subspace" ? "subspaceIds" : "labelIds";
  const menu = (): MenuItem[] => {
    const box = props.box;
    const toggle: MenuItem = {
      label: open_() ? "Hide threads" : "Show threads",
      run: () => toggleExpanded(key()),
    };
    if (box.kind === "label")
      return [
        { label: "Open label page", run: () => open({ label: box.id }) },
        {
          label: "New thread with this label…",
          run: () => setDialog({ kind: "newThread", labelId: box.id }),
        },
        "separator",
        toggle,
      ];
    const sub = store.findById(Subspace, box.id);
    return [
      { label: "Open space page", run: () => open({ subspace: box.id }) },
      {
        label: "New thread in this space…",
        run: () => setDialog({ kind: "newThread", subspaceId: box.id }),
      },
      ...(sub
        ? [{ label: "Add member…", run: () => setDialog({ kind: "addMember", subspace: sub }) }]
        : []),
      "separator",
      toggle,
    ];
  };
  const threads = (): Thread[] =>
    store
      .all(Thread)
      .filter((t) => t.isOpen && t[field()].includes(props.box.id))
      .sort((a, b) => lastActive(b) - lastActive(a));
  return (
    <>
      <Mailbox
        box={props.box}
        label={props.label}
        icon={props.icon}
        count={threads().length}
        disclosure={{ open: open_(), toggle: () => toggleExpanded(key()) }}
        menu={menu}
      />
      <li class={sx(s.mailboxItem)}>
        <Collapse open={open_()}>
          <ul class={sx(s.mailboxes, s.threadRows)} aria-label={`${props.label} threads`}>
            <For each={threads()}>
              {(thread) => (
                <li class={sx(s.mailboxItem)}>
                  <div
                    role="button"
                    tabindex={0}
                    class={sx(s.threadRow, active() === thread && s.mailboxOn)}
                    title={thread.title}
                    onClick={() => {
                      chooseMailbox(props.box);
                      open({ thread: thread.id });
                    }}
                    onContextMenu={(e) => showMenu(e, threadMenu(thread))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      chooseMailbox(props.box);
                      open({ thread: thread.id });
                    }}
                  >
                    <span
                      class={sx(
                        s.threadDot,
                        thread.state === "blocked" && s.threadDotBlocked,
                        thread.priority === "urgent" && s.threadDotUrgent,
                      )}
                      aria-hidden="true"
                    />
                    <span class={sx(base.ellipsis, s.threadTitle)}>{thread.title}</span>
                  </div>
                </li>
              )}
            </For>
            <Show when={threads().length === 0}>
              <li class={sx(s.mailboxItem, s.threadNone)}>No open threads</li>
            </Show>
          </ul>
        </Collapse>
      </li>
    </>
  );
}

// What right-clicking a bucket offers, as the old sidebar's bucket headings did.
function bucketMenu(bucket: Bucket): MenuItem[] {
  const move = (by: number) => () => {
    const buckets = myBuckets();
    const other = buckets[buckets.indexOf(bucket) + by];
    if (!other) return;
    [bucket.position, other.position] = [other.position, bucket.position];
    bucket.save();
    other.save();
  };
  return [
    { label: "Edit bucket…", run: () => setDialog({ kind: "bucket", bucket }) },
    { label: "New bucket…", run: () => setDialog({ kind: "bucket" }) },
    "separator",
    { label: "Move up", run: move(-1) },
    { label: "Move down", run: move(1) },
    // Sorting needs somewhere to put things.
    ...(myBuckets().length > 1
      ? [
          "separator" as const,
          {
            label: "Delete bucket",
            run: () => {
              if (sameMailbox(mailbox(), { kind: "bucket", id: bucket.id }))
                chooseMailbox({ kind: "inbox" });
              void bucket.delete();
            },
          },
        ]
      : []),
  ];
}

export function MailSidebar(): JSX.Element {
  const icons = (): Map<string, IconSvgElement> => bucketIcons(myBuckets());
  return (
    <aside class={sx(s.sidebar)} style={{ width: `${sidebarColumn.width()}px` }}>
      <div class={sx(topbar.bar, s.sidebarBar)}>
        <AppButtons />
        <span class={sx(topbar.end)}>
          <button
            class={sx(topbar.button)}
            aria-label="New thread"
            title="New thread (⌘N)"
            onClick={() => setDialog({ kind: "newThread" })}
          >
            <Icon icon={i.PencilEdit02Icon} {...ICON} />
          </button>
        </span>
      </div>
      <nav class={sx(s.nav)} aria-label="Mailboxes">
        <ul class={sx(s.mailboxes)}>
          <Mailbox
            box={{ kind: "inbox" }}
            label="Inbox"
            icon={i.InboxIcon}
            count={inbox().order.length}
            disclosure={{ open: !folded().includes("inbox"), toggle: () => toggleFold("inbox") }}
            menu={() => [
              { label: "New bucket…", run: () => setDialog({ kind: "bucket" }) },
              {
                label: folded().includes("inbox") ? "Show buckets" : "Hide buckets",
                run: () => toggleFold("inbox"),
              },
            ]}
          />
          <li class={sx(s.mailboxItem)}>
            <Collapse open={!folded().includes("inbox")}>
              <ul class={sx(s.mailboxes)}>
                <Show when={inbox().unsorted.length > 0}>
                  <Mailbox
                    box={{ kind: "unsorted" }}
                    label="Sorting"
                    icon={i.Clock01Icon}
                    count={inbox().unsorted.length}
                    indent
                  />
                </Show>
                <For each={inbox().sections}>
                  {(section) => (
                    <Mailbox
                      box={{ kind: "bucket", id: section.bucket.id }}
                      label={section.bucket.name}
                      icon={icons().get(section.bucket.id) ?? i.InboxIcon}
                      count={section.items.length}
                      indent
                      menu={() => bucketMenu(section.bucket)}
                    />
                  )}
                </For>
              </ul>
            </Collapse>
          </li>
          <Mailbox box={{ kind: "sent" }} label="Sent" icon={i.SentIcon} />
          <Mailbox
            box={{ kind: "drafts" }}
            label="Drafts"
            icon={i.NoteEditIcon}
            count={drafts().length}
          />
        </ul>
        <Section
          title="Spaces"
          add={{ label: "New subspace", run: () => setDialog({ kind: "newSubspace" }) }}
        >
          <For each={byName(store.all(Subspace))}>
            {(sub) => (
              <Expandable
                box={{ kind: "subspace", id: sub.id }}
                label={sub.name}
                icon={sub.visibility === "private" ? i.SquareLock02Icon : i.Layers01Icon}
              />
            )}
          </For>
        </Section>
        <Section
          title="Labels"
          add={{ label: "New label", run: () => setDialog({ kind: "newLabel" }) }}
        >
          <For each={byName(store.all(Label))}>
            {(label) => (
              <Expandable
                box={{ kind: "label", id: label.id }}
                label={label.name}
                icon={i.Tag01Icon}
              />
            )}
          </For>
        </Section>
        <Section title="Views">
          <Mailbox
            box={{ kind: "all" }}
            label="All threads"
            icon={i.DashboardSquare01Icon}
            menu={() => [{ label: "Open as a table", run: () => open({ view: null }) }]}
          />
          <For each={byName(store.all(View).filter((v) => v.shared || v.ownerId === me().id))}>
            {(saved) => (
              <Mailbox
                box={{ kind: "view", id: saved.id }}
                label={saved.name}
                icon={i.FilterIcon}
                menu={() => [
                  { label: "Open as a table", run: () => open({ view: saved.id }) },
                  ...(saved.ownerId === me().id
                    ? [
                        "separator" as const,
                        {
                          label: "Delete view",
                          run: () => {
                            if (sameMailbox(mailbox(), { kind: "view", id: saved.id }))
                              chooseMailbox({ kind: "all" });
                            void saved.delete();
                          },
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </For>
        </Section>
      </nav>
      <button
        class={sx(base.bare, s.profile)}
        aria-label="Your profile"
        onClick={() => open({ person: me().id })}
      >
        <Identicon seed={me().id} size={18} />
        <span class={sx(base.ellipsis)}>{me().name}</span>
      </button>
      <sidebarColumn.Edge label="Resize sidebar" />
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
function preview(body: string): string {
  let text = plain(body);
  const names = store.all(User).map((u) => `@${u.name} `);
  let lead = names.find((name) => text.startsWith(name));
  while (lead) {
    text = text.slice(lead.length);
    lead = names.find((name) => text.startsWith(name));
  }
  return text;
}

// Today's and past due dates are urgent.
const dueSoon = (due: Date): boolean => due.getTime() < new Date().setHours(23, 59, 59, 999);

// A thread as Mail lists a message: who wrote last and when, its title, the start of what they wrote, then its
// properties.
function Row(props: { thread: Thread }): JSX.Element {
  const t = (): Thread => props.thread;
  const on = (): boolean => active() === t();
  const item = () => itemFor(t());
  const isUnread = (): boolean => {
    const it = item();
    return it !== undefined && !it.doneAt && unread(it);
  };
  const last = () => t().messages.sorted("createdAt").at(-1);
  const from = () => last()?.author ?? t().owner;
  let row!: HTMLDivElement;
  // The open thread stays in view as J and K (or the arrows) move past the rows showing.
  createEffect(on, (shown) => {
    if (shown) row.scrollIntoView({ block: "nearest" });
  });
  return (
    <li class={sx(s.rowItem)} data-on={on() ? "" : undefined}>
      <div
        ref={row}
        role="button"
        tabindex={on() ? 0 : -1}
        data-active={on() ? "" : undefined}
        aria-current={on() ? "true" : undefined}
        class={sx(s.row, on() && s.rowOn)}
        onClick={() => open({ thread: t().id })}
        onContextMenu={(e) => showMenu(e, threadMenu(t()))}
      >
        <span class={sx(s.unreadSlot)}>
          <Show when={isUnread()}>
            <span class={sx(s.unreadDot)} aria-label="Unread" />
          </Show>
        </span>
        <Identicon seed={from()?.id ?? t().ownerId ?? ""} size={24} class={sx(s.avatar)} />
        <span class={sx(s.rowBody)}>
          <span class={sx(s.rowTop)}>
            <span class={sx(base.ellipsis, s.from)}>{from()?.name ?? ""}</span>
            <span class={sx(s.stamp)}>{stamp(last()?.createdAt ?? t().createdAt)}</span>
          </span>
          <span class={sx(s.subjectLine)}>
            <Show when={t().priority === "urgent" || t().priority === "high"}>
              <span class={sx(s.priority, t().priority === "urgent" && s.urgent)}>
                {t().priority === "urgent" ? "!!" : "!"}
              </span>
            </Show>
            <Show when={t().state !== "open"}>
              <span class={sx(s.stateMark)}>
                <Icon
                  icon={t().state === "resolved" ? i.CheckmarkCircle02Icon : i.Clock01Icon}
                  size={11}
                  aria-hidden="true"
                />
              </span>
            </Show>
            <span class={sx(base.ellipsis, s.subject, isUnread() && s.subjectUnread)}>
              {t().title}
            </span>
          </span>
          <Show when={last()}>
            {(message) => <span class={sx(s.preview)}>{preview(message().body)}</span>}
          </Show>
          <Show when={(t().dueAt && t().isOpen) || t().labelIds.length > 0}>
            <span class={sx(s.chips)}>
              <Show when={t().isOpen && t().dueAt}>
                {(due) => (
                  <span class={sx(s.due, dueSoon(due()) && s.dueSoon)}>
                    <Icon icon={i.Calendar03Icon} size={10} aria-hidden="true" />
                    {shortDate(due())}
                  </span>
                )}
              </Show>
              <For
                each={t()
                  .labelIds.map((id) => store.findById(Label, id))
                  .filter((l) => l !== undefined)}
              >
                {(label) => <span class={sx(s.labelChip)}>{label.name}</span>}
              </For>
            </span>
          </Show>
        </span>
      </div>
    </li>
  );
}

// A draft in Drafts, which opens back in Compose.
function DraftRow(props: { draft: Draft }): JSX.Element {
  // Its drafted title, else its first line; the rest is the preview.
  const lines = (): string[] => props.draft.text.split("\n");
  const title = (): string => props.draft.draft?.title || lines()[0] || "Untitled draft";
  const rest = (): string =>
    props.draft.draft?.title ? props.draft.text : lines().slice(1).join(" ");
  return (
    <li class={sx(s.rowItem)}>
      <div
        role="button"
        tabindex={0}
        class={sx(s.row)}
        onClick={() => setDialog({ kind: "compose", draftId: props.draft.id })}
        onContextMenu={(e) =>
          showMenu(e, [
            {
              label: "Open draft",
              run: () => setDialog({ kind: "compose", draftId: props.draft.id }),
            },
            "separator",
            { label: "Delete draft", run: () => void props.draft.delete() },
          ])
        }
      >
        <span class={sx(s.unreadSlot)} />
        <span class={sx(s.rowBody)}>
          <span class={sx(s.rowTop)}>
            <span class={sx(base.ellipsis, s.from, s.draftLabel)}>Draft</span>
            <span class={sx(s.stamp)}>{stamp(props.draft.updatedAt)}</span>
          </span>
          <span class={sx(base.ellipsis, s.subject)}>{title()}</span>
          <Show when={rest()}>
            <span class={sx(s.preview)}>{rest()}</span>
          </Show>
        </span>
      </div>
    </li>
  );
}

// What a page shows of a space, label or view: its members and settings, or the table of all its threads.
const pageOf = (box: Mailbox) =>
  box.kind === "subspace"
    ? { subspace: box.id }
    : box.kind === "label"
      ? { label: box.id }
      : box.kind === "view"
        ? { view: box.id }
        : box.kind === "all"
          ? { view: null }
          : undefined;

export function MessageList(): JSX.Element {
  const icons = (): Map<string, IconSvgElement> => bucketIcons(myBuckets());
  // Opening a space's, label's or view's page (from ⌘K, say) lists its threads here too.
  createEffect(view, (shown) => {
    const next: Mailbox | undefined =
      "subspace" in shown
        ? { kind: "subspace", id: shown.subspace }
        : "label" in shown
          ? { kind: "label", id: shown.label }
          : "view" in shown
            ? shown.view === null
              ? { kind: "all" }
              : { kind: "view", id: shown.view }
            : undefined;
    if (next && !sameMailbox(next, mailbox())) chooseMailbox(next);
  });
  const total = (): number =>
    mailbox().kind === "drafts" ? drafts().length : listed().order.length;
  const unreadCount = (): number =>
    listed().order.filter((t) => {
      const it = itemFor(t);
      return it !== undefined && !it.doneAt && unread(it);
    }).length;
  const subtitle = (): string => {
    const n = unreadCount();
    if (n > 0) return `${n} unread`;
    const count = total();
    const noun = mailbox().kind === "drafts" ? "draft" : "thread";
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
      class={sx(s.list)}
      style={{ width: `${listColumn.width()}px` }}
      aria-label={mailboxTitle(mailbox())}
    >
      <div class={sx(topbar.bar, s.listBar, !sidebarOpen() && s.listBarAlone)}>
        <Show when={!sidebarOpen()}>
          <AppButtons />
        </Show>
        <span class={sx(s.listHeading)}>
          <span class={sx(base.ellipsis, s.listTitle)}>{mailboxTitle(mailbox())}</span>
          <span class={sx(s.listSubtitle)}>{subtitle()}</span>
        </span>
        <span class={sx(topbar.end)}>
          <Show when={pageOf(mailbox())}>
            {(page) => (
              <button
                class={sx(topbar.button)}
                aria-label="About this"
                title="Show its page"
                onClick={() => open(page())}
              >
                <Icon icon={i.InformationCircleIcon} {...ICON} />
              </button>
            )}
          </Show>
          <Show when={!sidebarOpen()}>
            <button
              class={sx(topbar.button)}
              aria-label="New thread"
              title="New thread (⌘N)"
              onClick={() => setDialog({ kind: "newThread" })}
            >
              <Icon icon={i.PencilEdit02Icon} {...ICON} />
            </button>
          </Show>
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
          when={mailbox().kind === "drafts"}
          fallback={
            <For each={listed().groups}>
              {(group) => (
                <>
                  <Show when={mailbox().kind === "inbox"}>
                    <div class={sx(s.groupHeader)}>
                      <Icon
                        icon={
                          group.bucket
                            ? (icons().get(group.bucket.id) ?? i.InboxIcon)
                            : i.Clock01Icon
                        }
                        size={11}
                        aria-hidden="true"
                      />
                      {group.bucket?.name ?? group.title}
                      <span class={sx(s.groupCount)}>{group.threads.length}</span>
                    </div>
                  </Show>
                  <ul class={sx(s.rows)}>
                    <For each={group.threads}>{(thread) => <Row thread={thread} />}</For>
                  </ul>
                </>
              )}
            </For>
          }
        >
          <ul class={sx(s.rows)}>
            <For each={drafts()}>{(draft) => <DraftRow draft={draft} />}</For>
          </ul>
        </Show>
        <Show when={total() === 0}>
          <div class={sx(s.empty)}>
            <Icon
              icon={mailbox().kind === "inbox" ? i.InboxCheckIcon : i.InboxIcon}
              size={28}
              aria-hidden="true"
            />
            <span class={sx(s.emptyTitle)}>
              {mailbox().kind === "inbox" ? "All caught up" : "Nothing here"}
            </span>
            <Show when={mailbox().kind === "inbox"}>
              <span>Nothing in your inbox needs you right now.</span>
            </Show>
          </div>
        </Show>
      </div>
      <listColumn.Edge label="Resize list" />
    </section>
  );
}

// ── The reading pane's toolbar: what you can do with the open thread ──

export function ThreadActions(props: { thread: Thread }): JSX.Element {
  const item = () => (inbox().order.includes(props.thread) ? itemFor(props.thread) : undefined);
  const moveMenu = (event: MouseEvent): void => {
    const it = itemFor(props.thread);
    if (!it) return;
    showMenu(event, [
      ...myBuckets().map((bucket) => ({
        label: bucket.name,
        checked: it.bucketId === bucket.id,
        run: () => placeIn(it, bucket),
      })),
      "separator" as const,
      { label: "Sort it for me", run: () => placeIn(it, undefined) },
    ]);
  };
  return (
    <>
      <Show when={item()}>
        {(it) => (
          <>
            <button
              class={sx(topbar.button)}
              aria-label="Done"
              title="Done (⌘E)"
              onClick={() => markDone(it())}
            >
              <Icon icon={i.Tick02Icon} {...ICON} />
            </button>
            <button
              class={sx(topbar.button)}
              aria-label="Move to"
              title="Move to a bucket"
              onClick={moveMenu}
            >
              <Icon icon={i.Folder01Icon} {...ICON} />
            </button>
          </>
        )}
      </Show>
      <button
        class={sx(topbar.button)}
        aria-label="More"
        title="More"
        onClick={(e) => showMenu(e, threadMenu(props.thread))}
      >
        <Icon icon={i.MoreHorizontalIcon} {...ICON} />
      </button>
    </>
  );
}

// No thread open: as Mail says.
export function NothingOpen(): JSX.Element {
  return (
    <div class={sx(s.nothing)}>
      <span class={sx(s.nothingTitle)}>No thread selected</span>
      <span>{listed().order.length > 0 ? "Choose one from the list to read it here." : ""}</span>
    </div>
  );
}

const EDGE = `linear-gradient(to right, transparent 2px, ${colors.resizeEdge} 2px, ${colors.resizeEdge} 3px, transparent 3px)`;

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
    backgroundImage: { default: null, ":hover": EDGE },
    cursor: "col-resize",
  },

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
  sidebarBar: { paddingLeft: sidebarSpace.afterLights },
  nav: { flex: 1, minHeight: 0, padding: "2px 8px 12px", overflowY: "auto" },
  // A little space between rows, so neighbouring fills (a space and its open thread) don't run together.
  mailboxes: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  mailboxItem: { listStyle: "none" },
  mailbox: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 26,
    paddingRight: 8,
    borderRadius: radii.row,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    cursor: "default",
    outline: "none",
    backgroundColor: { default: "transparent", ":focus-visible": colors.bgQuaternary },
  },
  mailboxOn: { backgroundColor: colors.bgTertiary },
  // Indented by a margin, not padding, and without the disclosure's slot, so its hover and selection fill starts just
  // before its icon (which lines up with where it was: 14 + 12 + 6).
  indent: { marginLeft: 26, paddingLeft: 6 },
  disclosureSlot: { display: "flex", flexShrink: 0, justifyContent: "center", width: 12 },
  disclosure: {
    display: "flex",
    color: colors.textTertiary,
    transitionProperty: "transform",
    transitionDuration: { default: "220ms", [motion.reduced]: "0s" },
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
  collapse: {
    display: "grid",
    gridTemplateRows: "0fr",
    opacity: 0,
    transitionProperty: "grid-template-rows, opacity",
    transitionDuration: { default: "220ms", [motion.reduced]: "0s" },
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
  collapseOpen: { gridTemplateRows: "1fr", opacity: 1 },
  // A space's or label's threads: five rows tall, scrolling past that.
  threadRows: { maxHeight: 24 * 5 + 2 * 4, overflowY: "auto", overscrollBehavior: "contain" },
  threadRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    height: 24,
    // Under the mailbox's icon, so the titles line up with the names above; the indent is a margin, so the row's
    // fill starts there rather than at the sidebar's edge.
    marginLeft: 16,
    paddingLeft: 6,
    paddingRight: 8,
    borderRadius: radii.row,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    cursor: "default",
    outline: "none",
    backgroundColor: { default: "transparent", ":hover": colors.bgQuaternary },
  },
  threadDot: {
    flexShrink: 0,
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: colors.iconTertiary,
  },
  threadDotBlocked: { backgroundColor: "#ff9f0a" },
  threadDotUrgent: { backgroundColor: colors.urgent },
  threadTitle: { flex: 1 },
  threadNone: {
    paddingLeft: 38,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    lineHeight: "24px",
  },
  collapseInner: { minHeight: 0, overflow: "hidden" },
  disclosureOpen: { transform: "rotate(90deg)" },
  mailboxIcon: { display: "flex", flexShrink: 0, color: colors.iconTertiary },
  mailboxName: { flex: 1 },
  count: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontVariantNumeric: "tabular-nums",
  },
  section: { marginTop: 14 },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    height: 22,
    paddingLeft: 6,
    paddingRight: 6,
  },
  sectionTitle: {
    display: "flex",
    flex: 1,
    gap: 4,
    alignItems: "center",
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontWeight: 600,
    cursor: "default",
  },
  sectionChevron: {
    display: "flex",
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1 },
    transitionProperty: "transform, opacity",
    transitionDuration: { default: "220ms", [motion.reduced]: "0s" },
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
  sectionChevronOpen: { transform: "rotate(90deg)" },
  sectionAdd: {
    display: "flex",
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1 },
  },
  profile: {
    display: "flex",
    flexShrink: 0,
    gap: 8,
    alignItems: "center",
    margin: "0 8px 8px",
    padding: "6px 8px",
    borderRadius: radii.row,
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
    backgroundColor: colors.frosted,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
  },
  listBar: { paddingLeft: 16 },
  listBarAlone: { paddingLeft: sidebarSpace.afterLights },
  // The mailbox's name and, after it on the same line, how many are unread (or listed).
  listHeading: { display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 },
  listTitle: { color: colors.textPrimary, fontSize: fontSizes.name, fontWeight: 500 },
  listSubtitle: { flexShrink: 0, color: colors.textTertiary, fontSize: fontSizes.small },
  listScroll: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 6px 12px", outline: "none" },
  groupHeader: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 26,
    padding: "0 10px",
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontWeight: 500,
  },
  groupCount: { fontWeight: 400 },
  rows: { margin: 0, padding: 0, listStyle: "none" },
  rowItem: {
    listStyle: "none",
    // A hairline between rows; it gives way on both sides of a selected or hovered row, so its rounded fill stands
    // clear rather than cut by the lines above and below it.
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: colors.strokeTertiary,
      ":is([data-on], :hover)": "transparent",
      ":has(+ :is([data-on], :hover))": "transparent",
    },
  },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    padding: "9px 10px 10px 2px",
    borderRadius: radii.row,
    color: colors.textPrimary,
    cursor: "default",
    outline: "none",
  },
  rowOn: { backgroundColor: colors.bgTertiary },
  unreadSlot: {
    display: "flex",
    flexShrink: 0,
    justifyContent: "center",
    width: 12,
    paddingTop: 5,
  },
  unreadDot: { width: 8, height: 8, borderRadius: "50%", backgroundColor: colors.systemBlue },
  avatar: { flexShrink: 0, marginTop: 1 },
  rowBody: { display: "flex", flex: 1, flexDirection: "column", gap: 1, minWidth: 0 },
  rowTop: { display: "flex", gap: 8, alignItems: "baseline" },
  from: { flex: 1, fontSize: fontSizes.name, fontWeight: 600 },
  draftLabel: { color: colors.urgent },
  stamp: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontVariantNumeric: "tabular-nums",
  },
  subjectLine: { display: "flex", gap: 4, alignItems: "center", minWidth: 0 },
  subject: { fontSize: fontSizes.body },
  subjectUnread: { fontWeight: 600 },
  priority: { flexShrink: 0, color: "#ff9f0a", fontSize: fontSizes.body, fontWeight: 700 },
  urgent: { color: colors.urgent },
  stateMark: { display: "flex", flexShrink: 0, color: colors.textTertiary },
  preview: {
    display: "-webkit-box",
    overflow: "hidden",
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    lineHeight: "16px",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 3 },
  due: {
    display: "flex",
    gap: 3,
    alignItems: "center",
    color: colors.textTertiary,
    fontSize: fontSizes.small,
  },
  dueSoon: { color: colors.urgent },
  labelChip: {
    padding: "0 6px",
    borderRadius: radii.pill,
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    lineHeight: "16px",
    backgroundColor: colors.bgTertiary,
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

  nothing: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    color: colors.textTertiary,
  },
  nothingTitle: { color: colors.textSecondary, fontSize: fontSizes.pageTitle, fontWeight: 600 },
});
