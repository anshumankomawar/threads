import { useContext, useEffect, useRef, useState } from "react";
import { NewThreadPalette, type NewThreadDraft } from "./components/NewThreadPalette";
import { CommandPalette } from "./components/CommandPalette";
import { DetailsPanel } from "./components/DetailsPanel";
import { DetailsToggle, SearchButton, Sidebar, SidebarToggle } from "./components/Sidebar";
import {
  relationshipTo,
  UNREAD_THREAD_IDS,
  type Person,
  type Thread,
  type ThreadKind,
} from "model";
import { CLOUDFLARE_AVAILABLE, createApi, serverFor, SOURCE_LABELS, type DataSource } from "./api";
import { ThreadView, type ThreadActions } from "./components/ThreadView";
import { MeContext } from "./me";
import { Identicon } from "./components/Identicon";
import { OrgView } from "./components/OrgView";
import { ViewAsPalette } from "./components/ViewAsPalette";
import { Welcome } from "./components/Welcome";
import { buildDay } from "./inbox";

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

// Until the first load, or if the API isn't running.
type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready" };

function App(): React.JSX.Element {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [source, setSource] = useState<DataSource>(savedSource);
  const [viewerId, setViewerId] = useState<string | null>(() => savedViewer(savedSource()));
  const fallbackMe = useContext(MeContext);
  // You view the app as the chosen person, or the first person in the data until you pick one.
  const me = people.find((person) => person.id === viewerId) ?? people[0] ?? fallbackMe;
  const api = createApi(source, me);
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
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
  const nowMs = useNow(60_000);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const day = buildDay(threads, me, relationshipTo, nowMs);
  const unreadIds = new Set(
    threads
      .filter(
        (thread) =>
          thread.id !== activeThreadId &&
          lastActivityByOthers(thread, me) > (lastSeen[thread.id] ?? 0),
      )
      .map((thread) => thread.id),
  );

  // Everything comes from the API; the sample's unread threads start unseen. The API may still be starting
  // (both launch together), so keep retrying until it answers.
  useEffect(() => {
    let cancelled = false;
    let retry = 0;
    // Reading needs no particular viewer.
    const reader = createApi(source, fallbackMe);
    const fetchAll = (): void => {
      Promise.all([reader.threads(), reader.people()]).then(
        ([loaded, team]) => {
          if (cancelled) return;
          setThreads(loaded);
          setPeople(team);
          setLastSeen(
            Object.fromEntries(
              loaded.map((thread) => [
                thread.id,
                UNREAD_THREAD_IDS.includes(thread.id) ? 0 : thread.updatedAtMs,
              ]),
            ),
          );
          setLoad({ state: "ready" });
        },
        (error: unknown) => {
          if (cancelled) return;
          setLoad({ state: "failed", error: String(error) });
          retry = window.setTimeout(fetchAll, 1000);
        },
      );
    };
    fetchAll();
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, [source, fallbackMe]);

  // Switching data sources starts fresh on the other one.
  const switchSource = (next: DataSource): void => {
    remember(SOURCE_KEY, next);
    setLoad({ state: "loading" });
    setThreads([]);
    setPeople([]);
    setActiveThreadId(null);
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

  // Swaps in the server's copy of a thread after a change, adding it if it's new.
  const replace = (thread: Thread): void =>
    setThreads((current) =>
      current.some((existing) => existing.id === thread.id)
        ? current.map((existing) => (existing.id === thread.id ? thread : existing))
        : [thread, ...current],
    );
  const sync = (request: Promise<Thread>): Promise<Thread> =>
    request.then(
      (thread) => {
        replace(thread);
        return thread;
      },
      (error: unknown) => {
        console.error(error);
        throw error;
      },
    );

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

  // The server turns the panel's text into the opening message (and its first line the title).
  const createThread = (draft: NewThreadDraft): void => {
    setNewThreadKind(null);
    void sync(api.createThread(draft)).then((thread) => openThread(thread.id));
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

  // Property changes go to the server, which records them in the thread as activity lines.
  const edit = (edits: Parameters<typeof api.editThread>[1]): void => {
    if (activeThread !== undefined) void sync(api.editThread(activeThread.id, edits));
  };

  const actions: ThreadActions = {
    onSend: (text) => {
      if (activeThread !== undefined) void sync(api.addEntry(activeThread.id, "message", text));
    },
    onResolve: (text) => {
      if (activeThread !== undefined) void sync(api.addEntry(activeThread.id, "resolution", text));
    },
    onReopen: () => edit({ status: "open" }),
    onSetStatus: (status) => edit({ status }),
    onSetPriority: (priority) => edit({ priority }),
    onSetDue: (dueAtMs) => edit({ dueAtMs }),
    onSetAssignee: (person) => edit({ assignee: person.id }),
    onSetSchedule: (schedule) => edit({ schedule }),
    onToggleDecision: (entryId) => {
      const entry = activeThread?.entries.find((candidate) => candidate.id === entryId);
      if (activeThread === undefined || entry?.kind !== "message") return;
      void sync(api.setDecision(activeThread.id, entryId, !entry.decision));
    },
  };

  if (load.state !== "ready")
    return (
      <>
        <div aria-hidden className="titlebar" />
        <div className="app-status">
          {load.state === "loading"
            ? "Loading…"
            : `Waiting for the ${SOURCE_LABELS[source]} API at ${serverFor(source).url}${source === "cloudflare" ? "" : " (vp run api#dev)"}… ${load.error}`}
        </div>
      </>
    );

  return (
    <MeContext value={me}>
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
              <span className="view-as-source">{SOURCE_LABELS[source]}</span>
              <Identicon seed={me.id} size={14} />
              <span>{me.name}</span>
            </button>
            <DetailsToggle onToggle={() => setDetailsOpen((open) => !open)} />
          </span>
        </div>
        {orgOpen ? (
          <OrgView people={people} me={me} />
        ) : activeThread === undefined ? (
          <Welcome
            me={me}
            source={source}
            todayCount={day.timeline.length + day.unscheduled.length}
            nowMs={nowMs}
            onNewThread={openNew}
            onSearch={() => setSearchOpen(true)}
            onViewAs={() => setViewAsOpen(true)}
          />
        ) : (
          <ThreadView
            key={activeThread.id}
            thread={activeThread}
            people={people}
            actions={actions}
          />
        )}
      </main>
      {detailsOpen && <DetailsPanel thread={activeThread} nowMs={nowMs} />}
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
    </MeContext>
  );
}

export default App;
