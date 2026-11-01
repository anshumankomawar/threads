import { CalendarDays, MessageSquare, Search, Target } from "lucide-react";
import type { Person, Schedule, ThreadKind } from "model";
import { formatClock, formatWhen, startOfDay } from "../format";
import type { TimelineItem } from "../inbox";
import { SOURCE_LABELS, type DataSource } from "../api";

const ICON_PROPS = { size: 15, strokeWidth: 1.7, "aria-hidden": true } as const;

type Action = { icon: React.JSX.Element; label: string; shortcut?: string; run: () => void };

function greeting(nowMs: number): string {
  const hour = new Date(nowMs).getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const KIND_ICONS: Record<ThreadKind, React.JSX.Element> = {
  response: <MessageSquare {...ICON_PROPS} />,
  meeting: <CalendarDays {...ICON_PROPS} />,
  focus: <Target {...ICON_PROPS} />,
};

// When a block is: "Now" while it's under way, a time today, else the day and time.
function whenLabel(block: Schedule, nowMs: number): string {
  if (block.startMs <= nowMs) return "Now";
  return startOfDay(block.startMs) === startOfDay(nowMs)
    ? formatClock(block.startMs)
    : formatWhen(block.startMs, nowMs);
}

// The main view with no thread open. It sits where a thread's page would, so opening one doesn't shift the
// layout: a greeting, what's waiting on whom, the next few things on your schedule, and a few ways to get going.
export function Welcome({
  me,
  source,
  upNext,
  inboxCount,
  outboxCount,
  nowMs,
  onOpenThread,
  onNewThread,
  onSearch,
  onViewAs,
}: {
  me: Person;
  source: DataSource;
  // The next few threads on your schedule, at their next block.
  upNext: TimelineItem[];
  // Threads waiting on you; none is inbox zero.
  inboxCount: number;
  // Threads you're waiting on others for.
  outboxCount: number;
  nowMs: number;
  onOpenThread: (id: string) => void;
  onNewThread: (kind: ThreadKind) => void;
  onSearch: () => void;
  onViewAs: () => void;
}): React.JSX.Element {
  const actions: Action[] = [
    {
      icon: <MessageSquare {...ICON_PROPS} />,
      label: "New thread",
      shortcut: "⌘ N",
      run: () => onNewThread("response"),
    },
    {
      icon: <CalendarDays {...ICON_PROPS} />,
      label: "New meeting",
      run: () => onNewThread("meeting"),
    },
    { icon: <Target {...ICON_PROPS} />, label: "New focus block", run: () => onNewThread("focus") },
    { icon: <Search {...ICON_PROPS} />, label: "Search", shortcut: "⌘ K", run: onSearch },
  ];
  const date = new Date(nowMs).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const waiting = [
    inboxCount > 0 ? `${inboxCount} waiting on you` : null,
    outboxCount > 0 ? `${outboxCount} waiting on others` : null,
  ].filter((part) => part !== null);
  const summary = waiting.length === 0 ? "Nothing on your plate." : waiting.join(" · ");

  return (
    <div className="welcome">
      <h1 className="welcome-title">
        {greeting(nowMs)}, {me.name}
      </h1>
      <p className="welcome-summary">
        {date} · {summary}
      </p>
      {inboxCount === 0 && <p className="welcome-zero">Inbox zero. Nothing is waiting on you.</p>}
      {upNext.length > 0 && (
        <section className="welcome-list" aria-label="Up next">
          <div className="welcome-list-label">Up next</div>
          {upNext.map(({ thread, block }) => (
            <button
              key={thread.id}
              type="button"
              className="welcome-action"
              onClick={() => onOpenThread(thread.id)}
            >
              <span className="welcome-action-icon">{KIND_ICONS[thread.kind]}</span>
              <span className="welcome-action-label">{thread.title}</span>
              <span className="welcome-shortcut">{whenLabel(block, nowMs)}</span>
            </button>
          ))}
        </section>
      )}
      <div className="welcome-actions">
        {actions.map((action) => (
          <button key={action.label} type="button" className="welcome-action" onClick={action.run}>
            <span className="welcome-action-icon">{action.icon}</span>
            <span className="welcome-action-label">{action.label}</span>
            {action.shortcut !== undefined && (
              <span className="welcome-shortcut">{action.shortcut}</span>
            )}
          </button>
        ))}
      </div>
      <button type="button" className="welcome-viewer" onClick={onViewAs}>
        Viewing {SOURCE_LABELS[source]} as {me.name} · Switch ⌘ U
      </button>
    </div>
  );
}
