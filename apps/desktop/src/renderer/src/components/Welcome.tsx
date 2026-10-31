import { CalendarDays, MessageSquare, Search, Target } from "lucide-react";
import type { Person, ThreadKind } from "model";
import { SOURCE_LABELS, type DataSource } from "../api";

const ICON_PROPS = { size: 15, strokeWidth: 1.7, "aria-hidden": true } as const;

type Action = { icon: React.JSX.Element; label: string; shortcut?: string; run: () => void };

function greeting(nowMs: number): string {
  const hour = new Date(nowMs).getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

// The main view with no thread open. It sits where a thread's page would, so opening one doesn't shift the
// layout: a greeting, how full today is, and a few ways to get going.
export function Welcome({
  me,
  source,
  todayCount,
  nowMs,
  onNewThread,
  onSearch,
  onViewAs,
}: {
  me: Person;
  source: DataSource;
  // Open items on today's schedule and inbox.
  todayCount: number;
  nowMs: number;
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
  const summary =
    todayCount === 0
      ? "Nothing on your plate."
      : `${todayCount} ${todayCount === 1 ? "thing" : "things"} on your plate.`;

  return (
    <div className="welcome">
      <h1 className="welcome-title">
        {greeting(nowMs)}, {me.name}
      </h1>
      <p className="welcome-summary">
        {date} · {summary}
      </p>
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
