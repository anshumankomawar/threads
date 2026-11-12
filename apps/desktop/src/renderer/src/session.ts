// The session (data source, who you are, the store) and what's on screen. One store per window: switching source or
// person reloads with a new session.
import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { createStore, httpTransport, indexedLocalDB, type Filter, type Model } from "sync";
import {
  Bucket,
  Draft,
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
import { commandFor, keysOf, type HotkeyId } from "./hotkeys";

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

// The first load is as the admin, to find who's here; then you're the first person. Someone no longer here starts over.
void store.ready().then(() => {
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
export function edit<T extends Model>(record: T, change: Partial<T>): void {
  Object.assign(record, change);
  record.save();
}
// Who you can @mention: everyone else, and the subspaces with someone in them.
export const others = (): User[] => store.all(User).filter((u) => u.id !== me().id);
export const subspacesWithMembers = (): Subspace[] =>
  store.all(Subspace).filter((sub) => sub.members.length > 0);
export const memberIn = (sub: Subspace, userId: string) =>
  sub.members.filter((m) => m.userId === userId)[0];
export const membersHint = (sub: Subspace): string =>
  `Group · ${sub.members.length} ${sub.members.length === 1 ? "person" : "people"}`;
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

// ⌘F by meaning, or Ask Arc, from the workspace's API (apps/api/src/search.ts), as you.
export const searchApi = async <T>(body: { query: string; ask?: boolean }): Promise<T> => {
  const response = await fetch(`${server.url}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace": server.workspace,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  return response.json() as Promise<T>;
};

// ── What's on screen ──
// A thread, or a page of threads: a label's, a person's, a subspace's, a saved view's, or all of them (`view: null`).
export type View =
  | { thread: string | null }
  | { label: string }
  | { person: string }
  | { subspace: string }
  | { view: string | null }
  | { settings: null }
  | { personal: null }
  | { draft: string };
// An item runs something, or opens its own `items` in the menu's place. One with `checked` is a toggle: it shows a check
// and leaves the menu open.
export type MenuItem =
  | { label: string; icon?: JSX.Element; checked?: boolean; run: () => void }
  | { label: string; icon?: JSX.Element; items: MenuItem[] }
  | "separator";
export type Dialog =
  | { kind: "search" | "find" | "viewAs" }
  | { kind: "newThread"; labelId?: string; subspaceId?: string; to?: User }
  | { kind: "newView"; filter: Filter }
  | { kind: "newSubspace" }
  | { kind: "addMember"; subspace: Subspace }
  | { kind: "newLabel"; thread?: Thread }
  | { kind: "compose" }
  | { kind: "bucket"; bucket?: Bucket }
  | { kind: "blocked"; thread: Thread };

export const [view, setView] = createSignal<View>({ thread: null });
export const [split, setSplit] = createSignal<string | null>(null);
export const [dialog, setDialog] = createSignal<Dialog | null>(null);
export const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(
  null,
);
export const [sidebarOpen, setSidebarOpen] = createSignal(true);
// The Settings tab to open on (⌘K's Groups opens it at Groups).
export const [settingsStart, setSettingsStart] = createSignal<string | undefined>(undefined);
export const [undo, setUndo] = createSignal<{ text: string; run: () => void } | null>(null);

const [zoom, setZoom] = createSignal<number>(saved("zoom", 1));
function applyZoom(next: number): void {
  const value = Math.round(Math.min(2, Math.max(0.7, next)) * 10) / 10;
  setZoom(value);
  save("zoom", value);
  document.documentElement.style.setProperty("--content-zoom", String(value));
}

export const showMenu = (event: MouseEvent, items: MenuItem[]): void => {
  event.preventDefault();
  setMenu({ x: event.clientX, y: event.clientY, items });
};

let undoTimer: ReturnType<typeof setTimeout> | undefined;
function offerUndo(text: string, run: () => void): void {
  clearTimeout(undoTimer);
  setUndo({ text, run });
  undoTimer = setTimeout(() => setUndo(null), 5000);
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
const lastActive = (thread: Thread): number =>
  Math.max(
    thread.updatedAt.getTime(),
    thread.messages.sorted("createdAt").at(-1)?.createdAt.getTime() ?? 0,
  );

// Snoozed threads come back on the minute.
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 60_000);

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
  const time = now();
  const items = store
    .where(InboxItem, "userId", me().id)
    .filter((i) => i.thread && !i.doneAt && !(i.snoozedUntil && i.snoozedUntil.getTime() > time))
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

// Every thread, the latest active first.
export const allThreads = store.view(() =>
  store.all(Thread).sort((a, b) => lastActive(b) - lastActive(a)),
);

// ── Mailboxes: what the sidebar chooses and the middle column lists ──
// The whole inbox, the threads still being sorted, one of your buckets, every thread, or your drafts.
export type Mailbox =
  | { kind: "inbox" }
  | { kind: "unsorted" }
  | { kind: "bucket"; id: string }
  | { kind: "all" }
  | { kind: "drafts" };
const [chosenMailbox, setChosenMailbox] = createSignal<Mailbox>(
  saved<Mailbox>("mailbox", { kind: "inbox" }),
);
export const mailbox = chosenMailbox;
export const sameMailbox = (a: Mailbox, b: Mailbox): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
export function chooseMailbox(box: Mailbox): void {
  setSidebarOpen(true);
  setChosenMailbox(box);
  save("mailbox", box);
}
export const mailboxTitle = (box: Mailbox): string =>
  box.kind === "inbox"
    ? "Buckets"
    : box.kind === "unsorted"
      ? "Sorting"
      : box.kind === "bucket"
        ? (store.findById(Bucket, box.id)?.name ?? "Buckets")
        : box.kind === "all"
          ? "All Threads"
          : "Drafts";

export const drafts = store.view(() =>
  store
    .where(Draft, "userId", me().id)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
);

// The chosen mailbox's threads, in groups: the inbox by bucket (what's still being sorted first), the rest in one.
type Group = { bucket?: Bucket; title?: string; threads: Thread[] };
export const listed = store.view((): { groups: Group[]; order: Thread[] } => {
  const box = mailbox();
  const { sections, unsorted } = inbox();
  const threads = (items: InboxItem[]): Thread[] => items.map((item) => item.thread);
  const groups: Group[] =
    box.kind === "inbox"
      ? [
          ...(unsorted.length > 0 ? [{ title: "Sorting", threads: threads(unsorted) }] : []),
          ...sections
            .filter((section) => section.items.length > 0)
            .map((section) => ({ bucket: section.bucket, threads: threads(section.items) })),
        ]
      : box.kind === "unsorted"
        ? [{ threads: threads(unsorted) }]
        : box.kind === "bucket"
          ? [{ threads: threads(sections.find((x) => x.bucket.id === box.id)?.items ?? []) }]
          : box.kind === "all"
            ? [{ threads: allThreads() }]
            : [];
  return { groups, order: groups.flatMap((group) => group.threads) };
});

// ── Navigation and the actions it takes ──
const activeId = (): string | null => {
  const shown = view();
  return "thread" in shown ? shown.thread : null;
};
export const active = (): Thread | undefined => store.findById(Thread, activeId() ?? "");
// The id the view shows of one kind of page, if it's that kind.
export const shown = (
  key: "label" | "person" | "subspace" | "view" | "draft",
): string | undefined => (view() as Record<string, string | null | undefined>)[key] ?? undefined;
export const workspaceShown = (): boolean => "view" in view() && shown("view") === undefined;

function markSeen(thread: Thread | undefined): void {
  const item = thread && itemFor(thread);
  if (!item || !hasNew(item)) return;
  item.seenAt = new Date();
  item.save();
}

// Opening a thread, or leaving one, marks it seen.
function show(next: View): void {
  markSeen(active());
  setView(next);
  if (!("thread" in next) || next.thread === null) return;
  if (next.thread === split()) setSplit(null);
  markSeen(store.findById(Thread, next.thread));
}

// Where you've been and where you came back from, as in a browser: going somewhere new clears the way forward.
const [history, setHistory] = createSignal<{ back: View[]; forward: View[] }>({
  back: [],
  forward: [],
});
export const canGoBack = (): boolean => history().back.length > 0;
export const canGoForward = (): boolean => history().forward.length > 0;

export function open(next: View): void {
  if (JSON.stringify(next) === JSON.stringify(view())) return;
  setHistory(({ back }) => ({ back: [...back, view()], forward: [] }));
  show(next);
}

export function goBack(): void {
  const { back, forward } = history();
  if (back.length === 0) return;
  setHistory({ back: back.slice(0, -1), forward: [view(), ...forward] });
  show(back.at(-1)!);
}

export function goForward(): void {
  const { back, forward } = history();
  if (forward.length === 0) return;
  setHistory({ back: [...back, view()], forward: forward.slice(1) });
  show(forward[0]);
}

// The mouse's back and forward buttons.
window.addEventListener("mouseup", (event) => {
  if (event.button === 3) goBack();
  if (event.button === 4) goForward();
});

// After you finish one, the next in your inbox opens; in the split view, the split closes.
function moveOn(thread: Thread): void {
  if (thread.id === split()) return void setSplit(null);
  const order = listed().order;
  const at = order.indexOf(thread);
  const next = [...order.slice(at + 1), ...order.slice(0, Math.max(0, at))].find(
    (c) => c !== thread,
  );
  open({ thread: next?.id ?? null });
}

// ⌘E, or the inbox row's done button. Done with the open thread, the next one opens.
export function markDone(item: InboxItem): void {
  if (active() === item.thread) moveOn(item.thread);
  item.doneAt = new Date();
  item.save();
  offerUndo("Done", () => {
    item.doneAt = undefined;
    item.save();
  });
}

// Out of your inbox until 9 tomorrow morning.
function snooze(item: InboxItem): void {
  moveOn(item.thread);
  item.snoozedUntil = new Date(new Date(Date.now() + 86_400_000).setHours(9, 0, 0, 0));
  item.save();
  offerUndo("Snoozed until tomorrow", () => {
    item.snoozedUntil = undefined;
    item.save();
  });
}

// Into one of your buckets by hand, or back to the model.
export const placeIn = (item: InboxItem, bucket?: Bucket): void => {
  item.bucket = bucket;
  item.manual = bucket !== undefined;
  item.save();
};

// What right-clicking a thread offers, wherever it's listed.
export function threadMenu(thread: Thread): MenuItem[] {
  const item = inbox().order.includes(thread) ? itemFor(thread) : undefined;
  const shown = active();
  return [
    { label: "Open", run: () => open({ thread: thread.id }) },
    ...(shown && shown !== thread
      ? [{ label: "Open beside", run: () => setSplit(thread.id) }]
      : []),
    ...(item
      ? [
          "separator" as const,
          { label: "Done", run: () => markDone(item) },
          { label: "Snooze until tomorrow", run: () => snooze(item) },
          "separator" as const,
          ...myBuckets()
            .filter((bucket) => bucket !== item.bucket)
            .map((bucket) => ({
              label: `Move to ${bucket.name}`,
              run: () => placeIn(item, bucket),
            })),
          ...(item.manual ? [{ label: "Sort it for me", run: () => placeIn(item) }] : []),
        ]
      : []),
  ];
}

export function setState(thread: Thread, state: Thread["state"]): void {
  const showing = thread === active() || thread.id === split();
  if (state === "resolved" && showing && inbox().order.includes(thread)) moveOn(thread);
  thread.state = state;
  thread.save();
}

// ── Keys ──
// What each hotkey does (hotkeys.ts has their keys, which Settings rebinds). Plain keys only when you're not typing, and
// none of the reading ones with a dialog or menu open.
window.addEventListener("keydown", (event) => {
  if (!signedIn()) return;
  const target = event.target as HTMLElement;
  const typing = target.closest("input, textarea, [contenteditable='true']") !== null;
  const free = !document.querySelector("dialog[open], :popover-open");
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
  const order = listed().order;
  const current = active();
  const at = current ? order.indexOf(current) : -1;
  const item = current && inbox().order.includes(current) ? itemFor(current) : undefined;
  const reading = free && !typing;
  const run: Record<HotkeyId, (() => void) | false | undefined> = {
    search: () => setDialog({ kind: "search" }),
    find: () => setDialog({ kind: "find" }),
    settings: () => (setDialog(null), open({ settings: null })),
    hotkeys: free && (() => open({ settings: null })),
    back: free && goBack,
    forward: free && goForward,
    sidebar: () => setSidebarOpen(!sidebarOpen()),
    // Not in a dialog, where ⌘1… choose its own tabs.
    inboxTab: free && (() => chooseMailbox({ kind: "inbox" })),
    threadsTab: free && (() => chooseMailbox({ kind: "all" })),
    draftsTab: free && (() => chooseMailbox({ kind: "drafts" })),
    newThread: () => {
      const shown = view();
      setDialog({
        kind: "newThread",
        labelId: "label" in shown ? shown.label : undefined,
        subspaceId: "subspace" in shown ? shown.subspace : undefined,
        to: "person" in shown ? store.findById(User, shown.person) : undefined,
      });
    },
    compose: () => setDialog({ kind: "compose" }),
    next: reading && (() => open({ thread: (order[at + 1] ?? order[at] ?? order[0])?.id ?? null })),
    previous: reading && at > 0 && (() => open({ thread: order[at - 1].id })),
    done: free && item && (() => markDone(item)),
    snooze: reading && item && (() => snooze(item)),
    reply: reading && (() => document.querySelector<HTMLElement>(".reply")?.focus()),
    zoomIn: () => applyZoom(zoom() + 0.1),
    zoomOut: () => applyZoom(zoom() - 0.1),
    zoomReset: () => applyZoom(1),
    // Signed in, you're who you signed in as.
    viewAs: !account && (() => setDialog({ kind: "viewAs" })),
  };
  const action = run[id];
  if (!action) return;
  event.preventDefault();
  action();
});

applyZoom(zoom());
