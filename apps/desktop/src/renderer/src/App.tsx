import { useContext, useEffect, useRef, useState } from "react";
import { NewThreadPalette, type NewThreadDraft } from "./components/NewThreadPalette";
import { CommandPalette } from "./components/CommandPalette";
import { DetailsPanel } from "./components/DetailsPanel";
import { DetailsToggle, SearchButton, Sidebar, SidebarToggle } from "./components/Sidebar";
import {
  plainThreadLinks,
  splitThreadLinks,
  UNREAD_THREAD_IDS,
  type Person,
  type Thread,
  type ThreadChanges,
  type ThreadKind,
  waitingOn,
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
import { MeContext } from "./me";
import { ThreadLinksContext, type ThreadLinks } from "./threadLinks";
import { Maximize2, Trash2, X } from "lucide-react";
import { Identicon } from "./components/Identicon";
import { OrgView } from "./components/OrgView";
import { ViewAsPalette } from "./components/ViewAsPalette";
import { Welcome } from "./components/Welcome";
import { buildDay, upNext } from "./inbox";

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
      <Trash2 size={13} strokeWidth={1.7} aria-hidden />
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
  const [orgOpen, setOrgOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // When you last looked at each thread. One you haven't opened counts as seen when the data finished loading,
  // except the sample's unread ones; activity by others after that, live or caught up, shows as unread.
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
  const nowMs = useNow(60_000);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  // The day the schedule shows, as days from today.
  const [dayOffset, setDayOffset] = useState(0);
  const shownDay = new Date(nowMs);
  shownDay.setHours(0, 0, 0, 0);
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
    setLastSeen(Object.fromEntries(threads.map((thread) => [thread.id, thread.updatedAtMs])));
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
    setOrgOpen(false);
    // A thread opened as the main one leaves the split view.
    if (id !== null && id === splitThreadId) setSplitThreadId(null);
  };
  // The org view takes the thread's place in the main area.
  const openOrg = (): void => {
    openThread(null);
    setOrgOpen(true);
  };
  const toggleSidebar = (): void => setSidebarOpen((open) => !open);

  // Starting a thread opens the new-thread panel on the chosen kind.
  const [newThreadKind, setNewThreadKind] = useState<ThreadKind | null>(null);
  const openNew = (kind: ThreadKind = "response"): void => {
    setSearchOpen(false);
    setNewThreadKind(kind);
  };

  // The panel's text becomes the opening message (and its first line the title). The thread appears at once and
  // syncs in the background.
  const createThread = (draft: NewThreadDraft): void => {
    setNewThreadKind(null);
    openThread(client.createThread(draft, me));
  };

  // ⌘K opens search; ⌘N starts a thread, matching the shortcut search shows for it; ⌘U picks who to view as;
  // ⌘+, ⌘- and ⌘0 zoom the main content.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.altKey) return;
      // ⌘+ is usually typed as ⌘= (with or without Shift).
      const zoom = { "=": ZOOM_STEP, "+": ZOOM_STEP, "-": -ZOOM_STEP }[event.key];
      if (zoom !== undefined || event.key === "0") {
        event.preventDefault();
        setContentZoom((current) =>
          zoom === undefined
            ? 1
            : Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + zoom)) * 10) / 10,
        );
        return;
      }
      if (event.shiftKey) return;
      const key = event.key.toLowerCase();
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
    text: string,
    withPerson?: Person,
    movedEntryIds?: string[],
  ): string => {
    const others = [withPerson, from.requester, from.assignee, ...from.attendees].filter(
      (person): person is Person => person !== undefined && person !== null && person.id !== me.id,
    );
    return client.createThread(
      {
        kind: "response",
        text,
        assignee: others[0] ?? null,
        invitees: [],
        schedule: null,
        branchedFromId: from.id,
        movedEntryIds,
      },
      me,
    );
  };

  // `/blocked`: a new thread asking someone for what this one needs, which blocks it until it closes.
  const createBlocker = (from: Thread, person: Person, text: string): void => {
    client.createThread(
      {
        kind: "response",
        text,
        assignee: person,
        invitees: [],
        schedule: null,
        branchedFromId: from.id,
        blocksId: from.id,
      },
      me,
    );
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

  // After you close a thread from your inbox, the next one opens, or, with nothing left, the start view says so. In
  // the split view, just the split closes.
  const moveOn = (thread: Thread): void => {
    if (thread.id === splitThreadId) {
      setSplitThreadId(null);
      return;
    }
    const inbox = day.unscheduled.map((item) => item.thread);
    const index = inbox.findIndex((candidate) => candidate.id === thread.id);
    const rest = inbox.filter(
      (candidate) => candidate.id !== thread.id && candidate.id !== splitThreadId,
    );
    const next = rest[Math.max(0, index)] ?? rest[0];
    openThread(next?.id ?? null);
  };

  // Every change is a transaction: applied here at once, then sent to the server, which records property changes
  // as activity lines that sync back. Each open thread (main or split) gets its own actions.
  const actionsFor = (thread: Thread): ThreadActions => {
    const edit = (changes: ThreadChanges): void => client.updateThread(thread.id, changes, me);
    return {
      onSend: (text) => client.addEntry(thread.id, "message", text, me),
      onBlock: (person, text) => createBlocker(thread, person, text),
      // Closing something in your inbox finishes it there, so the next thread opens.
      onSetStatus: (status) => {
        edit({ status });
        if (status === "closed" && waitingOn(thread) === me.id) moveOn(thread);
      },
      onSetPriority: (priority) => edit({ priority }),
      onSetDue: (dueAtMs) => edit({ dueAtMs }),
      onSetEffort: (effortHours) => edit({ effortHours }),
      onSetTags: (tagIds) => edit({ tagIds }),
      onSetAssignee: (person) => edit({ assigneeId: person.id }),
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
        <div aria-hidden className="titlebar" />
        <DragRegionResync />
        {sidebarOpen && (
          <Sidebar
            day={day}
            nowMs={nowMs}
            unreadIds={unreadIds}
            activeThreadId={activeThreadId}
            orgOpen={orgOpen}
            onNewThread={() => openNew()}
            onOpenThread={openThread}
            onToggleOrg={() => (orgOpen ? setOrgOpen(false) : openOrg())}
            onToggle={toggleSidebar}
            onSearch={() => setSearchOpen(true)}
            onShiftDay={(days) => setDayOffset((offset) => (days === null ? 0 : offset + days))}
          />
        )}
        <main className="main">
          <div className="topbar main-topbar" data-sidebar-open={sidebarOpen}>
            {!sidebarOpen && (
              <>
                <SidebarToggle onToggle={toggleSidebar} />
                <SearchButton onSearch={() => setSearchOpen(true)} />
              </>
            )}
            <span className="topbar-title">{orgOpen ? "Organization" : activeThread?.title}</span>
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
              <DetailsToggle onToggle={() => setDetailsOpen((open) => !open)} />
            </span>
          </div>
          {orgOpen ? (
            <OrgView people={people} me={me} />
          ) : activeThread === undefined ? (
            <Welcome
              me={me}
              source={source}
              upNext={upNext(threads, me, people, nowMs, 4)}
              inboxCount={day.unscheduled.length}
              outboxCount={day.outbox.length}
              nowMs={nowMs}
              onOpenThread={openThread}
              onNewThread={openNew}
              onSearch={() => setSearchOpen(true)}
              onViewAs={() => setViewAsOpen(true)}
            />
          ) : (
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
                      <Maximize2 size={13} strokeWidth={1.7} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="topbar-button"
                      aria-label="Close"
                      onClick={() => setSplitThreadId(null)}
                    >
                      <X size={14} strokeWidth={1.7} aria-hidden />
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
        {detailsOpen && <DetailsPanel thread={activeThread} team={people} nowMs={nowMs} />}
        {newThreadKind !== null && (
          <NewThreadPalette
            initialKind={newThreadKind}
            people={people}
            me={me}
            nowMs={nowMs}
            onCreate={createThread}
            onClose={() => setNewThreadKind(null)}
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
            onOpenOrg={openOrg}
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
      </ThreadLinksContext>
    </MeContext>
  );
});

export default App;
