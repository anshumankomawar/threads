import { useContext, useEffect, useRef, useState } from "react";
import {
  NewThreadPalette,
  type NewThreadDraft,
  type NewThreadKind,
} from "./components/NewThreadPalette";
import { CommandPalette } from "./components/CommandPalette";
import { DetailsPanel } from "./components/DetailsPanel";
import {
  DetailsToggle,
  SearchButton,
  Sidebar,
  SidebarToggle,
  type SidebarPage,
} from "./components/Sidebar";
import {
  isDone,
  labelSlug,
  plainThreadLinks,
  splitThreadLinks,
  UNREAD_THREAD_IDS,
  type Label,
  type Person,
  type Thread,
  type ThreadChanges,
  waitingOn,
  mentionsIn,
  threadLink,
  withoutLeadingMentions,
} from "model";
import { observer } from "mobx-react-lite";
import {
  CLOUDFLARE_AVAILABLE,
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
import { ProfileView } from "./components/ProfileView";
import { LabelView } from "./components/LabelView";
import { ListPage } from "./components/ListPage";
import { NewGroupPalette } from "./components/NewGroupPalette";
import { OrganizationPrompt } from "./components/OrganizationPrompt";
import { groupNoticesFor, groupsFor, selectableLabels } from "./groups";
import { SettingsView } from "./components/SettingsView";
import { ViewAsPalette } from "./components/ViewAsPalette";
import { buildDay, homeDayMs, upNext } from "./inbox";
import { conversationsFor, isUnread } from "./conversations";
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

// Wipes every thread and schedule in the current workspace, keeping people and the org: the first click asks, the
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
      aria-label="Wipe all threads and schedules"
      title="Wipe all threads and schedules (people and the org stay)"
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
  const [viewerId, setViewerId] = useState<string | null>(() => savedViewer(savedSource()));
  const fallbackMe = useContext(MeContext);
  // You view the app as the chosen person, or the first person in the data until you pick one.
  const me = people.find((person) => person.id === viewerId) ?? people[0] ?? fallbackMe;
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const [contentZoom, setContentZoom] = useState(savedContentZoom);

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
  // The day the schedule shows, as days from today, or on a weekend from Monday (the next day anything is scheduled).
  const [dayOffset, setDayOffset] = useState(0);
  const shownDay = new Date(homeDayMs(nowMs));
  shownDay.setDate(shownDay.getDate() + dayOffset);
  const day = buildDay(threads, me, people, nowMs, shownDay.getTime());
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

  // Opening a thread marks it, and the one you're leaving, as seen. A conversation opens beside the thread it's in.
  const openThread = (id: string | null): void => {
    const conversation = threads.find(
      (thread) => thread.id === id && thread.kind === "conversation",
    );
    if (conversation?.branchedFromId) {
      openThread(conversation.branchedFromId);
      setSplitThreadId(conversation.id);
      return;
    }
    const now = Date.now();
    setLastSeen((current) => ({
      ...current,
      ...(activeThreadId === null ? {} : { [activeThreadId]: now }),
      ...(id === null ? {} : { [id]: now }),
    }));
    setActiveThreadId(id);
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
  // The lists behind the sidebar's counts (inbox, waiting, questions for you), likewise.
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
  const toggleSidebar = (): void => setSidebarOpen((open) => !open);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [renamingOrganization, setRenamingOrganization] = useState(false);
  const organization = client.organization;
  const shownLabelId = page !== null && typeof page === "object" ? page.label : null;
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

  // Starting a thread opens the new-thread panel on the chosen kind.
  const [newThreadKind, setNewThreadKind] = useState<NewThreadKind | null>(null);
  const openNew = (kind: NewThreadKind = "response"): void => {
    setSearchOpen(false);
    setNewThreadKind(kind);
  };

  // The panel's title and description make the thread. It appears at once and syncs in the background.
  const createThread = (draft: NewThreadDraft): void => {
    setNewThreadKind(null);
    openThread(client.createThread(draft, me));
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
        setNewThreadKind(null);
        setViewAsOpen(true);
      }
    };
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
    nameOf: (personId) => people.find((person) => person.id === personId)?.name,
    people,
    threads,
    labels,
    groups,
    open: (threadId) => setSplitThreadId(threadId === activeThreadId ? null : threadId),
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
    const others = [withPerson, from.requester, from.assignee, ...from.attendees].filter(
      (person): person is Person => person !== undefined && person !== null && person.id !== me.id,
    );
    return client.createThread(
      {
        kind: "response",
        title,
        description: "",
        assignee: others[0] ?? null,
        invitees: [],
        schedule: null,
        branchedFromId: from.id,
        movedEntryIds,
      },
      me,
    );
  };

  // A conversation stays Unread while it's open and moves to Read once you click off it (open something else or close
  // it), so it doesn't jump between groups under you. Whoever wrote can tell it's been seen.
  const openConversation = [splitThread, activeThread].find(
    (thread) => thread?.kind === "conversation",
  )?.id;
  const conversationOpenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const left = conversationOpenRef.current;
    conversationOpenRef.current = openConversation;
    if (left === undefined || left === openConversation) return;
    const conversation = threads.find((thread) => thread.id === left);
    if (conversation !== undefined && isUnread(conversation, me.id))
      client.updateThread(left, { seen: true }, me);
  }, [openConversation, threads, client, me]);

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
        kind: "response",
        title,
        description,
        assignee: person,
        invitees: [],
        schedule: null,
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

  // After you close a thread of yours, the next thing on your agenda opens, or, with nothing left, the start view says
  // so. In the split view, just the split closes.
  const moveOn = (thread: Thread): void => {
    if (thread.id === splitThreadId) {
      setSplitThreadId(null);
      return;
    }
    // The next thing on your agenda, else anything of yours without time yet.
    const next = [
      ...upNext(threads, me, people, nowMs, 8).map((item) => item.thread),
      ...day.unplaced.map((item) => item.thread),
    ].find((candidate) => candidate.id !== thread.id && candidate.id !== splitThreadId);
    openThread(next?.id ?? null);
  };

  // Every change is a transaction: applied here at once, then sent to the server, which records property changes
  // as activity lines that sync back. Each open thread (main or split) gets its own actions.
  // The menu for a thread right-clicked in a list: open it here or beside the one you're in, close or reopen it,
  // archive or unarchive it.
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
    // Meetings have no status of their own to close; they can still be put away.
    if (thread.kind !== "meeting")
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
      onSend: (text) => {
        // Mentioning people in a thread starts a conversation with them, beside it; in a conversation it adds them.
        const mentioned = people.filter(
          (person) => person.id !== me.id && mentionsIn(text).includes(person.id),
        );
        if (thread.kind === "conversation" || mentioned.length === 0) {
          client.addEntry(thread.id, "message", text, me);
          return;
        }
        const said = plainThreadLinks(
          withoutLeadingMentions(text),
          threadLinks.titleOf,
          threadLinks.nameOf,
        ).trim();
        const firstLine = said.split("\n")[0];
        const conversationId = client.createThread(
          {
            kind: "conversation",
            title: (firstLine === ""
              ? `With ${mentioned.map((person) => person.name).join(", ")}`
              : firstLine.charAt(0).toUpperCase() + firstLine.slice(1)
            ).slice(0, 80),
            description: "",
            assignee: null,
            invitees: mentioned,
            schedule: null,
            branchedFromId: thread.id,
          },
          me,
        );
        client.addEntry(conversationId, "message", text, me);
        setSplitThreadId(conversationId);
      },
      onBlocked: () => setBlocking(thread),
      onTask: () => {
        // The latest message that asked you something, if there is one; else the thread itself.
        const question = thread.entries.findLast(
          (entry): entry is Extract<typeof entry, { kind: "message" }> =>
            entry.kind === "message" &&
            entry.author.id !== me.id &&
            mentionsIn(entry.text).includes(me.id),
        );
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
            kind: "response",
            title,
            description: question ? `${question.author.name}: “${asked}”` : "",
            assignee: me,
            invitees: [],
            schedule: null,
            branchedFromId: thread.id,
          },
          me,
        );
        // Saying so where you were asked lets them know.
        client.addEntry(thread.id, "message", `Taking this on in ${threadLink(taskId)}`, me);
        setSplitThreadId(taskId);
      },
      // Closing something in your inbox finishes it there, so the next thread opens.
      onSetStatus: (status) => {
        edit({ status });
        if (isDone(status) && waitingOn(thread) === me.id) moveOn(thread);
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
      onSetAssignee: (person) => edit({ assigneeId: person.id }),
      onSetRequester: (person) => edit({ requesterId: person.id }),
      onSetSchedule: (schedule) => edit({ schedule }),
      onBranch: (title) => createBranch(thread, title),
      onMoveMessages: (messages) => setMoving({ from: thread, messages }),
    };
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
              day={day}
              conversations={conversationsFor(threads, me)}
              splitThreadId={splitThread?.id ?? null}
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
              onShiftDay={(days) => setDayOffset((offset) => (days === null ? 0 : offset + days))}
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
                  : page === "unplaced"
                    ? "Not scheduled yet"
                    : page === "settings"
                      ? "Settings"
                      : (shownLabel?.name ?? activeThread?.title)}
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
                onWorkday={(workday) => client.updatePerson({ workday }, me)}
                onRenameOrganization={
                  organization === undefined ? null : () => setRenamingOrganization(true)
                }
              />
            ) : page === "unplaced" ? (
              <ListPage
                title="Not scheduled yet"
                items={day.unplaced}
                unreadIds={unreadIds}
                onOpenThread={openThread}
              />
            ) : page === "settings" ? (
              <SettingsView me={me} people={people} />
            ) : shownLabel !== undefined ? (
              <LabelView
                key={shownLabel.id}
                label={shownLabel}
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
                onNewThread={() => openNew()}
                onOpenThread={openThread}
              />
            ) : activeThread === undefined ? null : (
              <div className="thread-panes">
                <ThreadView
                  key={activeThread.id}
                  thread={activeThread}
                  people={people}
                  actions={actionsFor(activeThread)}
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
          </main>
          {detailsOpen && (
            <DetailsPanel
              thread={activeThread}
              nowMs={nowMs}
              onOpenThread={openThread}
              onOpenLabel={openLabel}
            />
          )}
          {newThreadKind !== null && (
            <NewThreadPalette
              initialKind={newThreadKind}
              people={people}
              me={me}
              nowMs={nowMs}
              labels={selectableLabels(labels, groups)}
              // Made from a group or label's page, a thread starts with that label.
              initialLabels={shownLabel === undefined ? [] : [shownLabel]}
              onCreate={createThread}
              onClose={() => setNewThreadKind(null)}
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
              onViewAs={() => {
                setSearchOpen(false);
                setViewAsOpen(true);
              }}
              onOpenProfile={openProfile}
              labels={labels}
              onOpenLabel={openLabel}
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
