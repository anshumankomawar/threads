import { HugeiconsIcon } from "@hugeicons/react";
import type { InboxItem } from "../inbox";
import { KIND_ICONS } from "../kindIcons";

// A list of threads in the main area, opened from the sidebar's counts: your inbox (what's waiting on you, by who
// it's from) or what you're waiting on (by who has it and when they'll get to it). Laid out like the Organization
// and Replies pages.
export function ListPage({
  title,
  items,
  unreadIds,
  onOpenThread,
}: {
  title: string;
  items: InboxItem[];
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="list-page">
      <h1 className="list-page-title">{title}</h1>
      {items.length > 0 && (
        <p className="list-page-summary">
          {items.length} {items.length === 1 ? "thread" : "threads"}
        </p>
      )}
      <ul className="list-page-items">
        {items.map((item) => {
          const icon = KIND_ICONS[item.thread.kind];
          const meta = [item.from?.name, item.dueLabel].filter((part) => part != null).join(" · ");
          return (
            <li key={item.thread.id}>
              <button
                type="button"
                className="list-page-item"
                onClick={() => onOpenThread(item.thread.id)}
              >
                <span className="list-page-icon" aria-hidden>
                  <HugeiconsIcon icon={icon} size={13} />
                </span>
                <span className="list-page-body">
                  <span className="list-page-name">
                    {item.thread.title}
                    {unreadIds.has(item.thread.id) && (
                      <span className="unread-dot" aria-label="Unread" />
                    )}
                  </span>
                  <span className="list-page-reason">{item.reason}</span>
                </span>
                {meta !== "" && (
                  <span className="list-page-meta" data-overdue={item.overdue}>
                    {meta}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
