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
  ORDERS,
  type Order,
  setDisplay,
  type Zoom,
  ZOOMS,
  type Mailbox,
} from "./mail";
import { FIELDS } from "./filters";
import { LAYOUTS } from "./components/Mail";
import { showToday } from "./components/Timeline";
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
  undoable,
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
            title: "Move to Bucket",
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
                  title: "Sort It for Me",
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
            title: "Show Branches",
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
            title: "Mark as Blocked on Another Thread",
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
      title: "Add a Branch",
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
      title: "Make This a Branch of Another Thread",
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
      title: "Change Status",
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
      title: "Change Priority",
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
      title: "Add or Remove Labels",
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
      title: "Assign to Someone",
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
      title: "Add to a Space",
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
    // One date, as the thread shows it: when it's due (a span's start is typed on the thread itself).
    {
      id: "when",
      title: "Set When",
      kind: "action",
      section,
      icon: i.Calendar03Icon,
      keywords: "due date deadline start schedule timeline",
      page: () =>
        choices(thread, "When", i.Calendar03Icon, [
          {
            id: "today",
            title: "Today",
            on: false,
            run: () => edit(thread, { startAt: undefined, dueAt: dueAt(0) }),
          },
          {
            id: "tomorrow",
            title: "Tomorrow",
            on: false,
            run: () => edit(thread, { startAt: undefined, dueAt: dueAt(1) }),
          },
          {
            id: "week",
            title: "Next Week",
            on: false,
            run: () => edit(thread, { startAt: undefined, dueAt: dueAt(7) }),
          },
          {
            id: "none",
            title: "No Date",
            on: !thread.dueAt && !thread.startAt,
            run: () => edit(thread, { startAt: undefined, dueAt: undefined }),
          },
        ]),
    },
  ];
}

// ── Going somewhere ──

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
  section: "Go to",
  icon,
  keywords,
  run: () => chooseMailbox(box),
});

function places(): Command[] {
  const icons = bucketIcons(myBuckets());
  return [
    place("inbox", "Inbox", i.InboxIcon, { kind: "inbox" }, "mail buckets all"),
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
    place("personal", "My Threads", i.UserIcon, { kind: "personal" }, "mine personal"),
    place("all", "All Spaces", i.Layers01Icon, { kind: "all" }, "everything workspace all threads"),
    ...byName(store.all(View).filter((v) => v.shared || v.ownerId === me().id)).map((v) =>
      place(v.id, v.name, i.PinIcon, { kind: "view", id: v.id }, "pinned view"),
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
    // The other layouts.
    ...LAYOUTS.filter(({ layout }) => layout !== display().layout).map(
      ({ layout, title, icon, keywords }): Command => ({
        id: `as-${layout}`,
        title,
        kind: "action",
        section,
        icon,
        keywords: `${keywords} layout display view`,
        run: () => setDisplay({ layout }),
      }),
    ),
    ...(display().layout === "timeline"
      ? [
          {
            id: "timeline-today",
            title: "Go to Today on the Timeline",
            kind: "action",
            section,
            icon: i.Calendar03Icon,
            keywords: "now scroll",
            run: () => showToday(),
          } satisfies Command,
          ...(Object.keys(ZOOMS) as Zoom[])
            .filter((zoom) => zoom !== (display().zoom ?? "weeks"))
            .map((zoom): Command => ({
              id: `zoom:${zoom}`,
              title: `Zoom the timeline to ${ZOOMS[zoom].toLowerCase()}`,
              kind: "action",
              section,
              icon: i.ZoomInIcon,
              keywords: "scale timeline",
              run: () => setDisplay({ zoom }),
            })),
        ]
      : []),
    // The inbox is grouped by its buckets.
    ...(mailbox().kind === "inbox"
      ? []
      : [
          {
            id: "group-by",
            title: "Group By",
            kind: "action" as const,
            section,
            icon: i.LayerIcon,
            keywords: "sections columns display",
            page: () => ({
              title: "Group By",
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
        ]),
    {
      id: "order-by",
      title: "Order By",
      kind: "action",
      section,
      icon: i.Sorting01Icon,
      keywords: "sort order newest due priority created",
      page: () => ({
        title: "Order By",
        placeholder: "Search",
        commands: () =>
          (Object.keys(ORDERS) as Order[]).map((order): Command => ({
            id: `order:${order}`,
            title: ORDERS[order],
            kind: "action",
            section: "Order by",
            icon: (display().order ?? "updated") === order ? i.Tick02Icon : i.Sorting01Icon,
            run: () => setDisplay({ order: order === "updated" ? undefined : order }),
          })),
      }),
    },
    {
      id: "toggle-resolved",
      title: display().hideResolved ? "Show resolved threads" : "Hide resolved threads",
      kind: "action",
      section,
      icon: i.CheckmarkCircle02Icon,
      keywords: "completed done closed display",
      run: () => setDisplay({ hideResolved: !display().hideResolved || undefined }),
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
      title: "Create a Space",
      kind: "action",
      section,
      icon: i.Layers01Icon,
      keywords: "new subspace team",
      run: () => setDialog({ kind: "newSubspace" }),
    },
    {
      id: "new-label",
      title: "Create a Label",
      kind: "action",
      section,
      icon: i.Tag01Icon,
      keywords: "new tag",
      run: () => setDialog({ kind: "newLabel" }),
    },
    {
      id: "new-bucket",
      title: "Create a Bucket",
      kind: "action",
      section,
      icon: i.Folder01Icon,
      keywords: "new inbox sort",
      run: () => setDialog({ kind: "bucket" }),
    },
    // The list's filter, kept as a view of its own.
    ...((narrowed.length > 0 && mailbox().kind !== "view") ||
    mailbox().kind === "label" ||
    mailbox().kind === "person"
      ? [
          {
            id: "save-view",
            title: "Pin This List to the Sidebar",
            kind: "action" as const,
            section,
            icon: i.PinIcon,
            keywords: "pin save view saved filter query",
            run: () =>
              setDialog({
                kind: "newView",
                filter: { and: [...baseFilter(mailbox()), ...narrowed] },
              }),
          },
        ]
      : []),
    // A pinned list of yours, taken out of the sidebar.
    ...(() => {
      const box = mailbox();
      const saved = box.kind === "view" ? store.findById(View, box.id) : undefined;
      if (saved?.ownerId !== me().id) return [];
      return [
        {
          id: "unpin",
          title: "Unpin This List from the Sidebar",
          kind: "action" as const,
          section,
          icon: i.PinOffIcon,
          keywords: "unpin remove delete view saved",
          run: () => {
            chooseMailbox({ kind: "all" });
            undoable("Unpin", () => void saved.delete());
          },
        },
      ];
    })(),
  ];
}

// ── The app ──

function app(): Command[] {
  const section = "App";
  return [
    // Undo and redo, named for what they'd undo or redo; there only when there's something to.
    ...(store.undo.nextUndo()
      ? hotkey(
          "undo",
          `Undo ${store.undo.nextUndo()}`,
          section,
          i.ArrowTurnBackwardIcon,
          "revert back",
        )
      : []),
    ...(store.undo.nextRedo()
      ? hotkey("redo", `Redo ${store.undo.nextRedo()}`, section, i.ArrowTurnForwardIcon, "again")
      : []),
    ...hotkey("settings", "Open settings", section, i.Settings02Icon, "preferences hotkeys"),
    ...hotkey("sidebar", "Show or hide the sidebar", section, i.PanelLeftIcon, "toggle"),
    ...hotkey("back", "Go back", section, i.ArrowLeft01Icon, "history previous"),
    ...hotkey("forward", "Go forward", section, i.ArrowRight01Icon, "history next"),
    {
      id: "profile",
      title: "Open Your Profile",
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
