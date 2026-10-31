import { useEffect, useRef, useState } from "react";
import { SearchPanel } from "./components/SearchPanel";
import { DetailsPanel } from "./components/DetailsPanel";
import { DetailsToggle, SearchButton, Sidebar, SidebarToggle } from "./components/Sidebar";
import { PRIORITY_LABELS, STATUS_LABELS, type Entry, type Thread, type ThreadKind } from "./model";
import { ThreadView, type ThreadActions } from "./components/ThreadView";
import { me } from "./me";
import { buildDay } from "./inbox";
import { PEOPLE, relationshipTo, sampleThreads, UNREAD_THREAD_IDS } from "./sampleThreads";

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

const NEW_TITLES: Record<ThreadKind, string> = {
  response: "New Thread",
  meeting: "New Meeting",
  focus: "New Focus Block",
};

function App(): React.JSX.Element {
  const [threads, setThreads] = useState<Thread[]>(sampleThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>("rate-limits");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [lastSeen, setLastSeen] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        UNREAD_THREAD_IDS.includes(thread.id) ? 0 : thread.updatedAtMs,
      ]),
    ),
  );
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

  // A new response starts unassigned; a new meeting has you in it at the top of the next hour; a new focus
  // block is yours and unscheduled. The first thing written in it becomes its title.
  const newThread = (kind: ThreadKind = "response"): void => {
    const now = Date.now();
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const thread: Thread = {
      id: crypto.randomUUID(),
      title: NEW_TITLES[kind],
      kind,
      requester: me,
      assignee: null,
      status: "open",
      priority: "none",
      dueAtMs: null,
      schedule:
        kind === "meeting"
          ? { startMs: nextHour.getTime(), endMs: nextHour.getTime() + 30 * 60_000 }
          : null,
      attendees: kind === "meeting" ? [me] : [],
      updatedAtMs: now,
      entries: [],
    };
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
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
        newThread();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateThread = (id: string, change: (thread: Thread) => Thread): void =>
    setThreads((current) => current.map((thread) => (thread.id === id ? change(thread) : thread)));

  // Appends an entry to the active thread and bumps its activity time.
  const append = (
    entry: (now: number) => Entry,
    change?: (thread: Thread) => Partial<Thread>,
  ): void => {
    if (activeThread === undefined) return;
    const now = Date.now();
    updateThread(activeThread.id, (thread) => ({
      ...thread,
      ...change?.(thread),
      updatedAtMs: now,
      entries: [...thread.entries, entry(now)],
    }));
  };

  // Property changes are recorded in the thread as activity lines.
  const logEvent = (text: string, change: Partial<Thread>): void =>
    append(
      (now) => ({ kind: "event", id: crypto.randomUUID(), actor: me, text, createdAtMs: now }),
      () => change,
    );

  const firstLine = (text: string): string => text.split("\n")[0].slice(0, 80);

  const actions: ThreadActions = {
    // With no thread selected, the first message starts one, and it becomes the ask.
    onSend: (text) => {
      const message = (now: number): Entry => ({
        kind: "message",
        id: crypto.randomUUID(),
        author: me,
        text,
        createdAtMs: now,
        decision: false,
      });
      if (activeThread === undefined) {
        const now = Date.now();
        const thread: Thread = {
          id: crypto.randomUUID(),
          title: firstLine(text),
          kind: "response",
          requester: me,
          assignee: null,
          status: "open",
          priority: "none",
          dueAtMs: null,
          schedule: null,
          attendees: [],
          updatedAtMs: now,
          entries: [message(now)],
        };
        setThreads((current) => [thread, ...current]);
        setActiveThreadId(thread.id);
        return;
      }
      append(message, (thread) => (thread.entries.length === 0 ? { title: firstLine(text) } : {}));
    },
    onResolve: (text) =>
      append(
        (now) => ({
          kind: "resolution",
          id: crypto.randomUUID(),
          author: me,
          text,
          createdAtMs: now,
        }),
        () => ({ status: "done" }),
      ),
    onReopen: () => logEvent("reopened this", { status: "open" }),
    onSetStatus: (status) => {
      if (status !== activeThread?.status)
        logEvent(`changed status to ${STATUS_LABELS[status]}`, { status });
    },
    onSetPriority: (priority) => {
      if (priority !== activeThread?.priority)
        logEvent(
          priority === "none"
            ? "removed the priority"
            : `set priority to ${PRIORITY_LABELS[priority]}`,
          { priority },
        );
    },
    onSetDue: (dueAtMs) => {
      const label =
        dueAtMs === null
          ? "removed the due date"
          : `set the due date to ${new Date(dueAtMs).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
      logEvent(label, { dueAtMs });
    },
    onSetAssignee: (person) => {
      if (person.id !== activeThread?.assignee?.id)
        logEvent(person.id === me.id ? "took this on" : `assigned this to ${person.name}`, {
          assignee: person,
        });
    },
    onSetSchedule: (schedule) => {
      const label =
        schedule === null
          ? "removed it from the schedule"
          : `scheduled this for ${new Date(schedule.startMs).toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}`;
      logEvent(label, { schedule });
    },
    onToggleDecision: (entryId) => {
      if (activeThread === undefined) return;
      updateThread(activeThread.id, (thread) => ({
        ...thread,
        entries: thread.entries.map((entry) =>
          entry.id === entryId && entry.kind === "message"
            ? { ...entry, decision: !entry.decision }
            : entry,
        ),
      }));
    },
  };

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
          onNewThread={() => newThread()}
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
          people={PEOPLE}
          actions={actions}
        />
      </main>
      {detailsOpen && <DetailsPanel thread={activeThread} nowMs={nowMs} />}
      {searchOpen && (
        <SearchPanel
          threads={threads}
          onNewThread={newThread}
          onOpenThread={openThread}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </>
  );
}

export default App;
