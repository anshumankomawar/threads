import { useEffect, useRef, useState } from "react";

const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 210;
const SIDEBAR_MAX_WIDTH = 400;
const SIDEBAR_WIDTH_KEY = "sidebar-width";

export type Thread = {
  id: string;
  title: string;
  updatedAtMs: number;
};

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return stored > 0 ? clampSidebarWidth(stored) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function saveSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // Width just won't persist.
  }
}

// Cursor's sidebar format: never "now", 1m minimum, and no weeks.
function formatRelativeTime(atMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.floor((nowMs - atMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Marks the element with data-overflowing when its text is clipped, which turns on the fade mask.
function useOverflowFade<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      element.toggleAttribute("data-overflowing", element.scrollWidth > element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function NewThreadIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  );
}

function activateOnKey(event: React.KeyboardEvent, activate: () => void): void {
  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  activate();
}

function ThreadRow({
  thread,
  active,
  nowMs,
  onOpen,
}: {
  thread: Thread;
  active: boolean;
  nowMs: number;
  onOpen: () => void;
}): React.JSX.Element {
  const titleRef = useOverflowFade<HTMLSpanElement>();
  const time = formatRelativeTime(thread.updatedAtMs, nowMs);

  return (
    <li className="thread-item">
      <div
        className="thread-row"
        aria-label={thread.title}
        data-active={active}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => activateOnKey(event, onOpen)}
      >
        <span className="thread-row-icon">
          <span className="status-dot-box" aria-label="Completed" role="img">
            <span className="status-dot" aria-hidden />
          </span>
        </span>
        <span className="thread-row-title-wrap">
          <span ref={titleRef} className="thread-row-title">
            {thread.title}
          </span>
        </span>
        <span className="thread-row-meta">
          <span className="thread-row-time" data-long={time.length > 3}>
            {time}
          </span>
        </span>
      </div>
    </li>
  );
}

export function Sidebar({
  threads,
  activeThreadId,
  onNewThread,
  onOpenThread,
}: {
  threads: Thread[];
  activeThreadId: string | null;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const sidebarRef = useRef<HTMLElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [scroll, setScroll] = useState({ scrolled: false, atEnd: true });
  const nowMs = useNow(60_000);

  const commitSidebarWidth = (width: number): void => {
    setSidebarWidth(width);
    saveSidebarWidth(width);
  };

  const onResizeStart = (event: React.PointerEvent<HTMLHRElement>): void => {
    const sidebar = sidebarRef.current;
    if (sidebar === null) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.resizing = "true";

    // Write the width straight to the DOM while dragging; commit to state on release.
    const onMove = (moveEvent: PointerEvent): void => {
      const width = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
      sidebar.style.width = `${width}px`;
      handle.setAttribute("aria-valuenow", String(width));
    };
    const onEnd = (endEvent: PointerEvent): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      delete handle.dataset.resizing;
      commitSidebarWidth(clampSidebarWidth(startWidth + endEvent.clientX - startX));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  };

  // Drives the top and bottom fade masks on the scrolling list.
  const onContentScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const element = event.currentTarget;
    const next = {
      scrolled: element.scrollTop > 0,
      atEnd: element.scrollTop + element.clientHeight >= element.scrollHeight - 5,
    };
    if (next.scrolled !== scroll.scrolled || next.atEnd !== scroll.atEnd) setScroll(next);
  };

  return (
    <aside ref={sidebarRef} className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar-topbar" />
      <div className="sidebar-header">
        <div
          className="nav-row"
          data-active={activeThreadId === null}
          role="button"
          tabIndex={0}
          onClick={onNewThread}
          onKeyDown={(event) => activateOnKey(event, onNewThread)}
        >
          <span className="nav-row-icon">
            <NewThreadIcon />
          </span>
          <span className="nav-row-label">New Thread</span>
        </div>
      </div>
      <div
        className="sidebar-content"
        data-at-end={scroll.atEnd}
        data-scrolled={scroll.scrolled}
        onScroll={onContentScroll}
      >
        <div className="sidebar-group">
          <div className="group-label">
            <span className="group-label-text">Threads</span>
          </div>
          {threads.length === 0 ? (
            <div className="sidebar-empty">No threads yet</div>
          ) : (
            <ul className="thread-list" aria-label="Threads">
              {threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  active={thread.id === activeThreadId}
                  nowMs={nowMs}
                  onOpen={() => onOpenThread(thread.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      <hr
        className="resize-handle"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuenow={sidebarWidth}
        onDoubleClick={() => commitSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
        onPointerDown={onResizeStart}
      />
    </aside>
  );
}
