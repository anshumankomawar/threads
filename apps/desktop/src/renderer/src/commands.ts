import * as i from "@hugeicons/core-free-icons";
import { Label, PRIORITIES, STATES, Subspace, Thread, User, View } from "models";
import { bucketIcons } from "./bucketIcons";
import { branchesOf, isUnder } from "./links";
import type { IconSvgElement } from "./components/Icon";
import { LABELS } from "./components/ThreadView";
import { keysFor, type HotkeyId } from "./hotkeys";
import {
  baseFilter,
  chooseMailbox,
  conditions,
  display,
  groupedBy,
  mailbox,
  setDisplay,
  type Mailbox,
} from "./mail";
import { FIELDS } from "./filters";
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
  // Other words it's found by ("archive" finds Mark as done).
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

// A page of threads to pick one from: those `allowed`, never the thread itself.
const pickThread = (
  thread: Thread,
  title: string,
  allowed: (t: Thread) => boolean,
  pick: (t: Thread) => void,
): Page => ({
  title,
  placeholder: "Search threads",
  commands: () =>
    store
      .all(Thread)
      .filter((t) => t !== thread && allowed(t))
      .map((t) => ({ ...threadCommand(t, title), run: () => pick(t), peek: undefined })),
});

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
      item?.doneAt ? "Move back to the inbox" : "Mark as done",
      section,
      i.InboxCheckIcon,
      "archive",
    ),
    ...hotkey(
      "resolve",
      thread.isOpen ? "Resolve this thread" : "Reopen this thread",
      section,
      thread.isOpen ? i.CheckmarkCircle02Icon : i.ArrowTurnBackwardIcon,
      "close finish",
    ),
    ...hotkey("closeThread", "Close this thread", section, i.Cancel01Icon, "deselect leave"),
    ...hotkey("reply", "Reply to this thread", section, i.MailReply01Icon, "write message"),
    ...(item && thread.isOpen
      ? [
          {
            id: "bucket",
            title: "Move to bucket",
            kind: "action" as const,
            section,
            icon: i.Folder01Icon,
            keywords: "sort file",
            page: () =>
              choices(thread, "Move to bucket", i.Folder01Icon, [
                ...myBuckets().map((b) => ({
                  id: b.id,
                  title: b.name,
                  icon: icons.get(b.id) ?? i.InboxIcon,
                  on: item.bucket === b,
                  run: () => placeIn(item, b),
                })),
                {
                  id: "auto",
                  title: "Sort it for me",
                  icon: i.SparklesIcon,
                  on: false,
                  run: () => placeIn(item),
                },
              ]),
          },
        ]
      : []),
    // Its parts: open one, make another thread one of them, or put this one under another.
    ...(branchesOf(thread).length > 0
      ? [
          {
            id: "branches",
            title: "Show branches",
            kind: "action" as const,
            section,
            icon: i.GitBranchIcon,
            keywords: "parts children progress",
            page: (): Page => ({
              title: "Branches",
              placeholder: "Search",
              commands: () => branchesOf(thread).map((t) => threadCommand(t, thread.title)),
            }),
          },
        ]
      : []),
    ...(thread.isOpen
      ? [
          {
            id: "blocked",
            title: "Mark as blocked on another thread",
            kind: "action" as const,
            section,
            icon: i.UnavailableIcon,
            keywords: "wait depends needs",
            run: () => setDialog({ kind: "blocked", thread }),
          },
        ]
      : []),
    {
      id: "add-branch",
      title: "Add a branch",
      kind: "action",
      section,
      icon: i.GitBranchIcon,
      keywords: "part depends child sub",
      page: () =>
        // Not one already, nor one it's under (that would loop).
        pickThread(
          thread,
          "Add a branch",
          (t) => t.branchedFrom !== thread && !isUnder(thread, t),
          (t) => edit(t, { branchedFrom: thread }),
        ),
    },
    {
      id: "branch-of",
      title: "Make this a branch of another thread",
      kind: "action",
      section,
      icon: i.GitBranchIcon,
      keywords: "part of parent under move",
      page: () =>
        // Not where it is already, nor one of its own branches (that would loop).
        pickThread(
          thread,
          "Make this a branch of",
          (t) => t !== thread.branchedFrom && !isUnder(t, thread),
          (t) => edit(thread, { branchedFrom: t }),
        ),
    },
    {
      id: "status",
      title: "Change status",
      kind: "action",
      section,
      icon: i.CircleIcon,
      keywords: "state open blocked resolved",
      page: () =>
        choices(
          thread,
          "Change status",
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
      title: "Change priority",
      kind: "action",
      section,
      icon: i.Flag02Icon,
      keywords: "urgent high medium low",
      page: () =>
        choices(
          thread,
          "Change priority",
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
      title: "Add or remove labels",
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
      title: "Assign to someone",
      kind: "action",
      section,
      icon: i.UserMultipleIcon,
      keywords: "assignee owner person who",
      page: () =>
        choices(
          thread,
          "Assign to",
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
      title: "Add to a space",
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
      title: "Set a due date",
      kind: "action",
      section,
      icon: i.Calendar01Icon,
      keywords: "deadline when date",
      page: () =>
        choices(thread, "Due date", i.Calendar01Icon, [
          { id: "today", title: "Today", on: false, run: () => edit(thread, { dueAt: dueAt(0) }) },
          {
            id: "tomorrow",
            title: "Tomorrow",
            on: false,
            run: () => edit(thread, { dueAt: dueAt(1) }),
          },
          {
            id: "week",
            title: "Next week",
            on: false,
            run: () => edit(thread, { dueAt: dueAt(7) }),
          },
          {
            id: "none",
            title: "No due date",
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
  title: `Go to ${title}`,
  kind: "place",
  section: "Places",
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

// ── How the list is shown ──

function listing(): Command[] {
  const section = "This list";
  const grouped = groupedBy();
  return [
    display().board
      ? {
          id: "as-list",
          title: "Show as a list",
          kind: "action",
          section,
          icon: i.LeftToRightListBulletIcon,
          keywords: "rows layout display view",
          run: () => setDisplay({ board: false }),
        }
      : {
          id: "as-board",
          title: "Show as a board",
          kind: "action",
          section,
          icon: i.Layout3ColumnIcon,
          keywords: "columns kanban layout display view",
          run: () => setDisplay({ board: true }),
        },
    {
      id: "group-by",
      title: "Group by",
      kind: "action",
      section,
      icon: i.LayerIcon,
      keywords: "sections columns display",
      page: () => ({
        title: "Group by",
        placeholder: "Search",
        // Toggles, as in the list's menu: the one it's grouped by ungroups it.
        commands: () =>
          Object.entries(FIELDS).map(([field, { label }]): Command => ({
            id: `group:${field}`,
            title: label,
            kind: "action",
            section: "Group by",
            icon: grouped === field ? i.Tick02Icon : i.LayerIcon,
            run: () => setDisplay({ group: grouped === field ? undefined : field }),
          })),
      }),
    },
  ];
}

// ── Making things ──

function creating(): Command[] {
  const section = "New";
  const narrowed = conditions();
  return [
    ...hotkey("newThread", "Create a thread", section, i.PencilEdit02Icon, "new start write"),
    ...hotkey(
      "compose",
      "Create a thread from a message",
      section,
      i.MessageAdd01Icon,
      "new write draft compose",
    ),
    {
      id: "new-space",
      title: "Create a space",
      kind: "action",
      section,
      icon: i.Layers01Icon,
      keywords: "new subspace team",
      run: () => setDialog({ kind: "newSubspace" }),
    },
    {
      id: "new-label",
      title: "Create a label",
      kind: "action",
      section,
      icon: i.Tag01Icon,
      keywords: "new tag",
      run: () => setDialog({ kind: "newLabel" }),
    },
    {
      id: "new-bucket",
      title: "Create a bucket",
      kind: "action",
      section,
      icon: i.Folder01Icon,
      keywords: "new inbox sort",
      run: () => setDialog({ kind: "bucket" }),
    },
    // The list's filter, kept as a view of its own.
    ...(narrowed.length > 0 && mailbox().kind !== "view"
      ? [
          {
            id: "save-view",
            title: "Save this filter as a view",
            kind: "action" as const,
            section,
            icon: i.FilterIcon,
            keywords: "new save view saved query",
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
    ...hotkey("settings", "Open settings", section, i.Settings02Icon, "preferences hotkeys"),
    ...hotkey("sidebar", "Show or hide the sidebar", section, i.PanelLeftIcon, "toggle"),
    ...hotkey("mailGroup", "Show the Inbox tab", section, i.InboxIcon, "sidebar tab"),
    ...hotkey("spacesGroup", "Show the Spaces tab", section, i.Layers01Icon, "sidebar tab"),
    ...hotkey("viewsGroup", "Show the Views tab", section, i.ViewIcon, "sidebar tab"),
    ...hotkey("back", "Go back", section, i.ArrowLeft01Icon, "history previous"),
    ...hotkey("forward", "Go forward", section, i.ArrowRight01Icon, "history next"),
    {
      id: "profile",
      title: "Open your profile",
      kind: "action",
      section,
      icon: i.UserIcon,
      keywords: "me account",
      run: () => open({ person: me().id }),
    },
    {
      id: "theme",
      title: theme() === "dark" ? "Switch to light mode" : "Switch to dark mode",
      kind: "action",
      section,
      icon: theme() === "dark" ? i.Sun03Icon : i.Moon02Icon,
      keywords: "theme appearance dark light",
      run: () => applyTheme(theme() === "dark" ? "light" : "dark"),
    },
    ...hotkey("zoomIn", "Zoom in", section, i.ZoomInAreaIcon, "bigger larger text"),
    ...hotkey("zoomOut", "Zoom out", section, i.ZoomOutAreaIcon, "smaller text"),
    ...hotkey("zoomReset", "Reset zoom", section, i.SearchAreaIcon, "zoom reset"),
    ...hotkey(
      "viewAs",
      "View as someone else",
      section,
      i.UserSwitchIcon,
      "switch user impersonate",
    ),
    ...otherSources.map((s): Command => ({
      id: `source:${s}`,
      title: `Use ${SOURCES[s]} data`,
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
            title: `Sign out (${account.email})`,
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

const personCommand = (u: User): Command => ({
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
    ...listing(),
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
