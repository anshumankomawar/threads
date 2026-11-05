import { formatEffort, PRIORITY_LABELS, type Status, type Thread } from "model";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { formatDue } from "../format";
import { BOARD_COLUMNS, boardColumns } from "../sprints";
import { useThreadMenu } from "../threadMenu";

// A list of threads as a board, one column per status. A card opens its thread; dragging it to another column changes
// its status, the same change as making it in the thread (anyone can close a thread), with the same activity line.
export function Board(props: {
  threads: Thread[];
  nowMs: number;
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
  onSetStatus: (thread: Thread, status: Status) => void;
}): JSX.Element {
  const openMenu = useThreadMenu();
  const columns = createMemo(() => boardColumns(props.threads));
  // The column a card is being dragged over, to show where it'll land.
  const [over, setOver] = createSignal<Status | null>(null);
  const [dragging, setDragging] = createSignal<string | null>(null);

  return (
    <div class="board" role="list" aria-label="Board">
      <For each={BOARD_COLUMNS}>
        {({ status, label }) => (
          <section
            class="board-column"
            aria-label={label}
            data-over={String(over() === status)}
            onDragOver={(event) => {
              if (dragging() === null) return;
              event.preventDefault();
              if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
              setOver(status);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const thread = props.threads.find(
                (candidate) => candidate.id === event.dataTransfer?.getData("text/thread-id"),
              );
              if (thread !== undefined && thread.status !== status)
                props.onSetStatus(thread, status);
            }}
          >
            <h2 class="board-heading">
              <span class="status-dot" data-status={status} aria-hidden="true" />
              {label}
              <span class="board-count">{columns()[status].length}</span>
            </h2>
            <ul class="board-cards">
              <For each={columns()[status]}>
                {(thread) => {
                  const due = (): ReturnType<typeof formatDue> | null =>
                    thread.dueAtMs === null ? null : formatDue(thread.dueAtMs, props.nowMs);
                  return (
                    <li>
                      <div
                        class="board-card"
                        role="button"
                        tabindex={0}
                        draggable="true"
                        data-dragging={String(dragging() === thread.id)}
                        onDragStart={(event) => {
                          event.dataTransfer?.setData("text/thread-id", thread.id);
                          if (event.dataTransfer !== null)
                            event.dataTransfer.effectAllowed = "move";
                          setDragging(thread.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onClick={() => props.onOpenThread(thread.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            props.onOpenThread(thread.id);
                          }
                        }}
                        onContextMenu={(event) => openMenu(event, thread)}
                      >
                        <span class="board-card-title">
                          {thread.title}
                          <Show when={props.unreadIds.has(thread.id)}>
                            <span class="unread-dot" aria-label="Unread" />
                          </Show>
                        </span>
                        <span class="board-card-meta">
                          <span>
                            {thread.assignees.length === 0
                              ? "Unassigned"
                              : thread.assignees
                                  .map((person) => person.name.split(" ")[0])
                                  .join(", ")}
                          </span>
                          <Show when={thread.priority !== "none"}>
                            <span data-priority={thread.priority}>
                              {PRIORITY_LABELS[thread.priority]}
                            </span>
                          </Show>
                          <Show when={due()}>
                            {(shown) => (
                              <span data-overdue={String(shown().overdue)}>{shown().label}</span>
                            )}
                          </Show>
                          <Show when={thread.effortHours !== null}>
                            <span>{formatEffort(thread.effortHours ?? 0)}</span>
                          </Show>
                        </span>
                      </div>
                    </li>
                  );
                }}
              </For>
            </ul>
          </section>
        )}
      </For>
    </div>
  );
}
