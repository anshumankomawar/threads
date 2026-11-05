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

export type AppState = ReturnType<typeof createAppState>;

export const AppContext = createContext<AppState>();

export const useApp = (): AppState => useContext(AppContext);

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // It still applies for this session.
  }
}

function savedSource(): DataSource {
  const saved = recall("data-source");
  if (saved === "local" || saved === "sample" || (saved === "cloudflare" && CLOUDFLARE_AVAILABLE))
    return saved;
  return CLOUDFLARE_AVAILABLE ? "cloudflare" : "local";
}

const viewerKey = (source: DataSource): string => `viewer:${source}`;
const clampZoom = (zoom: number): number => Math.round(Math.min(2, Math.max(0.7, zoom)) * 10) / 10;

// When someone other than you last touched the thread.
function lastActivityByOthers(thread: Thread, me: Person): number {
  let latest = 0;
  for (const entry of thread.entries) {
    const person = entry.kind === "event" ? entry.actor : entry.author;
    if (person?.id !== me.id) latest = Math.max(latest, entry.createdAtMs);
  }
  return latest;
}

const pageField = (page: SidebarPage | null, key: "label" | "person"): string | null =>
  page !== null && typeof page === "object" && key in page
    ? (page as Record<string, string>)[key]
    : null;

export function createAppState() {
  // ── Session: the data source, who you view it as, and their sync client ──
  const [source, setSource] = createSignal<DataSource>(savedSource());
  const [viewerId, setViewerId] = createSignal(recall(viewerKey(savedSource())));
  // One client per source and viewer (its own session and cache), running while it's current.
  const client = createMemo(() => createSyncClient(source(), viewerId()));
  createEffect(client, (current) => {
    void current.start();
    return () => current.stop();
  });
  const threads = (): Thread[] => client().threads;
  const people = (): Person[] => client().people;
  const labels = (): Label[] => client().labels;
  const groups = (): ThreadsClient["groups"] => client().groups;
  const me = createMemo(
    () =>
      people().find((person) => person.id === viewerId()) ??
      people()[0] ?? { id: window.user.username, name: "You" },
  );
  // The first load is as the admin session, to find who's here; then the app signs in as the first person. Someone
  // who isn't in this workspace sees nobody, so that goes back to the admin session.
  createEffect(
    () => ({
      ready: client().status === "ready",
      connected: client().connected,
      first: people()[0]?.id,
    }),
    ({ ready, connected, first }) => {
      if (!ready) return;
      const viewer = viewerId();
      if (viewer === null && first !== undefined) {
        remember(viewerKey(source()), first);
        setViewerId(first);
      } else if (viewer !== null && first === undefined && connected) {
        remember(viewerKey(source()), null);
        setViewerId(null);
      }
    },
  );
  const [now, setNow] = createSignal(Date.now());
  onSettled(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  });

  // ── What's open ──
  const [theme, setTheme] = createSignal(savedTheme());
  createEffect(theme, applyTheme);
  const [contentZoom, setContentZoom] = createSignal(
    clampZoom(Number(recall("content-zoom")) || 1),
  );
  createEffect(contentZoom, (zoom) => {
    document.documentElement.style.setProperty("--content-zoom", String(zoom));
    remember("content-zoom", String(zoom));
  });
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [viewAsOpen, setViewAsOpen] = createSignal(false);
  const [newGroupOpen, setNewGroupOpen] = createSignal(false);
  const [newThreadOpen, setNewThreadOpen] = createSignal(false);
  const [composeOpen, setComposeOpen] = createSignal(false);
  const [composing, setComposing] = createSignal<SavedDraft | null>(null);
  const [editingBucket, setEditingBucket] = createSignal<Bucket | "new" | null>(null);
  const [blocking, setBlocking] = createSignal<Thread | null>(null);
  const [moving, setMoving] = createSignal<{ from: Thread; messages: MessageEntry[] } | null>(null);
  const [threadMenu, setThreadMenu] = createSignal<{ x: number; y: number; thread: Thread } | null>(
    null,
  );

  // Opening one palette closes the others it replaces.
  const openNewThread = (): void => {
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
  // A dialog or menu keeps the inbox's keys off.
  const dialogOpen = (): boolean =>
    searchOpen() ||
    newThreadOpen() ||
    composeOpen() ||
    viewAsOpen() ||
    newGroupOpen() ||
    editingBucket() !== null ||
    blocking() !== null ||
    moving() !== null ||
    threadMenu() !== null ||
    document.querySelector(".chip-menu, .context-menu, .thread-menu") !== null;

  // ── Navigation: what the main area shows ──
  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
  const [splitThreadId, setSplitThreadId] = createSignal<string | null>(null);
  const [profileOpen, setProfileOpen] = createSignal(false);
  const [page, setPage] = createSignal<SidebarPage | null>(null);
  const [draftId, setDraftId] = createSignal<string | null>(null);
  // When you last looked at each thread (and group). One you haven't opened counts as seen when the data loaded,
  // except the sample's unread ones.
  const [lastSeen, setLastSeen] = createSignal<Record<string, number>>({});
  const markSeen = (...ids: (string | null)[]): void => {
    const at = Date.now();
    setLastSeen((current) => ({
      ...current,
      ...Object.fromEntries(ids.flatMap((id) => (id === null ? [] : [[id, at]]))),
    }));
  };

  const activeThread = createMemo(() => threads().find((thread) => thread.id === activeThreadId()));
  const splitThread = createMemo(() =>
    splitThreadId() === activeThreadId()
      ? undefined
      : threads().find((thread) => thread.id === splitThreadId()),
  );
  const drafts = useDrafts(source);
  const shownDraft = createMemo(() => drafts.drafts().find((draft) => draft.id === draftId()));
  const shownPerson = createMemo(() =>
    people().find((person) => person.id === pageField(page(), "person")),
  );
  const shownGroup = createMemo(() =>
    groups().find((group) => group.labelId === pageField(page(), "label")),
  );
  // A group's label arrives just after the group, so go by the group until then.
  const shownLabel = createMemo((): Label | undefined => {
    const group = shownGroup();
    return (
      labels().find((label) => label.id === pageField(page(), "label")) ??
      (group && {
        id: group.labelId,
        name: group.name,
        groupId: group.id,
        createdById: group.createdById,
        createdAtMs: group.createdAtMs,
      })
    );
  });
  const title = (): string | undefined =>
    profileOpen()
      ? me().name
      : page() === "all"
        ? "All threads"
        : (shownPerson()?.name ??
          shownLabel()?.name ??
          activeThread()?.title ??
          (shownDraft() && (shownDraft()?.draft?.title || "Draft")));

  // Opening a thread marks it, and the one you're leaving, as seen.
  const openThread = (id: string | null): void => {
    markSeen(activeThreadId(), id);
    setActiveThreadId(id);
    setDraftId(null);
    setProfileOpen(false);
    setPage(null);
    if (id !== null && id === splitThreadId()) setSplitThreadId(null);
  };
  const openSplit = (threadId: string): void => {
    setSplitThreadId(threadId === activeThreadId() ? null : threadId);
  };
  const openProfile = (): void => {
    openThread(null);
    setProfileOpen(true);
  };
  const openPage = (next: SidebarPage): void => {
    openThread(null);
    setPage(next);
  };
  const openPerson = (personId: string): void => {
    if (personId === me().id) openProfile();
    else openPage({ person: personId });
  };

  const switchSource = (next: DataSource): void => {
    remember("data-source", next);
    setActiveThreadId(null);
    setLastSeen({});
    setViewerId(recall(viewerKey(next)));
    setSource(next);
  };
  // Viewing as someone else shows the app from their side, with everything already seen.
  const viewAs = (person: Person): void => {
    setViewAsOpen(false);
    remember(viewerKey(source()), person.id);
    setViewerId(person.id);
    setLastSeen(
      Object.fromEntries([...threads(), ...groups()].map((item) => [item.id, item.updatedAtMs])),
    );
  };

  // ── Inbox ──
  const inbox = createMemo(() => buildInbox(threads(), me(), people(), now()));
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

  // After you finish a thread, the next one in your inbox opens; in the split view, just the split closes.
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

  const [undo, setUndo] = createSignal<{ text: string; run: () => void } | null>(null);
  createEffect(undo, (current) => {
    if (current === null) return;
    const timer = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(timer);
  });
  const edit = (thread: Thread, changes: ThreadChanges): void =>
    client().updateThread(thread.id, changes, me());
  // Done or snoozed, for you, with Undo; the next thread opens.
  const putAway = (
    thread: Thread,
    text: string,
    changes: ThreadChanges,
    undone: ThreadChanges,
  ): void => {
    moveOn(thread);
    edit(thread, changes);
    setUndo({ text, run: () => edit(thread, undone) });
  };
  const markDone = (thread: Thread): void =>
    putAway(thread, "Done", { done: true }, { done: false });
  const snooze = (thread: Thread): void => {
    const until = new Date(now() + 24 * 60 * 60_000);
    until.setHours(9, 0, 0, 0);
    putAway(
      thread,
      "Snoozed until tomorrow",
      { snoozeUntilMs: until.getTime() },
      { snoozeUntilMs: null },
    );
  };

  // ── Buckets, saved to your profile as a whole list ──
  const buckets = (): Bucket[] => bucketsOf(me());
  const saveBuckets = (next: Bucket[]): void => client().updatePerson({ buckets: next }, me());
  const placeIn = (threadId: string, bucketId: string | null): void =>
    client().updateThread(threadId, { bucketId }, me());
  const bucketActions: BucketActions = {
    onNew: () => setEditingBucket("new"),
    onEdit: (bucket) => setEditingBucket(bucket),
    onMove: (bucketId, by) => {
      const next = [...buckets()];
      const from = next.findIndex((bucket) => bucket.id === bucketId);
      const [moved] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, from + by)), 0, moved);
      saveBuckets(next);
    },
    onDelete: (bucketId) => saveBuckets(buckets().filter((bucket) => bucket.id !== bucketId)),
    onPlace: placeIn,
  };
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

  const removeDraft = (id: string): void => {
    drafts.remove(id);
    if (id === draftId()) setDraftId(null);
  };

  // ── Thread links ──
  const threadLinks: ThreadLinks = {
    titleOf: (threadId) => threads().find((thread) => thread.id === threadId)?.title,
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
    search: (query) =>
      threads()
        .filter((thread) => thread.title.toLowerCase().includes(query.toLowerCase()))
        .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs)
        .map(({ id, title }) => ({ id, title })),
  };

  // ── Changing threads: each change is a transaction, applied at once and synced in the background ──
  const createThread = (draft: NewThreadDraft): void => {
    setNewThreadOpen(false);
    openThread(client().createThread(draft, me()));
  };

  // Sends a ⌘⇧N draft: the thread, then each ask as a message opening with its people's @mentions, sent to them.
  const composeThread = (draft: ComposeDraft, fromDraftId: string | null): void => {
    setComposeOpen(false);
    if (fromDraftId !== null) removeDraft(fromDraftId);
    const threadId = client().createThread(
      { title: draft.title, description: draft.context },
      me(),
    );
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

  // A branch is an ordinary thread that remembers where it came from, with whoever you're talking to in the parent.
  const createBranch = (
    from: Thread,
    title: string,
    withPerson?: Person,
    movedEntryIds?: string[],
  ): string => {
    const others = [withPerson, ...participants(from)].filter(
      (person): person is Person => person != null && person.id !== me().id,
    );
    const assignees = [...new Map(others.map((person) => [person.id, person])).values()];
    return client().createThread(
      { title, description: "", assignees, branchedFromId: from.id, movedEntryIds },
      me(),
    );
  };

  // `/blocked`: a thread asking someone for what this one needs, which blocks it until it closes.
  const createBlocker = (
    from: Thread,
    person: Person,
    title: string,
    description: string,
  ): void => {
    client().createThread(
      { title, description, assignees: [person], branchedFromId: from.id, blocksId: from.id },
      me(),
    );
    setBlocking(null);
  };

  const moveTo = (target: MoveTarget): void => {
    const current = moving();
    if (current === null) return;
    const ids = current.messages.map((message) => message.id);
    const threadId =
      target.kind === "thread"
        ? target.threadId
        : createBranch(
            current.from,
            target.title,
            current.messages.find((m) => m.author.id !== me().id)?.author,
            ids,
          );
    if (target.kind === "thread") client().moveMessages(ids, threadId, me());
    setMoving(null);
    openSplit(threadId);
  };

  // Closing something in your inbox finishes it there, so the next thread opens.
  const setStatus = (thread: Thread, status: Status): void => {
    if (isDone(status) && inboxReason(thread, me().id, now()) !== null) moveOn(thread);
    edit(thread, { status });
  };

  const actionsFor = (thread: Thread): ThreadActions => ({
    onNote: (text) => client().addEntry(thread.id, "message", text, me()),
    onSend: (text, to) => client().addEntry(thread.id, "message", text, me(), undefined, to),
    onBlocked: () => setBlocking(thread),
    // A task of your own from the latest thing someone sent you here, telling them you've taken it on.
    onTask: () => {
      const question = lastSentTo(thread, me().id);
      const asked = question
        ? plainThreadLinks(
            withoutLeadingMentions(question.text),
            threadLinks.titleOf,
            threadLinks.nameOf,
          ).trim()
        : "";
      const taskId = client().createThread(
        {
          title: (asked.split("\n")[0] || `Follow up: ${thread.title}`).slice(0, 80),
          description: question ? `${question.author.name}: “${asked}”` : "",
          assignees: [me()],
          branchedFromId: thread.id,
        },
        me(),
      );
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
    onSetStatus: (status) => setStatus(thread, status),
    onSetPriority: (priority) => edit(thread, { priority }),
    onSetDue: (dueAtMs) => edit(thread, { dueAtMs }),
    onSetEffort: (effortHours) => edit(thread, { effortHours }),
    onToggleLabel: (label) => {
      const labelId = client().ensureLabel(label.name, me());
      const has = thread.labelIds.includes(labelId);
      edit(thread, {
        labelIds: has
          ? thread.labelIds.filter((id) => id !== labelId)
          : [...thread.labelIds, labelId],
      });
    },
    onSetBucket: (bucketId) => placeIn(thread.id, bucketId),
    onBranch: (title) => createBranch(thread, title),
    onMoveMessages: (messages) => setMoving({ from: thread, messages }),
    onDeleteMessage: (message) => client().deleteMessage(message.id, me()),
  });

  const threadMenuItems = (thread: Thread): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [{ label: "Open", run: () => openThread(thread.id) }];
    if (activeThreadId() !== null && activeThreadId() !== thread.id)
      items.push({ label: "Open beside", run: () => setSplitThreadId(thread.id) });
    items.push("separator");
    if (inboxReason(thread, me().id, now()) !== null) {
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
    const done = isDone(thread.status);
    const archived = thread.status === "archived";
    items.push(
      { label: done ? "Reopen" : "Close", run: () => setStatus(thread, done ? "open" : "closed") },
      {
        label: archived ? "Unarchive" : "Archive",
        run: () => setStatus(thread, archived ? "open" : "archived"),
      },
    );
    return items;
  };

  // ── Keys ──
  // ⌘K or ⌘⇧F search, ⌘N new thread, ⌘⇧N compose, ⌘U view as, ⌘+ ⌘- ⌘0 zoom the main content.
  const globalKeys = (event: KeyboardEvent): void => {
    if (!event.metaKey || event.altKey) return;
    const zoom = { "=": 0.1, "+": 0.1, "-": -0.1 }[event.key];
    const key = `${event.shiftKey ? "⇧" : ""}${event.key.toLowerCase()}`;
    const run =
      zoom !== undefined || event.key === "0"
        ? () => setContentZoom((current) => (zoom === undefined ? 1 : clampZoom(current + zoom)))
        : {
            k: () => setSearchOpen(true),
            "⇧f": () => setSearchOpen(true),
            n: openNewThread,
            "⇧n": () => openCompose(null),
            u: openViewAs,
          }[key];
    if (run === undefined) return;
    event.preventDefault();
    run();
  };

  // Superhuman's keys, never with a dialog open: ⌘E done (even from the reply); then, not while typing, J/K next or
  // previous, H snooze, R reply, and Escape leaves the reply.
  const inboxKeys = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    const order = inbox().order;
    const active = activeThread();
    const at = order.findIndex((thread) => thread.id === activeThreadId());
    const inInbox = active !== undefined && at !== -1;
    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === "e") {
      if (!inInbox || dialogOpen()) return;
      event.preventDefault();
      markDone(active);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']") !== null) {
      if (
        event.key === "Escape" &&
        target.closest(".thread-panes") &&
        !document.querySelector(".thread-menu")
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
    const onKeyDown = (event: KeyboardEvent): void => {
      globalKeys(event);
      inboxKeys(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return {
    client,
    source,
    switchSource,
    me,
    viewAs,
    now,
    data: {
      threads,
      people,
      labels,
      groups,
      targets: createMemo(() => targetsFor(people(), groups(), me())),
    },
    nav: {
      activeThreadId,
      activeThread,
      splitThread,
      page,
      profileOpen,
      shownDraft,
      shownPerson,
      shownLabel,
      shownGroup,
      pageLabel: shownLabel,
      title,
      openThread,
      openPage,
      openPerson,
      openProfile,
      toggleProfile: (): void => (profileOpen() ? void setProfileOpen(false) : openProfile()),
      // A group's page also counts as having seen the group.
      openLabel: (labelId: string): void => {
        openPage({ label: labelId });
        markSeen(groups().find((group) => group.labelId === labelId)?.id ?? null);
      },
      openDraft: (draft: SavedDraft): void => {
        openThread(null);
        setDraftId(draft.id);
      },
      closeSplit: (): void => void setSplitThreadId(null),
    },
    ui: {
      sidebarOpen,
      toggleSidebar: (): void => void setSidebarOpen((open) => !open),
      detailsOpen,
      toggleDetails: (): void => void setDetailsOpen((open) => !open),
      searchOpen,
      setSearchOpen,
      viewAsOpen,
      setViewAsOpen,
      openViewAs,
      newThreadOpen,
      setNewThreadOpen,
      openNewThread,
      composeOpen,
      composing,
      setComposeOpen,
      newGroupOpen,
      setNewGroupOpen,
      editingBucket,
      setEditingBucket,
      blocking,
      setBlocking,
      moving,
      setMoving,
      threadMenu,
      setThreadMenu,
      theme,
      toggleTheme: (): void => void setTheme((current) => (current === "dark" ? "light" : "dark")),
    },
    inbox: {
      view: inbox,
      unreadIds,
      activity: createMemo(() => activityFor(threads(), me(), seenAt, now())),
      groupNotices: createMemo(() =>
        groupNoticesFor(
          groups(),
          people(),
          me(),
          (group) => lastSeen()[group.id] ?? client().readyAtMs,
          now(),
        ),
      ),
      markAllRead: (): void =>
        markSeen(...threads().map((thread) => thread.id), ...groups().map((group) => group.id)),
    },
    buckets: { actions: bucketActions, save: saveBucket },
    threads: {
      create: createThread,
      compose: composeThread,
      draftWith: (request: ComposeRequest, signal: AbortSignal): Promise<ComposeDraft> =>
        composeDraft(source(), request, signal),
      createBlocker,
      moveTo,
      actionsFor,
      openMenu: (event: MouseEvent, thread: Thread): void => {
        event.preventDefault();
        setThreadMenu({ x: event.clientX, y: event.clientY, thread });
      },
      menuItems: threadMenuItems,
    },
    drafts: {
      list: drafts.drafts,
      save: drafts.save,
      saveAndClose: (draft: SavedDraft): void => {
        drafts.save(draft);
        setComposeOpen(false);
      },
      remove: removeDraft,
    },
    groups: {
      // Makes a group and opens its page.
      create: (name: string, members: Person[]): void => {
        setNewGroupOpen(false);
        client().createGroup(name, members, me());
        openPage({ label: labelSlug(name) });
      },
      update: (groupId: string, changes: Parameters<ThreadsClient["updateGroup"]>[1]): void =>
        client().updateGroup(groupId, changes, me()),
    },
    undo: {
      current: undo,
      run: (): void => {
        undo()?.run();
        setUndo(null);
      },
    },
    links: threadLinks,
  };
}
