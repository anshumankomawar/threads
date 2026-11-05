// The session (data source, who you are, the store) and what's on screen. One store per window: switching source or
// person reloads with a new session.
import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { createStore, httpTransport, indexedLocalDB } from "sync";
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
import * as stylex from "@stylexjs/stylex";
import { lightTheme } from "./styles/tokens.stylex";

export type Source = "cloudflare" | "local" | "sample";
const HOSTED = { url: import.meta.env.VITE_API_URL, token: import.meta.env.VITE_API_TOKEN };
export const SOURCES: Partial<Record<Source, string>> = {
  ...(HOSTED.url && HOSTED.token ? { cloudflare: "Cloudflare" } : {}),
  local: "Local",
  sample: "Sample",
};

function saved<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const source: Source = saved<Source>(
  "source",
  "cloudflare" in SOURCES ? "cloudflare" : "local",
);
const viewerKey = `viewer:${source}`;
// Signed in (through the browser, src/main/signIn.ts), you're that person. The sign-in page talks to the local API for
// now, so signing in is the Local source's; elsewhere, and while you're not signed in, View As (⌘U) picks who you are.
export const account = source === "local" ? ((await window.threads?.signedIn()) ?? null) : null;
const viewerId = account?.personId ?? saved<string | null>(viewerKey, null);
export const server =
  source === "cloudflare"
    ? { url: HOSTED.url!, workspace: "local" }
    : { url: "http://127.0.0.1:3030", workspace: source };

// Locally the token is who you are (none: the admin). Hosted, the API token is the admin, which mints a person's.
async function tokenFor(userId: string | null): Promise<string> {
  if (source !== "cloudflare") return userId ?? "";
  if (userId === null) return HOSTED.token!;
  const response = await fetch(`${server.url}/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${HOSTED.token}` },
    body: JSON.stringify({ workspace: server.workspace, personId: userId }),
  });
  return ((await response.json()) as { token: string }).token;
}
const token = account?.token ?? (await tokenFor(viewerId));

// Signing in or out reloads, like switching person.
window.onAuthenticated?.(() => location.reload());
export async function signOut(): Promise<void> {
  await window.signOut();
  location.reload();
}

export const store = createStore({
  transport: httpTransport({ ...server, token }),
  localDB: indexedLocalDB(),
  workspace: `${source}:${viewerId ?? "admin"}`,
  token,
});

export function switchTo(next: { source?: Source; viewer?: string | null }): void {
  if (next.source !== undefined) save("source", next.source);
  if (next.viewer !== undefined)
    save(next.source ? `viewer:${next.source}` : viewerKey, next.viewer);
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
// "l5 · pm": someone's level and title here.
export const position = (user: User): string | undefined => {
  const member = memberOf(user);
  return [member?.level, member?.title].filter(Boolean).join(" · ") || undefined;
};
export const signedIn = (): boolean =>
  viewerId !== null && store.findById(User, viewerId) !== undefined;

export const draftWith = async (
  request: ComposeRequest,
  signal: AbortSignal,
): Promise<ComposeDraft> =>
  (
    await fetch(`${server.url}/ai/compose`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(request),
    })
  ).json() as Promise<ComposeDraft>;

// ── What's on screen ──
export type View = { thread: string | null } | { label: string } | { person: string };
export type MenuItem = { label: string; run: () => void; icon?: JSX.Element } | "separator";
export type Dialog =
  | { kind: "search" | "viewAs" | "signIn" }
  | { kind: "newThread"; labelId?: string; to?: User }
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

type Theme = "dark" | "light";
export const [theme, setThemeSignal] = createSignal<Theme>(saved("theme", "dark"));
const LIGHT = (stylex.attrs(lightTheme).class ?? "").split(" ").filter(Boolean);
export function applyTheme(next: Theme): void {
  setThemeSignal(next);
  save("theme", next);
  document.documentElement.dataset.theme = next;
  for (const name of LIGHT) document.documentElement.classList.toggle(name, next === "light");
  window.electron?.ipcRenderer.send("set-theme", next);
}

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
export const unread = (item: InboxItem): boolean =>
  item.thread.messages.filter(
    (m) => m.authorId !== me().id && m.createdAt.getTime() > (item.seenAt?.getTime() ?? 0),
  ).length > 0;

const RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const byUrgency = (a: InboxItem, b: InboxItem): number => {
  const [x, y] = [a.thread, b.thread];
  return (
    Number(x.state === "blocked") - Number(y.state === "blocked") ||
    RANK[x.priority] - RANK[y.priority] ||
    (x.dueAt?.getTime() ?? Infinity) - (y.dueAt?.getTime() ?? Infinity) ||
    y.updatedAt.getTime() - x.updatedAt.getTime()
  );
};

// Your inbox in your buckets, most urgent first; what the model hasn't sorted yet waits apart.
export const inbox = store.view(() => {
  const now = Date.now();
  const items = store
    .where(InboxItem, "userId", me().id)
    .filter(
      (i) => i.thread?.isOpen && !i.doneAt && !(i.snoozedUntil && i.snoozedUntil.getTime() > now),
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

// Open threads you own that you've sent to someone.
export const sent = store.view(() =>
  store
    .where(Thread, "ownerId", me().id)
    .filter(
      (c) => c.isOpen && c.messages.filter((m) => m.toIds.some((id) => id !== me().id)).length > 0,
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
);

// ── Navigation and the actions it takes ──
const activeId = (): string | null => {
  const shown = view();
  return "thread" in shown ? shown.thread : null;
};
export const active = (): Thread | undefined => store.findById(Thread, activeId() ?? "");

// Opening a thread marks it seen.
export function open(next: View): void {
  setView(next);
  if (!("thread" in next) || next.thread === null) return;
  if (next.thread === split()) setSplit(null);
  const thread = store.findById(Thread, next.thread);
  const item = thread && itemFor(thread);
  if (item) {
    item.seenAt = new Date();
    item.save();
  }
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

function markDone(item: InboxItem): void {
  moveOn(item.thread);
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

export function setState(thread: Thread, state: Thread["state"]): void {
  if (state === "resolved" && itemFor(thread)) moveOn(thread);
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
    "⌘n": () => setDialog({ kind: "newThread" }),
    "⌘⇧n": () => setDialog({ kind: "compose" }),
    // Signed in, you're who you signed in as.
    "⌘u": !account && (() => setDialog({ kind: "viewAs" })),
    "⌘=": () => applyZoom(zoom() + 0.1),
    "⌘-": () => applyZoom(zoom() - 0.1),
    "⌘0": () => applyZoom(1),
    "⌘e": free && item && (() => markDone(item)),
    j: reading && (() => open({ thread: (order[at + 1] ?? order[at] ?? order[0])?.id ?? null })),
    k: reading && at > 0 && (() => open({ thread: order[at - 1].id })),
    h: reading && item && (() => snooze(item)),
    r: reading && (() => document.querySelector<HTMLElement>(".reply")?.focus()),
    escape: typing && free && target.closest(".reply") !== null && (() => target.blur()),
  };
  const action = run[key];
  if (!action) return;
  event.preventDefault();
  action();
});

applyTheme(theme());
applyZoom(zoom());
