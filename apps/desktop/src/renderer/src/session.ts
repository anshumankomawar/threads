// The session (data source, who you are, the store) and what's on screen. One store per window: switching source or
// person reloads with a new session.
import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { createStore, httpTransport, indexedLocalDB, type Filter } from "sync";
import {
  Bucket,
  InboxItem,
  Thread,
  User,
  Workspace,
  type ComposeDraft,
  type ComposeRequest,
  type WorkspaceMember,
} from "models";

import { account, save, saved, server, source, useSource, type Source } from "./startup";

export {
  account,
  applyTheme,
  save,
  saved,
  server,
  signOut,
  source,
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
  | { view: string | null };
export type MenuItem = { label: string; run: () => void; icon?: JSX.Element } | "separator";
export type Dialog =
  | { kind: "search" | "viewAs" }
  | { kind: "newThread"; labelId?: string; subspaceId?: string; to?: User }
  | { kind: "filter"; add: (condition: Filter) => void }
  | { kind: "newView"; filter: Filter }
  | { kind: "newSubspace" }
  | { kind: "newLabel"; thread?: Thread }
  | { kind: "compose"; draftId?: string }
  | { kind: "bucket"; bucket?: Bucket }
  | { kind: "blocked"; thread: Thread };

export const [view, setView] = createSignal<View>({ thread: null });
export const [split, setSplit] = createSignal<string | null>(null);
export const [dialog, setDialog] = createSignal<Dialog | null>(null);
export const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(
  null,
);
export const [sidebarOpen, setSidebarOpen] = createSignal(true);
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
    .filter(
      (i) => i.thread?.isOpen && !i.doneAt && !(i.snoozedUntil && i.snoozedUntil.getTime() > time),
    )
    .sort(byUrgency);
  const buckets = store.where(Bucket, "userId", me().id).sort((a, b) => a.position - b.position);
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

function markSeen(thread: Thread | undefined): void {
  const item = thread && itemFor(thread);
  if (!item || !hasNew(item)) return;
  item.seenAt = new Date();
  item.save();
}

// Opening a thread, or leaving one, marks it seen.
export function open(next: View): void {
  markSeen(active());
  setView(next);
  if (!("thread" in next) || next.thread === null) return;
  if (next.thread === split()) setSplit(null);
  markSeen(store.findById(Thread, next.thread));
}

// After you finish one, the next in your inbox opens; in the split view, the split closes.
function moveOn(thread: Thread): void {
  if (thread.id === split()) return void setSplit(null);
  const order = inbox().order;
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
export function snooze(item: InboxItem): void {
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
          ...store
            .where(Bucket, "userId", me().id)
            .sort((a, b) => a.position - b.position)
            .filter((bucket) => bucket !== item.bucket)
            .map((bucket) => ({
              label: `Move to ${bucket.name}`,
              run: () => placeIn(item, bucket),
            })),
          ...(item.manual ? [{ label: "Sort it for me", run: () => placeIn(item) }] : []),
        ]
      : []),
    "separator",
    {
      label: thread.isOpen ? "Resolve" : "Reopen",
      run: () => setState(thread, thread.isOpen ? "resolved" : "open"),
    },
  ];
}

export function setState(thread: Thread, state: Thread["state"]): void {
  const showing = thread === active() || thread.id === split();
  if (state === "resolved" && showing && inbox().order.includes(thread)) moveOn(thread);
  thread.state = state;
  thread.save();
}

// ── Keys ──
// ⌘K search, ⌘N new thread, ⌘⇧N compose, ⌘U view as, ⌘+ ⌘- ⌘0 zoom. Superhuman's, never with a dialog or menu
// open: ⌘E done (even while typing), and when not typing J/K next or previous, H snooze, R reply.
window.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || !signedIn()) return;
  const key = `${event.metaKey ? "⌘" : ""}${event.shiftKey ? "⇧" : ""}${event.key.toLowerCase()}`;
  const target = event.target as HTMLElement;
  const typing = target.closest("input, textarea, [contenteditable='true']") !== null;
  const free = !document.querySelector("dialog[open], :popover-open");
  const order = inbox().order;
  const current = active();
  const at = current ? order.indexOf(current) : -1;
  const item = current && at !== -1 ? itemFor(current) : undefined;
  const reading = free && !typing;
  const run: Record<string, (() => void) | false | undefined> = {
    "⌘k": () => setDialog({ kind: "search" }),
    "⌘n": () => {
      const shown = view();
      setDialog({
        kind: "newThread",
        labelId: "label" in shown ? shown.label : undefined,
        subspaceId: "subspace" in shown ? shown.subspace : undefined,
        to: "person" in shown ? store.findById(User, shown.person) : undefined,
      });
    },
    "⌘⇧n": () => setDialog({ kind: "compose" }),
    // Signed in, you're who you signed in as.
    "⌘u": !account && (() => setDialog({ kind: "viewAs" })),
    "⌘=": () => applyZoom(zoom() + 0.1),
    "⌘⇧+": () => applyZoom(zoom() + 0.1),
    "⌘-": () => applyZoom(zoom() - 0.1),
    "⌘0": () => applyZoom(1),
    "⌘e": free && item && (() => markDone(item)),
    j: reading && (() => open({ thread: (order[at + 1] ?? order[at] ?? order[0])?.id ?? null })),
    k: reading && at > 0 && (() => open({ thread: order[at - 1].id })),
    h: reading && item && (() => snooze(item)),
    r: reading && (() => document.querySelector<HTMLElement>(".reply")?.focus()),
    // Not when Escape just closed one of the reply's menus.
    escape:
      typing &&
      free &&
      !event.defaultPrevented &&
      target.closest(".reply") !== null &&
      (() => target.blur()),
  };
  const action = run[key];
  if (!action) return;
  event.preventDefault();
  action();
});

applyZoom(zoom());
