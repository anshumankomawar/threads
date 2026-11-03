import { formatEffort, PRIORITY_LABELS, type Status, type Thread } from "model";
import { useState } from "react";
import { formatDue } from "../format";
import { BOARD_COLUMNS, boardColumns } from "../sprints";
import { useThreadMenu } from "../threadMenu";

// A list of threads as a board, one column per status. A card opens its thread; dragging it to another column changes
// its status, the same change as making it in the thread (anyone can close a thread), with the same activity line.
export function Board({
  threads,
  nowMs,
  unreadIds,
  onOpenThread,
  onSetStatus,
}: {
  threads: Thread[];
  nowMs: number;
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
  onSetStatus: (thread: Thread, status: Status) => void;
}): React.JSX.Element {
  const openMenu = useThreadMenu();
  const columns = boardColumns(threads);
  // The column a card is being dragged over, to show where it'll land.
  const [over, setOver] = useState<Status | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  return (
    <div className="board" role="list" aria-label="Board">
      {BOARD_COLUMNS.map(({ status, label }) => (
        <section
          key={status}
          className="board-column"
          aria-label={label}
          data-over={over === status}
          onDragOver={(event) => {
            if (dragging === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setOver(status);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setOver(null);
            const thread = threads.find(
              (candidate) => candidate.id === event.dataTransfer.getData("text/thread-id"),
            );
            if (thread !== undefined && thread.status !== status) onSetStatus(thread, status);
          }}
        >
          <h2 className="board-heading">
            <span className="status-dot" data-status={status} aria-hidden />
            {label}
            <span className="board-count">{columns[status].length}</span>
          </h2>
          <ul className="board-cards">
            {columns[status].map((thread) => {
              const due = thread.dueAtMs === null ? null : formatDue(thread.dueAtMs, nowMs);
              return (
                <li key={thread.id}>
                  <div
                    className="board-card"
                    role="button"
                    tabIndex={0}
                    draggable
                    data-dragging={dragging === thread.id}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/thread-id", thread.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(thread.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onClick={() => onOpenThread(thread.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenThread(thread.id);
                      }
                    }}
                    onContextMenu={(event) => openMenu(event, thread)}
                  >
                    <span className="board-card-title">
                      {thread.title}
                      {unreadIds.has(thread.id) && (
                        <span className="unread-dot" aria-label="Unread" />
                      )}
                    </span>
                    <span className="board-card-meta">
                      <span>
                        {thread.assignees.length === 0
                          ? "Unassigned"
                          : thread.assignees.map((person) => person.name.split(" ")[0]).join(", ")}
                      </span>
                      {thread.priority !== "none" && (
                        <span data-priority={thread.priority}>
                          {PRIORITY_LABELS[thread.priority]}
                        </span>
                      )}
                      {due !== null && <span data-overdue={due.overdue}>{due.label}</span>}
                      {thread.effortHours !== null && (
                        <span>{formatEffort(thread.effortHours)}</span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
