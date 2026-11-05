import * as stylex from "@stylexjs/stylex";
import { formatEffort, PRIORITY_LABELS, type Status, type Thread } from "model";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { formatDue } from "../format";
import { BOARD_COLUMNS, boardColumns } from "../sprints";
import { status as statusStyle, statusDot } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";

// The board: a column per status, cards you can drag between them.
const styles = stylex.create({
  board: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(150px, 1fr))",
    gap: "12px",
    marginTop: "16px",
    overflowX: "auto",
    // The page is a flex column; scrolling sideways would otherwise let it shrink to nothing.
    flexShrink: 0,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    minHeight: "120px",
    padding: "8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radii.panel,
    backgroundColor: colors.bgQuaternary,
  },
  // A card is being dragged over it.
  columnOver: {
    borderColor: colors.strokeFocused,
  },
  heading: {
    display: "flex",
    gap: "7px",
    alignItems: "center",
    margin: "0 2px 8px",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    fontWeight: 500,
  },
  count: {
    color: colors.textTertiary,
  },
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px 10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: colors.strokeTertiary,
      ":hover": colors.strokeFocused,
    },
    borderRadius: radii.item,
    color: colors.textPrimary,
    backgroundColor: colors.bgTertiary,
    cursor: "grab",
  },
  cardDragging: {
    opacity: 0.4,
  },
  title: {
    display: "flex",
    gap: "6px",
    alignItems: "baseline",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 10px",
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },
  // Overdue, or urgent.
  metaUrgent: {
    color: colors.urgent,
  },
});

// A list of threads as a board, one column per status. A card opens its thread; dragging it to another column changes
// its status, the same change as making it in the thread (anyone can close a thread), with the same activity line.
export function Board(props: { threads: Thread[] }): JSX.Element {
  const app = useApp();
  const columns = createMemo(() => boardColumns(props.threads));
  // The column a card is being dragged over, to show where it'll land.
  const [over, setOver] = createSignal<Status | null>(null);
  const [dragging, setDragging] = createSignal<string | null>(null);

  return (
    <div class={sx(styles.board)} role="list" aria-label="Board">
      <For each={BOARD_COLUMNS}>
        {({ status, label }) => (
          <section
            class={sx(styles.column, over() === status && styles.columnOver)}
            aria-label={label}
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
                app.threads.setStatus(thread, status);
            }}
          >
            <h2 class={sx(styles.heading)}>
              <span
                class={sx(statusStyle.dot, status !== "open" && statusDot[status])}
                aria-hidden="true"
              />
              {label}
              <span class={sx(styles.count)}>{columns()[status].length}</span>
            </h2>
            <ul class={sx(styles.cards)}>
              <For each={columns()[status]}>
                {(thread) => {
                  const due = (): ReturnType<typeof formatDue> | null =>
                    thread.dueAtMs === null ? null : formatDue(thread.dueAtMs, app.now());
                  return (
                    <li>
                      <div
                        class={sx(styles.card, dragging() === thread.id && styles.cardDragging)}
                        role="button"
                        tabindex={0}
                        draggable="true"
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
                        onClick={() => app.nav.openThread(thread.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            app.nav.openThread(thread.id);
                          }
                        }}
                        onContextMenu={(event) => app.threads.openMenu(event, thread)}
                      >
                        <span class={sx(styles.title)}>
                          {thread.title}
                          <Show when={app.inbox.unreadIds().has(thread.id)}>
                            <span class={sx(statusStyle.unread)} aria-label="Unread" />
                          </Show>
                        </span>
                        <span class={sx(styles.meta)}>
                          <span>
                            {thread.assignees.length === 0
                              ? "Unassigned"
                              : thread.assignees
                                  .map((person) => person.name.split(" ")[0])
                                  .join(", ")}
                          </span>
                          <Show when={thread.priority !== "none"}>
                            <span class={sx(thread.priority === "urgent" && styles.metaUrgent)}>
                              {PRIORITY_LABELS[thread.priority]}
                            </span>
                          </Show>
                          <Show when={due()}>
                            {(shown) => (
                              <span class={sx(shown().overdue && styles.metaUrgent)}>
                                {shown().label}
                              </span>
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
