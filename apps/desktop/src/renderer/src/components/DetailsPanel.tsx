import { formatClock, formatDue, formatRelativeTime } from "../format";
import {
  KIND_LABELS,
  plainThreadLinks,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Entry,
  type Person,
  type Thread,
} from "model";
import { useThreadLinks } from "../threadLinks";
import { Identicon } from "./Identicon";
import { useResizablePanel } from "./useResizablePanel";

type MessageEntry = Extract<Entry, { kind: "message" }>;

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

// The task at a glance: its properties, the latest update, what's been decided and what's left to do,
// all read from the thread so you don't have to scroll through it.
export function DetailsPanel({
  thread,
  nowMs,
}: {
  thread: Thread | undefined;
  nowMs: number;
}): React.JSX.Element {
  const { titleOf } = useThreadLinks();
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
        <div className="details-empty">Select a thread to see its details.</div>
        {handle}
      </aside>
    );
  }

  const messages = thread.entries.filter(
    (entry): entry is MessageEntry => entry.kind === "message",
  );
  const latest = [...thread.entries]
    .reverse()
    .find((entry) => entry.kind === "message" || entry.kind === "event");
  const tagged = messages.filter((message) => message.decision);
  const notes = thread.entries.flatMap((entry) => (entry.kind === "notes" ? [entry] : []));
  const noteDecisions = notes.flatMap((entry) =>
    entry.decisions.map((text) => ({ text, entryId: entry.id })),
  );
  const actionItems = notes.flatMap((entry) =>
    entry.actionItems.map((item) => ({ ...item, entryId: entry.id })),
  );
  const people = new Map<string, Person>();
  for (const person of [thread.requester, thread.assignee, ...thread.attendees]) {
    if (person !== null) people.set(person.id, person);
  }
  for (const message of messages) people.set(message.author.id, message.author);
  const started = thread.entries[0]?.createdAtMs;
  const due = thread.dueAtMs === null ? null : formatDue(thread.dueAtMs, nowMs);

  return (
    <aside ref={panelRef} className="details" style={{ width }}>
      <div className="topbar details-topbar">Details</div>
      <div className="details-content">
        <Section title="Overview">
          <Row label="Kind">{KIND_LABELS[thread.kind]}</Row>
          {thread.kind !== "meeting" && (
            <Row label="Status">
              <span className="status-dot" data-status={thread.status} aria-hidden />
              {STATUS_LABELS[thread.status]}
            </Row>
          )}
          {thread.kind === "response" && (
            <>
              <Row label="Priority">{PRIORITY_LABELS[thread.priority]}</Row>
              <Row label="Due">
                <span data-overdue={due?.overdue ?? false}>{due?.label ?? "No due date"}</span>
              </Row>
            </>
          )}
          <Row label={thread.kind === "meeting" ? "When" : "Scheduled"}>
            {thread.schedule === null
              ? "Not scheduled"
              : `${new Date(thread.schedule.startMs).toLocaleDateString(undefined, {
                  weekday: "short",
                })} ${formatClock(thread.schedule.startMs)}–${formatClock(thread.schedule.endMs)}`}
          </Row>
          {thread.kind === "response" && (
            <>
              <Row label="Requested by">
                <PersonChip person={thread.requester} />
              </Row>
              <Row label="Assignee">
                {thread.assignee === null ? "Unassigned" : <PersonChip person={thread.assignee} />}
              </Row>
            </>
          )}
          {thread.kind === "meeting" && (
            <>
              <Row label="Organizer">
                <PersonChip person={thread.requester} />
              </Row>
              <Row label="Attendees">
                <span className="details-people">
                  {thread.attendees.map((person) => (
                    <PersonChip key={person.id} person={person} />
                  ))}
                </span>
              </Row>
            </>
          )}
          {thread.kind === "focus" && (
            <Row label="Owner">
              <PersonChip person={thread.requester} />
            </Row>
          )}
        </Section>

        {latest !== undefined && (
          <Section title="Latest">
            <button type="button" className="details-latest" onClick={() => reveal(latest.id)}>
              <span className="details-latest-meta">
                <PersonChip person={latest.kind === "event" ? latest.actor : latest.author} />
                <span className="details-time">
                  {formatRelativeTime(latest.createdAtMs, nowMs)}
                </span>
              </span>
              <span className="details-latest-text">{plainThreadLinks(latest.text, titleOf)}</span>
            </button>
          </Section>
        )}

        {tagged.length + noteDecisions.length > 0 && (
          <Section title={`Decisions · ${tagged.length + noteDecisions.length}`}>
            <ul className="details-list">
              {tagged.map((message) => (
                <li key={message.id}>
                  <button type="button" className="details-item" onClick={() => reveal(message.id)}>
                    {plainThreadLinks(message.text, titleOf)}
                  </button>
                </li>
              ))}
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

        <Section title="Activity">
          <div className="details-stats">
            {messages.length} {messages.length === 1 ? "message" : "messages"} · {people.size}{" "}
            {people.size === 1 ? "person" : "people"}
            {started !== undefined && ` · started ${formatRelativeTime(started, nowMs)} ago`}
          </div>
        </Section>
      </div>
      {handle}
    </aside>
  );
}
