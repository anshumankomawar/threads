import { HugeiconsIcon } from "@hugeicons/react";
import { STATUS_LABELS, type Thread } from "model";
import type { ListView } from "../listView";
import { THREAD_ICON } from "../threadIcon";
import { useThreadMenu } from "../threadMenu";

// List or board, beside New thread.
export function ViewToggle({
  view,
  onChange,
}: {
  view: ListView;
  onChange: (view: ListView) => void;
}): React.JSX.Element {
  return (
    <span className="view-toggle" role="group" aria-label="View">
      {(["list", "board"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="view-toggle-option"
          aria-pressed={view === option}
          onClick={() => onChange(option)}
        >
          {option === "list" ? "List" : "Board"}
        </button>
      ))}
    </span>
  );
}

// Threads as rows: title, who made it, and who has it. Click opens one; right-click has its menu.
export function ThreadRows({
  threads,
  unreadIds,
  onOpenThread,
}: {
  threads: Thread[];
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const openMenu = useThreadMenu();
  return (
    <ul className="list-page-items">
      {threads.map((thread) => {
        const meta = [
          thread.assignees.length === 0
            ? "Unassigned"
            : thread.assignees.map((person) => person.name.split(" ")[0]).join(", "),
          thread.status === "open" ? null : STATUS_LABELS[thread.status],
        ]
          .filter((part) => part !== null)
          .join(" · ");
        return (
          <li key={thread.id}>
            <button
              type="button"
              className="list-page-item"
              onClick={() => onOpenThread(thread.id)}
              onContextMenu={(event) => openMenu(event, thread)}
            >
              <span className="list-page-icon" aria-hidden>
                <HugeiconsIcon icon={THREAD_ICON} size={13} />
              </span>
              <span className="list-page-body">
                <span className="list-page-name">
                  {thread.title}
                  {unreadIds.has(thread.id) && <span className="unread-dot" aria-label="Unread" />}
                </span>
                <span className="list-page-reason">{`By ${thread.owner.name}`}</span>
              </span>
              {meta !== "" && <span className="list-page-meta">{meta}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
