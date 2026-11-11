import * as i from "@hugeicons/core-free-icons";
import { Bucket, Label, PRIORITIES, STATES, Subspace, Thread, User, View } from "models";
import { bucketIcons } from "./bucketIcons";
import { branchesOf, isUnder } from "./links";
import type { IconSvgElement } from "./components/Icon";
import { LABELS } from "./components/ThreadView";
import { keysFor, type HotkeyId } from "./hotkeys";
import {
  chooseMailbox,
  display,
  groupedBy,
  mailbox,
  isPinned,
  setPinned,
  ORDERS,
  type Order,
  setDisplay,
  type Zoom,
  ZOOMS,
  type Mailbox,
} from "./mail";
import {
  askDeleteBucket,
  deleteView,
  groupFields,
  moveBucket,
  LAYOUTS,
  savable,
  saveView,
  toggleResolved,
} from "./components/Mail";
import { dueIn } from "./when";
import { chooseWorkspace, openWorkspace, server } from "./startup";
import {
  gettingStartedDone,
  gettingStartedShown,
  showGettingStarted,
} from "./components/GettingStarted";
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
  markAllRead,
  me,
  myBuckets,
  open,
  otherSources,
  peek,
  bucketChoices,
  setDialog,
  setState,
  signOut,
  sortAllForMe,
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

function threadCommands(thread: Thread): Command[] {
  const section = "This thread";
  const item = itemFor(thread);
  const list = (field: "labelIds" | "subspaceIds" | "assigneeIds", id: string) => () =>
    edit(
      thread,
      { [field]: toggled(thread[field], id) } as Partial<Thread>,
      { labelIds: "Change Labels", subspaceIds: "Change Spaces", assigneeIds: "Change Assignees" }[
        field
      ],
    );
  const icons = bucketIcons(myBuckets());
  return [
    // Done is your inbox's: only for what's in it.
    ...(item
      ? hotkey(
          "done",
          item.doneAt ? "Move Back to the Inbox" : "Mark Done",
          section,
          i.InboxCheckIcon,
          "archive",
        )
      : []),
    ...hotkey(
      "resolve",
      thread.isOpen ? "Resolve This Thread" : "Reopen This Thread",
      section,
      thread.isOpen ? i.CheckmarkCircle02Icon : i.ArrowTurnBackwardIcon,
      "close finish",
    ),
    ...hotkey("closeThread", "Close This Thread", section, i.Cancel01Icon, "deselect leave"),
    ...hotkey("reply", "Reply to This Thread", section, i.MailReply01Icon, "write message"),
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
              choices(
                thread,
                "Move to Bucket",
                i.Folder01Icon,
                bucketChoices(item).map(({ bucket, ...choice }) => ({
                  ...choice,
                  icon: bucket ? (icons.get(bucket.id) ?? i.InboxIcon) : i.SparklesIcon,
                })),
              ),
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
          "Add a Branch",
          (t) => t.branchedFrom !== thread && !isUnder(thread, t),
          (t) => edit(t, { branchedFrom: thread }, "Add a Branch"),
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
          (t) => edit(thread, { branchedFrom: t }, "Make a Branch"),
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
          "Change Status",
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
            run: () => edit(thread, { priority: p }, "Change Priority"),
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
    // One date, as the thread shows it: when it's due (a span is picked on the thread's calendar).
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
            run: () => edit(thread, { startAt: undefined, dueAt: dueIn(0) }, "When"),
          },
          {
            id: "tomorrow",
            title: "Tomorrow",
            on: false,
            run: () => edit(thread, { startAt: undefined, dueAt: dueIn(1) }, "When"),
          },
          {
            id: "week",
            title: "Next Week",
            on: false,
            run: () => edit(thread, { startAt: undefined, dueAt: dueIn(7) }, "When"),
          },
          {
            id: "none",
            title: "No Date",
            on: !thread.dueAt && !thread.startAt,
            run: () => edit(thread, { startAt: undefined, dueAt: undefined }, "When"),
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
  hotkey?: HotkeyId,
): Command => ({
  id: `go:${id}`,
  title: `Go to ${title}`,
  kind: "place",
  section: "Go to",
  icon,
  keys: hotkey && keysFor(hotkey),
  keywords,
  run: () => chooseMailbox(box),
});

function places(): Command[] {
  const icons = bucketIcons(myBuckets());
  return [
    place("inbox", "Inbox", i.InboxIcon, { kind: "inbox" }, "mail buckets all", "goInbox"),
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
    place("drafts", "Drafts", i.NoteEditIcon, { kind: "drafts" }, undefined, "goDrafts"),
    place("personal", "My Threads", i.UserIcon, { kind: "personal" }, "mine personal", "goMine"),
    place(
      "all",
      "All Spaces",
      i.Layers01Icon,
      { kind: "all" },
      "everything workspace all threads",
      "goEverything",
    ),
    ...byName(store.all(View).filter((v) => v.shared || v.ownerId === me().id)).map((v) =>
      place(v.id, v.name, i.FilterIcon, { kind: "view", id: v.id }, "view saved pinned"),
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
    ...hotkey("next", "Open the Next Thread", section, i.ArrowDown01Icon, "down below j"),
    ...hotkey("previous", "Open the Previous Thread", section, i.ArrowUp01Icon, "up above k"),
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
              title: `Zoom the Timeline to ${ZOOMS[zoom]}`,
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
                groupFields().map(([field, { label }]): Command => ({
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
      title: display().hideResolved ? "Show Resolved Threads" : "Hide Resolved Threads",
      kind: "action",
      section,
      icon: i.CheckmarkCircle02Icon,
      keywords: "completed done closed display",
      run: toggleResolved,
    },
  ];
}

// ── Making things ──

function creating(): Command[] {
  const section = "New";
  return [
    ...hotkey("newThread", "Create a Thread", section, i.PencilEdit02Icon, "new start write"),
    ...hotkey(
      "compose",
      "Create a Thread from a Message",
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
    ...(savable()
      ? [
          {
            id: "save-view",
            title: "Save as View",
            kind: "action" as const,
            section,
            icon: i.FilterAddIcon,
            keywords: "save view saved filter query pin",
            run: saveView,
          },
        ]
      : []),
    // The view shown: in the sidebar or out of it, or gone.
    ...(() => {
      const box = mailbox();
      const saved = box.kind === "view" ? store.findById(View, box.id) : undefined;
      if (!saved) return [];
      const pinned = isPinned(saved);
      return [
        {
          id: "pin",
          title: pinned ? "Unpin from Sidebar" : "Pin to Sidebar",
          kind: "action" as const,
          section,
          icon: pinned ? i.PinOffIcon : i.PinIcon,
          keywords: "pin unpin sidebar view",
          run: () => setPinned(saved, !pinned),
        },
        ...(saved.ownerId === me().id
          ? [
              {
                id: "delete-view",
                title: "Delete View",
                kind: "action" as const,
                section,
                icon: i.Delete02Icon,
                keywords: "remove view saved",
                run: () => deleteView(saved),
              },
            ]
          : []),
      ];
    })(),
  ];
}

// ── The list you're on: what its own menu (the sidebar's right-click) offers ──

// Where a form ⌘K asks for grows from, as a menu entry's would: under where ⌘K was.
const underSearch = (): DOMRect => new DOMRect(innerWidth / 2 - 160, innerHeight * 0.2, 320, 0);

function here(): Command[] {
  const section = "This list";
  const box = mailbox();
  const action = (
    id: string,
    title: string,
    icon: IconSvgElement,
    run: () => void,
    keywords?: string,
  ): Command => ({ id, title, kind: "action", section, icon, keywords, run });
  if (box.kind === "inbox")
    return [
      action("read-all", "Mark All as Read", i.MailOpen01Icon, markAllRead, "seen clear"),
      ...(inbox().order.some((t) => itemFor(t)?.manual)
        ? [action("sort-all", "Sort All for Me", i.SparklesIcon, sortAllForMe, "auto buckets")]
        : []),
    ];
  if (box.kind === "bucket") {
    const bucket = store.findById(Bucket, box.id);
    if (!bucket) return [];
    const at = myBuckets().indexOf(bucket);
    return [
      action("edit-bucket", "Edit Bucket", i.PencilEdit01Icon, () =>
        setDialog({ kind: "bucket", bucket }),
      ),
      ...(at > 0
        ? [action("bucket-up", "Move Bucket Up", i.ArrowUp01Icon, () => moveBucket(bucket, -1))]
        : []),
      ...(at < myBuckets().length - 1
        ? [
            action("bucket-down", "Move Bucket Down", i.ArrowDown01Icon, () =>
              moveBucket(bucket, 1),
            ),
          ]
        : []),
      // Sorting needs somewhere to put things.
      ...(myBuckets().length > 1
        ? [
            action("delete-bucket", "Delete Bucket", i.Delete02Icon, () =>
              askDeleteBucket(underSearch(), bucket),
            ),
          ]
        : []),
    ];
  }
  if (box.kind === "subspace") {
    const space = store.findById(Subspace, box.id);
    if (!space) return [];
    return [
      action("space-settings", "Open Space Settings", i.Settings02Icon, () =>
        open({ subspace: space.id }),
      ),
      action("add-member", "Add Member to This Space", i.UserAdd01Icon, () =>
        setDialog({ kind: "addMember", subspace: space }),
      ),
    ];
  }
  if (box.kind === "label")
    return [
      action("label-settings", "Open Label Settings", i.Settings02Icon, () =>
        open({ label: box.id }),
      ),
    ];
  if (box.kind === "view") {
    const saved = store.findById(View, box.id);
    if (!saved) return [];
    return [
      action("view-settings", "Open View Settings", i.Settings02Icon, () =>
        open({ view: saved.id }),
      ),
      ...(saved.ownerId === me().id
        ? [
            saved.shared
              ? action("share-view", "Share View with Only You", i.SquareLock02Icon, () =>
                  edit(saved, { shared: false }, "Share View"),
                )
              : action("share-view", "Share View with the Workspace", i.UserMultipleIcon, () =>
                  edit(saved, { shared: true }, "Share View"),
                ),
          ]
        : []),
    ];
  }
  return [];
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
    ...hotkey("settings", "Open Settings", section, i.Settings02Icon, "preferences"),
    ...hotkey("hotkeys", "Show Hotkeys", section, i.KeyboardIcon, "shortcuts keys keyboard"),
    ...hotkey("sidebar", "Show or Hide the Sidebar", section, i.PanelLeftIcon, "toggle"),
    ...hotkey("back", "Go Back", section, i.ArrowLeft01Icon, "history previous"),
    ...hotkey("forward", "Go Forward", section, i.ArrowRight01Icon, "history next"),
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
      title: theme() === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      kind: "action",
      section,
      icon: theme() === "dark" ? i.Sun03Icon : i.Moon02Icon,
      keywords: "theme appearance dark light",
      run: () => applyTheme(theme() === "dark" ? "light" : "dark"),
    },
    ...hotkey("zoomIn", "Zoom In", section, i.ZoomInAreaIcon, "bigger larger text"),
    ...hotkey("zoomOut", "Zoom Out", section, i.ZoomOutAreaIcon, "smaller text"),
    ...hotkey("zoomReset", "Reset Zoom", section, i.SearchAreaIcon, "zoom reset"),
    ...hotkey(
      "viewAs",
      "View as Someone Else",
      section,
      i.UserSwitchIcon,
      "switch user impersonate",
    ),
    ...otherSources.map((s): Command => ({
      id: `source:${s}`,
      title: `Use ${SOURCES[s]} Data`,
      kind: "action",
      section,
      icon: i.DatabaseIcon,
      keywords: "source server workspace",
      run: () => void switchTo({ source: s }),
    })),
    ...(account
      ? [
          {
            id: "sign-out",
            title: `Log Out (${account.email})`,
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

// Your workspaces: inviting people to this one, going to another, and making or joining one more. Only signed in.
function workspaces(): Command[] {
  if (!account) return [];
  const section = "Workspace";
  return [
    {
      id: "invite",
      title: "Invite People",
      kind: "action",
      section,
      icon: i.UserAdd01Icon,
      keywords: "invite add team member teammate email",
      run: () => setDialog({ kind: "invite" }),
    },
    ...account.workspaces
      .filter((w) => w.id !== server.workspace)
      .map((w): Command => ({
        id: `workspace:${w.id}`,
        title: `Switch to ${w.name}`,
        kind: "action",
        section,
        icon: i.ArrowDataTransferHorizontalIcon,
        keywords: "workspace change team",
        run: () => openWorkspace(w.id),
      })),
    {
      id: "choose-workspace",
      title: "Add Workspace",
      kind: "action",
      section,
      icon: i.Add01Icon,
      keywords: "new create join invited workspace team company",
      run: chooseWorkspace,
    },
    // Nothing to show once every step's done.
    ...(gettingStartedDone()
      ? []
      : [
          {
            id: "getting-started",
            title: gettingStartedShown() ? "Hide Getting Started" : "Show Getting Started",
            kind: "action" as const,
            section,
            icon: i.CheckListIcon,
            keywords: "checklist onboarding tips setup",
            run: () => showGettingStarted(!gettingStartedShown()),
          },
        ]),
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
    ...here(),
    ...listing(),
    ...creating(),
    ...workspaces(),
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
    ...workspaces(),
    ...app(),
  ];
}
