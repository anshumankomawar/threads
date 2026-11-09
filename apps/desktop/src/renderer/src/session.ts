// The session (data source, who you are, the store) and what's on screen. One store per window: switching source or
// person reloads with a new session.
import * as i from "@hugeicons/core-free-icons";
import { createSignal, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { createStore, httpTransport, indexedLocalDB, type Filter, type Model } from "sync";
import {
  Bucket,
  Subspace,
  InboxItem,
  Thread,
  User,
  Workspace,
  type ComposeDraft,
  type ComposeRequest,
  type WorkspaceMember,
} from "models";

import { account, save, saved, server, source, useSource, type Source } from "./startup";
import { icon } from "./components/Icon";
import { commandFor, keysFor, keysOf, type HotkeyId } from "./hotkeys";

export {
  account,
  applyTheme,
  save,
  saved,
  server,
  signOut,
  source,
  otherSources,
  SOURCES,
  theme,
  type Source,
} from "./startup";

const viewerKey = `viewer:${source}`;
// Signed in, you're that person; on Sample, whoever you view it as (⌘U), the admin until you pick.
const viewerId = account?.personId ?? saved<string | null>(viewerKey, null);
const token = account?.token ?? viewerId ?? "";

export const store = createStore({
  transport: httpTransport({ ...server, token }),
  localDB: indexedLocalDB(),
  workspace: `${source}:${viewerId ?? "admin"}`,
  token,
});

export function switchTo(next: { source?: Source; viewer?: string | null }): void {
  if (next.source !== undefined) return void useSource(next.source);
  save(viewerKey, next.viewer ?? null);
  location.reload();
}

// Whether the first load's in: until it is, a space or label not found may just not be here yet.
const [isLoaded, setLoaded] = createSignal(false);
export const loaded = isLoaded;
// The first load is as the admin, to find who's here; then you're the first person. Someone no longer here starts over.
void store.ready().then(() => {
  setLoaded(true);
  if (viewerId === null) {
    const first = store.all(User)[0];
    if (first) switchTo({ viewer: first.id });
  } else if (!account && !store.findById(User, viewerId)) switchTo({ viewer: null });
});

export const me = (): User => store.findById(User, viewerId ?? "")!;
// A store holds one workspace, so a person has at most one membership in it.
export const workspace = (): Workspace => store.all(Workspace)[0];
export const memberOf = (user: User): WorkspaceMember | undefined => [...user.memberships][0];

// ── Small things every view uses ──
export const firstName = (user: { name: string }): string => user.name.split(" ")[0];
export const byName = <T extends { name: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));
// "No labels", "Security", or "Security +1".
export const summary = (names: string[], none: string): string =>
  names.length === 0 ? none : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
export const shortDate = (date: Date): string =>
  date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
// An id list with `id` added, or taken out if it's there.
export const toggled = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
// A change to a record you can undo (⌘Z), as one step called `label`.
export function edit<T extends Model>(record: T, change: Partial<T>, label = "Edit"): void {
  undoable(label, () => {
    Object.assign(record, change);
    record.save();
  });
}
// Everything `fn` saves, creates or deletes, as one undo step (⌘Z) called `label`: the sync engine's undo queue, as
// Linear's. What it does by itself (marking a thread seen as you open it) isn't undone.
export const undoable = (label: string, fn: () => void): void => store.undo.group(label, fn);
// Who you can @mention: everyone else, and the subspaces with someone in them.
export const others = (): User[] => store.all(User).filter((u) => u.id !== me().id);
export const subspacesWithMembers = (): Subspace[] =>
  store.all(Subspace).filter((sub) => sub.members.length > 0);
export const memberIn = (sub: Subspace, userId: string) =>
  sub.members.filter((m) => m.userId === userId)[0];
export const membersHint = (sub: Subspace): string => `Space · ${sub.members.length}`;
export const myBuckets = (): Bucket[] =>
  store.where(Bucket, "userId", me().id).sort((a, b) => a.position - b.position);
export const signedIn = (): boolean =>
  viewerId !== null && store.findById(User, viewerId) !== undefined;

export const draftWith = async (
  request: ComposeRequest,
  signal: AbortSignal,
): Promise<ComposeDraft> => {
  const response = await fetch(`${server.url}/ai/compose`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Compose failed (${response.status})`);
  return response.json() as Promise<ComposeDraft>;
};

// ── What's on screen ──
// A thread, or a page of threads: a label's, a person's, a subspace's, a saved view's, or all of them (`view: null`).
export type View =
  | { thread: string | null }
  | { label: string }
  | { person: string }
  | { subspace: string }
  | { bucket: string }
  | { view: string | null }
  | { settings: null }
  | { personal: null }
  // A kept draft, open as a page like the thread it will be.
  | { draft: string };
// An item runs something, or opens its own `items` in the menu's place. One with `checked` is a toggle: it shows a check
// and leaves the menu open.
export type MenuItem =
  // `run` is told where the row's icon is, for a form that grows out of it (InlineForm); one with `form` asks for one,
  // which opens over the menu instead of closing it.
  | {
      label: string;
      icon?: JSX.Element;
      checked?: boolean;
      form?: boolean;
      // Its hotkey, shown on the right as a menu does (hotkeys.ts's keys, as rebound).
      keys?: string;
      run: (from: DOMRect) => void;
    }
  | { label: string; icon?: JSX.Element; items: MenuItem[]; field?: MenuField }
  | "separator";
// A field as a menu's first row, to type into rather than choose: Enter gives it, closing the menu when `submit` takes
// it.
export type MenuField = {
  placeholder: string;
  submit: (text: string) => boolean;
};
export type Dialog =
  // ⌘K, or (`command`) open at one command's own page, as the reply's / menu opens Branch Of.
  (
    | { kind: "search"; command?: string }
    | { kind: "viewAs" }
    | { kind: "newThread"; labelId?: string; subspaceId?: string; to?: User }
    | { kind: "newView"; filter: Filter }
    | { kind: "newSubspace" }
    | { kind: "addMember"; subspace: Subspace }
    | { kind: "newLabel"; thread?: Thread }
    | { kind: "compose"; draftId?: string }
    | { kind: "bucket"; bucket?: Bucket }
    | { kind: "blocked"; thread: Thread }
  ) & {
    // The palette it was opened from (⌘K), which going back from its first step returns to.
    back?: Dialog;
  };

export const [view, setView] = createSignal<View>({ thread: null });
export const [split, setSplit] = createSignal<string | null>(null);
// A link's thread or person, floating over the app (Peek) until you expand it, split it beside, or click away. It has
// its own history while it's open: a link inside it is a step forward, and closing it forgets them.
export type Peeked = { thread: string } | { person: string };
const [peekedNow, setPeeked] = createSignal<Peeked | null>(null);
const [peekHistory, setPeekHistory] = createSignal<{ back: Peeked[]; forward: Peeked[] }>({
  back: [],
  forward: [],
});
export const peeked = peekedNow;
export const canPeekBack = (): boolean => peekHistory().back.length > 0;
export const canPeekForward = (): boolean => peekHistory().forward.length > 0;
export function peek(next: Peeked | null): void {
  const now = untrack(peekedNow);
  if (JSON.stringify(next) === JSON.stringify(now)) return;
  setPeekHistory(
    next && now ? ({ back }) => ({ back: [...back, now], forward: [] }) : { back: [], forward: [] },
  );
  setPeeked(next);
}
export function peekBack(): void {
  const { back, forward } = untrack(peekHistory);
  const now = untrack(peekedNow);
  if (back.length === 0 || !now) return;
  setPeekHistory({ back: back.slice(0, -1), forward: [now, ...forward] });
  setPeeked(back.at(-1)!);
}
export function peekForward(): void {
  const { back, forward } = untrack(peekHistory);
  const now = untrack(peekedNow);
  if (forward.length === 0 || !now) return;
  setPeekHistory({ back: [...back, now], forward: forward.slice(1) });
  setPeeked(forward[0]);
}
const [dialogNow, setDialogNow] = createSignal<Dialog | null>(null);
export const dialog = dialogNow;
// A palette opened while running something from another (⌘K's New Bucket) remembers it, to go back to; one palette
// replacing another is one continuous window (Palettes keeps the one <dialog>).
let returnTo: Dialog | null = null;
export function setDialog(next: Dialog | null): void {
  const back = returnTo;
  returnTo = null;
  setDialogNow(next && back && next.kind !== back.kind ? { ...next, back } : next);
}
// Runs `run` from the palette `from`: a palette it opens can go back to `from`; if it opens none, the palette closes.
export function runFrom(from: Dialog, run: () => void): void {
  returnTo = from;
  run();
  if (returnTo === from) {
    returnTo = null;
    setDialogNow(null);
  }
}
// Back a palette: to the one it was opened from, else closed.
export function dialogBack(): void {
  setDialogNow(untrack(dialogNow)?.back ?? null);
}
// The open context menu: at the pointer, or (`end`) hanging left from a button's corner, as a menu from the right end
// of a toolbar does.
export const [menu, setMenu] = createSignal<{
  x: number;
  y: number;
  items: MenuItem[];
  end?: boolean;
} | null>(null);
// A button's menu, under it, its right edge on the button's.
export function menuFrom(button: Element, items: MenuItem[]): void {
  const at = button.getBoundingClientRect();
  setMenu({ x: at.right, y: at.bottom + 4, items, end: true });
}
export const [sidebarOpen, setSidebarOpen] = createSignal(true);
// A toast at the bottom: what just happened, and undoing it if it can be.
// What was just done, and what its button does (Undo, or Redo after an undo).
export const [undo, setUndo] = createSignal<{
  text: string;
  run?: () => void;
  action?: string;
} | null>(null);

const [zoom, setZoom] = createSignal<number>(saved("zoom", 1));
function applyZoom(next: number): void {
  const value = Math.round(Math.min(2, Math.max(0.7, next)) * 10) / 10;
  setZoom(value);
  save("zoom", value);
  document.documentElement.style.setProperty("--content-zoom", String(value));
}

export const showMenu = (event: MouseEvent, items: MenuItem[]): void => {
  event.preventDefault();
  const open = (): void => void setMenu({ x: event.clientX, y: event.clientY, items });
  // On macOS a right click asks for the menu as its button goes down. Opened then, the button coming up would
  // light-dismiss it (it wasn't open when the button went down), so with a button held it opens once that's up.
  if (event.buttons === 0) return open();
  window.addEventListener("pointerup", () => setTimeout(open), { once: true, capture: true });
};

let undoTimer: ReturnType<typeof setTimeout> | undefined;
function offerUndo(text: string, run?: () => void, action = "Undo"): void {
  clearTimeout(undoTimer);
  setUndo({ text, run, action });
  undoTimer = setTimeout(() => setUndo(null), 5000);
}

// ⌘Z and ⇧⌘Z (and Edit → Undo, Redo): the latest step undone or redone, said in the toast.
export function undoLast(): void {
  const label = store.undo.undo();
  offerUndo(label ? `Undid ${label}` : "Nothing to undo", label ? redoLast : undefined, "Redo");
}
export function redoLast(): void {
  const label = store.undo.redo();
  offerUndo(label ? `Redid ${label}` : "Nothing to redo", label ? undoLast : undefined);
}

// ── The inbox ──
export const itemFor = (thread: Thread): InboxItem | undefined =>
  thread.inboxItems.filter((item) => item.userId === me().id)[0];
const hasNew = (item: InboxItem): boolean =>
  item.thread.messages.filter(
    (m) => m.authorId !== me().id && m.createdAt.getTime() > (item.seenAt?.getTime() ?? 0),
  ).length > 0;
// The thread you're reading is never unread; leaving it marks it seen.
export const unread = (item: InboxItem): boolean => item.thread !== active() && hasNew(item);

// A message counts as activity on its thread, though it doesn't change the Thread's row.
export const lastActive = (thread: Thread): number =>
  Math.max(
    thread.updatedAt.getTime(),
    thread.messages.sorted("createdAt").at(-1)?.createdAt.getTime() ?? 0,
  );

const RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const byUrgency = (a: InboxItem, b: InboxItem): number => {
  const [x, y] = [a.thread, b.thread];
  return (
    Number(x.state === "blocked") - Number(y.state === "blocked") ||
    RANK[x.priority] - RANK[y.priority] ||
    (x.dueAt?.getTime() ?? Infinity) - (y.dueAt?.getTime() ?? Infinity) ||
    lastActive(y) - lastActive(x)
  );
};

// Your inbox in your buckets, most urgent first; what the model hasn't sorted yet waits apart.
export const inbox = store.view(() => {
  const items = store
    .where(InboxItem, "userId", me().id)
    .filter((i) => i.thread?.isOpen && !i.doneAt)
    .sort(byUrgency);
  const buckets = myBuckets();
  const sections = buckets.map((bucket) => ({
    bucket,
    items: items.filter((i) => i.bucketId === bucket.id),
  }));
  const unsorted = items.filter((i) => !buckets.some((b) => b.id === i.bucketId));
  return {
    sections,
    unsorted,
    order: [...unsorted, ...sections.flatMap((s) => s.items)].map((i) => i.thread),
  };
});

// Open threads you own that someone else is on, unless they're back in your inbox.
export const sent = store.view(() =>
  store
    .where(Thread, "ownerId", me().id)
    .filter(
      (c) => c.isOpen && !inbox().order.includes(c) && c.assigneeIds.some((id) => id !== me().id),
    )
    .sort((a, b) => lastActive(b) - lastActive(a)),
);

// ── Navigation and the actions it takes ──
const activeId = (): string | null => {
  const shown = view();
  return "thread" in shown ? shown.thread : null;
};
export const active = (): Thread | undefined => store.findById(Thread, activeId() ?? "");
// The id the view shows of one kind of page, if it's that kind.
export const shown = (
  key: "label" | "person" | "subspace" | "bucket" | "view" | "draft",
): string | undefined => (view() as Record<string, string | null | undefined>)[key] ?? undefined;
export const allThreads = (): boolean => "view" in view() && shown("view") === undefined;

function markSeen(thread: Thread | undefined): void {
  const item = thread && itemFor(thread);
  if (!item || !hasNew(item)) return;
  item.seenAt = new Date();
  item.save();
}

// Opening a thread, or leaving one, marks it seen.
function show(next: View): void {
  markSeen(active());
  shownView = next;
  setView(next);
  if (!("thread" in next) || next.thread === null) return;
  if (next.thread === split()) setSplit(null);
  markSeen(store.findById(Thread, next.thread));
}

// Where you've been and where you came back from, as in a browser: going somewhere new clears the way forward.
const [history, setHistory] = createSignal<{ back: Place[]; forward: Place[] }>({
  back: [],
  forward: [],
});
export const canGoBack = (): boolean => history().back.length > 0;
export const canGoForward = (): boolean => history().forward.length > 0;

// A place in history: the reading pane's view and the mailbox listed beside it (mail.ts registers that), both as last
// set, since a signal reads its old value until the batch it's written in is done.
type Place = { view: View; box: unknown };
let shownView: View | undefined;
let mailboxes = { now: (): unknown => null, set: (_box: unknown): void => {} };
export const trackMailbox = (now: () => unknown, set: (box: unknown) => void): void =>
  void (mailboxes = { now, set });
const here = (): Place => ({ view: shownView ?? untrack(view), box: mailboxes.now() });
const samePlace = (a: Place, b: Place): boolean => JSON.stringify(a) === JSON.stringify(b);
function arrive(place: Place): void {
  mailboxes.set(place.box);
  show(place.view);
}

// One step in history for whatever `go` changes (a mailbox and the thread that closes with it are one), and none if it
// changes nothing.
let stepping = false;
export function step(go: () => void): void {
  if (stepping) return go();
  const from = here();
  stepping = true;
  try {
    go();
  } finally {
    stepping = false;
  }
  if (samePlace(from, here())) return;
  setHistory(({ back }) => ({
    back: back.length > 0 && samePlace(back.at(-1)!, from) ? back : [...back, from],
    forward: [],
  }));
}

export function open(next: View): void {
  step(() => {
    if (JSON.stringify(next) !== JSON.stringify(here().view)) show(next);
  });
}

export function goBack(): void {
  const { back, forward } = history();
  if (back.length === 0) return;
  setHistory({ back: back.slice(0, -1), forward: [here(), ...forward] });
  arrive(back.at(-1)!);
}

export function goForward(): void {
  const { back, forward } = history();
  if (forward.length === 0) return;
  setHistory({ back: [...back, here()], forward: forward.slice(1) });
  arrive(forward[0]);
}

// The mouse's back and forward buttons: Peek's own, while it's open.
window.addEventListener("mouseup", (event) => {
  const peeking = untrack(peekedNow) !== null;
  if (event.button === 3) (peeking ? peekBack : goBack)();
  if (event.button === 4) (peeking ? peekForward : goForward)();
});

// The threads J and K step through, and where finishing one moves on to: the list that's showing (mail.ts says which),
// else the inbox's order.
let listOrder: () => Thread[] = () => inbox().order;
export const followOrder = (order: () => Thread[]): void => {
  listOrder = order;
};

// After you finish one, the next in the list opens; in the split view, the split closes.
function moveOn(thread: Thread): void {
  if (thread.id === split()) return void setSplit(null);
  const order = listOrder();
  const at = order.indexOf(thread);
  const next = [...order.slice(at + 1), ...order.slice(0, Math.max(0, at))].find(
    (c) => c !== thread,
  );
  open({ thread: next?.id ?? null });
}

// ⌘E, or the inbox row's done button. Done with the open thread, the next one opens.
// Back into your inbox, as ⌘E on something already done does.
function markUndone(item: InboxItem): void {
  undoable("Move to Inbox", () => {
    item.doneAt = undefined;
    item.save();
  });
  offerUndo("Moved to Inbox", undoLast);
}

function markDone(item: InboxItem): void {
  if (active() === item.thread) moveOn(item.thread);
  undoable("Mark Done", () => {
    item.doneAt = new Date();
    item.save();
  });
  offerUndo("Done", undoLast);
}

// Into one of your buckets by hand, or back to the model.
export const placeIn = (item: InboxItem, bucket?: Bucket): void =>
  undoable(bucket ? "Move to Bucket" : "Sort It for Me", () => {
    item.bucket = bucket;
    item.manual = bucket !== undefined;
    item.save();
  });

// Everything in your inbox marked read, as Mail's Mark All as Read does.
export function markAllRead(): void {
  const now = new Date();
  undoable("Mark All as Read", () => {
    for (const thread of inbox().order) {
      const item = itemFor(thread);
      if (!item || !hasNew(item)) continue;
      item.seenAt = now;
      item.save();
    }
  });
}
// Whatever you placed by hand in your inbox, back to the model to sort.
export function sortAllForMe(): void {
  undoable("Sort All for Me", () => {
    for (const thread of inbox().order) {
      const item = itemFor(thread);
      if (item?.manual) placeIn(item);
    }
  });
}

// What right-clicking a thread offers, wherever it's listed.
export function threadMenu(thread: Thread): MenuItem[] {
  const item = inbox().order.includes(thread) ? itemFor(thread) : undefined;
  const shown = active();
  // Opening it, unless it's the one open (its own toolbar's menu).
  const opening: MenuItem[] =
    shown === thread
      ? []
      : [
          {
            label: "Open",
            icon: icon(i.SquareArrowUpRightIcon, 13),
            run: () => open({ thread: thread.id }),
          },
          ...(shown
            ? [
                {
                  label: "Open Beside",
                  icon: icon(i.LayoutTwoColumnIcon, 13),
                  run: () => setSplit(thread.id),
                },
              ]
            : []),
          "separator",
        ];
  return [
    ...opening,
    ...(item
      ? [
          // Done is yours (it leaves your inbox); Resolve is everyone's (it closes the thread).
          {
            label: "Mark Done",
            icon: icon(i.InboxCheckIcon, 13),
            keys: keysFor("done"),
            run: () => markDone(item),
          },
          {
            label: "Move to Bucket",
            icon: icon(i.Folder01Icon, 13),
            items: [
              ...myBuckets().map((bucket) => ({
                label: bucket.name,
                icon: bucket === item.bucket ? icon(i.Tick02Icon, 13) : undefined,
                run: () => placeIn(item, bucket),
              })),
              ...(item.manual
                ? [
                    "separator" as const,
                    {
                      label: "Sort It for Me",
                      icon: icon(i.SparklesIcon, 13),
                      run: () => placeIn(item),
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    {
      label: thread.isOpen ? "Resolve for Everyone" : "Reopen",
      keys: keysFor("resolve"),
      icon: icon(thread.isOpen ? i.CheckmarkCircle02Icon : i.ArrowTurnBackwardIcon, 13),
      run: () => setState(thread, thread.isOpen ? "resolved" : "open"),
    },
  ];
}

export function setState(thread: Thread, state: Thread["state"]): void {
  const showing = thread === active() || thread.id === split();
  if (state === "resolved" && showing && inbox().order.includes(thread)) moveOn(thread);
  undoable(state === "resolved" ? "Resolve" : state === "open" ? "Reopen" : "Change State", () => {
    thread.state = state;
    thread.save();
  });
}

// ── Keys ──
// Which of the sidebar's first places ⌘1, ⌘2… go to (by position): Mail.tsx says how, as it owns them.
let goTo: (at: number) => void = () => {};
export const onGoTo = (go: typeof goTo): void => {
  goTo = go;
};
const goToPlace = (at: number) => (): void => {
  setSidebarOpen(true);
  goTo(at);
};

// What each hotkey does (hotkeys.ts has their keys, which Settings rebinds), given whether you're typing and whether a
// dialog or menu is open: plain keys only when you're not typing, and none of the reading ones over a dialog or menu.
function hotkeyActions(
  free: boolean,
  typing: boolean,
): Record<HotkeyId, (() => void) | false | undefined> {
  const order = listOrder();
  const current = active();
  const at = current ? order.indexOf(current) : -1;
  // Done is for what's in your inbox, whichever list it's open from; on something done it puts it back.
  const item = current && itemFor(current);
  const toggleDone = (): void =>
    !item || !item.thread.isOpen
      ? offerUndo(item ? "Resolved threads leave your inbox" : "Not in your inbox")
      : item.doneAt
        ? markUndone(item)
        : markDone(item);
  const reading = free && !typing;
  return {
    search: () => setDialog({ kind: "search" }),
    // Typing, the text's own undo has them (the Edit menu's, below).
    undo: !typing && undoLast,
    redo: !typing && redoLast,
    searchSlash: free && !typing && (() => setDialog({ kind: "search" })),
    settings: () => (setDialog(null), open({ settings: null })),
    hotkeys: free && (() => open({ settings: null })),
    back: free && goBack,
    forward: free && goForward,
    sidebar: () => setSidebarOpen(!sidebarOpen()),
    // Not in a dialog, where ⌘1… choose its own tabs.
    goInbox: free && goToPlace(0),
    goMine: free && goToPlace(1),
    goEverything: free && goToPlace(2),
    goDrafts: free && goToPlace(3),
    // In the space, label or person's list you're on (or whose page is open).
    newThread: () => {
      const shown = view();
      const box = mailboxes.now() as { kind: string; id?: string } | null;
      const of = (kind: string): string | undefined => (box?.kind === kind ? box.id : undefined);
      const person = "person" in shown ? shown.person : of("person");
      setDialog({
        kind: "newThread",
        labelId: "label" in shown ? shown.label : of("label"),
        subspaceId: "subspace" in shown ? shown.subspace : of("subspace"),
        to: person ? store.findById(User, person) : undefined,
      });
    },
    compose: () => setDialog({ kind: "compose" }),
    next: reading && (() => open({ thread: (order[at + 1] ?? order[at] ?? order[0])?.id ?? null })),
    previous: reading && at > 0 && (() => open({ thread: order[at - 1].id })),
    done: free && current && toggleDone,
    reply: reading && (() => document.querySelector<HTMLElement>(".reply")?.focus()),
    closeThread: reading && current && (() => open({ thread: null })),
    resolve: free && current && (() => setState(current, current.isOpen ? "resolved" : "open")),
    zoomIn: () => applyZoom(zoom() + 0.1),
    zoomOut: () => applyZoom(zoom() - 0.1),
    zoomReset: () => applyZoom(1),
    // Signed in, you're who you signed in as.
    viewAs: !account && (() => setDialog({ kind: "viewAs" })),
  };
}

// A hotkey's action as ⌘K runs it, once it's closed: undefined when it can't run now (Done with no thread open).
export const hotkeyAction = (id: HotkeyId): (() => void) | undefined =>
  hotkeyActions(true, false)[id] || undefined;

window.addEventListener("keydown", (event) => {
  // Already handled (an Escape that closed Peek or a menu).
  if (!signedIn() || event.defaultPrevented) return;
  const target = event.target as HTMLElement;
  // A form grown out of the sidebar or a menu keeps its keys (InlineForm).
  if (target.closest("[data-holds-keys]")) return;
  const typing = target.closest("input, textarea, [contenteditable='true']") !== null;
  // (Peek is a window beside the app, not over it: the app's keys still work while it's open.)
  const free = !document.querySelector("dialog[open], :popover-open:not([data-peek])");
  // Escape leaves the reply, unless it just closed one of the reply's menus.
  if (
    event.key === "Escape" &&
    typing &&
    free &&
    !event.defaultPrevented &&
    target.closest(".reply")
  ) {
    event.preventDefault();
    return target.blur();
  }
  const keys = keysOf(event);
  const id = keys && commandFor(keys);
  if (!id || (typing && !/[⌘⌃]/.test(keys))) return;
  const action = hotkeyActions(free, typing)[id];
  if (!action) return;
  event.preventDefault();
  action();
});

applyZoom(zoom());

// Edit → Undo and Redo, chosen from the menu or by their keys when the page didn't take them (as it doesn't while you
// type): in a field, its text's; anywhere else, what you changed.
window.electron?.ipcRenderer.on("edit", (_event, which: "undo" | "redo") => {
  const focused = document.activeElement;
  if (focused?.closest("input, textarea, [contenteditable='true']")) document.execCommand(which);
  else if (which === "undo") undoLast();
  else redoLast();
});
