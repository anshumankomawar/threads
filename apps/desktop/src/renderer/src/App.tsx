import { useContext, useEffect, useRef, useState } from "react";
import { NewThreadPalette, type NewThreadDraft } from "./components/NewThreadPalette";
import { ComposePanel } from "./components/ComposePanel";
import { DraftView } from "./components/DraftView";
import { useDrafts, type SavedDraft } from "./drafts";
import { recipientsOf, targetsFor } from "./compose";
import { BucketPalette } from "./components/BucketPalette";
import { CommandPalette } from "./components/CommandPalette";
import { applyTheme, savedTheme } from "./theme";
import { DetailsPanel } from "./components/DetailsPanel";
import {
  DetailsToggle,
  SearchButton,
  Sidebar,
  SidebarToggle,
  type BucketActions,
  type SidebarPage,
} from "./components/Sidebar";
import {
  bucketsOf,
  isDone,
  labelSlug,
  plainThreadLinks,
  splitThreadLinks,
  UNREAD_THREAD_IDS,
  type Group,
  type Label,
  type Bucket,
  type ComposeDraft,
  type Person,
  type Thread,
  type ThreadChanges,
  inboxReason,
  GROUP_TARGET,
  groupTarget,
  mentionToken,
  lastSentTo,
  participants,
  threadLink,
  withoutLeadingMentions,
} from "model";
import { observer } from "mobx-react-lite";
import {
  CLOUDFLARE_AVAILABLE,
  composeDraft,
  createSyncClient,
  serverFor,
  SOURCE_LABELS,
  type DataSource,
} from "./api";
import type { SyncClient } from "./sync/syncClient";
import { ThreadView, type MessageEntry, type ThreadActions } from "./components/ThreadView";
import { MovePalette, type MoveTarget } from "./components/MovePalette";
import { BlockedPalette } from "./components/BlockedPalette";
import { MentionToasts } from "./components/MentionToasts";
import { MeContext } from "./me";
import { ThreadLinksContext, type ThreadLinks } from "./threadLinks";
import { ThreadMenuContext } from "./threadMenu";
import { ContextMenu, type ContextMenuItem } from "./components/ContextMenu";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowExpand01Icon, Cancel01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { Identicon } from "./components/Identicon";
import { PersonView } from "./components/PersonView";
import { SprintView } from "./components/SprintView";
import { ProfileView } from "./components/ProfileView";
import { LabelView } from "./components/LabelView";
import { NewGroupPalette } from "./components/NewGroupPalette";
import { OrganizationPrompt } from "./components/OrganizationPrompt";
import { groupNoticesFor, groupsFor, selectableLabels } from "./groups";
import { nextSprint, openSprintWith, sprintsOf } from "./sprints";
import { SettingsView } from "./components/SettingsView";
import { ViewAsPalette } from "./components/ViewAsPalette";
import { buildInbox } from "./inbox";
import { activityFor } from "./activity";

// Mouse moves within this many pixels of the top nudge the drag-region resync element.
const DRAG_RESYNC_ZONE_PX = 96;

// Chromium can keep stale app-region bounds; moving a 1px no-drag element forces a recompute.
function DragRegionResync(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent): void => {
      const element = ref.current;
      if (element === null || event.clientY > DRAG_RESYNC_ZONE_PX) return;
      element.style.left = element.style.left === "1px" ? "0px" : "1px";
    };
    window.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove, { capture: true });
  }, []);

  return <div aria-hidden ref={ref} className="drag-region-resync" />;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
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

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; it still applies for this session.
  }
}

// One sync client per data source, made when the source is picked and running while it's on screen.
function useSyncClient(source: DataSource): SyncClient {
  const [current, setCurrent] = useState(() => ({ source, client: createSyncClient(source) }));
  if (current.source !== source) setCurrent({ source, client: createSyncClient(source) });
  const { client } = current;
  useEffect(() => {
    void client.start();
    return () => client.stop();
  }, [client]);
  return client;
}

// Wipes every thread in the current workspace, keeping people and the org: the first click asks, the
// second (within a few seconds) wipes.
function WipeButton({ onWipe }: { onWipe: () => Promise<void> }): React.JSX.Element {
  const [state, setState] = useState<"idle" | "confirm" | "wiping">("idle");
  useEffect(() => {
    if (state !== "confirm") return;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <button
      type="button"
      className="topbar-button wipe-button"
      data-state={state}
      aria-label="Wipe all threads"
      title="Wipe all threads (people and the org stay)"
      disabled={state === "wiping"}
      onClick={() => {
        if (state === "idle") return setState("confirm");
        setState("wiping");
        void onWipe().finally(() => setState("idle"));
      }}
    >
      <HugeiconsIcon icon={Delete02Icon} size={13} aria-hidden />
      {state === "confirm" && <span>Wipe all threads?</span>}
      {state === "wiping" && <span>Wiping…</span>}
    </button>
  );
}

const App = observer(function App(): React.JSX.Element {
  const [source, setSource] = useState<DataSource>(savedSource);
  const client = useSyncClient(source);
  const threads = client.threads;
  const people = client.people;
  const labels = client.labels;
  const groups = client.groups;
  const sprints = client.sprints;
  const [viewerId, setViewerId] = useState<string | null>(() => savedViewer(savedSource()));
  const fallbackMe = useContext(MeContext);
  // You view the app as the chosen person, or the first person in the data until you pick one.
  const me = people.find((person) => person.id === viewerId) ?? people[0] ?? fallbackMe;
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const [contentZoom, setContentZoom] = useState(savedContentZoom);
  const [theme, setTheme] = useState(savedTheme);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--content-zoom", String(contentZoom));
    remember(CONTENT_ZOOM_KEY, String(contentZoom));
  }, [contentZoom]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // When you last looked at each thread. One you haven't opened counts as seen when the data finished loading,
  // except the sample's unread ones; activity by others after that, live or caught up, shows as unread.
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
  const nowMs = useNow(60_000);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const inbox = buildInbox(threads, me, people, nowMs);
  const seenAt = (thread: Thread): number =>
    lastSeen[thread.id] ?? (UNREAD_THREAD_IDS.includes(thread.id) ? 0 : client.readyAtMs);
  const unreadIds = new Set(
    threads
      .filter(
        (thread) =>
          thread.id !== activeThreadId && lastActivityByOthers(thread, me) > seenAt(thread),
      )
      .map((thread) => thread.id),
  );

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
    remember(viewerKey(source), person.id);
    setViewerId(person.id);
    setLastSeen({
      ...Object.fromEntries(threads.map((thread) => [thread.id, thread.updatedAtMs])),
      ...Object.fromEntries(groups.map((group) => [group.id, group.updatedAtMs])),
    });
  };

  // Opening a thread marks it, and the one you're leaving, as seen.
  const openThread = (id: string | null): void => {
    const now = Date.now();
    setLastSeen((current) => ({
      ...current,
      ...(activeThreadId === null ? {} : { [activeThreadId]: now }),
      ...(id === null ? {} : { [id]: now }),
    }));
    setActiveThreadId(id);
    setDraftId(null);
    setProfileOpen(false);
    setPage(null);
    // A thread opened as the main one leaves the split view.
    if (id !== null && id === splitThreadId) setSplitThreadId(null);
  };
  // Your profile and the org take the thread's place in the main area.
  const openProfile = (): void => {
    openThread(null);
    setProfileOpen(true);
  };
  // Settings, likewise.
  const [page, setPage] = useState<SidebarPage | null>(null);
  const openPage = (next: SidebarPage): void => {
    openThread(null);
    setPage(next);
  };
  // A label's threads; for a group's label, the group's page, which also counts as having seen it.
  const openLabel = (labelId: string): void => {
    openPage({ label: labelId });
    const group = groups.find((candidate) => candidate.labelId === labelId);
    if (group !== undefined) setLastSeen((current) => ({ ...current, [group.id]: Date.now() }));
  };
  // Someone's profile; your own is the profile and org.
  const openPerson = (personId: string): void => {
    if (personId === me.id) openProfile();
    else openPage({ person: personId });
  };
  const openSprint = (sprintId: string): void => openPage({ sprint: sprintId });
  // Starts the next sprint in a group (`nextSprint`), with any threads to carry over, and opens it.
  const startSprint = (group: Group, threadIds: string[]): void => {
    const next = nextSprint(sprintsOf(sprints, group.id), Date.now());
    openSprint(client.createSprint(group.id, next.name, next, threadIds, me));
  };
  const toggleSidebar = (): void => setSidebarOpen((open) => !open);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [renamingOrganization, setRenamingOrganization] = useState(false);
  const organization = client.organization;
  const shownLabelId =
    page !== null && typeof page === "object" && "label" in page ? page.label : null;
  const shownPerson =
    page !== null && typeof page === "object" && "person" in page
      ? people.find((person) => person.id === page.person)
      : undefined;
  // A sprint's page, with the group it's in.
  const shownSprint =
    page !== null && typeof page === "object" && "sprint" in page
      ? sprints.find((sprint) => sprint.id === page.sprint)
      : undefined;
  const sprintGroup = groups.find((group) => group.id === shownSprint?.groupId);
  const shownGroup = groups.find((group) => group.labelId === shownLabelId);
  // A group's label comes back from the server just after the group, so go by the group until then.
  const shownLabel: Label | undefined =
    labels.find((label) => label.id === shownLabelId) ??
    (shownGroup === undefined
      ? undefined
      : {
          id: shownGroup.labelId,
          name: shownGroup.name,
          groupId: shownGroup.id,
          createdById: shownGroup.createdById,
          createdAtMs: shownGroup.createdAtMs,
        });
  // The label a thread made from this page starts with: the group's or label's, or a sprint's group's, which it needs
  // to go in the sprint.
  const pageLabel = shownLabel ?? labels.find((label) => label.id === sprintGroup?.labelId);

  // Starting a thread opens the new-thread panel.
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  // The open sprint it was started from, which it goes into.
  const [newThreadSprintId, setNewThreadSprintId] = useState<string | null>(null);
  const openNew = (sprintId: string | null = null): void => {
    setSearchOpen(false);
    setNewThreadSprintId(sprintId);
    setNewThreadOpen(true);
  };

  // The panel's title and description make the thread. It appears at once and syncs in the background.
  const createThread = (draft: NewThreadDraft): void => {
    setNewThreadOpen(false);
    const threadId = client.createThread(draft, me);
    // Made from a sprint, it goes in it in the same batch, as long as it kept the group's label: only the group's
    // threads go in its sprints.
    const sprint = sprints.find((candidate) => candidate.id === newThreadSprintId);
    const group = groups.find((candidate) => candidate.id === sprint?.groupId);
    if (
      sprint !== undefined &&
      !sprint.closed &&
      group !== undefined &&
      draft.labelNames.some((name) => labelSlug(name) === group.labelId)
    )
      client.updateSprint(sprint.id, { threadIds: [...sprint.threadIds, threadId] }, me);
    openThread(threadId);
  };

  // ⌘⇧N: a new thread written as one message, drafted by the model (`ComposePanel`). The first person asked has it;
  // each ask is a message sent to its people, which puts the thread in their inboxes, sorted by what they were asked.
  // A saved draft opens in the same panel, and leaves the drafts once it's sent.
  const [composeOpen, setComposeOpen] = useState(false);
  const [composing, setComposing] = useState<SavedDraft | null>(null);
  const drafts = useDrafts(source);
  const openCompose = (draft: SavedDraft | null): void => {
    setSearchOpen(false);
    setNewThreadOpen(false);
    setComposing(draft);
    setComposeOpen(true);
  };
  const saveDraft = (draft: SavedDraft): void => {
    drafts.save(draft);
    setComposeOpen(false);
  };
  // A draft opened from the sidebar takes the thread's place in the main area (`DraftView`).
  const [draftId, setDraftId] = useState<string | null>(null);
  const openDraft = (draft: SavedDraft): void => {
    openThread(null);
    setDraftId(draft.id);
  };
  const shownDraft = drafts.drafts.find((draft) => draft.id === draftId);
  // Sends a draft, from the panel or a draft's page, and drops it from the drafts.
  const composeThread = (draft: ComposeDraft, fromDraftId: string | null): void => {
    setComposeOpen(false);
    if (fromDraftId !== null) drafts.remove(fromDraftId);
    const threadId = client.createThread({ title: draft.title, description: draft.context }, me);
    // Each ask opens with its people's and groups' @mentions, so it reads "@Amara Can you review this CR?". The server
    // assigns the thread to everyone mentioned, and to each group through its label; each is sent their ask (a group's
    // members as they are now), so it's in their inboxes.
    for (const ask of draft.asks)
      client.addEntry(
        threadId,
        "message",
        [...ask.personIds.map(mentionToken), ask.text].join(" "),
        me,
        undefined,
        recipientsOf(ask.personIds, people, groups, me),
      );
    openThread(threadId);
  };

  // Your buckets, edited from the inbox and saved to your profile as a whole list. A thread placed by hand stays put.
  const buckets = bucketsOf(me);
  const [editingBucket, setEditingBucket] = useState<Bucket | "new" | null>(null);
  const saveBuckets = (next: Bucket[]): void => client.updatePerson({ buckets: next }, me);
  const placeIn = (threadId: string, bucketId: string | null): void =>
    client.updateThread(threadId, { bucketId }, me);
  const bucketActions: BucketActions = {
    onNew: () => setEditingBucket("new"),
    onEdit: (bucket) => setEditingBucket(bucket),
    onMove: (bucketId, by) => {
      const from = buckets.findIndex((bucket) => bucket.id === bucketId);
      const next = [...buckets];
      const [moved] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, from + by)), 0, moved);
      saveBuckets(next);
    },
    onDelete: (bucketId) => saveBuckets(buckets.filter((bucket) => bucket.id !== bucketId)),
    onPlace: (threadId, bucketId) => placeIn(threadId, bucketId),
  };
  const saveBucket = (name: string, description: string): void => {
    const editing = editingBucket;
    setEditingBucket(null);
    if (editing === null) return;
    saveBuckets(
      editing === "new"
        ? [...buckets, { id: crypto.randomUUID(), name, description }]
        : buckets.map((bucket) =>
            bucket.id === editing.id ? { ...bucket, name, description } : bucket,
          ),
    );
  };

  // ⌘K (or ⌘⇧F) opens search; ⌘N starts a thread, matching the shortcut search shows for it; ⌘U picks who to view as;
  // ⌘+, ⌘- and ⌘0 zoom the main content.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
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
        setSearchOpen(false);
        setNewThreadOpen(false);
        setViewAsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Superhuman's keys for the inbox, never with a dialog open: ⌘E marks the open thread done, even from the reply; then,
  // without a modifier and not while typing, J/K open the next or previous thread, H snoozes it, R puts the cursor in
  // the reply, and Escape leaves the reply so the keys work again. Set each render so it sees the current state.
  const inboxKeysRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => inboxKeysRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The thread open beside the main one, from clicking a thread link.
  const [splitThreadId, setSplitThreadId] = useState<string | null>(null);
  const splitThread =
    splitThreadId === activeThreadId
      ? undefined
      : threads.find((thread) => thread.id === splitThreadId);
  const threadLinks: ThreadLinks = {
    titleOf: (threadId) => threads.find((thread) => thread.id === threadId)?.title,
    // People by id, groups by `group:<id>`.
    nameOf: (target) =>
      target.startsWith(GROUP_TARGET)
        ? groups.find((group) => groupTarget(group.id) === target)?.name
        : people.find((person) => person.id === target)?.name,
    people,
    threads,
    labels,
    groups,
    open: (threadId) => setSplitThreadId(threadId === activeThreadId ? null : threadId),
    openPerson,
    search: (query) => {
      const needle = query.toLowerCase();
      return threads
        .filter((thread) => thread.title.toLowerCase().includes(needle))
        .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs)
        .map(({ id, title }) => ({ id, title }));
    },
  };

  // A branch is an ordinary thread that remembers where it came from, between the same people: you ask whoever
  // you're talking to in the parent (`with`, or the first other person on it).
  const createBranch = (
    from: Thread,
    title: string,
    withPerson?: Person,
    movedEntryIds?: string[],
  ): string => {
    const others = [withPerson, ...participants(from)].filter(
      (person): person is Person => person !== undefined && person !== null && person.id !== me.id,
    );
    return client.createThread(
      {
        title,
        description: "",
        assignees: [...new Map(others.map((person) => [person.id, person])).values()],
        branchedFromId: from.id,
        movedEntryIds,
      },
      me,
    );
  };

  // `/blocked`: the thread the form is for while it's open, and the new thread asking someone for what it needs,
  // which blocks it until it closes.
  const [blocking, setBlocking] = useState<Thread | null>(null);
  const createBlocker = (
    from: Thread,
    person: Person,
    title: string,
    description: string,
  ): void => {
    client.createThread(
      {
        title,
        description,
        assignees: [person],
        branchedFromId: from.id,
        blocksId: from.id,
      },
      me,
    );
    setBlocking(null);
  };

  // Messages on their way out of a thread, while you pick where they go.
  const [moving, setMoving] = useState<{ from: Thread; messages: MessageEntry[] } | null>(null);
  const moveTo = (target: MoveTarget): void => {
    if (moving === null) return;
    const { from, messages } = moving;
    const ids = messages.map((message) => message.id);
    const threadId =
      target.kind === "thread"
        ? target.threadId
        : createBranch(
            from,
            target.title,
            messages.find((m) => m.author.id !== me.id)?.author,
            ids,
          );
    if (target.kind === "thread") client.moveMessages(ids, threadId, me);
    setMoving(null);
    setSplitThreadId(threadId === activeThreadId ? null : threadId);
  };

  // After you close a thread of yours, the next one in your inbox opens: the one after it, else the first. In the
  // split view, just the split closes.
  const moveOn = (thread: Thread): void => {
    if (thread.id === splitThreadId) {
      setSplitThreadId(null);
      return;
    }
    const at = inbox.order.findIndex((candidate) => candidate.id === thread.id);
    const next = [...inbox.order.slice(at + 1), ...inbox.order.slice(0, Math.max(0, at))].find(
      (candidate) => candidate.id !== thread.id && candidate.id !== splitThreadId,
    );
    openThread(next?.id ?? null);
  };

  // A change just made from the inbox, which Undo takes back for a few seconds.
  const [undo, setUndo] = useState<{ text: string; run: () => void } | null>(null);
  useEffect(() => {
    if (undo === null) return;
    const timer = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(timer);
  }, [undo]);

  // ⌘E: done with it, for you. It never closes the thread, which is always by hand (/close, the
  // status, right-click), so nobody's ask is closed under them. The next thread in your inbox opens.
  const markDone = (thread: Thread): void => {
    moveOn(thread);
    client.updateThread(thread.id, { done: true }, me);
    setUndo({ text: "Done", run: () => client.updateThread(thread.id, { done: false }, me) });
  };

  // H: out of your inbox until 9 tomorrow morning.
  const snooze = (thread: Thread): void => {
    const until = new Date(nowMs + 24 * 60 * 60_000);
    until.setHours(9, 0, 0, 0);
    moveOn(thread);
    client.updateThread(thread.id, { snoozeUntilMs: until.getTime() }, me);
    setUndo({
      text: "Snoozed until tomorrow",
      run: () => client.updateThread(thread.id, { snoozeUntilMs: null }, me),
    });
  };

  // Every change is a transaction: applied here at once, then sent to the server, which records property changes
  // as activity lines that sync back. Each open thread (main or split) gets its own actions.
  // The menu for a thread right-clicked in a list: open it here or beside the one you're in, move it to another of
  // your buckets, close or reopen it, archive or unarchive it.
  const [threadMenu, setThreadMenu] = useState<{ x: number; y: number; thread: Thread } | null>(
    null,
  );
  const openThreadMenu = (event: React.MouseEvent, thread: Thread): void => {
    event.preventDefault();
    setThreadMenu({ x: event.clientX, y: event.clientY, thread });
  };
  const threadMenuItems = (thread: Thread): ContextMenuItem[] => {
    const setStatus = actionsFor(thread).onSetStatus;
    const items: ContextMenuItem[] = [{ label: "Open", run: () => openThread(thread.id) }];
    if (activeThreadId !== null && activeThreadId !== thread.id)
      items.push({ label: "Open beside", run: () => setSplitThreadId(thread.id) });
    items.push("separator");
    if (inboxReason(thread, me.id, nowMs) !== null) {
      items.push(
        { label: "Done", shortcut: "⌘E", run: () => markDone(thread) },
        { label: "Snooze until tomorrow", shortcut: "H", run: () => snooze(thread) },
        "separator",
      );
      const current = thread.triage[me.id] ?? null;
      for (const bucket of buckets)
        if (bucket.id !== current?.bucketId)
          items.push({ label: `Move to ${bucket.name}`, run: () => placeIn(thread.id, bucket.id) });
      if (current?.manual)
        items.push({ label: "Sort it for me", run: () => placeIn(thread.id, null) });
      items.push("separator");
    }
    // The open sprints of your groups that it's in, or could join: only a group's threads go in its sprints, each in
    // one open sprint of the group at a time.
    const sprintItems: ContextMenuItem[] = groups.flatMap((group) => {
      if (!group.memberIds.includes(me.id) || !thread.labelIds.includes(group.labelId)) return [];
      const groupSprints = sprintsOf(sprints, group.id);
      const current = openSprintWith(groupSprints, thread.id);
      if (current !== undefined)
        return [
          {
            label: `Remove from ${current.name}`,
            run: () =>
              client.updateSprint(
                current.id,
                { threadIds: current.threadIds.filter((id) => id !== thread.id) },
                me,
              ),
          },
        ];
      if (isDone(thread.status)) return [];
      return groupSprints
        .filter((sprint) => !sprint.closed)
        .map((sprint) => ({
          label: `Add to ${sprint.name}${groups.length > 1 ? ` (${group.name})` : ""}`,
          run: () =>
            client.updateSprint(sprint.id, { threadIds: [...sprint.threadIds, thread.id] }, me),
        }));
    });
    if (sprintItems.length > 0) items.push(...sprintItems, "separator");
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

  const actionsFor = (thread: Thread): ThreadActions => {
    const edit = (changes: ThreadChanges): void => client.updateThread(thread.id, changes, me);
    return {
      // Enter sends to people, into their inbox; with nobody to send to, it's a note in the thread.
      onNote: (text) => client.addEntry(thread.id, "message", text, me),
      // Whoever it @mentions is assigned the thread, and a group through its label (the server's doing).
      onSend: (text, to) => client.addEntry(thread.id, "message", text, me, undefined, to),
      onBlocked: () => setBlocking(thread),
      onTask: () => {
        // The latest thing someone sent you here, if anything; else the thread itself.
        const question = lastSentTo(thread, me.id);
        const asked = question
          ? plainThreadLinks(
              withoutLeadingMentions(question.text),
              threadLinks.titleOf,
              threadLinks.nameOf,
            ).trim()
          : "";
        const title = (asked.split("\n")[0] || `Follow up: ${thread.title}`).slice(0, 80);
        const taskId = client.createThread(
          {
            title,
            description: question ? `${question.author.name}: “${asked}”` : "",
            assignees: [me],
            branchedFromId: thread.id,
          },
          me,
        );
        // Saying so where you were asked, sent to whoever asked, lets them know.
        client.addEntry(
          thread.id,
          "message",
          `Taking this on in ${threadLink(taskId)}`,
          me,
          undefined,
          question === undefined ? [] : [question.author],
        );
        setSplitThreadId(taskId);
      },
      // Closing something in your inbox finishes it there, so the next thread opens.
      onSetStatus: (status) => {
        if (isDone(status) && inboxReason(thread, me.id, nowMs) !== null) moveOn(thread);
        edit({ status });
      },
      onSetPriority: (priority) => edit({ priority }),
      onSetDue: (dueAtMs) => edit({ dueAtMs }),
      onSetEffort: (effortHours) => edit({ effortHours }),
      onToggleLabel: (label) => {
        const labelId = client.ensureLabel(label.name, me);
        edit({
          labelIds: thread.labelIds.includes(labelId)
            ? thread.labelIds.filter((id) => id !== labelId)
            : [...thread.labelIds, labelId],
        });
      },
      onSetBucket: (bucketId) => placeIn(thread.id, bucketId),
      onBranch: (title) => createBranch(thread, title),
      onMoveMessages: (messages) => setMoving({ from: thread, messages }),
    };
  };

  inboxKeysRef.current = (event) => {
    const key = event.key.toLowerCase();
    const order = inbox.order;
    const at = order.findIndex((thread) => thread.id === activeThreadId);
    const inInbox = activeThread !== undefined && at !== -1;
    const dialogOpen = (): boolean =>
      searchOpen ||
      newThreadOpen ||
      composeOpen ||
      viewAsOpen ||
      editingBucket !== null ||
      blocking !== null ||
      moving !== null ||
      newGroupOpen ||
      renamingOrganization ||
      organization?.name === "" ||
      threadMenu !== null ||
      document.querySelector(".chip-menu, .context-menu, .thread-menu") !== null;
    // ⌘E: done with it, for you. It works from the reply too, so you can answer and move on.
    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === "e") {
      if (!inInbox || dialogOpen()) return;
      event.preventDefault();
      markDone(activeThread);
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
    } else if (key === "h" && inInbox) snooze(activeThread);
    else if (key === "r" && activeThread !== undefined)
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

  if (client.status !== "ready")
    return (
      <>
        <div aria-hidden className="titlebar" />
        <div className="app-status">
          {client.status === "waiting" ? (
            <div className="app-status-body">
              <div>
                Waiting for the {SOURCE_LABELS[source]} API at {serverFor(source).url}
                {source === "cloudflare" ? "" : " (vp run api#dev)"}… {client.error ?? ""}
              </div>
              {/* A way out while that server can't be reached. */}
              <div className="app-status-actions">
                {(["cloudflare", "local", "sample"] as const)
                  .filter(
                    (option) =>
                      option !== source && (option !== "cloudflare" || CLOUDFLARE_AVAILABLE),
                  )
                  .map((option, index) => (
                    <button
                      key={option}
                      type="button"
                      className="app-status-button"
                      autoFocus={index === 0}
                      onClick={() => switchSource(option)}
                    >
                      Use {SOURCE_LABELS[option]} Data
                    </button>
                  ))}
              </div>
            </div>
          ) : (
            "Loading…"
          )}
        </div>
      </>
    );

  return (
    <MeContext value={me}>
      <ThreadLinksContext value={threadLinks}>
        <ThreadMenuContext value={openThreadMenu}>
          <div aria-hidden className="titlebar" />
          <DragRegionResync />
          {sidebarOpen && (
            <Sidebar
              inbox={inbox}
              drafts={drafts.drafts}
              activeDraftId={shownDraft?.id ?? null}
              onOpenDraft={openDraft}
              onDeleteDraft={(id) => {
                drafts.remove(id);
                if (id === draftId) setDraftId(null);
              }}
              bucketActions={bucketActions}
              activity={activityFor(threads, me, seenAt, nowMs)}
              groupNotices={groupNoticesFor(
                groups,
                people,
                me,
                (group) => lastSeen[group.id] ?? client.readyAtMs,
                nowMs,
              )}
              groups={groupsFor(groups, me)}
              labels={labels}
              threads={threads}
              onNewGroup={() => setNewGroupOpen(true)}
              onOpenLabel={openLabel}
              onMarkAllRead={() => {
                const now = Date.now();
                setLastSeen((current) => ({
                  ...current,
                  ...Object.fromEntries(threads.map((thread) => [thread.id, now])),
                  ...Object.fromEntries(groups.map((group) => [group.id, now])),
                }));
              }}
              nowMs={nowMs}
              unreadIds={unreadIds}
              activeThreadId={activeThreadId}
              profileOpen={profileOpen}
              onNewThread={() => openNew()}
              onOpenThread={openThread}
              onToggleProfile={() => (profileOpen ? setProfileOpen(false) : openProfile())}
              onToggle={toggleSidebar}
              onSearch={() => setSearchOpen(true)}
              page={page}
              onOpenPage={openPage}
            />
          )}
          <main className="main">
            <div className="topbar main-topbar" data-sidebar-open={sidebarOpen}>
              {!sidebarOpen && (
                <>
                  <SidebarToggle open={false} onToggle={toggleSidebar} />
                  <SearchButton onSearch={() => setSearchOpen(true)} />
                </>
              )}
              <span className="topbar-title">
                {profileOpen
                  ? me.name
                  : page === "settings"
                    ? "Settings"
                    : page === "all"
                      ? "All threads"
                      : (shownSprint?.name ??
                        shownPerson?.name ??
                        shownLabel?.name ??
                        activeThread?.title ??
                        (shownDraft === undefined
                          ? undefined
                          : shownDraft.draft?.title || "Draft"))}
              </span>
              <span className="topbar-end">
                <button
                  type="button"
                  className="view-as-button"
                  aria-label={`Viewing as ${me.name}. Switch user`}
                  onClick={() => setViewAsOpen(true)}
                >
                  <span className="view-as-source">
                    {SOURCE_LABELS[source]}
                    {client.connected ? "" : " · Offline"}
                  </span>
                  <Identicon seed={me.id} size={14} />
                  <span>{me.name}</span>
                </button>
                <WipeButton onWipe={() => client.wipe()} />
                <DetailsToggle
                  open={detailsOpen}
                  onToggle={() => setDetailsOpen((open) => !open)}
                />
              </span>
            </div>
            {/* A change the server refused has already been undone, so say so rather than letting it vanish. */}
            {client.error !== null && (
              <div className="save-error" role="alert">
                <span>
                  That change wasn't saved: {client.error.split("\n")[0].replace(/^✖\s*/, "")}.
                  {source === "cloudflare" && " The hosted API may need a deploy."}
                </span>
                <button
                  type="button"
                  className="save-error-dismiss"
                  aria-label="Dismiss"
                  onClick={() => client.dismissError()}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden />
                </button>
              </div>
            )}
            {profileOpen ? (
              <ProfileView
                people={people}
                me={me}
                threads={threads}
                nowMs={nowMs}
                organizationName={organization?.name ?? ""}
                onRenameOrganization={
                  organization === undefined ? null : () => setRenamingOrganization(true)
                }
                onOpenPerson={openPerson}
              />
            ) : page === "settings" ? (
              <SettingsView me={me} people={people} />
            ) : shownPerson !== undefined ? (
              <PersonView
                key={shownPerson.id}
                person={shownPerson}
                me={me}
                people={people}
                threads={threads}
                groups={groups}
                unreadIds={unreadIds}
                onOpenPerson={openPerson}
                onOpenLabel={openLabel}
                onNewThread={() => openNew()}
                onOpenThread={openThread}
              />
            ) : shownSprint !== undefined && sprintGroup !== undefined ? (
              <SprintView
                key={shownSprint.id}
                sprint={shownSprint}
                group={sprintGroup}
                threads={threads}
                people={people}
                me={me}
                nowMs={nowMs}
                unreadIds={unreadIds}
                groupSprints={sprintsOf(sprints, sprintGroup.id)}
                onUpdate={(changes) => client.updateSprint(shownSprint.id, changes, me)}
                onStartNext={(threadIds) => startSprint(sprintGroup, threadIds)}
                onOpenGroup={() => openLabel(sprintGroup.labelId)}
                onOpenPerson={openPerson}
                onNewThread={() => openNew(shownSprint.id)}
                onOpenThread={openThread}
                // Straight to the thread: from the board you stay on the board, rather than moving on through your inbox.
                onSetStatus={(thread, status) => client.updateThread(thread.id, { status }, me)}
              />
            ) : page === "all" || shownLabel !== undefined ? (
              <LabelView
                key={shownLabel?.id ?? "all"}
                label={shownLabel ?? null}
                group={shownGroup}
                threads={threads}
                people={people}
                labels={labels}
                me={me}
                nowMs={nowMs}
                unreadIds={unreadIds}
                onUpdateGroup={(changes) => {
                  if (shownGroup !== undefined) client.updateGroup(shownGroup.id, changes, me);
                }}
                sprints={shownGroup === undefined ? [] : sprintsOf(sprints, shownGroup.id)}
                onOpenSprint={openSprint}
                onNewSprint={() => {
                  if (shownGroup !== undefined) startSprint(shownGroup, []);
                }}
                // Straight to the thread: from the board you stay on the board, rather than moving on through your inbox.
                onSetStatus={(thread, status) => client.updateThread(thread.id, { status }, me)}
                onNewThread={() => openNew()}
                onOpenThread={openThread}
                onOpenPerson={openPerson}
              />
            ) : shownDraft !== undefined ? (
              <DraftView
                key={shownDraft.id}
                saved={shownDraft}
                targets={targetsFor(people, groups, me)}
                nowMs={nowMs}
                onChange={drafts.save}
                onSend={(draft) => composeThread(draft, shownDraft.id)}
                onDelete={() => {
                  drafts.remove(shownDraft.id);
                  setDraftId(null);
                }}
              />
            ) : activeThread === undefined ? null : (
              <div className="thread-panes">
                <ThreadView
                  key={activeThread.id}
                  thread={activeThread}
                  people={people}
                  actions={actionsFor(activeThread)}
                  autoFocusReply={inboxReason(activeThread, me.id, nowMs) === null}
                />
                {splitThread !== undefined && (
                  <section className="split-pane" aria-label={splitThread.title}>
                    <div className="split-pane-bar">
                      <span className="split-pane-title">{splitThread.title}</span>
                      <button
                        type="button"
                        className="topbar-button"
                        aria-label="Open as the main thread"
                        onClick={() => openThread(splitThread.id)}
                      >
                        <HugeiconsIcon icon={ArrowExpand01Icon} size={13} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="topbar-button"
                        aria-label="Close"
                        onClick={() => setSplitThreadId(null)}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden />
                      </button>
                    </div>
                    <ThreadView
                      key={splitThread.id}
                      thread={splitThread}
                      people={people}
                      actions={actionsFor(splitThread)}
                    />
                  </section>
                )}
              </div>
            )}
            {undo !== null && (
              <div className="undo-toast" role="status">
                <span>{undo.text}</span>
                <button
                  type="button"
                  onClick={() => {
                    undo.run();
                    setUndo(null);
                  }}
                >
                  Undo
                </button>
              </div>
            )}
          </main>
          {detailsOpen && (
            <DetailsPanel
              thread={activeThread}
              nowMs={nowMs}
              onOpenThread={openThread}
              onOpenLabel={openLabel}
            />
          )}
          {composeOpen && (
            <ComposePanel
              key={composing?.id ?? "new"}
              targets={targetsFor(people, groups, me)}
              me={me}
              initial={composing}
              draftWith={(request, signal) => composeDraft(source, request, signal)}
              onCreate={(draft) => composeThread(draft, composing?.id ?? null)}
              onSaveDraft={saveDraft}
              onClose={() => setComposeOpen(false)}
            />
          )}
          {newThreadOpen && (
            <NewThreadPalette
              people={people}
              me={me}
              labels={selectableLabels(labels, groups)}
              // Made from a group or label's page, a thread starts with that label.
              initialLabels={pageLabel === undefined ? [] : [pageLabel]}
              // Made from someone's profile, it's for them.
              initialAssignee={shownPerson ?? null}
              onCreate={createThread}
              onClose={() => setNewThreadOpen(false)}
            />
          )}
          {editingBucket !== null && (
            <BucketPalette
              bucket={editingBucket === "new" ? null : editingBucket}
              onSave={saveBucket}
              onClose={() => setEditingBucket(null)}
            />
          )}
          {newGroupOpen && (
            <NewGroupPalette
              people={people}
              me={me}
              labels={labels}
              onCreate={(name, members) => {
                setNewGroupOpen(false);
                client.createGroup(name, members, me);
                openPage({ label: labelSlug(name) });
              }}
              onClose={() => setNewGroupOpen(false)}
            />
          )}
          {(organization?.name === "" || renamingOrganization) && (
            <OrganizationPrompt
              current={organization?.name ?? ""}
              onSave={(name) => {
                client.renameOrganization(name, me);
                setRenamingOrganization(false);
              }}
              onClose={() => setRenamingOrganization(false)}
            />
          )}
          {blocking !== null && (
            <BlockedPalette
              people={people}
              me={me}
              blockedTitle={blocking.title}
              onCreate={(person, title, description) =>
                createBlocker(blocking, person, title, description)
              }
              onClose={() => setBlocking(null)}
            />
          )}
          {moving !== null && (
            <MovePalette
              count={moving.messages.length}
              fromThreadId={moving.from.id}
              linkedThreadIds={moving.messages.flatMap((message) =>
                splitThreadLinks(message.text).flatMap((part) =>
                  "threadId" in part ? [part.threadId] : [],
                ),
              )}
              suggestedTitle={plainThreadLinks(
                moving.messages[0].text.split("\n")[0],
                threadLinks.titleOf,
                threadLinks.nameOf,
              ).slice(0, 80)}
              onMove={moveTo}
              onClose={() => setMoving(null)}
            />
          )}
          {searchOpen && (
            <CommandPalette
              threads={threads}
              source={source}
              me={me}
              onSwitchSource={switchSource}
              theme={theme}
              onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              onViewAs={() => {
                setSearchOpen(false);
                setViewAsOpen(true);
              }}
              onOpenProfile={openProfile}
              people={people}
              onOpenPerson={openPerson}
              labels={labels}
              onOpenLabel={openLabel}
              sprints={groups.flatMap((group) =>
                sprintsOf(sprints, group.id).map((sprint) => ({
                  id: sprint.id,
                  label: `${group.name} › ${sprint.name}`,
                })),
              )}
              onOpenSprint={openSprint}
              onNewGroup={() => {
                setSearchOpen(false);
                setNewGroupOpen(true);
              }}
              onNewThread={openNew}
              onOpenThread={openThread}
              onClose={() => setSearchOpen(false)}
            />
          )}
          {viewAsOpen && (
            <ViewAsPalette
              people={people}
              me={me}
              onPick={viewAs}
              onClose={() => setViewAsOpen(false)}
            />
          )}
          <MentionToasts threads={threads} me={me} sinceMs={client.readyAtMs} onOpen={openThread} />
          {threadMenu !== null && (
            <ContextMenu
              x={threadMenu.x}
              y={threadMenu.y}
              items={threadMenuItems(threadMenu.thread)}
              onClose={() => setThreadMenu(null)}
            />
          )}
        </ThreadMenuContext>
      </ThreadLinksContext>
    </MeContext>
  );
});

export default App;
