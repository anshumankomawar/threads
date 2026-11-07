import * as i from "@hugeicons/core-free-icons";
import { Label, PRIORITIES, STATES, Subspace, Thread, User, View } from "models";
import { bucketIcons } from "./bucketIcons";
import type { IconSvgElement } from "./components/Icon";
import { LABELS } from "./components/ThreadView";
import { keysFor, type HotkeyId } from "./hotkeys";
import { baseFilter, chooseMailbox, conditions, mailbox, type Mailbox } from "./mail";
import {
  account,
  active,
  applyTheme,
  byName,
  edit,
  hotkeyAction,
  inbox,
  itemFor,
  me,
  myBuckets,
  open,
  otherSources,
  peek,
  placeIn,
  setDialog,
  setState,
  signOut,
  SOURCES,
  store,
  switchTo,
  theme,
  toggled,
} from "./session";

// Everything you can do or go to, in one list ⌘K reads: the open thread's actions, every mailbox, what you can make,
// the app's own settings, and the people and threads it finds. A command either runs (⌘K closes first) or opens a
// page of its own choices (Move to Bucket ▸ its buckets). Anything new in the app belongs here too (AGENTS.md).

export type Kind = "action" | "place" | "person" | "thread";
export type Command = {
  id: string;
  title: string;
  kind: Kind;
  // The heading it's listed under.
  section: string;
  icon?: IconSvgElement;
  // Someone's avatar in place of an icon.
  seed?: string;
  // Its hotkey, shown on the right.
  keys?: string;
  // Other words it's found by ("archive" finds Mark Done).
  keywords?: string;
  // What it does, after ⌘K closes; or `page`, its own list of choices.
  run?: () => void;
  page?: () => Page;
  // ⌘↵: a look without leaving where you are (Peek).
  peek?: () => void;
};
export type Page = { title: string; placeholder: string; commands: () => Command[] };

// A hotkey's command: what the key does, as the key does it, its keys on the right. Left out when it can't run now.
function hotkey(
  id: HotkeyId,
  title: string,
  section: string,
  icon: IconSvgElement,
  keywords?: string,
): Command[] {
  const run = hotkeyAction(id);
  return run
    ? [{ id, title, kind: "action", section, icon, keys: keysFor(id), keywords, run }]
    : [];
}

// ── The open thread ──

// A page of choices for the open thread, a check on the ones it has; each with its own icon, or the page's.
const choices = (
  thread: Thread,
  title: string,
  pageIcon: IconSvgElement,
  list: {
    id: string;
    title: string;
    icon?: IconSvgElement;
    seed?: string;
    on: boolean;
    run: () => void;
  }[],
): Page => ({
  title,
  placeholder: "Search",
  commands: () =>
    list.map((c) => ({
      id: `${title}:${c.id}`,
      title: c.title,
      kind: "action" as const,
      section: thread.title,
      icon: c.on ? i.Tick02Icon : (c.icon ?? pageIcon),
      seed: c.on ? undefined : c.seed,
      run: c.run,
    })),
});

const dueAt = (days: number): Date =>
  new Date(new Date(Date.now() + days * 86_400_000).setHours(17, 0, 0, 0));

function threadCommands(thread: Thread): Command[] {
  const section = "This thread";
  const item = itemFor(thread);
  const list = (field: "labelIds" | "subspaceIds" | "assigneeIds", id: string) => () =>
    edit(thread, { [field]: toggled(thread[field], id) } as Partial<Thread>);
  const icons = bucketIcons(myBuckets());
  return [
    ...hotkey(
      "done",
      item?.doneAt ? "Move Back to Inbox" : "Mark Done",
      section,
      i.InboxCheckIcon,
      "archive",
    ),
    ...hotkey(
      "resolve",
      thread.isOpen ? "Resolve for Everyone" : "Reopen",
      section,
      thread.isOpen ? i.CheckmarkCircle02Icon : i.ArrowTurnBackwardIcon,
      "close finish",
    ),
    ...hotkey("reply", "Reply", section, i.MailReply01Icon, "write message"),
    ...(item && thread.isOpen
      ? [
          {
            id: "bucket",
            title: "Move to Bucket",
            kind: "action" as const,
            section,
            icon: i.Folder01Icon,
            keywords: "sort file",
            page: () =>
              choices(thread, "Move to Bucket", i.Folder01Icon, [
                ...myBuckets().map((b) => ({
                  id: b.id,
                  title: b.name,
                  icon: icons.get(b.id) ?? i.InboxIcon,
                  on: item.bucket === b,
                  run: () => placeIn(item, b),
                })),
                {
                  id: "auto",
                  title: "Sort It for Me",
                  icon: i.SparklesIcon,
                  on: false,
                  run: () => placeIn(item),
                },
              ]),
          },
        ]
      : []),
    {
      id: "status",
      title: "Set Status",
      kind: "action",
      section,
      icon: i.CircleIcon,
      keywords: "state open blocked resolved",
      page: () =>
        choices(
          thread,
          "Set Status",
          i.CircleIcon,
          STATES.map((state) => ({
            id: state,
            title: LABELS[state],
            on: thread.state === state,
            run: () => setState(thread, state),
          })),
        ),
    },
    {
      id: "priority",
      title: "Set Priority",
      kind: "action",
      section,
      icon: i.Flag02Icon,
      keywords: "urgent high medium low",
      page: () =>
        choices(
          thread,
          "Set Priority",
          i.Flag02Icon,
          [...PRIORITIES].reverse().map((p) => ({
            id: p,
            title: LABELS[p],
            on: thread.priority === p,
            run: () => edit(thread, { priority: p }),
          })),
        ),
    },
    {
      id: "labels",
      title: "Labels",
      kind: "action",
      section,
      icon: i.Tag01Icon,
      keywords: "tag label add remove",
      page: () =>
        choices(
          thread,
          "Labels",
          i.Tag01Icon,
          byName(store.all(Label)).map((l) => ({
            id: l.id,
            title: l.name,
            icon: i.Tag01Icon,
            on: thread.labelIds.includes(l.id),
            run: list("labelIds", l.id),
          })),
        ),
    },
    {
      id: "assign",
      title: "Assign",
      kind: "action",
      section,
      icon: i.UserMultipleIcon,
      keywords: "assignee owner person who",
      page: () =>
        choices(
          thread,
          "Assign",
          i.UserIcon,
          byName(store.all(User)).map((u) => ({
            id: u.id,
            title: u.name,
            seed: u.id,
            on: thread.assigneeIds.includes(u.id),
            run: list("assigneeIds", u.id),
          })),
        ),
    },
    {
      id: "spaces",
      title: "Spaces",
      kind: "action",
      section,
      icon: i.Layers01Icon,
      keywords: "subspace move to space",
      page: () =>
        choices(
          thread,
          "Spaces",
          i.Layers01Icon,
          byName(store.all(Subspace)).map((sub) => ({
            id: sub.id,
            title: sub.name,
            icon: sub.visibility === "private" ? i.SquareLock02Icon : i.Layers01Icon,
            on: thread.subspaceIds.includes(sub.id),
            run: list("subspaceIds", sub.id),
          })),
        ),
    },
    {
      id: "due",
      title: "Set Due Date",
      kind: "action",
      section,
      icon: i.Calendar01Icon,
      keywords: "deadline when date",
      page: () =>
        choices(thread, "Set Due Date", i.Calendar01Icon, [
          { id: "today", title: "Today", on: false, run: () => edit(thread, { dueAt: dueAt(0) }) },
          {
            id: "tomorrow",
            title: "Tomorrow",
            on: false,
            run: () => edit(thread, { dueAt: dueAt(1) }),
          },
          {
            id: "week",
            title: "Next Week",
            on: false,
            run: () => edit(thread, { dueAt: dueAt(7) }),
          },
          {
            id: "none",
            title: "No Due Date",
            on: !thread.dueAt,
            run: () => edit(thread, { dueAt: undefined }),
          },
        ]),
    },
  ];
}

// ── Places ──

const place = (
  id: string,
  title: string,
  icon: IconSvgElement,
  box: Mailbox,
  keywords?: string,
): Command => ({
  id: `go:${id}`,
  title,
  kind: "place",
  section: "Go to",
  icon,
  keywords,
  run: () => chooseMailbox(box),
});

function places(): Command[] {
  const icons = bucketIcons(myBuckets());
  return [
    place("inbox", "Buckets", i.InboxIcon, { kind: "inbox" }, "inbox mail all"),
    ...inbox().sections.map((s) =>
      place(
        s.bucket.id,
        s.bucket.name,
        icons.get(s.bucket.id) ?? i.InboxIcon,
        {
          kind: "bucket",
          id: s.bucket.id,
        },
        "bucket",
      ),
    ),
    place("sent", "Sent", i.SentIcon, { kind: "sent" }),
    place("drafts", "Drafts", i.NoteEditIcon, { kind: "drafts" }),
    place("personal", "Personal", i.UserIcon, { kind: "personal" }, "mine"),
    place("all", "Workspace", i.DashboardSquare01Icon, { kind: "all" }, "everything all threads"),
    ...byName(store.all(View).filter((v) => v.shared || v.ownerId === me().id)).map((v) =>
      place(v.id, v.name, i.FilterIcon, { kind: "view", id: v.id }, "view"),
    ),
    ...byName(store.all(Subspace)).map((sub) =>
      place(
        sub.id,
        sub.name,
        sub.visibility === "private" ? i.SquareLock02Icon : i.Layers01Icon,
        { kind: "subspace", id: sub.id },
        "space subspace team",
      ),
    ),
    ...byName(store.all(Label)).map((l) =>
      place(l.id, l.name, i.Tag01Icon, { kind: "label", id: l.id }, "label tag"),
    ),
  ];
}

// ── Making things ──

function creating(): Command[] {
  const section = "Create";
  const narrowed = conditions();
  return [
    ...hotkey("newThread", "New Thread", section, i.PencilEdit02Icon, "start write"),
    ...hotkey(
      "compose",
      "Write a Thread as a Message",
      section,
      i.MessageAdd01Icon,
      "draft compose",
    ),
    {
      id: "new-space",
      title: "New Space",
      kind: "action",
      section,
      icon: i.Layers01Icon,
      keywords: "subspace team",
      run: () => setDialog({ kind: "newSubspace" }),
    },
    {
      id: "new-label",
      title: "New Label",
      kind: "action",
      section,
      icon: i.Tag01Icon,
      keywords: "tag",
      run: () => setDialog({ kind: "newLabel" }),
    },
    {
      id: "new-bucket",
      title: "New Bucket",
      kind: "action",
      section,
      icon: i.Folder01Icon,
      keywords: "inbox sort",
      run: () => setDialog({ kind: "bucket" }),
    },
    // The list's filter, kept as a view of its own.
    ...(narrowed.length > 0 && mailbox().kind !== "view"
      ? [
          {
            id: "save-view",
            title: "Save Filter as View",
            kind: "action" as const,
            section,
            icon: i.FilterIcon,
            keywords: "view saved query",
            run: () =>
              setDialog({
                kind: "newView",
                filter: { and: [...baseFilter(mailbox()), ...narrowed] },
              }),
          },
        ]
      : []),
  ];
}

// ── The app ──

function app(): Command[] {
  const section = "App";
  return [
    ...hotkey("settings", "Settings", section, i.Settings02Icon, "preferences hotkeys"),
    ...hotkey("sidebar", "Show or Hide the Sidebar", section, i.PanelLeftIcon, "toggle"),
    ...hotkey("mailGroup", "Show Inbox Tab", section, i.InboxIcon, "sidebar tab"),
    ...hotkey("spacesGroup", "Show Spaces Tab", section, i.Layers01Icon, "sidebar tab"),
    ...hotkey("viewsGroup", "Show Views Tab", section, i.ViewIcon, "sidebar tab"),
    ...hotkey("back", "Back", section, i.ArrowLeft01Icon, "history previous"),
    ...hotkey("forward", "Forward", section, i.ArrowRight01Icon, "history next"),
    {
      id: "profile",
      title: "Your Profile",
      kind: "action",
      section,
      icon: i.UserIcon,
      keywords: "me account",
      run: () => open({ person: me().id }),
    },
    {
      id: "theme",
      title: theme() === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      kind: "action",
      section,
      icon: theme() === "dark" ? i.Sun03Icon : i.Moon02Icon,
      keywords: "theme appearance dark light",
      run: () => applyTheme(theme() === "dark" ? "light" : "dark"),
    },
    ...hotkey("zoomIn", "Zoom In", section, i.ZoomInAreaIcon, "bigger larger text"),
    ...hotkey("zoomOut", "Zoom Out", section, i.ZoomOutAreaIcon, "smaller text"),
    ...hotkey("zoomReset", "Actual Size", section, i.SearchAreaIcon, "zoom reset"),
    ...hotkey("viewAs", "View As", section, i.UserSwitchIcon, "switch user impersonate"),
    ...otherSources.map((s): Command => ({
      id: `source:${s}`,
      title: `Use ${SOURCES[s]} Data`,
      kind: "action",
      section,
      icon: i.DatabaseIcon,
      keywords: "source server workspace",
      run: () => switchTo({ source: s }),
    })),
    ...(account
      ? [
          {
            id: "sign-out",
            title: `Sign Out (${account.email})`,
            kind: "action" as const,
            section,
            icon: i.Logout01Icon,
            keywords: "log out",
            run: () => void signOut(),
          },
        ]
      : []),
  ];
}

// ── People and threads ──

export const personCommand = (u: User): Command => ({
  id: `person:${u.id}`,
  title: u.name,
  kind: "person",
  section: "People",
  seed: u.id,
  keywords: u.email,
  run: () => open({ person: u.id }),
  peek: () => peek({ person: u.id }),
});

export const threadCommand = (t: Thread, section = "Threads"): Command => ({
  id: `thread:${t.id}`,
  title: t.title,
  kind: "thread",
  section,
  icon: t.isOpen ? i.Comment01Icon : i.CheckmarkCircle02Icon,
  run: () => open({ thread: t.id }),
  peek: () => peek({ thread: t.id }),
});

// Every command there is but threads (which are found by what they say, in Search.tsx), the open thread's first.
export function commands(): Command[] {
  const thread = active();
  return [
    ...(thread ? threadCommands(thread) : []),
    ...places(),
    ...creating(),
    ...app(),
    ...store.all(User).map(personCommand),
  ];
}

// What ⌘K offers before anything's typed: the open thread's actions, then where to go, what to make, and the app.
export function suggestions(): Command[] {
  const thread = active();
  return [
    ...(thread ? threadCommands(thread) : []),
    ...places().slice(0, 1 + inbox().sections.length + 4),
    ...creating(),
    ...app(),
  ];
}
