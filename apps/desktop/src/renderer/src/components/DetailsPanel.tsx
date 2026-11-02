import { formatDue, formatRelativeTime } from "../format";
import { bucketsOf, plainThreadLinks, STATUS_LABELS, type Person, type Thread } from "model";
import { useMe } from "../me";
import { useThreadLinks } from "../threadLinks";
import { useResizablePanel } from "./useResizablePanel";

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="details-row">
      <span className="details-label">{label}</span>
      <span className="details-value">{children}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="details-section">
      <div className="details-section-label">{title}</div>
      {children}
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
export function DetailsPanel({
  thread,
  nowMs,
  onOpenThread,
  onOpenLabel,
}: {
  thread: Thread | undefined;
  nowMs: number;
  onOpenThread: (id: string) => void;
  onOpenLabel: (id: string) => void;
}): React.JSX.Element {
  const { threads, titleOf, people, labels } = useThreadLinks();
  const me = useMe();
  const { panelRef, width, handle } = useResizablePanel({
    storageKey: "details-width",
    defaultWidth: 280,
    minWidth: 240,
    maxWidth: 480,
    edge: "left",
  });

  if (thread === undefined) {
    return (
      <aside ref={panelRef} className="details" style={{ width }}>
        <div className="topbar details-topbar">Details</div>
        {handle}
      </aside>
    );
  }

  const due = thread.dueAtMs === null ? null : formatDue(thread.dueAtMs, nowMs);
  const onLabels = labels.filter((label) => thread.labelIds.includes(label.id));
  const history = thread.entries.flatMap((entry) => (entry.kind === "event" ? [entry] : []));
  const nameOf = (personId: string): string | undefined =>
    people.find((person) => person.id === personId)?.name;
  // Which of your buckets it's in, and why, while it's waiting on you.
  const triage = thread.triage?.personId === me.id ? thread.triage : null;
  const bucket = bucketsOf(me).find((candidate) => candidate.id === triage?.bucketId);

  return (
    <aside ref={panelRef} className="details" style={{ width }}>
      <div className="topbar details-topbar">Details</div>
      <div className="details-content">
        {/* Who and what are in the thread's header; this is when and how far along. */}
        <Section title="Overview">
          <Row label="Status">
            <span className="status-dot" data-status={thread.status} aria-hidden />
            {STATUS_LABELS[thread.status]}
          </Row>
          {due !== null && (
            <Row label="Due">
              <span data-overdue={due.overdue}>{due.label}</span>
            </Row>
          )}
          {bucket !== undefined && triage !== null && (
            <Row label="Bucket">
              <div>{bucket.name}</div>
              <div className="details-note">
                {triage.manual ? "Placed by you" : triage.reason || "Sorted by the model"}
              </div>
            </Row>
          )}
          {onLabels.length > 0 && (
            <Row label="Labels">
              {onLabels.map((label) => (
                <div key={label.id}>
                  <button
                    type="button"
                    className="details-label-link"
                    onClick={() => onOpenLabel(label.id)}
                  >
                    {label.name}
                  </button>
                </div>
              ))}
            </Row>
          )}
        </Section>

        <ThreadGraph current={thread} threads={threads} onOpenThread={onOpenThread} />

        {/* The record of what's been done to the thread, including who made it on whose behalf. */}
        {history.length > 0 && (
          <Section title="Activity">
            <ul className="details-list">
              {history.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className="details-item" onClick={() => reveal(entry.id)}>
                    {entry.actor.name} {plainThreadLinks(entry.text, titleOf, nameOf)} ·{" "}
                    {formatRelativeTime(entry.createdAtMs, nowMs)}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
      {handle}
    </aside>
  );
}

// The threads branched off a thread, conversations included, oldest first.
function branchesOf(thread: Thread, threads: Thread[]): Thread[] {
  return threads
    .filter((other) => other.branchedFromId === thread.id)
    .toSorted((a, b) => (a.entries[0]?.createdAtMs ?? 0) - (b.entries[0]?.createdAtMs ?? 0));
}

// The thread's family as a graph, like `git log --graph`: from the thread everything branched from, each branch and
// conversation forks off where it started. Click one to open it. Nothing shows for a thread with no branches.
function ThreadGraph({
  current,
  threads,
  onOpenThread,
}: {
  current: Thread;
  threads: Thread[];
  onOpenThread: (id: string) => void;
}): React.JSX.Element | null {
  let root = current;
  const seen = new Set([root.id]);
  for (;;) {
    const parent = threads.find((other) => other.id === root.branchedFromId);
    if (parent === undefined || seen.has(parent.id)) break;
    seen.add(parent.id);
    root = parent;
  }
  if (root === current && branchesOf(current, threads).length === 0) return null;

  const renderThread = (thread: Thread, depth: number): React.JSX.Element => {
    const branches = depth < 8 ? branchesOf(thread, threads) : [];
    return (
      <>
        <button
          type="button"
          className="graph-thread"
          data-current={thread.id === current.id}
          onClick={() => onOpenThread(thread.id)}
        >
          {thread.kind === "conversation" ? (
            <span className="graph-at" aria-hidden>
              @
            </span>
          ) : (
            <span className="status-dot" data-status={thread.status} aria-hidden />
          )}
          <span
            className="graph-title"
            title={
              thread.kind === "conversation"
                ? `With ${thread.attendees.map(firstName).join(", ")}`
                : undefined
            }
          >
            {thread.title}
          </span>
        </button>
        {branches.length > 0 && (
          <ul className="graph-children">
            {branches.map((branch) => (
              <li key={branch.id}>{renderThread(branch, depth + 1)}</li>
            ))}
          </ul>
        )}
      </>
    );
  };

  return (
    <Section title="Branches">
      <div className="graph">{renderThread(root, 0)}</div>
    </Section>
  );
}

function firstName(person: Person): string {
  return person.name.split(" ")[0];
}
