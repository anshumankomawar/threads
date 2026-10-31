import { useEffect, useRef, useState } from "react";
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
import { createApi, type Workspace } from "./api";
import { ThreadView, type ThreadActions } from "./components/ThreadView";
import { me } from "./me";
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
function lastActivityByOthers(thread: Thread): number {
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

const WORKSPACE_KEY = "workspace";

// Which workspace to show, remembered across launches. Starts on your own (empty) local data.
function savedWorkspace(): Workspace {
  try {
    return localStorage.getItem(WORKSPACE_KEY) === "sample" ? "sample" : "local";
  } catch {
    return "local";
  }
}

// Until the first load, or if the API isn't running.
type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready" };

function App(): React.JSX.Element {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [workspace, setWorkspace] = useState<Workspace>(savedWorkspace);
  const api = createApi(workspace);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});
  const nowMs = useNow(60_000);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const day = buildDay(threads, me, relationshipTo, nowMs);
  const unreadIds = new Set(
    threads
      .filter(
        (thread) =>
          thread.id !== activeThreadId && lastActivityByOthers(thread) > (lastSeen[thread.id] ?? 0),
      )
      .map((thread) => thread.id),
  );

  // Everything comes from the API; the sample's unread threads start unseen. The API may still be starting
  // (both launch together), so keep retrying until it answers.
  useEffect(() => {
    let cancelled = false;
    let retry = 0;
    const source = createApi(workspace);
    const fetchAll = (): void => {
      Promise.all([source.threads(), source.people()]).then(
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
  }, [workspace]);

  // Switching between your data and the sample data starts fresh on the other set.
  const switchWorkspace = (next: Workspace): void => {
    try {
      localStorage.setItem(WORKSPACE_KEY, next);
    } catch {
      // Not remembered; it still switches for this session.
    }
    setLoad({ state: "loading" });
    setThreads([]);
    setPeople([]);
    setActiveThreadId(null);
    setWorkspace(next);
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

  // ⌘K opens search; ⌘N starts a thread, matching the shortcut search shows for it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.shiftKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (key === "n") {
        event.preventDefault();
        openNew();
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
    // With no thread selected, the first message starts one, and it becomes the ask.
    onSend: (text) => {
      if (activeThread === undefined) {
        void sync(
          api.createThread({
            kind: "response",
            text,
            assignee: null,
            invitees: [],
            schedule: null,
          }),
        ).then((thread) => setActiveThreadId(thread.id));
        return;
      }
      void sync(api.addEntry(activeThread.id, "message", text));
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
            : `Waiting for the API at 127.0.0.1:3030 (vp run api#dev)… ${load.error}`}
        </div>
      </>
    );

  return (
    <>
      <div aria-hidden className="titlebar" />
      <DragRegionResync />
      {sidebarOpen && (
        <Sidebar
          day={day}
          nowMs={nowMs}
          unreadIds={unreadIds}
          activeThreadId={activeThreadId}
          onNewThread={() => openNew()}
          onOpenThread={openThread}
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
          <span className="topbar-title">{activeThread?.title ?? "New Thread"}</span>
          <span className="topbar-end">
            <DetailsToggle onToggle={() => setDetailsOpen((open) => !open)} />
          </span>
        </div>
        <ThreadView
          key={activeThread?.id ?? "new"}
          thread={activeThread}
          people={people}
          actions={actions}
        />
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
          workspace={workspace}
          onSwitchWorkspace={switchWorkspace}
          onNewThread={openNew}
          onOpenThread={openThread}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </>
  );
}

export default App;
