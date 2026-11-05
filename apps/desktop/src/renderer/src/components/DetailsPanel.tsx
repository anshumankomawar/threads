import { formatDue, formatRelativeTime } from "../format";
import { bucketsOf, plainThreadLinks, STATUS_LABELS, type Thread } from "model";
import { createMemo, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useMe } from "../me";
import { useThreadLinks } from "../threadLinks";
import { useResizablePanel } from "./useResizablePanel";

function Row(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="details-row">
      <span class="details-label">{props.label}</span>
      <span class="details-value">{props.children}</span>
    </div>
  );
}

function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="details-section">
      <div class="details-section-label">{props.title}</div>
      {props.children}
    </section>
  );
}

function reveal(entryId: string): void {
  document
    .getElementById(`entry-${entryId}`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

// The task at a glance: when it's happening, how it branched and who was asked what, and what's been decided and
// what's left to do, all read from the thread so you don't have to scroll through it.
export function DetailsPanel(props: {
  thread: Thread | undefined;
  nowMs: number;
  onOpenThread: (id: string) => void;
  onOpenLabel: (id: string) => void;
}): JSX.Element {
  const links = useThreadLinks();
  const me = useMe();
  const { ref, width, handle } = useResizablePanel({
    storageKey: "details-width",
    defaultWidth: 280,
    minWidth: 240,
    maxWidth: 480,
    edge: "left",
  });

  const nameOf = (personId: string): string | undefined =>
    links.people.find((person) => person.id === personId)?.name;

  return (
    <aside ref={ref} class="details" style={{ width: `${width()}px` }}>
      <div class="topbar details-topbar">Details</div>
      <Show when={props.thread}>
        {(thread) => {
          const due = createMemo(() => {
            const dueAtMs = thread().dueAtMs;
            return dueAtMs === null ? null : formatDue(dueAtMs, props.nowMs);
          });
          const onLabels = createMemo(() =>
            links.labels.filter((label) => thread().labelIds.includes(label.id)),
          );
          const history = createMemo(() =>
            thread().entries.flatMap((entry) => (entry.kind === "event" ? [entry] : [])),
          );
          // Which of your buckets it's in, and why, while it's in your inbox.
          const triage = createMemo(() => thread().triage[me().id] ?? null);
          const bucket = createMemo(() =>
            bucketsOf(me()).find((candidate) => candidate.id === triage()?.bucketId),
          );

          return (
            <div class="details-content">
              {/* Who and what are in the thread's header; this is when and how far along. */}
              <Section title="Overview">
                <Row label="Status">
                  <span class="status-dot" data-status={thread().status} aria-hidden="true" />
                  {STATUS_LABELS[thread().status]}
                </Row>
                <Show when={due()}>
                  {(shown) => (
                    <Row label="Due">
                      <span data-overdue={String(shown().overdue)}>{shown().label}</span>
                    </Row>
                  )}
                </Show>
                <Show when={bucket() !== undefined && triage()}>
                  {(sorted) => (
                    <Row label="Bucket">
                      <div>{bucket()?.name}</div>
                      <div class="details-note">
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
                            class="details-label-link"
                            onClick={() => props.onOpenLabel(label.id)}
                          >
                            {label.name}
                          </button>
                        </div>
                      )}
                    </For>
                  </Row>
                </Show>
              </Section>

              <ThreadGraph
                current={thread()}
                threads={links.threads}
                onOpenThread={props.onOpenThread}
              />

              {/* The record of what's been done to the thread, including who made it on whose behalf. */}
              <Show when={history().length > 0}>
                <Section title="Activity">
                  <ul class="details-list">
                    <For each={history()}>
                      {(entry) => (
                        <li>
                          <button
                            type="button"
                            class="details-item"
                            onClick={() => reveal(entry.id)}
                          >
                            {entry.actor.name} {plainThreadLinks(entry.text, links.titleOf, nameOf)}{" "}
                            · {formatRelativeTime(entry.createdAtMs, props.nowMs)}
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
function ThreadGraph(props: {
  current: Thread;
  threads: Thread[];
  onOpenThread: (id: string) => void;
}): JSX.Element {
  const root = createMemo(() => {
    let root = props.current;
    const seen = new Set([root.id]);
    for (;;) {
      const parent = props.threads.find((other) => other.id === root.branchedFromId);
      if (parent === undefined || seen.has(parent.id)) break;
      seen.add(parent.id);
      root = parent;
    }
    return root;
  });

  const renderThread = (thread: Thread, depth: number): JSX.Element => {
    const branches = (): Thread[] => (depth < 8 ? branchesOf(thread, props.threads) : []);
    return (
      <>
        <button
          type="button"
          class="graph-thread"
          data-current={String(thread.id === props.current.id)}
          onClick={() => props.onOpenThread(thread.id)}
        >
          <span class="status-dot" data-status={thread.status} aria-hidden="true" />
          <span class="graph-title">{thread.title}</span>
        </button>
        <Show when={branches().length > 0}>
          <ul class="graph-children">
            <For each={branches()}>{(branch) => <li>{renderThread(branch, depth + 1)}</li>}</For>
          </ul>
        </Show>
      </>
    );
  };

  return (
    <Show when={root() !== props.current || branchesOf(props.current, props.threads).length > 0}>
      <Section title="Branches">
        <div class="graph">{renderThread(root(), 0)}</div>
      </Section>
    </Show>
  );
}
