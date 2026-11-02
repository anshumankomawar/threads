import { formatClock, formatDue } from "../format";
import { mentionsIn, plainThreadLinks, STATUS_LABELS, type Person, type Thread } from "model";
import { useThreadLinks } from "../threadLinks";
import { Identicon } from "./Identicon";
import { useResizablePanel } from "./useResizablePanel";

function PersonChip({ person }: { person: Person }): React.JSX.Element {
  return (
    <span className="details-person">
      <Identicon seed={person.id} size={14} />
      {person.name}
    </span>
  );
}

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
}: {
  thread: Thread | undefined;
  nowMs: number;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const { threads } = useThreadLinks();
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

  const notes = thread.entries.flatMap((entry) => (entry.kind === "notes" ? [entry] : []));
  const noteDecisions = notes.flatMap((entry) =>
    entry.decisions.map((text) => ({ text, entryId: entry.id })),
  );
  const actionItems = notes.flatMap((entry) =>
    entry.actionItems.map((item) => ({ ...item, entryId: entry.id })),
  );
  const due = thread.dueAtMs === null ? null : formatDue(thread.dueAtMs, nowMs);
  // A meeting keeps its time once it's over; a response only lists what's still to come.
  const upcoming =
    thread.kind === "response"
      ? thread.blocks.filter((block) => block.endMs > nowMs)
      : thread.blocks;

  return (
    <aside ref={panelRef} className="details" style={{ width }}>
      <div className="topbar details-topbar">Details</div>
      <div className="details-content">
        {/* Who and what are in the thread's header; this is when and how far along. */}
        <Section title="Overview">
          {thread.kind !== "meeting" && (
            <Row label="Status">
              <span className="status-dot" data-status={thread.status} aria-hidden />
              {STATUS_LABELS[thread.status]}
            </Row>
          )}
          {thread.kind === "response" && due !== null && (
            <Row label="Due">
              <span data-overdue={due.overdue}>{due.label}</span>
            </Row>
          )}
          <Row label={thread.kind === "response" ? "Scheduled" : "When"}>
            {upcoming.length === 0
              ? "Not scheduled"
              : upcoming.map((block) => (
                  <div key={block.startMs}>
                    {new Date(block.startMs).toLocaleDateString(undefined, { weekday: "short" })}{" "}
                    {formatClock(block.startMs)}–{formatClock(block.endMs)}
                  </div>
                ))}
          </Row>
        </Section>

        <ThreadGraph current={thread} threads={threads} onOpenThread={onOpenThread} />

        {noteDecisions.length > 0 && (
          <Section title={`Decisions · ${noteDecisions.length}`}>
            <ul className="details-list">
              {noteDecisions.map((decision) => (
                <li key={decision.text}>
                  <button
                    type="button"
                    className="details-item"
                    onClick={() => reveal(decision.entryId)}
                  >
                    {decision.text}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {actionItems.length > 0 && (
          <Section title={`Action items · ${actionItems.length}`}>
            <ul className="details-list details-actions">
              {actionItems.map((item) => (
                <li key={item.text}>
                  <span className="notes-check" aria-hidden />
                  <span className="details-action-text">
                    {item.text}
                    <PersonChip person={item.owner} />
                  </span>
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

// One step in a thread's history: someone asked people a question in it, or a thread branched off it.
type GraphItem =
  | {
      kind: "ask";
      id: string;
      atMs: number;
      from: Person;
      to: Person[];
      text: string;
      answered: boolean;
    }
  | { kind: "branch"; id: string; atMs: number; thread: Thread };

// What happened in a thread, oldest first: its questions (mentions) and its branches.
function graphItems(thread: Thread, threads: Thread[]): GraphItem[] {
  const asks = thread.entries.flatMap((entry): GraphItem[] => {
    if (entry.kind !== "message") return [];
    const to = mentionsIn(entry.text).flatMap((id) => {
      const person = threads
        .flatMap((other) => [other.requester, other.assignee, ...other.attendees])
        .find((candidate) => candidate?.id === id);
      return person == null || id === entry.author.id ? [] : [person];
    });
    if (to.length === 0) return [];
    const answered = to.every((person) =>
      thread.entries.some(
        (later) =>
          later.kind === "message" &&
          later.author.id === person.id &&
          later.createdAtMs > entry.createdAtMs,
      ),
    );
    return [
      {
        kind: "ask",
        id: entry.id,
        atMs: entry.createdAtMs,
        from: entry.author,
        to,
        text: entry.text,
        answered,
      },
    ];
  });
  const branches = threads.flatMap((other): GraphItem[] =>
    other.branchedFromId === thread.id
      ? [{ kind: "branch", id: other.id, atMs: other.entries[0]?.createdAtMs ?? 0, thread: other }]
      : [],
  );
  return [...asks, ...branches].sort((a, b) => a.atMs - b.atMs);
}

// The thread's family as a graph, like `git log --graph`: from the thread everything branched from, each branch
// forks off where it started, with the questions asked along the way. Click a thread to open it, a question to jump
// to it. Nothing shows for a thread with no branches or questions.
function ThreadGraph({
  current,
  threads,
  onOpenThread,
}: {
  current: Thread;
  threads: Thread[];
  onOpenThread: (id: string) => void;
}): React.JSX.Element | null {
  const { titleOf, nameOf } = useThreadLinks();
  let root = current;
  const seen = new Set([root.id]);
  for (;;) {
    const parent = threads.find((other) => other.id === root.branchedFromId);
    if (parent === undefined || seen.has(parent.id)) break;
    seen.add(parent.id);
    root = parent;
  }
  if (root === current && graphItems(current, threads).length === 0) return null;
  // A question as its words, without the mentions it opens with.
  const questionText = (text: string): string =>
    plainThreadLinks(text, titleOf, nameOf).replace(/^(@\S+\s*)+/, "");

  const renderThread = (thread: Thread, depth: number): React.JSX.Element => {
    const items = depth < 8 ? graphItems(thread, threads) : [];
    return (
      <>
        <button
          type="button"
          className="graph-thread"
          data-current={thread.id === current.id}
          onClick={() => onOpenThread(thread.id)}
        >
          <span className="status-dot" data-status={thread.status} aria-hidden />
          <span className="graph-title">{thread.title}</span>
        </button>
        {items.length > 0 && (
          <ul className="graph-children">
            {items.map((item) => (
              <li key={item.id}>
                {item.kind === "branch" ? (
                  renderThread(item.thread, depth + 1)
                ) : (
                  <button
                    type="button"
                    className="graph-ask"
                    data-answered={item.answered}
                    onClick={() =>
                      thread.id === current.id ? reveal(item.id) : onOpenThread(thread.id)
                    }
                  >
                    <span className="graph-at" aria-hidden>
                      @
                    </span>
                    <span
                      className="graph-title"
                      title={`${firstName(item.from)} asked ${item.to.map(firstName).join(", ")}`}
                    >
                      <span className="graph-asker">{firstName(item.from)}</span>{" "}
                      {questionText(item.text)}
                    </span>
                    {item.answered && <span className="graph-answered">answered</span>}
                  </button>
                )}
              </li>
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
