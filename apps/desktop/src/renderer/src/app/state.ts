// The app store: made once by `App`, read anywhere below it with `useApp()`.
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  useContext,
} from "solid-js";
import {
  bucketsOf,
  GROUP_TARGET,
  groupTarget,
  inboxReason,
  isDone,
  labelSlug,
  lastSentTo,
  mentionToken,
  participants,
  plainThreadLinks,
  threadLink,
  UNREAD_THREAD_IDS,
  withoutLeadingMentions,
  type Bucket,
  type ComposeDraft,
  type ComposeRequest,
  type Group,
  type Label,
  type Person,
  type Status,
  type Thread,
  type ThreadChanges,
} from "model";
import { CLOUDFLARE_AVAILABLE, composeDraft, createSyncClient, type DataSource } from "../api";
import type { ThreadsClient } from "../sync/syncClient";
import { useDrafts, type SavedDraft } from "../drafts";
import { recipientsOf, targetsFor } from "../compose";
import { applyTheme, savedTheme } from "../theme";
import type { ThreadLinks } from "../threadLinks";
import { buildInbox } from "../inbox";
import { activityFor } from "../activity";
import { groupNoticesFor } from "../groups";
import type { BucketActions, SidebarPage } from "../components/Sidebar";
import type { MessageEntry, ThreadActions } from "../components/ThreadView";
import type { MoveTarget } from "../components/MovePalette";
import type { NewThreadDraft } from "../components/NewThreadPalette";
import type { ContextMenuItem } from "../components/ContextMenu";

type GroupChanges = Parameters<ThreadsClient["updateGroup"]>[1];

export type AppState = ReturnType<typeof createAppState>;

// The app store, provided by `App`. Default-less: reading it outside the app throws.
export const AppContext = createContext<AppState>();

export const useApp = (): AppState => useContext(AppContext);

function useNow(intervalMs: number): () => number {
  const [now, setNow] = createSignal(Date.now());
  onSettled(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  });
  return now;
}

// When someone other than you last touched the thread. Calls and meeting notes count as others' activity.
function lastActivityByOthers(thread: Thread, me: Person): number {
  let latest = 0;
  for (const entry of thread.entries) {
    const person =
      entry.kind === "event"
        ? entry.actor
        : entry.kind === "message" || entry.kind === "resolution"
          ? entry.author
          : null;
    if (person?.id !== me.id) latest = Math.max(latest, entry.createdAtMs);
  }
  return latest;
}

const SOURCE_KEY = "data-source";

// Where data comes from, remembered across launches. Starts on Cloudflare when it's set up, otherwise local.
function savedSource(): DataSource {
  try {
    const saved = localStorage.getItem(SOURCE_KEY);
    if (saved === "local" || saved === "sample") return saved;
    if (saved === "cloudflare" && CLOUDFLARE_AVAILABLE) return saved;
  } catch {
    // Fall through to the default.
  }
  return CLOUDFLARE_AVAILABLE ? "cloudflare" : "local";
}

// The main content's zoom, changed with ⌘+, ⌘- and ⌘0; the sidebar and top bar stay as they are.
const CONTENT_ZOOM_KEY = "content-zoom";
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2;

// The main content's zoom, kept in range and to one decimal.
const clampZoom = (zoom: number): number =>
  Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 10) / 10;

function savedContentZoom(): number {
  try {
    const zoom = Number(localStorage.getItem(CONTENT_ZOOM_KEY));
    return zoom >= MIN_ZOOM && zoom <= MAX_ZOOM ? zoom : 1;
  } catch {
    return 1;
  }
}

// Who you last viewed each data source as.
const viewerKey = (source: DataSource): string => `viewer:${source}`;

function savedViewer(source: DataSource): string | null {
  try {
    return localStorage.getItem(viewerKey(source));
  } catch {
    return null;
  }
}

function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing remembered to forget.
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; it still applies for this session.
  }
}

// One sync client per data source and person you view it as (each its own session and local cache, as the server
// treats you as them), made when either changes and running while it's on screen.
function useSyncClient(
  source: () => DataSource,
  viewerId: () => string | null,
): () => ThreadsClient {
  const client = createMemo(() => createSyncClient(source(), viewerId()));
  createEffect(client, (current) => {
    void current.start();
    return () => current.stop();
  });
  return client;
}

// The page shown in the main area, when it's one of the object forms.
function pageField<K extends "label" | "person">(page: SidebarPage | null, key: K): string | null {
  return page !== null && typeof page === "object" && key in page
    ? (page as Record<K, string>)[key]
    : null;
}

// A signal's setter as a plain action that takes the new value (the store's `ui.set…`).
function valueSetter<T>(set: (update: (previous: T) => T) => unknown): (value: T) => void {
  return (value) => {
    set(() => value);
  };
}

// Made once, in `App`'s body (it creates signals, memos and effects, and installs the window's key handlers).
export function createAppState() {
  // ── Session: the data source, who you view it as, and their sync client ──────────────────────────────────────────
  const [source, setSource] = createSignal<DataSource>(savedSource());
  const [viewerId, setViewerId] = createSignal<string | null>(savedViewer(savedSource()));
  const client = useSyncClient(source, viewerId);
  const threads = (): Thread[] => client().threads;
  const people = (): Person[] => client().people;
  const labels = (): Label[] => client().labels;
  const groups = (): Group[] => client().groups;
  // You view the app as the chosen person, or the first person in the data until you pick one (or the local user,
  // before anyone has loaded).
  const me = createMemo(
    () =>
      people().find((person) => person.id === viewerId()) ??
      people()[0] ?? { id: window.user.username, name: "You" },
  );
  // The first load is as the admin session, to find who's here; then the app signs in as the person it shows, so the
  // server treats it as them. Someone who isn't in this workspace sees nobody, so that goes back to the admin session.
  createEffect(
    () => ({
      status: client().status,
      connected: client().connected,
      viewerId: viewerId(),
      firstPersonId: people()[0]?.id,
      source: source(),
    }),
    ({ status, connected, viewerId, firstPersonId, source }) => {
      if (status !== "ready") return;
      if (viewerId === null && firstPersonId !== undefined) {
        remember(viewerKey(source), firstPersonId);
        setViewerId(firstPersonId);
      } else if (viewerId !== null && firstPersonId === undefined && connected) {
        forget(viewerKey(source));
        setViewerId(null);
      }
    },
  );
  const nowMs = useNow(60_000);
  const targets = createMemo(() => targetsFor(people(), groups(), me()));

  // ── What's open ──────────────────────────────────────────────────────────────────────────────────────────────────
  const [viewAsOpen, setViewAsOpen] = createSignal(false);
  const [contentZoom, setContentZoom] = createSignal(savedContentZoom());
  const [theme, setTheme] = createSignal(savedTheme());

  createEffect(theme, (current) => applyTheme(current));

  createEffect(contentZoom, (zoom) => {
    document.documentElement.style.setProperty("--content-zoom", String(zoom));
    remember(CONTENT_ZOOM_KEY, String(zoom));
  });
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [newGroupOpen, setNewGroupOpen] = createSignal(false);
  // Starting a thread opens the new-thread panel.
  const [newThreadOpen, setNewThreadOpen] = createSignal(false);
  // ⌘⇧N: a new thread written as one message, drafted by the model (`ComposePanel`). The first person asked has it;
  // each ask is a message sent to its people, which puts the thread in their inboxes, sorted by what they were asked.
  // A saved draft opens in the same panel, and leaves the drafts once it's sent.
  const [composeOpen, setComposeOpen] = createSignal(false);
  const [composing, setComposing] = createSignal<SavedDraft | null>(null);
  const [editingBucket, setEditingBucket] = createSignal<Bucket | "new" | null>(null);
  // `/blocked`: the thread the form is for while it's open.
  const [blocking, setBlocking] = createSignal<Thread | null>(null);
  // Messages on their way out of a thread, while you pick where they go.
  const [moving, setMoving] = createSignal<{ from: Thread; messages: MessageEntry[] } | null>(null);
  // The menu for a thread right-clicked in a list: open it here or beside the one you're in, move it to another of
  // your buckets, close or reopen it, archive or unarchive it.
  const [threadMenu, setThreadMenu] = createSignal<{ x: number; y: number; thread: Thread } | null>(
    null,
  );

  const openNew = (): void => {
    setSearchOpen(false);
    setNewThreadOpen(true);
  };
  const openCompose = (draft: SavedDraft | null): void => {
    setSearchOpen(false);
    setNewThreadOpen(false);
    setComposing(draft);
    setComposeOpen(true);
  };
  const openViewAs = (): void => {
    setSearchOpen(false);
    setNewThreadOpen(false);
    setViewAsOpen(true);
  };
  // Whether a dialog or menu is open, which keeps the inbox's keys off.
  const dialogOpen = (): boolean =>
    searchOpen() ||
    newThreadOpen() ||
    composeOpen() ||
    viewAsOpen() ||
    editingBucket() !== null ||
    blocking() !== null ||
    moving() !== null ||
    newGroupOpen() ||
    threadMenu() !== null ||
    document.querySelector(".chip-menu, .context-menu, .thread-menu") !== null;

  // ── Navigation: what the main area shows ─────────────────────────────────────────────────────────────────────────
  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
  const [profileOpen, setProfileOpen] = createSignal(false);
  // Settings, a label's or group's threads, or someone's profile; null for a thread or your own profile.
  const [page, setPage] = createSignal<SidebarPage | null>(null);
  // A draft opened from the sidebar takes the thread's place in the main area (`DraftView`).
  const [draftId, setDraftId] = createSignal<string | null>(null);
  // The thread open beside the main one, from clicking a thread link.
  const [splitThreadId, setSplitThreadId] = createSignal<string | null>(null);
  // When you last looked at each thread. One you haven't opened counts as seen when the data finished loading,
  // except the sample's unread ones; activity by others after that, live or caught up, shows as unread.
  const [lastSeen, setLastSeen] = createSignal<Record<string, number>>({});

  const activeThread = createMemo(() => threads().find((thread) => thread.id === activeThreadId()));
  const splitThread = createMemo(() =>
    splitThreadId() === activeThreadId()
      ? undefined
      : threads().find((thread) => thread.id === splitThreadId()),
  );
  const drafts = useDrafts(source);
  const shownDraft = createMemo(() => drafts.drafts().find((draft) => draft.id === draftId()));
  const shownLabelId = createMemo(() => pageField(page(), "label"));
  const shownPerson = createMemo(() => {
    const id = pageField(page(), "person");
    return id === null ? undefined : people().find((person) => person.id === id);
  });
  const shownGroup = createMemo(() => groups().find((group) => group.labelId === shownLabelId()));
  // A group's label comes back from the server just after the group, so go by the group until then.
  const shownLabel = createMemo((): Label | undefined => {
    const group = shownGroup();
    return (
      labels().find((label) => label.id === shownLabelId()) ??
      (group === undefined
        ? undefined
        : {
            id: group.labelId,
            name: group.name,
            groupId: group.id,
            createdById: group.createdById,
            createdAtMs: group.createdAtMs,
          })
    );
  });
  // The label a thread made from this page starts with.
  const pageLabel = shownLabel;
  // The top bar's title for what's shown.
  const title = (): string | undefined =>
    profileOpen()
      ? me().name
      : page() === "settings"
        ? "Settings"
        : page() === "all"
          ? "All threads"
          : (shownPerson()?.name ??
            shownLabel()?.name ??
            activeThread()?.title ??
            (shownDraft() === undefined ? undefined : shownDraft()?.draft?.title || "Draft"));

  // Opening a thread marks it, and the one you're leaving, as seen.
  const openThread = (id: string | null): void => {
    const now = Date.now();
    const leaving = activeThreadId();
    setLastSeen((current) => ({
      ...current,
      ...(leaving === null ? {} : { [leaving]: now }),
      ...(id === null ? {} : { [id]: now }),
    }));
    setActiveThreadId(id);
    setDraftId(null);
    setProfileOpen(false);
    setPage(null);
    // A thread opened as the main one leaves the split view.
    if (id !== null && id === splitThreadId()) setSplitThreadId(null);
  };
  // Beside the main thread; the main thread itself doesn't open twice.
  const openSplit = (threadId: string): void => {
    setSplitThreadId(threadId === activeThreadId() ? null : threadId);
  };
  // Your profile and the org take the thread's place in the main area.
  const openProfile = (): void => {
    openThread(null);
    setProfileOpen(true);
  };
  const toggleProfile = (): void => {
    if (profileOpen()) setProfileOpen(false);
    else openProfile();
  };
  // Settings, likewise.
  const openPage = (next: SidebarPage): void => {
    openThread(null);
    setPage(next);
  };
  // A label's threads; for a group's label, the group's page, which also counts as having seen it.
  const openLabel = (labelId: string): void => {
    openPage({ label: labelId });
    const group = groups().find((candidate) => candidate.labelId === labelId);
    if (group !== undefined) setLastSeen((current) => ({ ...current, [group.id]: Date.now() }));
  };
  // Someone's profile; your own is the profile and org.
  const openPerson = (personId: string): void => {
    if (personId === me().id) openProfile();
    else openPage({ person: personId });
  };
  const openDraft = (draft: SavedDraft): void => {
    openThread(null);
    setDraftId(draft.id);
  };

  // ── Session changes ──────────────────────────────────────────────────────────────────────────────────────────────
  // Switching data sources starts fresh on the other one.
  const switchSource = (next: DataSource): void => {
    remember(SOURCE_KEY, next);
    setActiveThreadId(null);
    setLastSeen({});
    setViewerId(savedViewer(next));
    setSource(next);
  };

  // Viewing as someone else shows the app from their side, with everything already seen.
  const viewAs = (person: Person): void => {
    setViewAsOpen(false);
    remember(viewerKey(source()), person.id);
    setViewerId(person.id);
    setLastSeen({
      ...Object.fromEntries(threads().map((thread) => [thread.id, thread.updatedAtMs])),
      ...Object.fromEntries(groups().map((group) => [group.id, group.updatedAtMs])),
    });
  };

  // ── Inbox, unread and notifications ──────────────────────────────────────────────────────────────────────────────
  const inbox = createMemo(() => buildInbox(threads(), me(), people(), nowMs()));
  const seenAt = (thread: Thread): number =>
    lastSeen()[thread.id] ?? (UNREAD_THREAD_IDS.includes(thread.id) ? 0 : client().readyAtMs);
  const unreadIds = createMemo(
    () =>
      new Set(
        threads()
          .filter(
            (thread) =>
              thread.id !== activeThreadId() && lastActivityByOthers(thread, me()) > seenAt(thread),
          )
          .map((thread) => thread.id),
      ),
  );
  const activity = createMemo(() => activityFor(threads(), me(), seenAt, nowMs()));
  const groupNotices = createMemo(() =>
    groupNoticesFor(
      groups(),
      people(),
      me(),
      (group) => lastSeen()[group.id] ?? client().readyAtMs,
      nowMs(),
    ),
  );
  const markAllRead = (): void => {
    const now = Date.now();
    setLastSeen((current) => ({
      ...current,
      ...Object.fromEntries(threads().map((thread) => [thread.id, now])),
      ...Object.fromEntries(groups().map((group) => [group.id, now])),
    }));
  };

  // After you close a thread of yours, the next one in your inbox opens: the one after it, else the first. In the
  // split view, just the split closes.
  const moveOn = (thread: Thread): void => {
    if (thread.id === splitThreadId()) {
      setSplitThreadId(null);
      return;
    }
    const order = inbox().order;
    const at = order.findIndex((candidate) => candidate.id === thread.id);
    const next = [...order.slice(at + 1), ...order.slice(0, Math.max(0, at))].find(
      (candidate) => candidate.id !== thread.id && candidate.id !== splitThreadId(),
    );
    openThread(next?.id ?? null);
  };

  // A change just made from the inbox, which Undo takes back for a few seconds.
  const [undo, setUndo] = createSignal<{ text: string; run: () => void } | null>(null);
  createEffect(undo, (current) => {
    if (current === null) return;
    const timer = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(timer);
  });

  // ⌘E: done with it, for you. It never closes the thread, which is always by hand (/close, the
  // status, right-click), so nobody's ask is closed under them. The next thread in your inbox opens.
  const markDone = (thread: Thread): void => {
    moveOn(thread);
    client().updateThread(thread.id, { done: true }, me());
    setUndo({ text: "Done", run: () => client().updateThread(thread.id, { done: false }, me()) });
  };

  // H: out of your inbox until 9 tomorrow morning.
  const snooze = (thread: Thread): void => {
    const until = new Date(nowMs() + 24 * 60 * 60_000);
    until.setHours(9, 0, 0, 0);
    moveOn(thread);
    client().updateThread(thread.id, { snoozeUntilMs: until.getTime() }, me());
    setUndo({
      text: "Snoozed until tomorrow",
      run: () => client().updateThread(thread.id, { snoozeUntilMs: null }, me()),
    });
  };

  // ── Buckets ──────────────────────────────────────────────────────────────────────────────────────────────────────
  // Your buckets, edited from the inbox and saved to your profile as a whole list. A thread placed by hand stays put.
  const buckets = (): Bucket[] => bucketsOf(me());
  const saveBuckets = (next: Bucket[]): void => client().updatePerson({ buckets: next }, me());
  const placeIn = (threadId: string, bucketId: string | null): void =>
    client().updateThread(threadId, { bucketId }, me());
  const bucketActions: BucketActions = {
    onNew: () => setEditingBucket("new"),
    onEdit: (bucket) => setEditingBucket(bucket),
    onMove: (bucketId, by) => {
      const current = buckets();
      const from = current.findIndex((bucket) => bucket.id === bucketId);
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, from + by)), 0, moved);
      saveBuckets(next);
    },
    onDelete: (bucketId) => saveBuckets(buckets().filter((bucket) => bucket.id !== bucketId)),
    onPlace: (threadId, bucketId) => placeIn(threadId, bucketId),
  };
  // Saves the bucket being edited (`ui.editingBucket()`), new or existing, and closes the editor.
  const saveBucket = (name: string, description: string): void => {
    const editing = editingBucket();
    setEditingBucket(null);
    if (editing === null) return;
    saveBuckets(
      editing === "new"
        ? [...buckets(), { id: crypto.randomUUID(), name, description }]
        : buckets().map((bucket) =>
            bucket.id === editing.id ? { ...bucket, name, description } : bucket,
          ),
    );
  };

  // ── Drafts ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const saveDraft = (draft: SavedDraft): void => {
    drafts.save(draft);
    setComposeOpen(false);
  };
  // Deleting the draft on screen leaves its page.
  const removeDraft = (id: string): void => {
    drafts.remove(id);
    if (id === draftId()) setDraftId(null);
  };

  // ── Groups ───────────────────────────────────────────────────────────────────────────────────────────────────────
  // Makes a group (from the new-group palette) and opens its page.
  const createGroup = (
    name: string,
    members: Parameters<ThreadsClient["createGroup"]>[1],
  ): void => {
    setNewGroupOpen(false);
    client().createGroup(name, members, me());
    openPage({ label: labelSlug(name) });
  };
  const updateGroup = (groupId: string, changes: GroupChanges): void =>
    client().updateGroup(groupId, changes, me());

  // ── Thread links ─────────────────────────────────────────────────────────────────────────────────────────────────
  const threadLinks: ThreadLinks = {
    titleOf: (threadId) => threads().find((thread) => thread.id === threadId)?.title,
    // People by id, groups by `group:<id>`.
    nameOf: (target) =>
      target.startsWith(GROUP_TARGET)
        ? groups().find((group) => groupTarget(group.id) === target)?.name
        : people().find((person) => person.id === target)?.name,
    get people() {
      return people();
    },
    get threads() {
      return threads();
    },
    get labels() {
      return labels();
    },
    get groups() {
      return groups();
    },
    open: openSplit,
    openPerson,
    search: (query) => {
      const needle = query.toLowerCase();
      return threads()
        .filter((thread) => thread.title.toLowerCase().includes(needle))
        .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs)
        .map(({ id, title }) => ({ id, title }));
    },
  };

  // ── Changing threads ─────────────────────────────────────────────────────────────────────────────────────────────
  // The panel's title and description make the thread. It appears at once and syncs in the background.
  const createThread = (draft: NewThreadDraft): void => {
    setNewThreadOpen(false);
    openThread(client().createThread(draft, me()));
  };

  // Sends a draft, from the panel or a draft's page, and drops it from the drafts.
  const composeThread = (draft: ComposeDraft, fromDraftId: string | null): void => {
    setComposeOpen(false);
    if (fromDraftId !== null) removeDraft(fromDraftId);
    const threadId = client().createThread(
      { title: draft.title, description: draft.context },
      me(),
    );
    // Each ask opens with its people's and groups' @mentions, so it reads "@Amara Can you review this CR?". The server
    // assigns the thread to everyone mentioned, and to each group through its label; each is sent their ask (a group's
    // members as they are now), so it's in their inboxes.
    for (const ask of draft.asks)
      client().addEntry(
        threadId,
        "message",
        [...ask.personIds.map(mentionToken), ask.text].join(" "),
        me(),
        undefined,
        recipientsOf(ask.personIds, people(), groups(), me()),
      );
    openThread(threadId);
  };
  // The model's draft of a ⌘⇧N message, from the current data source.
  const draftWith = (request: ComposeRequest, signal: AbortSignal): Promise<ComposeDraft> =>
    composeDraft(source(), request, signal);

  // A branch is an ordinary thread that remembers where it came from, between the same people: you ask whoever
  // you're talking to in the parent (`with`, or the first other person on it).
  const createBranch = (
    from: Thread,
    title: string,
    withPerson?: Person,
    movedEntryIds?: string[],
  ): string => {
    const others = [withPerson, ...participants(from)].filter(
      (person): person is Person =>
        person !== undefined && person !== null && person.id !== me().id,
    );
    return client().createThread(
      {
        title,
        description: "",
        assignees: [...new Map(others.map((person) => [person.id, person])).values()],
        branchedFromId: from.id,
        movedEntryIds,
      },
      me(),
    );
  };

  // `/blocked`: the new thread asking someone for what it needs, which blocks it until it closes.
  const createBlocker = (
    from: Thread,
    person: Person,
    title: string,
    description: string,
  ): void => {
    client().createThread(
      {
        title,
        description,
        assignees: [person],
        branchedFromId: from.id,
        blocksId: from.id,
      },
      me(),
    );
    setBlocking(null);
  };

  // Moves the messages in `ui.moving()` to an existing thread or a new branch, and opens it beside.
  const moveTo = (target: MoveTarget): void => {
    const current = moving();
    if (current === null) return;
    const { from, messages } = current;
    const ids = messages.map((message) => message.id);
    const threadId =
      target.kind === "thread"
        ? target.threadId
        : createBranch(
            from,
            target.title,
            messages.find((m) => m.author.id !== me().id)?.author,
            ids,
          );
    if (target.kind === "thread") client().moveMessages(ids, threadId, me());
    setMoving(null);
    openSplit(threadId);
  };

  // Straight to the thread, without moving on through your inbox.
  const setStatus = (thread: Thread, status: Status): void =>
    client().updateThread(thread.id, { status }, me());

  // Every change is a transaction: applied here at once, then sent to the server, which records property changes
  // as activity lines that sync back. Each open thread (main or split) gets its own actions.
  const actionsFor = (thread: Thread): ThreadActions => {
    const edit = (changes: ThreadChanges): void => client().updateThread(thread.id, changes, me());
    return {
      // Enter sends to people, into their inbox; with nobody to send to, it's a note in the thread.
      onNote: (text) => client().addEntry(thread.id, "message", text, me()),
      // Whoever it @mentions is assigned the thread, and a group through its label (the server's doing).
      onSend: (text, to) => client().addEntry(thread.id, "message", text, me(), undefined, to),
      onBlocked: () => setBlocking(thread),
      onTask: () => {
        // The latest thing someone sent you here, if anything; else the thread itself.
        const question = lastSentTo(thread, me().id);
        const asked = question
          ? plainThreadLinks(
              withoutLeadingMentions(question.text),
              threadLinks.titleOf,
              threadLinks.nameOf,
            ).trim()
          : "";
        const title = (asked.split("\n")[0] || `Follow up: ${thread.title}`).slice(0, 80);
        const taskId = client().createThread(
          {
            title,
            description: question ? `${question.author.name}: “${asked}”` : "",
            assignees: [me()],
            branchedFromId: thread.id,
          },
          me(),
        );
        // Saying so where you were asked, sent to whoever asked, lets them know.
        client().addEntry(
          thread.id,
          "message",
          `Taking this on in ${threadLink(taskId)}`,
          me(),
          undefined,
          question === undefined ? [] : [question.author],
        );
        setSplitThreadId(taskId);
      },
      // Closing something in your inbox finishes it there, so the next thread opens.
      onSetStatus: (status) => {
        if (isDone(status) && inboxReason(thread, me().id, nowMs()) !== null) moveOn(thread);
        edit({ status });
      },
      onSetPriority: (priority) => edit({ priority }),
      onSetDue: (dueAtMs) => edit({ dueAtMs }),
      onSetEffort: (effortHours) => edit({ effortHours }),
      onToggleLabel: (label) => {
        const labelId = client().ensureLabel(label.name, me());
        edit({
          labelIds: thread.labelIds.includes(labelId)
            ? thread.labelIds.filter((id) => id !== labelId)
            : [...thread.labelIds, labelId],
        });
      },
      onSetBucket: (bucketId) => placeIn(thread.id, bucketId),
      onBranch: (title) => createBranch(thread, title),
      onMoveMessages: (messages) => setMoving({ from: thread, messages }),
      onDeleteMessage: (message) => client().deleteMessage(message.id, me()),
    };
  };

  // Right-clicking a thread anywhere opens this menu.
  const openThreadMenu = (event: MouseEvent, thread: Thread): void => {
    event.preventDefault();
    setThreadMenu({ x: event.clientX, y: event.clientY, thread });
  };
  const threadMenuItems = (thread: Thread): ContextMenuItem[] => {
    const setStatus = actionsFor(thread).onSetStatus;
    const items: ContextMenuItem[] = [{ label: "Open", run: () => openThread(thread.id) }];
    if (activeThreadId() !== null && activeThreadId() !== thread.id)
      items.push({ label: "Open beside", run: () => setSplitThreadId(thread.id) });
    items.push("separator");
    if (inboxReason(thread, me().id, nowMs()) !== null) {
      items.push(
        { label: "Done", shortcut: "⌘E", run: () => markDone(thread) },
        { label: "Snooze until tomorrow", shortcut: "H", run: () => snooze(thread) },
        "separator",
      );
      const current = thread.triage[me().id] ?? null;
      for (const bucket of buckets())
        if (bucket.id !== current?.bucketId)
          items.push({ label: `Move to ${bucket.name}`, run: () => placeIn(thread.id, bucket.id) });
      if (current?.manual)
        items.push({ label: "Sort it for me", run: () => placeIn(thread.id, null) });
      items.push("separator");
    }
    items.push(
      isDone(thread.status)
        ? { label: "Reopen", run: () => setStatus("open") }
        : { label: "Close", run: () => setStatus("closed") },
    );
    items.push(
      thread.status === "archived"
        ? { label: "Unarchive", run: () => setStatus("open") }
        : { label: "Archive", run: () => setStatus("archived") },
    );
    return items;
  };

  // ── Keys ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  // ⌘K (or ⌘⇧F) opens search; ⌘N starts a thread, matching the shortcut search shows for it; ⌘U picks who to view as;
  // ⌘+, ⌘- and ⌘0 zoom the main content.
  const globalKeys = (event: KeyboardEvent): void => {
    if (!event.metaKey || event.altKey) return;
    // ⌘+ is usually typed as ⌘= (with or without Shift).
    const zoom = { "=": ZOOM_STEP, "+": ZOOM_STEP, "-": -ZOOM_STEP }[event.key];
    if (zoom !== undefined || event.key === "0") {
      event.preventDefault();
      setContentZoom((current) => (zoom === undefined ? 1 : clampZoom(current + zoom)));
      return;
    }
    const key = event.key.toLowerCase();
    if (event.shiftKey && key === "f") {
      event.preventDefault();
      setSearchOpen(true);
      return;
    }
    if (event.shiftKey && key === "n") {
      event.preventDefault();
      openCompose(null);
      return;
    }
    if (event.shiftKey) return;
    if (key === "k") {
      event.preventDefault();
      setSearchOpen(true);
    } else if (key === "n") {
      event.preventDefault();
      openNew();
    } else if (key === "u") {
      event.preventDefault();
      openViewAs();
    }
  };

  // Superhuman's keys for the inbox, never with a dialog open: ⌘E marks the open thread done, even from the reply; then,
  // without a modifier and not while typing, J/K open the next or previous thread, H snoozes it, R puts the cursor in
  // the reply, and Escape leaves the reply so the keys work again. It reads the current state when a key is pressed.
  const inboxKeys = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    const order = inbox().order;
    const active = activeThread();
    const at = order.findIndex((thread) => thread.id === activeThreadId());
    const inInbox = active !== undefined && at !== -1;
    // ⌘E: done with it, for you. It works from the reply too, so you can answer and move on.
    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === "e") {
      if (!inInbox || dialogOpen()) return;
      event.preventDefault();
      markDone(active);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    const typing = target.closest("input, textarea, select, [contenteditable='true']") !== null;
    // Escape leaves the reply (once its own menus are closed), so the keys work again.
    if (typing) {
      if (
        event.key === "Escape" &&
        target.closest(".thread-panes") !== null &&
        document.querySelector(".thread-menu") === null
      )
        target.blur();
      return;
    }
    if (event.defaultPrevented || dialogOpen()) return;
    if (key === "j" || key === "k") {
      const next = at === -1 ? order[0] : order[at + (key === "j" ? 1 : -1)];
      if (next !== undefined) openThread(next.id);
    } else if (key === "h" && inInbox) snooze(active);
    else if (key === "r" && active !== undefined)
      // The thread's own reply, at the end of its document.
      [
        ...document.querySelectorAll<HTMLElement>(
          ".thread-panes > .thread-view .thread-reply-editor",
        ),
      ]
        .at(-1)
        ?.focus();
    else return;
    event.preventDefault();
  };

  onSettled(() => {
    window.addEventListener("keydown", globalKeys);
    return () => window.removeEventListener("keydown", globalKeys);
  });
  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent): void => inboxKeys(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return {
    client,
    source,
    switchSource,
    me,
    viewAs,
    now: nowMs,

    data: { threads, people, labels, groups, targets },

    nav: {
      activeThreadId,
      activeThread,
      splitThreadId,
      splitThread,
      page,
      profileOpen,
      draftId,
      shownDraft,
      shownPerson,
      shownLabel,
      shownGroup,
      pageLabel,
      title,
      openThread,
      openSplit,
      closeSplit: (): void => {
        setSplitThreadId(null);
      },
      openProfile,
      closeProfile: (): void => {
        setProfileOpen(false);
      },
      toggleProfile,
      openPage,
      openLabel,
      openPerson,
      openDraft,
      moveOn,
    },

    ui: {
      sidebarOpen,
      setSidebarOpen: valueSetter(setSidebarOpen),
      toggleSidebar: (): void => {
        setSidebarOpen((open) => !open);
      },
      detailsOpen,
      setDetailsOpen: valueSetter(setDetailsOpen),
      toggleDetails: (): void => {
        setDetailsOpen((open) => !open);
      },
      searchOpen,
      setSearchOpen: valueSetter(setSearchOpen),
      viewAsOpen,
      setViewAsOpen: valueSetter(setViewAsOpen),
      openViewAs,
      newThreadOpen,
      setNewThreadOpen: valueSetter(setNewThreadOpen),
      openNewThread: openNew,
      composeOpen,
      composing,
      setComposeOpen: valueSetter(setComposeOpen),
      openCompose,
      newGroupOpen,
      setNewGroupOpen: valueSetter(setNewGroupOpen),
      editingBucket,
      setEditingBucket: valueSetter(setEditingBucket),
      blocking,
      setBlocking: valueSetter(setBlocking),
      moving,
      setMoving: valueSetter(setMoving),
      threadMenu,
      setThreadMenu: valueSetter(setThreadMenu),
      theme,
      setTheme: valueSetter(setTheme),
      toggleTheme: (): void => {
        setTheme((current) => (current === "dark" ? "light" : "dark"));
      },
      contentZoom,
      dialogOpen,
    },

    inbox: {
      view: inbox,
      unreadIds,
      seenAt,
      activity,
      groupNotices,
      markAllRead,
      markDone,
      snooze,
    },

    buckets: { list: buckets, actions: bucketActions, save: saveBucket, placeIn },

    threads: {
      create: createThread,
      compose: composeThread,
      draftWith,
      branch: createBranch,
      createBlocker,
      moveTo,
      setStatus,
      actionsFor,
      openMenu: openThreadMenu,
      menuItems: threadMenuItems,
    },

    drafts: {
      list: drafts.drafts,
      save: drafts.save,
      saveAndClose: saveDraft,
      remove: removeDraft,
    },

    groups: {
      create: createGroup,
      update: updateGroup,
    },

    undo: {
      current: undo,
      run: (): void => {
        undo()?.run();
        setUndo(null);
      },
      dismiss: (): void => {
        setUndo(null);
      },
    },

    links: threadLinks,

    keys: { global: globalKeys, inbox: inboxKeys },
  };
}
