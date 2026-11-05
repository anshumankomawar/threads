import { formatDue, formatRelativeTime } from "../format";
import { bucketsOf, plainThreadLinks, STATUS_LABELS, type Status, type Thread } from "model";
import { createMemo, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { useApp } from "../app/state";
import { status as statusStyles, statusDot, topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { useResizablePanel } from "./useResizablePanel";

// A branch's line in the graph: down the left of its row from its parent, then across to its dot.
const GRAPH_LINE = {
  position: "absolute",
  left: 0,
  content: '""',
} as const;

const styles = stylex.create({
  // Details panel: the task at a glance, on the same glass as the left sidebar.
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    height: "100%",
    backgroundColor: colors.sidebarSolid,
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.strokeTertiary,
  },
  topbar: {
    paddingLeft: "12px",
    color: colors.textSecondary,
  },
  content: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    paddingBottom: "16px",
    overflowY: "auto",
  },
  // Sections follow one another 6px apart (every child of the content is a section).
  section: {
    display: "flex",
    flexDirection: "column",
    padding: "0 12px",
    marginTop: {
      default: null,
      ":not(:first-child)": "6px",
    },
  },
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    height: "28px",
    color: colors.textSecondary,
  },
  row: {
    display: "flex",
    alignItems: "center",
    minHeight: "24px",
    gap: "8px",
    fontSize: fontSizes.body,
  },
  label: {
    flexShrink: 0,
    width: "84px",
    color: colors.textTertiary,
  },
  value: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    color: colors.textPrimary,
  },
  overdue: {
    color: colors.urgent,
  },
  note: {
    color: colors.textTertiary,
    fontSize: fontSizes.small,
  },
  // A label on the thread, which opens its page: looks like the text around it until hovered.
  labelLink: {
    padding: 0,
    borderStyle: "none",
    color: {
      default: "inherit",
      ":hover": colors.textPrimary,
    },
    font: "inherit",
    textAlign: "left",
    textDecoration: {
      default: null,
      ":hover": "underline",
    },
    backgroundColor: "transparent",
    cursor: "pointer",
  },

  // The branch graph: threads as status dots joined by lines, like git log --graph; the last child turns the corner.
  graphChildren: {
    margin: "0 0 0 3.5px",
    padding: 0,
    listStyle: "none",
  },
  graphBranch: {
    position: "relative",
    paddingLeft: "14px",
    "::before": {
      ...GRAPH_LINE,
      top: 0,
      bottom: 0,
      borderLeftWidth: "1px",
      borderLeftStyle: "solid",
      borderLeftColor: colors.strokeFocused,
    },
    "::after": {
      ...GRAPH_LINE,
      top: "12px",
      width: "10px",
      borderTopWidth: "1px",
      borderTopStyle: "solid",
      borderTopColor: colors.strokeFocused,
    },
  },
  // The last branch: its line stops at its dot and turns the corner there.
  graphBranchLast: {
    "::before": {
      bottom: "auto",
      width: "10px",
      height: "12px",
      borderBottomWidth: "1px",
      borderBottomStyle: "solid",
      borderBottomColor: colors.strokeFocused,
      borderBottomLeftRadius: "6px",
    },
    "::after": {
      display: "none",
    },
  },
  graphThread: {
    display: "flex",
    gap: "7px",
    alignItems: "center",
    width: "100%",
    height: "24px",
    padding: "0 4px 0 0",
    borderStyle: "none",
    color: {
      default: colors.textSecondary,
      ":hover": colors.textPrimary,
    },
    font: "inherit",
    fontSize: fontSizes.body,
    textAlign: "left",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  graphThreadCurrent: {
    color: colors.textPrimary,
    fontWeight: 500,
  },
  graphTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  // Activity lines jump to their place in the thread.
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    width: "100%",
    marginLeft: "-6px",
    padding: "4px 6px",
    borderStyle: "none",
    borderRadius: radii.control,
    color: colors.textPrimary,
    font: "inherit",
    fontSize: fontSizes.body,
    lineHeight: "17px",
    textAlign: "left",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.bgQuaternary,
    },
    cursor: "pointer",
    boxSizing: "content-box",
  },
});

// A thread's status as a dot: a hollow ring while open, filled as work moves along.
function StatusDot(props: { status: Status }): JSX.Element {
  return (
    <span
      class={sx(statusStyles.dot, props.status !== "open" && statusDot[props.status])}
      aria-hidden="true"
    />
  );
}

function Row(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div class={sx(styles.row)}>
      <span class={sx(styles.label)}>{props.label}</span>
      <span class={sx(styles.value)}>{props.children}</span>
    </div>
  );
}

function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class={sx(styles.section)}>
      <div class={sx(styles.sectionLabel)}>{props.title}</div>
      {props.children}
    </section>
  );
}

function reveal(entryId: string): void {
  document
    .getElementById(`entry-${entryId}`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

// The open thread at a glance: when it's happening, how it branched and who was asked what, and what's been decided
// and what's left to do, all read from the thread so you don't have to scroll through it.
export function DetailsPanel(): JSX.Element {
  const app = useApp();
  const { ref, width, handle } = useResizablePanel({
    storageKey: "details-width",
    defaultWidth: 280,
    minWidth: 240,
    maxWidth: 480,
    edge: "left",
  });

  const nameOf = (personId: string): string | undefined =>
    app.data.people().find((person) => person.id === personId)?.name;

  return (
    <aside ref={ref} class={sx(styles.panel)} style={{ width: `${width()}px` }}>
      <div class={sx(topbar.bar, styles.topbar)}>Details</div>
      <Show when={app.nav.activeThread()}>
        {(thread) => {
          const due = createMemo(() => {
            const dueAtMs = thread().dueAtMs;
            return dueAtMs === null ? null : formatDue(dueAtMs, app.now());
          });
          const onLabels = createMemo(() =>
            app.data.labels().filter((label) => thread().labelIds.includes(label.id)),
          );
          const history = createMemo(() =>
            thread().entries.flatMap((entry) => (entry.kind === "event" ? [entry] : [])),
          );
          // Which of your buckets it's in, and why, while it's in your inbox.
          const triage = createMemo(() => thread().triage[app.me().id] ?? null);
          const bucket = createMemo(() =>
            bucketsOf(app.me()).find((candidate) => candidate.id === triage()?.bucketId),
          );

          return (
            <div class={sx(styles.content)}>
              {/* Who and what are in the thread's header; this is when and how far along. */}
              <Section title="Overview">
                <Row label="Status">
                  <StatusDot status={thread().status} />
                  {STATUS_LABELS[thread().status]}
                </Row>
                <Show when={due()}>
                  {(shown) => (
                    <Row label="Due">
                      <span class={sx(shown().overdue && styles.overdue)}>{shown().label}</span>
                    </Row>
                  )}
                </Show>
                <Show when={bucket() !== undefined && triage()}>
                  {(sorted) => (
                    <Row label="Bucket">
                      <div>{bucket()?.name}</div>
                      <div class={sx(styles.note)}>
                        {sorted().manual
                          ? "Placed by you"
                          : sorted().reason || "Sorted by the model"}
                      </div>
                    </Row>
                  )}
                </Show>
                <Show when={onLabels().length > 0}>
                  <Row label="Labels">
                    <For each={onLabels()}>
                      {(label) => (
                        <div>
                          <button
                            type="button"
                            class={sx(styles.labelLink)}
                            onClick={() => app.nav.openLabel(label.id)}
                          >
                            {label.name}
                          </button>
                        </div>
                      )}
                    </For>
                  </Row>
                </Show>
              </Section>

              <ThreadGraph current={thread()} />

              {/* The record of what's been done to the thread, including who made it on whose behalf. */}
              <Show when={history().length > 0}>
                <Section title="Activity">
                  <ul class={sx(styles.list)}>
                    <For each={history()}>
                      {(entry) => (
                        <li>
                          <button
                            type="button"
                            class={sx(styles.item)}
                            onClick={() => reveal(entry.id)}
                          >
                            {entry.actor.name}{" "}
                            {plainThreadLinks(entry.text, app.links.titleOf, nameOf)} ·{" "}
                            {formatRelativeTime(entry.createdAtMs, app.now())}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Section>
              </Show>
            </div>
          );
        }}
      </Show>
      {handle}
    </aside>
  );
}

// The threads branched off a thread, oldest first.
function branchesOf(thread: Thread, threads: Thread[]): Thread[] {
  return threads
    .filter((other) => other.branchedFromId === thread.id)
    .toSorted((a, b) => (a.entries[0]?.createdAtMs ?? 0) - (b.entries[0]?.createdAtMs ?? 0));
}

// The thread's family as a graph, like `git log --graph`: from the thread everything branched from, each branch forks
// off where it started. Click one to open it. Nothing shows for a thread with no branches.
function ThreadGraph(props: { current: Thread }): JSX.Element {
  const app = useApp();
  const root = createMemo(() => {
    let root = props.current;
    const seen = new Set([root.id]);
    for (;;) {
      const parent = app.data.threads().find((other) => other.id === root.branchedFromId);
      if (parent === undefined || seen.has(parent.id)) break;
      seen.add(parent.id);
      root = parent;
    }
    return root;
  });

  const renderThread = (thread: Thread, depth: number): JSX.Element => {
    const branches = (): Thread[] => (depth < 8 ? branchesOf(thread, app.data.threads()) : []);
    return (
      <>
        <button
          type="button"
          class={sx(
            styles.graphThread,
            thread.id === props.current.id && styles.graphThreadCurrent,
          )}
          onClick={() => app.nav.openThread(thread.id)}
        >
          <StatusDot status={thread.status} />
          <span class={sx(styles.graphTitle)}>{thread.title}</span>
        </button>
        <Show when={branches().length > 0}>
          <ul class={sx(styles.graphChildren)}>
            <For each={branches()}>
              {(branch, index) => (
                <li
                  class={sx(
                    styles.graphBranch,
                    index() === branches().length - 1 && styles.graphBranchLast,
                  )}
                >
                  {renderThread(branch, depth + 1)}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </>
    );
  };

  return (
    <Show
      when={root() !== props.current || branchesOf(props.current, app.data.threads()).length > 0}
    >
      <Section title="Branches">
        <div>{renderThread(root(), 0)}</div>
      </Section>
    </Show>
  );
}
