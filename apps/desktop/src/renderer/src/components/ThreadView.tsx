import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bookmark,
  Calendar,
  CalendarDays,
  Check,
  Clock,
  Link2,
  MicOff,
  RotateCcw,
  Sparkles,
  Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { me } from "../me";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Entry,
  type Person,
  type Priority,
  type Schedule,
  type Status,
  type Thread,
} from "model";
import { DAY, formatClock, formatDue, formatRelativeTime, startOfDay } from "../format";
import { Identicon } from "./Identicon";
import { ThreadMinimap } from "./ThreadMinimap";

const ICON_PROPS = { size: 13, strokeWidth: 1.7, "aria-hidden": true } as const;

type MessageEntry = Extract<Entry, { kind: "message" }>;
type EventEntry = Extract<Entry, { kind: "event" }>;
type ResolutionEntry = Extract<Entry, { kind: "resolution" }>;
type CallEntry = Extract<Entry, { kind: "call" }>;
type NotesEntry = Extract<Entry, { kind: "notes" }>;

export type ThreadActions = {
  onSend: (text: string) => void;
  onResolve: (text: string) => void;
  onReopen: () => void;
  onSetStatus: (status: Status) => void;
  onSetPriority: (priority: Priority) => void;
  onSetDue: (dueAtMs: number | null) => void;
  onSetAssignee: (person: Person) => void;
  onSetSchedule: (schedule: Schedule | null) => void;
  onToggleDecision: (entryId: string) => void;
};

// Due-date shortcuts, each landing at 5pm on that day.
function dueOptions(nowMs: number): { label: string; value: number | null }[] {
  const at5pm = (offsetDays: number): number => {
    const date = new Date(startOfDay(nowMs) + offsetDays * DAY);
    date.setHours(17, 0, 0, 0);
    return date.getTime();
  };
  const daysToFriday = (5 - new Date(nowMs).getDay() + 7) % 7 || 7;
  return [
    { label: "Today", value: at5pm(0) },
    { label: "Tomorrow", value: at5pm(1) },
    { label: "This Friday", value: at5pm(daysToFriday) },
    { label: "Next week", value: at5pm(7) },
    { label: "No due date", value: null },
  ];
}

// "2:00 PM–2:30 PM" today, "Mon 10:00 AM" on another day.
function formatSchedule(schedule: Schedule, nowMs: number): string {
  if (startOfDay(schedule.startMs) !== startOfDay(nowMs)) {
    const day = new Date(schedule.startMs).toLocaleDateString(undefined, { weekday: "short" });
    return `${day} ${formatClock(schedule.startMs)}`;
  }
  return `${formatClock(schedule.startMs)}–${formatClock(schedule.endMs)}`;
}

// Scheduling shortcuts: each remaining hour today (9 to 6), tomorrow morning, or off the timeline.
// The block keeps its current length, 30 minutes by default.
function scheduleOptions(
  current: Schedule | null,
  nowMs: number,
): { label: string; value: Schedule | null }[] {
  const lengthMs = current === null ? 30 * 60_000 : current.endMs - current.startMs;
  const at = (dayOffset: number, hour: number): Schedule => {
    const date = new Date(startOfDay(nowMs) + dayOffset * DAY);
    date.setHours(hour, 0, 0, 0);
    return { startMs: date.getTime(), endMs: date.getTime() + lengthMs };
  };
  const firstHour = Math.max(9, new Date(nowMs).getHours() + 1);
  const today = Array.from({ length: Math.max(0, 19 - firstHour) }, (_, i) => at(0, firstHour + i));
  return [
    ...today.map((schedule) => ({
      label: `Today, ${formatClock(schedule.startMs)}`,
      value: schedule,
    })),
    { label: "Tomorrow, 10:00 AM", value: at(1, 10) },
    { label: "Not scheduled", value: null },
  ];
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Avatar({ person }: { person: Person }): React.JSX.Element {
  return (
    <span className="thread-avatar">
      <Identicon seed={person.id} size={20} />
    </span>
  );
}

// A property chip that opens a small menu of options, styled like the search panel.
function MenuChip<T>({
  label,
  icon,
  tone,
  options,
  onSelect,
}: {
  label: string;
  icon?: React.ReactNode;
  tone?: string;
  options: { label: string; value: T; icon?: React.ReactNode }[];
  onSelect: (value: T) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="chip-anchor">
      <button
        type="button"
        className="chip"
        data-tone={tone}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
      </button>
      {open && (
        <div className="chip-menu" role="menu">
          {options.map((option) => (
            <div
              key={option.label}
              className="chip-menu-row"
              role="menuitem"
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
            >
              {option.icon}
              {option.label}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function StatusDot({ status }: { status: Status }): React.JSX.Element {
  return <span className="status-dot" data-status={status} aria-hidden />;
}

// The first message, shown as the ask: who wants what from whom, plus the task's properties.
// The top of every thread. A response shows the ask (who wants what from whom); a meeting shows its title,
// organizer and attendees; a focus block shows the work you set out to do. All share the property chips.
function ThreadHeader({
  thread,
  ask,
  nowMs,
  people,
  actions,
  onMarkDone,
}: {
  thread: Thread;
  ask: MessageEntry | undefined;
  nowMs: number;
  people: Person[];
  actions: ThreadActions;
  onMarkDone: () => void;
}): React.JSX.Element {
  const due = thread.dueAtMs === null ? null : formatDue(thread.dueAtMs, nowMs);
  const statuses = (Object.keys(STATUS_LABELS) as Status[]).filter((status) => status !== "done");
  const priorities = Object.keys(PRIORITY_LABELS) as Priority[];
  const priorityTone =
    thread.priority === "urgent" ? "urgent" : thread.priority === "none" ? "muted" : undefined;
  const dueTone = due === null ? "muted" : due.overdue ? "urgent" : undefined;
  const isResponse = thread.kind === "response";

  return (
    <div className="thread-block thread-ask" id={ask === undefined ? undefined : `entry-${ask.id}`}>
      {thread.kind === "meeting" ? (
        <span className="thread-avatar thread-kind-marker" aria-hidden>
          <CalendarDays size={12} strokeWidth={1.8} />
        </span>
      ) : (
        <Avatar person={thread.requester} />
      )}
      <div className="thread-body">
        <div className="thread-meta">
          {thread.kind === "meeting" ? (
            <>
              <span className="thread-author">Meeting</span>
              <span className="thread-time">organized by {thread.requester.name}</span>
            </>
          ) : thread.kind === "focus" ? (
            <>
              <span className="thread-author">Focus block</span>
              <span className="thread-time">{thread.requester.name}</span>
            </>
          ) : (
            <>
              <span className="thread-author">{thread.requester.name}</span>
              <span className="thread-ask-arrow">→</span>
              <MenuChip
                label={thread.assignee?.name ?? "Unassigned"}
                tone="assignee"
                options={people.map((person) => ({ label: person.name, value: person }))}
                onSelect={actions.onSetAssignee}
              />
              {ask !== undefined && (
                <span className="thread-time">{formatRelativeTime(ask.createdAtMs, nowMs)}</span>
              )}
            </>
          )}
        </div>
        <div className="thread-text">{ask?.text ?? thread.title}</div>
        {thread.kind === "meeting" && (
          <div className="thread-attendees">
            {thread.attendees.map((person) => (
              <span key={person.id} className="thread-attendee">
                <Identicon seed={person.id} size={16} />
                {person.name}
              </span>
            ))}
          </div>
        )}
        <div className="thread-properties">
          {thread.kind !== "meeting" &&
            (thread.status === "done" ? (
              <span className="chip" data-tone="static">
                <StatusDot status="done" />
                Done
              </span>
            ) : (
              <MenuChip
                label={STATUS_LABELS[thread.status]}
                icon={<StatusDot status={thread.status} />}
                options={statuses.map((status) => ({
                  label: STATUS_LABELS[status],
                  value: status,
                  icon: <StatusDot status={status} />,
                }))}
                onSelect={actions.onSetStatus}
              />
            ))}
          <MenuChip
            label={
              thread.schedule === null ? "Not scheduled" : formatSchedule(thread.schedule, nowMs)
            }
            icon={<Clock {...ICON_PROPS} />}
            tone={thread.schedule === null ? "muted" : undefined}
            options={scheduleOptions(thread.schedule, nowMs)}
            onSelect={actions.onSetSchedule}
          />
          {isResponse && (
            <>
              <MenuChip
                label={PRIORITY_LABELS[thread.priority]}
                tone={priorityTone}
                options={priorities.map((priority) => ({
                  label: PRIORITY_LABELS[priority],
                  value: priority,
                }))}
                onSelect={actions.onSetPriority}
              />
              <MenuChip
                label={due?.label ?? "No due date"}
                icon={<Calendar {...ICON_PROPS} />}
                tone={dueTone}
                options={dueOptions(nowMs)}
                onSelect={actions.onSetDue}
              />
            </>
          )}
          {thread.status === "done" ? (
            <button type="button" className="chip chip-action" onClick={actions.onReopen}>
              <RotateCcw {...ICON_PROPS} />
              Reopen
            </button>
          ) : (
            <button type="button" className="chip chip-action" onClick={onMarkDone}>
              <Check {...ICON_PROPS} />
              Mark done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBlock({
  message,
  nowMs,
  onToggleDecision,
}: {
  message: MessageEntry;
  nowMs: number;
  onToggleDecision: () => void;
}): React.JSX.Element {
  const label = message.decision ? "Unmark as decision" : "Mark as decision";
  return (
    <div className="thread-block thread-message" id={`entry-${message.id}`}>
      <Avatar person={message.author} />
      <div className="thread-body">
        <div className="thread-meta">
          <span className="thread-author">{message.author.name}</span>
          <span className="thread-time">{formatRelativeTime(message.createdAtMs, nowMs)}</span>
          {message.decision && <span className="decision-tag">Decision</span>}
          <button
            type="button"
            className="icon-button thread-message-action"
            aria-label={label}
            title={label}
            onClick={onToggleDecision}
          >
            <Bookmark {...ICON_PROPS} fill={message.decision ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="thread-text">{message.text}</div>
      </div>
    </div>
  );
}

function EventLine({ event, nowMs }: { event: EventEntry; nowMs: number }): React.JSX.Element {
  return (
    <div className="thread-block thread-event" id={`entry-${event.id}`}>
      <span className="thread-avatar thread-event-marker" aria-hidden>
        <span />
      </span>
      <div className="thread-event-text">
        <span className="thread-event-actor">{event.actor.name}</span> {event.text}
        <span className="thread-event-time"> · {formatRelativeTime(event.createdAtMs, nowMs)}</span>
      </div>
    </div>
  );
}

function ResolutionMarker(): React.JSX.Element {
  return (
    <span className="thread-avatar thread-resolution-marker" aria-hidden>
      <Check size={12} strokeWidth={2.2} />
    </span>
  );
}

function ResolutionBlock({
  resolution,
  nowMs,
}: {
  resolution: ResolutionEntry;
  nowMs: number;
}): React.JSX.Element {
  return (
    <div className="thread-block thread-resolution" id={`entry-${resolution.id}`}>
      <ResolutionMarker />
      <div className="thread-body">
        <div className="thread-meta">
          <span className="thread-author">Done</span>
          <span className="thread-time">
            {resolution.author.name} · {formatRelativeTime(resolution.createdAtMs, nowMs)}
          </span>
        </div>
        <div className="thread-text">{resolution.text}</div>
      </div>
    </div>
  );
}

// Where a meeting's call stands relative to now: about to start, live, or over.
function callState(thread: Thread, nowMs: number): string {
  const schedule = thread.schedule;
  if (schedule === null) return "Not scheduled";
  if (nowMs < schedule.startMs - 5 * 60_000) return `Starts at ${formatClock(schedule.startMs)}`;
  if (nowMs < schedule.endMs) return "In progress";
  return `Ended · ${Math.round((schedule.endMs - schedule.startMs) / 60_000)} min`;
}

// A stand-in for an embedded video call: participant tiles and a join bar. Not wired to anything yet.
function CallBlock({
  call,
  thread,
  nowMs,
}: {
  call: CallEntry;
  thread: Thread;
  nowMs: number;
}): React.JSX.Element {
  const state = callState(thread, nowMs);
  const ended = state.startsWith("Ended");

  return (
    <div className="thread-block" id={`entry-${call.id}`}>
      <span className="thread-avatar thread-kind-marker" aria-hidden>
        <Video size={12} strokeWidth={1.8} />
      </span>
      <div className="thread-body">
        <div className="thread-meta">
          <span className="thread-author">Video call</span>
          <span className="thread-time">{state}</span>
        </div>
        <div className="call-card" data-ended={ended}>
          <div className="call-tiles">
            {thread.attendees.map((person) => (
              <div key={person.id} className="call-tile">
                <Identicon seed={person.id} size={26} />
                <span className="call-tile-name">
                  <MicOff size={10} strokeWidth={2} aria-hidden />
                  {person.name}
                </span>
              </div>
            ))}
          </div>
          <div className="call-bar">
            <span className="call-link">
              <Link2 {...ICON_PROPS} />
              {call.link}
            </span>
            <button type="button" className="call-join" disabled={ended}>
              <Video {...ICON_PROPS} />
              {ended ? "Call ended" : "Join"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Notes written up after a meeting: summary, decisions, and action items with owners. Placeholder content for now.
function NotesBlock({ notes, nowMs }: { notes: NotesEntry; nowMs: number }): React.JSX.Element {
  return (
    <div className="thread-block" id={`entry-${notes.id}`}>
      <span className="thread-avatar thread-kind-marker thread-notes-marker" aria-hidden>
        <Sparkles size={12} strokeWidth={1.8} />
      </span>
      <div className="thread-body">
        <div className="thread-meta">
          <span className="thread-author">Meeting notes</span>
          <span className="thread-time">
            AI summary · {formatRelativeTime(notes.createdAtMs, nowMs)}
          </span>
        </div>
        <div className="thread-text">{notes.summary}</div>
        <div className="notes-section">
          <div className="notes-label">Decisions</div>
          <ul className="notes-list">
            {notes.decisions.map((decision) => (
              <li key={decision}>{decision}</li>
            ))}
          </ul>
        </div>
        <div className="notes-section">
          <div className="notes-label">Action items</div>
          <ul className="notes-list notes-actions">
            {notes.actionItems.map((action) => (
              <li key={action.text}>
                <span className="notes-check" aria-hidden />
                <span className="notes-action-text">{action.text}</span>
                <span className="notes-owner">
                  <Identicon seed={action.owner.id} size={14} />
                  {action.owner.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// Hands the thread a way to focus the reply, for clicks on empty space around the document.
function ReplyFocus({
  editor,
  focusRef,
}: {
  editor: ReturnType<typeof useEditor>;
  focusRef: React.RefObject<(() => void) | null>;
}): null {
  useEffect(() => {
    focusRef.current = () => editor?.commands.focus("end");
    return () => {
      focusRef.current = null;
    };
  }, [editor, focusRef]);
  return null;
}

// The next message, written in place at the end of the thread. Enter sends, Shift+Enter breaks the line;
// in resolve mode the text becomes the resolution note and Escape backs out.
function ReplyBlock({
  placeholder,
  resolving,
  focusRef,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  resolving: boolean;
  focusRef: React.RefObject<(() => void) | null>;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const handlersRef = useRef({ onSubmit, onCancel });
  useEffect(() => {
    handlersRef.current = { onSubmit, onCancel };
  });

  const editor = useEditor({
    autofocus: "end",
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false }),
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: { class: "thread-text thread-reply-editor", "aria-label": "Reply" },
      handleKeyDown: (view, event) => {
        if (event.key === "Escape") {
          handlersRef.current.onCancel();
          return false;
        }
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false;
        const text = view.state.doc.textBetween(0, view.state.doc.content.size, "\n").trim();
        if (text.length > 0) {
          handlersRef.current.onSubmit(text);
          view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
        }
        return true;
      },
    },
  });

  return (
    <div className="thread-block" onClick={() => editor?.commands.focus()}>
      <ReplyFocus editor={editor} focusRef={focusRef} />
      {resolving ? <ResolutionMarker /> : <Avatar person={me} />}
      <div className="thread-body">
        <div className="thread-meta">
          <span className="thread-author">{resolving ? "Resolve" : me.name}</span>
          {resolving && <span className="thread-time">Enter to mark done · Esc to cancel</span>}
        </div>
        <EditorContent editor={editor} className="thread-reply" />
      </div>
    </div>
  );
}

export function ThreadView({
  thread,
  people,
  actions,
}: {
  thread: Thread | undefined;
  people: Person[];
  actions: ThreadActions;
}): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLElement>(null);
  const focusReplyRef = useRef<(() => void) | null>(null);
  const nowMs = useNow(60_000);
  const [resolving, setResolving] = useState(false);
  const entries = thread?.entries ?? [];
  // The opening message moves into the header: a response's ask, a meeting's agenda, a focus block's note.
  const [first] = entries;
  const ask = first?.kind === "message" ? first : undefined;
  const rest = ask === undefined ? entries : entries.slice(1);

  // Keep the reply block in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  const placeholder = resolving
    ? "How was this resolved?"
    : thread?.kind === "meeting"
      ? "Add notes…"
      : thread?.kind === "focus"
        ? "Add a note…"
        : ask === undefined
          ? "What do you need? This becomes the ask."
          : "Reply…";

  // Clicking empty space in the thread, including below the last block, puts the cursor in the reply.
  const onBackgroundMouseDown = (event: React.MouseEvent): void => {
    const target = event.target as HTMLElement;
    const empty =
      target === scrollRef.current ||
      target === docRef.current ||
      target.classList.contains("thread-overscroll");
    if (!empty) return;
    event.preventDefault();
    focusReplyRef.current?.();
  };

  return (
    <div className="thread-view">
      <div ref={scrollRef} className="thread-scroll" onMouseDown={onBackgroundMouseDown}>
        <article ref={docRef} className="thread-doc">
          {thread !== undefined && (thread.kind !== "response" || ask !== undefined) && (
            <h1 className="thread-title">{thread.title}</h1>
          )}
          {thread !== undefined && (thread.kind !== "response" || ask !== undefined) && (
            <ThreadHeader
              thread={thread}
              ask={ask}
              nowMs={nowMs}
              people={people}
              actions={actions}
              onMarkDone={() => setResolving(true)}
            />
          )}
          {rest.map((entry) => {
            if (entry.kind === "message")
              return (
                <MessageBlock
                  key={entry.id}
                  message={entry}
                  nowMs={nowMs}
                  onToggleDecision={() => actions.onToggleDecision(entry.id)}
                />
              );
            if (entry.kind === "event")
              return <EventLine key={entry.id} event={entry} nowMs={nowMs} />;
            if (entry.kind === "call")
              return thread === undefined ? null : (
                <CallBlock key={entry.id} call={entry} thread={thread} nowMs={nowMs} />
              );
            if (entry.kind === "notes")
              return <NotesBlock key={entry.id} notes={entry} nowMs={nowMs} />;
            return <ResolutionBlock key={entry.id} resolution={entry} nowMs={nowMs} />;
          })}
          <ReplyBlock
            key={`${thread?.id ?? "new"}-${resolving ? "resolve" : "reply"}`}
            placeholder={placeholder}
            resolving={resolving}
            focusRef={focusReplyRef}
            onSubmit={(text) => {
              if (resolving) {
                actions.onResolve(text);
                setResolving(false);
              } else {
                actions.onSend(text);
              }
            }}
            onCancel={() => setResolving(false)}
          />
          <div ref={endRef} />
        </article>
        {/* Room to scroll the last entry up to the top without losing it off screen. */}
        <div className="thread-overscroll" aria-hidden />
      </div>
      <ThreadMinimap
        entries={entries}
        scrollRef={scrollRef}
        nowMs={nowMs}
        onToggleDecision={actions.onToggleDecision}
      />
    </div>
  );
}
