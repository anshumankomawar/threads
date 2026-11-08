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
  edit,
  markAllRead,
  menuFrom,
  me,
  myBuckets,
  open,
  save,
  saved,
  setDialog,
  shortDate,
  shown,
  onChooseGroup,
  showMenu,
  sidebarOpen,
  sortAllForMe,
  store,
  threadMenu,
  unread,
  view,
  workspace,
  undoable,
  type MenuItem,
} from "../session";
import {
  baseFilter,
  chooseMailbox,
  showMailbox,
  conditions,
  setConditions,
  drafts,
  listed,
  mailbox,
  mailboxTitle,
  sameMailbox,
  type Mailbox,
  display,
  groupedBy,
  ORDERS,
  type Order,
  type Layout,
  type Zoom,
  ZOOMS,
  setDisplay,
} from "../mail";
import { bucketIcons } from "../bucketIcons";
import { describe, FIELDS, subspacesIn } from "../filters";
import { base } from "../styles/base";
import { button, topbar } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors, fontSizes, motion, sidebarSpace } from "../styles/tokens.stylex";
import { AppButtons } from "./TopButtons";
import { icon, Icon, type IconSvgElement } from "./Icon";
import { askInline, InlineForm } from "./InlineForm";
import { progressOf } from "../links";
import { Tabs, type Tab } from "./Tabs";
import { Identicon } from "./Identicon";
import { MenuChip } from "./Menus";
import { makeSubspace } from "./Palettes";
import { dot, plain } from "./ThreadView";
import { Timeline } from "./Timeline";

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
// A timeline beside an open thread: wider than a list, so a few weeks show.
const timelineColumn = resizable("mail-timeline-width", { initial: 600, min: 300, max: 1100 });
// A timeline takes the room a list leaves the reading pane.
const wide = (): boolean => display().layout !== "list";

// ── The sidebar: mailboxes ──

// A mailbox in the sidebar: its icon, name and count.
function Mailbox(props: {
  box: Mailbox;
  label: string;
  icon: IconSvgElement;
  count?: number;
  indent?: boolean;
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
const toggleFold = (key: string): void =>
  void setFolded((list) => {
    const next = toggleIn(list, key);
    save("mail-folded", next);
    return next;
  });

// A sidebar section: a heading that folds it (as Mail's do), with an add button that shows on hover.
// A section's + : a small field grown out of it (InlineForm) for the new one's name. Enter makes it and selects it.
type Add = { label: string; placeholder: string; make: (name: string) => Mailbox };

function Section(props: { title: string; add?: Add; children: JSX.Element }): JSX.Element {
  const shut = (): boolean => folded().includes(props.title);
  let plus: HTMLButtonElement | undefined;
  // From the +, over it; from the heading's menu, in the menu's place under its title.
  const ask = (from: Element | DOMRect | null | undefined, title?: string): void => {
    const add = props.add;
    if (!add || !from) return;
    askInline({
      at: from,
      title,
      icon: i.Add01Icon,
      fields: [{ label: add.label, placeholder: add.placeholder }],
      submit: ([name]) => chooseMailbox(add.make(name)),
    });
  };
  return (
    <section class={sx(s.section)}>
      <div
        class={sx(s.sectionHeader, stylex.defaultMarker())}
        onContextMenu={(e) => {
          const add = props.add;
          if (add)
            showMenu(e, [
              {
                label: add.label,
                form: true,
                icon: icon(i.Add01Icon, 13),
                run: (from) => ask(from, add.label),
              },
            ]);
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
              ref={plus}
              class={sx(base.bare, s.sectionAdd)}
              aria-label={add().label}
              title={add().label}
              onClick={(e) => ask(e.currentTarget.querySelector("svg"))}
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

// From the latest list, written or not (Solid applies writes in batches), so two toggles at once both count.
const toggleIn = (list: string[], key: string): string[] =>
  list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

const draftTitle = (draft: Draft): string =>
  draft.draft?.title || draft.text.split("\n")[0] || "Untitled draft";

// A space or label: how many open threads it has, and what right-clicking it offers.
function SpaceOrLabel(props: {
  box: { kind: "subspace" | "label"; id: string };
  label: string;
  icon: IconSvgElement;
}): JSX.Element {
  const field = (): "subspaceIds" | "labelIds" =>
    props.box.kind === "subspace" ? "subspaceIds" : "labelIds";
  const openCount = (): number =>
    store.all(Thread).filter((t) => t.isOpen && t[field()].includes(props.box.id)).length;
  const menu = (): MenuItem[] => {
    const box = props.box;
    if (box.kind === "label")
      return [
        {
          label: "New Thread with This Label",
          icon: icon(i.PencilEdit02Icon, 13),
          run: () => setDialog({ kind: "newThread", labelId: box.id }),
        },
      ];
    const sub = store.findById(Subspace, box.id);
    return [
      {
        label: "Open Space Page",
        icon: icon(i.InformationCircleIcon, 13),
        run: () => open({ subspace: box.id }),
      },
      {
        label: "New Thread in This Space",
        icon: icon(i.PencilEdit02Icon, 13),
        run: () => setDialog({ kind: "newThread", subspaceId: box.id }),
      },
      ...(sub
        ? [
            {
              label: "Add Member",
              icon: icon(i.UserAdd01Icon, 13),
              run: () => setDialog({ kind: "addMember", subspace: sub }),
            },
          ]
        : []),
    ];
  };
  return (
    <Mailbox
      box={props.box}
      label={props.label}
      icon={props.icon}
      count={openCount()}
      menu={menu}
    />
  );
}

// A bucket's name and what goes in it (which the model sorts by), asked for in a form grown out of the menu entry
// that asked, at `from`.
function askBucket(from: DOMRect, bucket?: Bucket): void {
  askInline({
    at: from,
    title: bucket ? "Edit Bucket" : "New Bucket",
    icon: bucket ? i.PencilEdit01Icon : i.Add01Icon,
    fields: [
      { label: "Name", placeholder: "Name the bucket", value: bucket?.name },
      {
        label: "What goes in it",
        placeholder: "What goes in it?",
        value: bucket?.description,
      },
    ],
    submit: ([name, description]) => {
      if (bucket) return edit(bucket, { name: name.slice(0, 40), description }, "Edit Bucket");
      const position = Math.max(-1, ...myBuckets().map((b) => b.position)) + 1;
      let id = "";
      undoable("New Bucket", () => {
        id = store.create(Bucket, {
          user: me(),
          name: name.slice(0, 40),
          description: description.slice(0, 500),
          position,
        }).id;
      });
      chooseMailbox({ kind: "bucket", id });
    },
  });
}

// Deleting a bucket, confirmed by typing its name in a form grown out of the entry that asked; its threads go back to
// the model to sort.
export function askDeleteBucket(from: DOMRect, bucket: Bucket): void {
  askInline({
    at: from,
    icon: i.Delete02Icon,
    title: "Delete Bucket",
    fields: [{ label: "Bucket name", placeholder: `Type “${bucket.name}” to delete it` }],
    accept: ([typed]) => typed === bucket.name,
    submit: () => {
      if (sameMailbox(mailbox(), { kind: "bucket", id: bucket.id }))
        chooseMailbox({ kind: "inbox" });
      undoable("Delete Bucket", () => void bucket.delete());
    },
  });
}

// What right-clicking a bucket offers, as the old sidebar's bucket headings did.
function bucketMenu(bucket: Bucket): MenuItem[] {
  const move = (by: number) => () => {
    const buckets = myBuckets();
    const other = buckets[buckets.indexOf(bucket) + by];
    if (!other) return;
    undoable("Move Bucket", () => {
      [bucket.position, other.position] = [other.position, bucket.position];
      bucket.save();
      other.save();
    });
  };
  return [
    {
      label: "Edit Bucket",
      form: true,
      icon: icon(i.PencilEdit01Icon, 13),
      run: (from) => askBucket(from, bucket),
    },
    {
      label: "New Bucket",
      icon: icon(i.Add01Icon, 13),
      form: true,
      run: (from) => askBucket(from),
    },
    "separator",
    { label: "Move Up", icon: icon(i.ArrowUp01Icon, 13), run: move(-1) },
    { label: "Move Down", icon: icon(i.ArrowDown01Icon, 13), run: move(1) },
    // Sorting needs somewhere to put things.
    ...(myBuckets().length > 1
      ? [
          "separator" as const,
          {
            label: "Delete Bucket",
            form: true,
            icon: icon(i.Delete02Icon, 13),
            run: (from) => askDeleteBucket(from, bucket),
          },
        ]
      : []),
  ];
}

// The sidebar's segments, each one group of mailboxes: your inbox (with its buckets, sent and drafts), the
// workspace's spaces and labels, and views across it. The one shown follows the mailbox you choose, wherever from.
type SidebarGroup = "mail" | "spaces" | "views";
const GROUPS: (Tab & { key: SidebarGroup })[] = [
  { key: "mail", label: "Inbox", icon: i.InboxIcon },
  { key: "spaces", label: "Spaces", icon: i.Layers01Icon },
  { key: "views", label: "Views", icon: i.ViewIcon },
];
const groupOf = (box: Mailbox): SidebarGroup =>
  box.kind === "subspace" || box.kind === "label"
    ? "spaces"
    : box.kind === "personal" || box.kind === "all" || box.kind === "view" || box.kind === "person"
      ? "views"
      : "mail";
const [group, setGroup] = createSignal<SidebarGroup>(groupOf(mailbox()));
const chooseGroup = (next: SidebarGroup): void => void setGroup(next);
// ⌘1, ⌘2… show the segments in order.
onChooseGroup((at) => {
  const chosen = GROUPS[at];
  if (chosen) chooseGroup(chosen.key);
});

export function MailSidebar(): JSX.Element {
  // Choosing a mailbox from elsewhere (⌘4, a space's page) shows its group.
  createEffect(mailbox, (box) => void setGroup(groupOf(box)));
  const icons = (): Map<string, IconSvgElement> => bucketIcons(myBuckets());
  return (
    <aside class={sx(s.sidebar)} style={{ width: `${sidebarColumn.width()}px` }}>
      <div data-bar class={sx(topbar.bar, s.sidebarBar)}>
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
      <div class={sx(s.groups)}>
        <Tabs
          label="Sidebar"
          tabs={GROUPS}
          chosen={GROUPS.find((g) => g.key === group()) ?? GROUPS[0]}
          onChoose={(g) => chooseGroup(g.key)}
        />
      </div>
      <nav class={sx(s.nav)} aria-label="Mailboxes">
        <Show when={group() === "mail"}>
          <ul class={sx(s.mailboxes)}>
            <Mailbox
              box={{ kind: "inbox" }}
              label="Buckets"
              icon={i.InboxIcon}
              count={inbox().order.length}
              menu={() => [
                {
                  label: "New Bucket",
                  icon: icon(i.Add01Icon, 13),
                  form: true,
                  run: (from) => askBucket(from),
                },
                "separator",
                {
                  label: "Mark All as Read",
                  icon: icon(i.MailOpen01Icon, 13),
                  run: markAllRead,
                },
                {
                  label: "Sort All for Me",
                  icon: icon(i.SparklesIcon, 13),
                  run: sortAllForMe,
                },
              ]}
            />

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
            <Mailbox box={{ kind: "sent" }} label="Sent" icon={i.SentIcon} />
            <Mailbox
              box={{ kind: "drafts" }}
              label="Drafts"
              icon={i.NoteEditIcon}
              count={drafts().length}
            />
          </ul>
        </Show>
        <Show when={group() === "spaces"}>
          <Section
            title="Spaces"
            add={{
              label: "New Subspace",
              placeholder: "Name the space",
              make: (name) => ({ kind: "subspace", id: makeSubspace(name).id }),
            }}
          >
            <For each={byName(store.all(Subspace))}>
              {(sub) => (
                <SpaceOrLabel
                  box={{ kind: "subspace", id: sub.id }}
                  label={sub.name}
                  icon={sub.visibility === "private" ? i.SquareLock02Icon : i.Layers01Icon}
                />
              )}
            </For>
          </Section>
          <Section
            title="Labels"
            add={{
              label: "New Label",
              placeholder: "Name the label",
              make: (name) => {
                let id = "";
                undoable("New Label", () => {
                  id = store.create(Label, { name, workspace: workspace() }).id;
                });
                return { kind: "label", id };
              },
            }}
          >
            <For each={byName(store.all(Label))}>
              {(label) => (
                <SpaceOrLabel
                  box={{ kind: "label", id: label.id }}
                  label={label.name}
                  icon={i.Tag01Icon}
                />
              )}
            </For>
          </Section>
        </Show>
        <Show when={group() === "views"}>
          <ul class={sx(s.mailboxes)}>
            <Mailbox box={{ kind: "personal" }} label="Personal" icon={i.UserIcon} />
            <Mailbox box={{ kind: "all" }} label="Workspace" icon={i.DashboardSquare01Icon} />
            <For each={byName(store.all(View).filter((v) => v.shared || v.ownerId === me().id))}>
              {(saved) => (
                <Mailbox
                  box={{ kind: "view", id: saved.id }}
                  label={saved.name}
                  icon={i.FilterIcon}
                  menu={() =>
                    saved.ownerId === me().id
                      ? [
                          {
                            label: "View Settings",
                            icon: icon(i.Settings02Icon, 13),
                            run: () => open({ view: saved.id }),
                          },
                          "separator" as const,
                          {
                            label: "Delete View",
                            icon: icon(i.Delete02Icon, 13),
                            run: () => {
                              if (sameMailbox(mailbox(), { kind: "view", id: saved.id }))
                                chooseMailbox({ kind: "all" });
                              undoable("Delete View", () => void saved.delete());
                            },
                          },
                        ]
                      : []
                  }
                />
              )}
            </For>
          </ul>
        </Show>
      </nav>
      <InlineForm />
      <div class={sx(s.footer)}>
        {/* You: one button to your profile and settings, on one page. */}
        <button
          class={sx(base.bare, s.profile)}
          aria-label="Profile and settings"
          title="Profile and settings (⌘,)"
          onClick={() => open({ settings: null })}
        >
          <Identicon seed={me().id} size={18.18} />
          <span class={sx(base.ellipsis)}>{me().name}</span>
        </button>
      </div>
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
    <li class={sx(s.rowItem, stylex.defaultMarker())} data-on={on() ? "" : undefined}>
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
              <Show when={t().priority === "urgent" || t().priority === "high"}>
                <span class={sx(s.priority, t().priority === "urgent" && s.urgent)}>
                  {t().priority === "urgent" ? "!!" : "!"}
                </span>
              </Show>
              <Show when={t().state === "blocked"}>
                <span class={sx(s.stateMark)}>
                  <Icon icon={i.Clock01Icon} size={11} aria-hidden="true" />
                </span>
              </Show>
              <span class={sx(base.ellipsis, s.subject, !t().isOpen && s.subjectResolved)}>
                {t().title}
              </span>
            </span>
            {/* Unread: a dot before when, on the right, so read rows lose no width to an empty column. */}
            <span class={sx(s.stamp)}>
              <Show when={isUnread()}>
                <span class={sx(s.unreadDot)} aria-label="Unread" />
              </Show>
              {stamp(last()?.createdAt ?? t().createdAt)}
            </span>
          </span>
          {/* Then who wrote last and what, up to two lines, in a column of its own; its due date and label beside it,
              on its last line. */}
          <span class={sx(s.second)}>
            <span class={sx(s.preview)}>
              <span class={sx(s.from)}>{from()?.name ?? ""}</span>
              <Show when={last()}>{(message) => <> {preview(message().body)}</>}</Show>
            </span>
            {/* What it's made of: how many of its branches are resolved. */}
            <Show when={progressOf(t())}>
              {(p) => (
                <span class={sx(s.due)} title="Branches resolved">
                  <Icon icon={i.GitBranchIcon} size={10} aria-hidden="true" />
                  {p().done}/{p().total}
                </span>
              )}
            </Show>
            <Show when={t().dueAt}>
              {(due) => (
                <span class={sx(s.due, t().isOpen && dueSoon(due()) && s.dueSoon)}>
                  <Icon icon={i.Calendar03Icon} size={10} aria-hidden="true" />
                  {shortDate(due())}
                </span>
              )}
            </Show>
            <Show
              when={t()
                .labelIds.map((id) => store.findById(Label, id))
                .find((l) => l)}
            >
              {(label) => <span class={sx(s.labelChip)}>{label().name}</span>}
            </Show>
          </span>
        </span>
      </div>
    </li>
  );
}

// A draft in Drafts, which opens back in Compose.
function DraftRow(props: { draft: Draft }): JSX.Element {
  // Its drafted title, else its first line; the rest is the preview.
  const lines = (): string[] => props.draft.text.split("\n");
  const title = (): string => draftTitle(props.draft);
  const rest = (): string =>
    props.draft.draft?.title ? props.draft.text : lines().slice(1).join(" ");
  return (
    <li
      class={sx(s.rowItem, stylex.defaultMarker())}
      data-on={shown("draft") === props.draft.id ? "" : undefined}
    >
      <div
        role="button"
        tabindex={0}
        data-active={shown("draft") === props.draft.id ? "" : undefined}
        aria-current={shown("draft") === props.draft.id ? "true" : undefined}
        class={sx(s.row, shown("draft") === props.draft.id && s.selected)}
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
              run: () => undoable("Delete Draft", () => void props.draft.delete()),
            },
          ])
        }
      >
        <span class={sx(s.rowBody)}>
          <span class={sx(s.rowTop)}>
            <span class={sx(base.ellipsis, s.from)}>{title()}</span>
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

// The filter menu's icons: each field's, and each value's where it has one of its own (a status's dot, a person's
// avatar, a space's or label's mark).
const FIELD_ICONS: Record<string, IconSvgElement> = {
  state: i.Loading03Icon,
  priority: i.Flag01Icon,
  subspaceIds: i.Layers01Icon,
  labelIds: i.Tag01Icon,
  assigneeIds: i.UserMultipleIcon,
  ownerId: i.UserIcon,
};
function valueIcon(field: string, value: string): JSX.Element | undefined {
  if (field === "state") return dot(value as Thread["state"]);
  if (field === "assigneeIds" || field === "ownerId")
    return <Identicon seed={value === "$me" ? me().id : value} size={13} />;
  if (field === "subspaceIds") return icon(i.Layers01Icon, 13);
  if (field === "labelIds") return icon(i.Tag01Icon, 13);
  return undefined;
}

// The list's button to a mailbox's page: a space's or view's settings (a gear), or someone's profile.
const pageLabel = (box: Mailbox): string =>
  box.kind === "subspace"
    ? "Space settings"
    : box.kind === "view"
      ? "View settings"
      : box.kind === "bucket"
        ? "Bucket settings"
        : "Profile";

// What a mailbox's page shows beside its list: a space's description, members and settings, a saved view's settings,
// or someone's profile.
const pageOf = (box: Mailbox) =>
  box.kind === "subspace"
    ? { subspace: box.id }
    : box.kind === "view"
      ? { view: box.id }
      : box.kind === "bucket"
        ? { bucket: box.id }
        : box.kind === "person"
          ? { person: box.id }
          : undefined;

// The ways a list can be laid out, as the Display menu and ⌘K offer them.
export const LAYOUTS: {
  layout: Layout;
  label: string;
  title: string;
  icon: IconSvgElement;
  keywords: string;
}[] = [
  {
    layout: "list",
    label: "List",
    title: "Show as a list",
    icon: i.LeftToRightListBulletIcon,
    keywords: "rows",
  },
  {
    layout: "timeline",
    label: "Timeline",
    title: "Show as a timeline",
    icon: i.ChartBarDecreasingIcon,
    keywords: "gantt roadmap schedule dates",
  },
];
const layoutIcon = (): IconSvgElement => LAYOUTS.find((l) => l.layout === display().layout)!.icon;

// The ways to group and order a list, and a timeline's scales: in the Display menu, the query bar and ⌘K. Grouping
// toggles: choosing the one it's grouped by ungroups it.
const groupItems = (): MenuItem[] =>
  Object.entries(FIELDS).map(([field, { label }]) => ({
    label,
    icon: icon(FIELD_ICONS[field] ?? i.FilterIcon, 13),
    checked: groupedBy() === field,
    run: () => setDisplay({ group: groupedBy() === field ? undefined : field }),
  }));
const orderItems = (): MenuItem[] =>
  (Object.keys(ORDERS) as Order[]).map((order) => ({
    label: ORDERS[order],
    checked: (display().order ?? "updated") === order,
    run: () => setDisplay({ order: order === "updated" ? undefined : order }),
  }));

// What a list can be narrowed by: each field's values, and resolved threads (hidden, they're a pill too).
const filterItems = (): MenuItem[] => [
  ...Object.entries(FIELDS).map(([field, { label, compare, values }]) => ({
    label,
    icon: icon(FIELD_ICONS[field] ?? i.FilterIcon, 13),
    items: values().map(([value, name]) => ({
      label: name,
      icon: valueIcon(field, value),
      run: () => setConditions([...conditions(), { [field]: { [compare]: value } }]),
    })),
  })),
  "separator",
  {
    label: "Show Resolved",
    icon: icon(i.CheckmarkCircle02Icon, 13),
    checked: !display().hideResolved,
    run: () => setDisplay({ hideResolved: !display().hideResolved || undefined }),
  },
];

// How the list is shown (mail.ts' display, kept on this Mac): rows or a timeline; grouped by any field a filter can test;
// a timeline's scale; its order; and whether resolved threads show. In ⌘K too.
export const displayMenu = (): MenuItem[] => [
  ...LAYOUTS.map(({ layout, label, icon: glyph }) => ({
    label,
    icon: icon(glyph, 13),
    run: () => setDisplay({ layout }),
  })),
  "separator",
  { label: "Group By", icon: icon(i.LayerIcon, 13), items: groupItems() },
  ...(display().layout === "timeline"
    ? [
        {
          label: "Zoom",
          icon: icon(i.ZoomInIcon, 13),
          items: (Object.keys(ZOOMS) as Zoom[]).map((zoom) => ({
            label: ZOOMS[zoom],
            checked: (display().zoom ?? "weeks") === zoom,
            run: () => setDisplay({ zoom }),
          })),
        },
      ]
    : []),
  { label: "Order By", icon: icon(i.Sorting01Icon, 13), items: orderItems() },
  {
    label: "Show Resolved",
    icon: icon(i.CheckmarkCircle02Icon, 13),
    checked: !display().hideResolved,
    run: () => setDisplay({ hideResolved: !display().hideResolved || undefined }),
  },
];

// The query over the list, in a bar above it: its filters (each a pill that removes itself; more from Filter), saving
// them as a view, how it's grouped and ordered, and New. Always over a timeline; over a list while it's filtered.
function QueryBar(): JSX.Element {
  return (
    <div class={sx(s.query)}>
      <For each={conditions()}>
        {(condition) => (
          <button
            class={sx(base.bare, base.hover, page.filterPill)}
            title="Remove"
            onClick={() => setConditions(conditions().filter((c) => c !== condition))}
          >
            {describe(condition)}
            <Icon icon={i.Cancel01Icon} size={11} aria-hidden="true" />
          </button>
        )}
      </For>
      <Show when={display().hideResolved}>
        <button
          class={sx(base.bare, base.hover, page.filterPill)}
          title="Show resolved threads"
          onClick={() => setDisplay({ hideResolved: undefined })}
        >
          Resolved hidden
          <Icon icon={i.Cancel01Icon} size={11} aria-hidden="true" />
        </button>
      </Show>
      <MenuChip
        title="Filter"
        tone="muted"
        icon={<Icon icon={i.FilterIcon} size={12} aria-hidden="true" />}
        label="Filter"
        items={filterItems()}
      />
      <Show when={conditions().length > 0 && mailbox().kind !== "view"}>
        <button
          class={sx(base.bare, base.dim, page.filterPill)}
          onClick={() =>
            setDialog({
              kind: "newView",
              filter: { and: [...baseFilter(mailbox()), ...conditions()] },
            })
          }
        >
          Save view
        </button>
      </Show>
      <span class={sx(s.querySpacer)} />
      <MenuChip
        title="Group by"
        tone={groupedBy() ? undefined : "muted"}
        icon={<Icon icon={i.LayerIcon} size={12} aria-hidden="true" />}
        label={groupedBy() ? FIELDS[groupedBy()!]!.label : "Group"}
        items={groupItems()}
      />
      <MenuChip
        title="Order by"
        icon={<Icon icon={i.Sorting01Icon} size={12} aria-hidden="true" />}
        label={ORDERS[display().order ?? "updated"]}
        items={orderItems()}
      />
      {/* The one main action here, as Notion's New: a thread in this list (its space or label). */}
      <button
        class={sx(base.bare, button.solid, s.queryNew)}
        onClick={() =>
          setDialog({
            kind: "newThread",
            subspaceId:
              mailbox().kind === "subspace" ? (mailbox() as { id: string }).id : undefined,
            labelId: mailbox().kind === "label" ? (mailbox() as { id: string }).id : undefined,
          })
        }
      >
        New
      </button>
    </div>
  );
}

// `alone`: nothing's open beside it, so it takes the room.
export function MessageList(props: { alone?: boolean }): JSX.Element {
  const icons = (): Map<string, IconSvgElement> => bucketIcons(myBuckets());
  // Opening a space's, label's, person's or view's page (from ⌘K, say) lists its threads here too.
  createEffect(view, (shown) => {
    const next: Mailbox | undefined =
      "subspace" in shown
        ? { kind: "subspace", id: shown.subspace }
        : "bucket" in shown
          ? { kind: "bucket", id: shown.bucket }
          : "label" in shown
            ? { kind: "label", id: shown.label }
            : "person" in shown
              ? { kind: "person", id: shown.person }
              : "draft" in shown
                ? { kind: "drafts" }
                : "personal" in shown
                  ? { kind: "personal" }
                  : "view" in shown
                    ? shown.view === null
                      ? { kind: "all" }
                      : { kind: "view", id: shown.view }
                    : undefined;
    if (next) showMailbox(next);
  });
  // A space's threads, and those of any space a filter names, load even if you're not in it.
  createEffect(
    () => {
      const box = mailbox();
      return [...(box.kind === "subspace" ? [box.id] : []), ...subspacesIn(conditions())];
    },
    (ids) => ids.forEach((id) => store.subscribe(`subspace:${id}`)),
  );
  const filterable = (): boolean => mailbox().kind !== "drafts";
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
      class={sx(s.list, wide() && s.listTimeline, props.alone && s.listAlone)}
      style={{
        width: props.alone
          ? undefined
          : wide()
            ? `${timelineColumn.width()}px`
            : `${listColumn.width()}px`,
      }}
      aria-label={mailboxTitle(mailbox())}
    >
      <div data-bar class={sx(topbar.bar, s.listBar, !sidebarOpen() && s.listBarAlone)}>
        <Show when={!sidebarOpen()}>
          <AppButtons />
        </Show>
        <span class={sx(s.listHeading)}>
          <span class={sx(base.ellipsis, s.listTitle)}>{mailboxTitle(mailbox())}</span>
          <span class={sx(s.listSubtitle)}>{subtitle()}</span>
        </span>
        <span class={sx(topbar.end)}>
          <Show when={filterable()}>
            <MenuChip
              look={topbar.button}
              title="Display"
              label={<Icon icon={layoutIcon()} {...ICON} />}
              items={displayMenu()}
            />
          </Show>
          <Show when={filterable()}>
            <MenuChip
              look={topbar.button}
              title="Filter"
              label={<Icon icon={i.FilterIcon} {...ICON} />}
              items={filterItems()}
            />
          </Show>
          <Show when={pageOf(mailbox())}>
            {(page) => (
              <button
                class={sx(topbar.button)}
                aria-label={pageLabel(mailbox())}
                title={pageLabel(mailbox())}
                onClick={() => open(page())}
              >
                <Icon
                  icon={mailbox().kind === "person" ? i.InformationCircleIcon : i.Settings02Icon}
                  {...ICON}
                />
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
      <Show
        when={
          filterable() &&
          (display().layout === "timeline" || conditions().length > 0 || display().hideResolved)
        }
      >
        <QueryBar />
      </Show>
      <Show when={display().layout === "timeline"}>
        <Timeline />
      </Show>
      <div
        ref={list}
        class={sx(s.listScroll, wide() && s.hidden)}
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
                  <Show when={mailbox().kind === "inbox" || display().group}>
                    <div class={sx(s.groupHeader)}>
                      <Show when={!display().group}>
                        <Icon
                          icon={
                            group.bucket
                              ? (icons().get(group.bucket.id) ?? i.InboxIcon)
                              : i.Clock01Icon
                          }
                          size={11}
                          aria-hidden="true"
                        />
                      </Show>
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
      <Show when={!wide()}>
        <listColumn.Edge label="Resize list" />
      </Show>
      <Show when={wide() && active()}>
        <timelineColumn.Edge label="Resize timeline" />
      </Show>
    </section>
  );
}

// With nothing open: say so, and where to look.
export function NothingOpen(): JSX.Element {
  return (
    <div class={sx(s.nothing)}>
      <span class={sx(s.nothingTitle)}>No thread selected</span>
      <span>{listed().order.length > 0 ? "Choose one from the list to read it here." : ""}</span>
    </div>
  );
}

// ── The reading pane's toolbar: what you can do with the open thread ──

export function ThreadActions(props: { thread: Thread }): JSX.Element {
  return (
    <button
      class={sx(topbar.button)}
      aria-label="More"
      title="More"
      onClick={(e) => menuFrom(e.currentTarget, threadMenu(props.thread))}
    >
      <Icon icon={i.MoreHorizontalIcon} {...ICON} />
    </button>
  );
}

// No thread open: as Mail says.

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
  // Under the top bar, 10pt in from the sides and 10pt above the rows (as the macOS app's: each size here is its
  // points ÷ 1.1, for the 110% scale).
  // Level with the list's first heading beside them (their middles on one line); the rows stay where they were.
  groups: { flexShrink: 0, padding: "12.38px 9.09px 6.07px" },
  nav: {
    flex: 1,
    minHeight: 0,
    padding: "2px 7.27px 12px",
    overflowY: "auto",
  },
  // The chosen row, on its own ground; nothing changes under the pointer (as macOS lists show it).
  selected: { backgroundColor: colors.bgTertiary },
  // A little space between rows, so neighbouring fills (a space and its open thread) don't run together.
  mailboxes: {
    display: "flex",
    flexDirection: "column",
    gap: 1.82,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  mailboxItem: { listStyle: "none" },
  // 30pt tall, rounded 8pt, 8pt in from its ends, its icon in an 18pt column 8pt before its 13pt name.
  mailbox: {
    display: "flex",
    gap: 7.27,
    alignItems: "center",
    height: 27.27,
    paddingLeft: 7.27,
    paddingRight: 7.27,
    borderRadius: 7.27,
    color: colors.textPrimary,
    fontSize: 11.82,
    cursor: "default",
    outline: "none",
  },
  // A bucket under Inbox: indented by a margin, not padding, so its ground starts just before its icon.
  indent: { marginLeft: 14 },
  collapse: {
    display: "grid",
    gridTemplateRows: "0fr",
    opacity: 0,
    transitionProperty: "grid-template-rows, opacity",
    transitionDuration: { default: "220ms", [motion.reduced]: "0s" },
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
  collapseOpen: { gridTemplateRows: "1fr", opacity: 1 },
  collapseInner: { minHeight: 0, overflow: "hidden" },
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
  // Apart from the one before it; the first in its group sits right under the segments.
  // 14pt above, its title at 12pt medium, 8pt in, 4pt over its rows.
  section: { marginTop: { default: 12.73, ":first-of-type": 0 } },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    height: 16.73,
    paddingLeft: 7.27,
    paddingRight: 7.27,
    marginBottom: 3.64,
  },
  sectionTitle: {
    display: "flex",
    flex: 1,
    gap: 4,
    alignItems: "center",
    color: colors.textTertiary,
    fontSize: 10.91,
    fontWeight: 500,
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
  // You 16pt in and 12pt up from the corner, at 20pt, 8pt before your 13pt name.
  footer: {
    display: "flex",
    flexShrink: 0,
    gap: 4,
    alignItems: "center",
    margin: "0 7.27px 4.55px",
  },
  profile: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    gap: 7.27,
    alignItems: "center",
    padding: "6.36px 7.27px",
    borderRadius: 7.27,
    color: colors.textSecondary,
    fontSize: 11.82,
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
  listBar: { paddingLeft: 16 },
  // A timeline alone (no thread open beside it) takes the room, with no edge to divide.
  listAlone: { flex: 1, borderRightWidth: 0 },
  // A timeline's column is on the window's own ground (as the timeline is, its stuck titles covering what scrolls), so
  // its header matches it.
  listTimeline: { backgroundColor: colors.chrome },
  hidden: { display: "none" },
  listBarAlone: { paddingLeft: sidebarSpace.afterLights },
  // The mailbox's name and, after it on the same line, how many are unread (or listed).
  listHeading: { display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 },
  listTitle: { color: colors.textPrimary, fontSize: fontSizes.name, fontWeight: 500 },
  listSubtitle: { flexShrink: 0, color: colors.textTertiary, fontSize: fontSizes.small },
  // The query bar: filters at the start, grouping and order at the end.
  query: {
    display: "flex",
    flexShrink: 0,
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
    minHeight: 40,
    padding: "6px 12px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
  },
  querySpacer: { flex: 1 },
  // As tall as the chips beside it.
  queryNew: { height: 22, marginLeft: 4, padding: "0 10px" },
  // Sized as the macOS app's list: each size here is its points ÷ 1.1, for the renderer's 110% scale. Cards 8pt in
  // from the column's sides and 2pt apart.
  listScroll: {
    position: "relative",
    isolation: "isolate",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    // 8pt clear of the top bar.
    padding: "7.27px 7.27px 10.91px",
    outline: "none",
  },
  // A bucket's name at 12pt medium, 12pt in, 10pt above and 2pt over its cards.
  groupHeader: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    padding: "9.09px 10.91px 1.82px",
    color: colors.textTertiary,
    fontSize: 10.91,
    fontWeight: 500,
  },
  groupCount: { fontWeight: 400 },
  // No hairlines between rows: compact cards, set apart by the space between them.
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 1.82,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  rowItem: { listStyle: "none" },
  // A card: 12pt in from its sides and 10pt from its top and bottom, rounded 10pt, its two parts 5pt apart.
  row: {
    display: "flex",
    alignItems: "flex-start",
    padding: "9.09px 10.91px",
    borderRadius: 9.09,
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
  rowBody: { display: "flex", flex: 1, flexDirection: "column", gap: 4.55, minWidth: 0 },
  // The first line, at 14pt: the title (after its priority's marks), then at least 8pt on, the unread dot and when.
  rowTop: { display: "flex", gap: 7.27, alignItems: "center", fontSize: 12.73 },
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
  subject: { fontWeight: 600, lineHeight: "17.27px" },
  subjectResolved: { color: colors.textTertiary },
  priority: { flexShrink: 0, color: "#ff9f0a", fontWeight: 700 },
  urgent: { color: colors.urgent },
  stateMark: { display: "flex", flexShrink: 0, color: colors.textTertiary },
  // The rest at 13pt: the preview's column, then its due date and label, 8pt apart, on its last line.
  second: {
    display: "flex",
    gap: 7.27,
    alignItems: "last baseline",
    fontSize: 11.82,
    lineHeight: "14.55px",
  },
  preview: {
    display: "-webkit-box",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: colors.textTertiary,
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  due: {
    display: "flex",
    flexShrink: 0,
    gap: 2.73,
    alignItems: "center",
    color: colors.textTertiary,
  },
  dueSoon: { color: colors.urgent },
  // A label: 6pt in, 1pt above and below, rounded 6pt.
  labelChip: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    padding: "0.91px 5.45px",
    borderRadius: 5.45,
    color: colors.textSecondary,
    lineHeight: "14.55px",
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
