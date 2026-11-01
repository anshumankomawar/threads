import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ArrowDown,
  Calendar,
  CalendarDays,
  Check,
  Clock,
  GitBranch,
  Hourglass,
  Link2,
  MicOff,
  Plus,
  Sparkles,
  Tag as TagIcon,
  Target,
  Video,
  X,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMe } from "../me";
import { CurrentThreadContext, useThreadLinks } from "../threadLinks";
import {
  closeThreadMenu,
  offerKey,
  THREAD_MENU_EVENT,
  THREAD_MENU_KEY,
  ThreadLinkNode,
  type ThreadMenuState,
} from "./threadLinkNode";
import { slotMissesDue } from "../inbox";
import {
  EFFORT_OPTIONS,
  formatEffort,
  plainThreadLinks,
  PRIORITY_LABELS,
  splitThreadLinks,
  STATUS_LABELS,
  TAGS,
  threadLink,
  type Entry,
  type Person,
  type Priority,
  type Schedule,
  type Status,
  type Thread,
} from "model";
import {
  DAY,
  formatClock,
  formatDue,
  formatRelativeTime,
  formatWhen,
  parseWhen,
  startOfDay,
} from "../format";
import { Identicon } from "./Identicon";
import { ThreadMinimap } from "./ThreadMinimap";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

const ICON_PROPS = { size: 13, strokeWidth: 1.7, "aria-hidden": true } as const;

export type MessageEntry = Extract<Entry, { kind: "message" }>;
type EventEntry = Extract<Entry, { kind: "event" }>;
// How a click changes the selection: toggle one message, or extend from the last one clicked.
type SelectMode = "toggle" | "range";
type ResolutionEntry = Extract<Entry, { kind: "resolution" }>;
type CallEntry = Extract<Entry, { kind: "call" }>;
type NotesEntry = Extract<Entry, { kind: "notes" }>;

export type ThreadActions = {
  onSend: (text: string) => void;
  onSetStatus: (status: Status) => void;
  onSetPriority: (priority: Priority) => void;
  onSetDue: (dueAtMs: number | null) => void;
  onSetEffort: (effortHours: number | null) => void;
  onSetTags: (tagIds: string[]) => void;
  onSetAssignee: (person: Person) => void;
  onSetSchedule: (schedule: Schedule | null) => void;
  // Starts a thread branching off this one, with the same people, and returns its id: from "New thread" in the
  // `#` menu, titled by what you typed.
  onBranch: (title: string) => string;
  // Moves messages out of this thread, into another or a new branch; asks where.
  onMoveMessages: (messages: MessageEntry[]) => void;
};

// A thread link as a chip with the linked thread's current title; clicking opens it beside this one.
function ThreadLinkChip({ threadId }: { threadId: string }): React.JSX.Element {
  const links = useThreadLinks();
  const title = links.titleOf(threadId) ?? "Thread";
  if (useContext(CurrentThreadContext) === threadId)
    return <span className="thread-link-self">#{title}</span>;
  return (
    <button
      type="button"
      className="thread-link"
      onClick={(event) => {
        event.stopPropagation();
        links.open(threadId);
      }}
    >
      <GitBranch size={11} strokeWidth={1.8} aria-hidden />
      {title}
    </button>
  );
}

// A message's text, with its thread links as chips.
function MessageText({
  text,
  className = "thread-text",
}: {
  text: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <LinkedText text={text} />
    </div>
  );
}

// Text with its thread links as chips, inline.
function LinkedText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {splitThreadLinks(text).map((part, index) =>
        "threadId" in part ? (
          <ThreadLinkChip key={index} threadId={part.threadId} />
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

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
  typed,
}: {
  label: string;
  icon?: React.ReactNode;
  tone?: string;
  options: { label: string; value: T; icon?: React.ReactNode }[];
  onSelect: (value: T) => void;
  // A field at the top of the menu for typing a value in words, with what it reads as.
  typed?: { placeholder: string; parse: (text: string) => { label: string; value: T } | null };
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const parsed = typed?.parse(text) ?? null;
  const choose = (value: T): void => {
    onSelect(value);
    setOpen(false);
    setText("");
  };
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
          {typed !== undefined && (
            <input
              className="chip-menu-input"
              placeholder={typed.placeholder}
              spellCheck={false}
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && parsed !== null) choose(parsed.value);
              }}
            />
          )}
          {parsed !== null && (
            <div className="chip-menu-row" role="menuitem" onClick={() => choose(parsed.value)}>
              {parsed.label}
            </div>
          )}
          {options.map((option) => (
            <div
              key={option.label}
              className="chip-menu-row"
              role="menuitem"
              onClick={() => choose(option.value)}
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

// "No tags", "Security", or "Security +1".
function tagsLabel(tagIds: string[]): string {
  const [first, ...rest] = TAGS.filter((tag) => tagIds.includes(tag.id));
  if (first === undefined) return "No tags";
  return rest.length === 0 ? first.name : `${first.name} +${rest.length}`;
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
}: {
  thread: Thread;
  ask: MessageEntry | undefined;
  nowMs: number;
  people: Person[];
  actions: ThreadActions;
}): React.JSX.Element {
  const due = thread.dueAtMs === null ? null : formatDue(thread.dueAtMs, nowMs);
  const statuses = Object.keys(STATUS_LABELS) as Status[];
  const priorities = Object.keys(PRIORITY_LABELS) as Priority[];
  const priorityTone =
    thread.priority === "urgent" ? "urgent" : thread.priority === "none" ? "muted" : undefined;
  const dueTone = due === null ? "muted" : due.overdue ? "urgent" : undefined;
  const isResponse = thread.kind === "response";

  // The title is the ask's first line, so the description is whatever follows it.
  const askText = ask?.text ?? "";
  const description = askText.startsWith(thread.title)
    ? askText.slice(thread.title.length).trim()
    : askText.trim();

  return (
    <header className="thread-header" id={ask === undefined ? undefined : `entry-${ask.id}`}>
      <h1 className="thread-title">{thread.title}</h1>
      <div className="thread-byline">
        {thread.kind === "meeting" ? (
          <>
            <CalendarDays {...ICON_PROPS} />
            <span>Meeting</span>
            <span className="thread-byline-dot">·</span>
            <span>organized by {thread.requester.name}</span>
            <span className="thread-byline-dot">·</span>
            <span className="thread-attendees">
              {thread.attendees.map((person) => (
                <span key={person.id} className="thread-attendee">
                  <Identicon seed={person.id} size={14} />
                  {person.name}
                </span>
              ))}
            </span>
          </>
        ) : thread.kind === "focus" ? (
          <>
            <Target {...ICON_PROPS} />
            <span>Focus block</span>
            <span className="thread-byline-dot">·</span>
            <span>{thread.requester.name}</span>
          </>
        ) : (
          <>
            <span className="thread-byline-person">
              <Identicon seed={thread.requester.id} size={14} />
              {thread.requester.name}
            </span>
            <span className="thread-ask-arrow">→</span>
            <MenuChip
              label={thread.assignee?.name ?? "Unassigned"}
              tone="assignee"
              options={people.map((person) => ({ label: person.name, value: person }))}
              onSelect={actions.onSetAssignee}
            />
          </>
        )}
        {thread.branchedFromId !== null && (
          <>
            <span className="thread-byline-dot">·</span>
            <span>Branched from</span>
            <ThreadLinkChip threadId={thread.branchedFromId} />
          </>
        )}
        {ask !== undefined && (
          <>
            <span className="thread-byline-dot">·</span>
            <span>{formatRelativeTime(ask.createdAtMs, nowMs)}</span>
          </>
        )}
      </div>
      <div className="thread-properties">
        {thread.kind !== "meeting" && (
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
        )}
        {isResponse ? (
          // A response's slot comes from the scheduler, so it only shows here.
          <span
            className="chip"
            data-tone={slotMissesDue(thread) ? "urgent" : "static"}
            title={
              slotMissesDue(thread)
                ? "The schedule couldn't fit this before its due date"
                : "Scheduled automatically by importance"
            }
          >
            <Clock {...ICON_PROPS} />
            {thread.schedule === null ? "No slot yet" : formatSchedule(thread.schedule, nowMs)}
          </span>
        ) : (
          <MenuChip
            label={
              thread.schedule === null ? "Not scheduled" : formatSchedule(thread.schedule, nowMs)
            }
            icon={<Clock {...ICON_PROPS} />}
            tone={thread.schedule === null ? "muted" : undefined}
            options={scheduleOptions(thread.schedule, nowMs)}
            onSelect={actions.onSetSchedule}
            typed={{
              placeholder: "Type a time…",
              parse: (text) => {
                const lengthMs =
                  thread.schedule === null
                    ? 30 * 60_000
                    : thread.schedule.endMs - thread.schedule.startMs;
                const when = parseWhen(text, nowMs, lengthMs);
                return when === null
                  ? null
                  : { label: formatWhen(when.startMs, nowMs), value: when };
              },
            }}
          />
        )}
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
            <MenuChip
              label={thread.effortHours === null ? "No estimate" : formatEffort(thread.effortHours)}
              icon={<Hourglass {...ICON_PROPS} />}
              tone={thread.effortHours === null ? "muted" : undefined}
              options={[
                ...EFFORT_OPTIONS.map((hours) => ({
                  label: formatEffort(hours),
                  value: hours as number | null,
                })),
                { label: "No estimate", value: null },
              ]}
              onSelect={actions.onSetEffort}
            />
            <MenuChip
              label={tagsLabel(thread.tagIds)}
              icon={<TagIcon {...ICON_PROPS} />}
              tone={thread.tagIds.length === 0 ? "muted" : undefined}
              options={TAGS.map((tag) => ({
                label: tag.name,
                value: tag.id as string,
                icon: thread.tagIds.includes(tag.id) ? <Check {...ICON_PROPS} /> : undefined,
              }))}
              onSelect={(tagId) =>
                actions.onSetTags(
                  thread.tagIds.includes(tagId)
                    ? thread.tagIds.filter((id) => id !== tagId)
                    : [...thread.tagIds, tagId],
                )
              }
            />
          </>
        )}
      </div>
      {description !== "" && (
        <MessageText text={description} className="thread-text thread-description" />
      )}
    </header>
  );
}

function MessageBlock({
  message,
  nowMs,
  selected,
  run,
  selecting,
  onSelect,
  onContextMenu,
}: {
  message: MessageEntry;
  nowMs: number;
  selected: boolean;
  // Where a selected message sits in a run of selected neighbours, so the run reads as one box.
  run: "single" | "start" | "middle" | "end" | undefined;
  // While some messages are selected, a click selects instead of placing the cursor.
  selecting: boolean;
  onSelect: (mode: SelectMode) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  const modeFor = (event: React.MouseEvent): SelectMode | undefined =>
    event.shiftKey ? "range" : event.metaKey || selecting ? "toggle" : undefined;
  return (
    <div
      className="thread-block thread-message"
      id={`entry-${message.id}`}
      data-selected={selected}
      data-run={run}
      data-selecting={selecting}
      onMouseDown={(event) => {
        // Shift-click selects messages, not text.
        if (event.shiftKey) event.preventDefault();
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a") !== null) return;
        const mode = modeFor(event);
        if (mode !== undefined) onSelect(mode);
      }}
      onContextMenu={onContextMenu}
    >
      <Avatar person={message.author} />
      <div className="thread-body">
        <div className="thread-meta">
          <span className="thread-author">{message.author.name}</span>
          <span className="thread-time">{formatRelativeTime(message.createdAtMs, nowMs)}</span>
        </div>
        <MessageText text={message.text} />
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
        <span className="thread-event-actor">{event.actor.name}</span>{" "}
        <LinkedText text={event.text} />
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
        <MessageText text={resolution.text} />
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

// The next message, written in place at the end of the thread. Enter sends, Shift+Enter breaks the line.
function ReplyBlock({
  placeholder,
  focusRef,
  onSubmit,
  onBranch,
  threadId,
}: {
  threadId: string;
  placeholder: string;
  focusRef: React.RefObject<(() => void) | null>;
  onSubmit: (text: string) => void;
  onBranch: ThreadActions["onBranch"];
}): React.JSX.Element {
  const me = useMe();
  const handlersRef = useRef({ onSubmit });
  useEffect(() => {
    handlersRef.current = { onSubmit };
  });

  const editor = useEditor({
    autofocus: "end",
    extensions: [
      // No underline, so ⌘U stays the app's user picker.
      StarterKit.configure({ heading: false, horizontalRule: false, underline: false }),
      Placeholder.configure({ placeholder }),
      ThreadLinkNode,
    ],
    editorProps: {
      attributes: { class: "thread-text thread-reply-editor", "aria-label": "Reply" },
      handleKeyDown: (view, event) => {
        // The `#` menu, when open, gets keys first.
        if (offerKey(view.dom, event)) return true;
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false;
        // Thread links go out as `[[thread:<id>]]`.
        const text = view.state.doc
          .textBetween(0, view.state.doc.content.size, "\n", (leaf) =>
            leaf.type.name === "threadLink" ? threadLink(String(leaf.attrs.id)) : "",
          )
          .trim();
        if (text.length > 0) {
          handlersRef.current.onSubmit(text);
          view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
        }
        return true;
      },
    },
  });

  // The `#` menu: the link node announces it on the editor; this renders it and handles its keys.
  const links = useThreadLinks();
  const [menu, setMenu] = useState<ThreadMenuState>(null);
  const [selected, setSelected] = useState(0);
  const options = menu === null ? [] : menuOptions(menu.query, links.search, threadId);
  const choose = (option: MenuOption): void => {
    if (menu === null) return;
    if (option.kind === "link") menu.pick(option.link);
    else menu.pick({ id: onBranch(option.title), title: option.title });
  };

  useEffect(() => {
    const dom = editor?.view.dom;
    if (dom === undefined) return;
    const onMenu = (event: Event): void => {
      setMenu((event as CustomEvent<ThreadMenuState>).detail);
      setSelected(0);
    };
    dom.addEventListener(THREAD_MENU_EVENT, onMenu);
    return () => dom.removeEventListener(THREAD_MENU_EVENT, onMenu);
  }, [editor]);

  useEffect(() => {
    const view = editor?.view;
    if (view === undefined || menu === null) return;
    const onKey = (event: Event): void => {
      const key = (event as CustomEvent<KeyboardEvent>).detail;
      if (key.key === "Escape") closeThreadMenu(view);
      else if (options.length === 0) return;
      else if (key.key === "ArrowDown") setSelected((selected + 1) % options.length);
      else if (key.key === "ArrowUp") setSelected((selected - 1 + options.length) % options.length);
      else if ((key.key === "Enter" && !key.shiftKey) || key.key === "Tab")
        choose(options[Math.min(selected, options.length - 1)]);
      else return;
      event.preventDefault();
    };
    view.dom.addEventListener(THREAD_MENU_KEY, onKey);
    return () => view.dom.removeEventListener(THREAD_MENU_KEY, onKey);
  });

  return (
    <div className="thread-block" onClick={() => editor?.commands.focus()}>
      <ReplyFocus editor={editor} focusRef={focusRef} />
      <Avatar person={me} />
      <div className="thread-body">
        <div className="thread-meta">
          <span className="thread-author">{me.name}</span>
        </div>
        <EditorContent editor={editor} className="thread-reply" />
      </div>
      {menu !== null && options.length > 0 && (
        <ThreadMenu
          rect={menu.rect}
          options={options}
          selected={Math.min(selected, options.length - 1)}
          onHover={setSelected}
          onChoose={choose}
        />
      )}
    </div>
  );
}

type MenuOption =
  | { kind: "link"; link: { id: string; title: string } }
  | { kind: "new"; title: string };

const MENU_MATCHES = 6;

// Threads matching what's typed after `#`, then a new thread titled by it unless one already has that title.
function menuOptions(
  query: string,
  search: (query: string) => { id: string; title: string }[],
  currentThreadId: string,
): MenuOption[] {
  const title = query.trim();
  const found = search(title);
  const matches = found.filter((thread) => thread.id !== currentThreadId).slice(0, MENU_MATCHES);
  const options: MenuOption[] = matches.map((link) => ({ kind: "link", link }));
  // No new thread named like one that exists, including the one you're in.
  const exact = found.some((thread) => thread.title.toLowerCase() === title.toLowerCase());
  if (title.length > 0 && !exact) options.push({ kind: "new", title });
  return options;
}

// The `#` menu, below the text being typed. Rendered on the body so the content zoom doesn't move it.
function ThreadMenu({
  rect,
  options,
  selected,
  onHover,
  onChoose,
}: {
  rect: DOMRect | null;
  options: MenuOption[];
  selected: number;
  onHover: (index: number) => void;
  onChoose: (option: MenuOption) => void;
}): React.JSX.Element | null {
  if (rect === null) return null;
  return createPortal(
    <div
      className="thread-menu"
      role="listbox"
      aria-label="Link a thread"
      style={{ left: rect.left, top: rect.bottom + 6 }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {options.map((option, index) => (
        <button
          key={option.kind === "link" ? option.link.id : "new"}
          type="button"
          role="option"
          aria-selected={index === selected}
          className="thread-menu-item"
          onMouseEnter={() => onHover(index)}
          onClick={() => onChoose(option)}
        >
          {option.kind === "link" ? (
            <>
              <GitBranch {...ICON_PROPS} />
              <span className="thread-menu-title">{option.link.title}</span>
            </>
          ) : (
            <>
              <Plus {...ICON_PROPS} />
              <span className="thread-menu-title">
                New thread <span className="thread-menu-new">“{option.title}”</span>
              </span>
            </>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// Who made an entry, if a person did.
function entryPerson(entry: Entry): Person | undefined {
  if (entry.kind === "message" || entry.kind === "resolution") return entry.author;
  if (entry.kind === "event") return entry.actor;
  return undefined;
}

export function ThreadView({
  thread,
  people,
  actions,
}: {
  thread: Thread;
  people: Person[];
  actions: ThreadActions;
}): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLElement>(null);
  const focusReplyRef = useRef<(() => void) | null>(null);
  const nowMs = useNow(60_000);
  const me = useMe();
  const entries = thread.entries;
  // The opening message moves into the header: a response's ask, a meeting's agenda, a focus block's note. Only the
  // one that opened the thread (its first line is the title); messages moved in from elsewhere stay as messages.
  const [first] = entries;
  const ask =
    first?.kind === "message" && first.text.split("\n")[0].trim() === thread.title.trim()
      ? first
      : undefined;
  const rest = ask === undefined ? entries : entries.slice(1);

  // Whether you're following the conversation: the reply block is on screen. Scroll it away to read back and new
  // entries from others stop moving the view; a pill counts them instead. `seenCount` is how many entries the thread
  // had the last time you were following.
  const [following, setFollowing] = useState(true);
  const [seenCount, setSeenCount] = useState(entries.length);
  const followingRef = useRef(true);
  const lengthRef = useRef<number | undefined>(undefined);

  // Puts the reply block at eye level: its bottom edge a third of the way down the view, so where you type sits just
  // above it. The overscroll spacer leaves room to scroll that far.
  const bringReplyIntoView = (behavior: ScrollBehavior = "auto"): void => {
    const scroller = scrollRef.current;
    const end = endRef.current;
    if (scroller === null || end === null) return;
    const offset = end.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({
      top: Math.max(0, scroller.scrollTop + offset - scroller.clientHeight / 3),
      behavior,
    });
  };

  // On opening a thread and whenever it grows: back to the reply block if you're following, or if you made the change.
  useEffect(() => {
    const previous = lengthRef.current;
    lengthRef.current = entries.length;
    if (previous !== undefined && entries.length <= previous) return;
    const added = previous === undefined ? [] : entries.slice(previous);
    const yours = added.some((entry) => entryPerson(entry)?.id === me.id);
    if (previous === undefined || followingRef.current || yours) bringReplyIntoView();
  }, [entries, me.id]);

  // Tracks following as you scroll; reaching the reply block marks everything seen.
  const onScroll = (): void => {
    const scroller = scrollRef.current;
    const end = endRef.current;
    if (scroller === null || end === null) return;
    const offset = end.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const onScreen = offset > 0 && offset <= scroller.clientHeight;
    followingRef.current = onScreen;
    if (onScreen !== following) setFollowing(onScreen);
    if (onScreen && seenCount !== entries.length) setSeenCount(entries.length);
  };

  // Messages selected to move, in thread order: right-click → Select, ⌘-click, or shift-click for a range. Kept
  // per thread; moved messages drop out of it on their own. Escape clears it.
  const { titleOf } = useThreadLinks();
  const [selection, setSelection] = useState<{
    threadId: string;
    ids: string[];
    anchor: string | null;
  }>({ threadId: thread.id, ids: [], anchor: null });
  const messages = rest.filter((entry): entry is MessageEntry => entry.kind === "message");
  const pickedIds = selection.threadId === thread.id ? selection.ids : [];
  const selected = messages.filter((message) => pickedIds.includes(message.id));
  const selecting = selected.length > 0;
  const select = (messageId: string, mode: SelectMode): void => {
    let ids: string[];
    if (mode === "toggle") {
      ids = pickedIds.includes(messageId)
        ? pickedIds.filter((id) => id !== messageId)
        : [...pickedIds, messageId];
    } else {
      const to = messages.findIndex((message) => message.id === messageId);
      const anchor = messages.findIndex((message) => message.id === selection.anchor);
      const from = anchor === -1 ? to : anchor;
      const range = messages.slice(Math.min(from, to), Math.max(from, to) + 1).map(({ id }) => id);
      ids = [...new Set([...pickedIds, ...range])];
    }
    setSelection({ threadId: thread.id, ids, anchor: messageId });
  };
  const clearSelection = (): void => setSelection({ threadId: thread.id, ids: [], anchor: null });
  const isPicked = (entry: Entry | undefined): boolean =>
    entry?.kind === "message" && pickedIds.includes(entry.id);
  const runAt = (index: number): "single" | "start" | "middle" | "end" | undefined => {
    if (!isPicked(rest[index])) return undefined;
    const before = isPicked(rest[index - 1]);
    const after = isPicked(rest[index + 1]);
    return before ? (after ? "middle" : "end") : after ? "start" : "single";
  };

  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented)
        setSelection((current) => ({ ...current, ids: [], anchor: null }));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting]);

  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const moveLabel = (count: number): string =>
    count === 1 ? "Move to thread…" : `Move ${count} messages to thread…`;
  const menuFor = (message: MessageEntry): ContextMenuItem[] => {
    if (pickedIds.includes(message.id))
      return [
        { label: moveLabel(selected.length), run: () => actions.onMoveMessages(selected) },
        "separator",
        { label: "Clear selection", shortcut: "Esc", run: clearSelection },
      ];
    return [
      { label: moveLabel(1), run: () => actions.onMoveMessages([message]) },
      {
        label: selecting ? "Add to selection" : "Select",
        shortcut: "⌘ Click",
        run: () => select(message.id, "toggle"),
      },
      "separator",
      {
        label: "Copy text",
        run: () => void navigator.clipboard.writeText(plainThreadLinks(message.text, titleOf)),
      },
    ];
  };

  // What arrived while you were reading back: messages and resolutions by others, else any activity.
  const unseen = following ? [] : entries.slice(seenCount);
  const unseenMessages = unseen.filter(
    (entry) =>
      (entry.kind === "message" || entry.kind === "resolution") && entryPerson(entry)?.id !== me.id,
  ).length;

  const placeholder =
    thread.kind === "meeting" ? "Add notes…" : thread.kind === "focus" ? "Add a note…" : "Reply…";

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
    <CurrentThreadContext value={thread.id}>
      <div className="thread-view">
        <div
          ref={scrollRef}
          className="thread-scroll"
          onMouseDown={onBackgroundMouseDown}
          onScroll={onScroll}
        >
          <article ref={docRef} className="thread-doc">
            <ThreadHeader
              thread={thread}
              ask={ask}
              nowMs={nowMs}
              people={people}
              actions={actions}
            />
            {rest.map((entry, index) => {
              if (entry.kind === "message")
                return (
                  <MessageBlock
                    key={entry.id}
                    message={entry}
                    nowMs={nowMs}
                    selected={pickedIds.includes(entry.id)}
                    run={runAt(index)}
                    selecting={selecting}
                    onSelect={(mode) => select(entry.id, mode)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({ x: event.clientX, y: event.clientY, items: menuFor(entry) });
                    }}
                  />
                );
              if (entry.kind === "event")
                return <EventLine key={entry.id} event={entry} nowMs={nowMs} />;
              if (entry.kind === "call")
                return <CallBlock key={entry.id} call={entry} thread={thread} nowMs={nowMs} />;
              if (entry.kind === "notes")
                return <NotesBlock key={entry.id} notes={entry} nowMs={nowMs} />;
              return <ResolutionBlock key={entry.id} resolution={entry} nowMs={nowMs} />;
            })}
            <ReplyBlock
              key={thread.id}
              placeholder={placeholder}
              focusRef={focusReplyRef}
              onSubmit={actions.onSend}
              onBranch={actions.onBranch}
              threadId={thread.id}
            />
            <div ref={endRef} />
          </article>
          {/* Room to scroll the last entry up to the top without losing it off screen. */}
          <div className="thread-overscroll" aria-hidden />
        </div>
        {selecting && (
          <div className="selection-bar" role="toolbar" aria-label="Selected messages">
            <span className="selection-bar-count">{selected.length} selected</span>
            <button
              type="button"
              className="selection-bar-move"
              onClick={() => actions.onMoveMessages(selected)}
            >
              <GitBranch {...ICON_PROPS} />
              Move to thread…
            </button>
            <button
              type="button"
              className="icon-button selection-bar-clear"
              aria-label="Clear selection"
              title="Clear selection (Esc)"
              onClick={clearSelection}
            >
              <X {...ICON_PROPS} />
            </button>
          </div>
        )}
        {menu !== null && (
          <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
        )}
        {unseen.length > 0 && !selecting && (
          <button
            type="button"
            className="thread-new-pill"
            onClick={() => bringReplyIntoView("smooth")}
          >
            <ArrowDown {...ICON_PROPS} />
            {unseenMessages === 0
              ? "New activity"
              : `${unseenMessages} new ${unseenMessages === 1 ? "message" : "messages"}`}
          </button>
        )}
        <ThreadMinimap entries={entries} scrollRef={scrollRef} nowMs={nowMs} />
      </div>
    </CurrentThreadContext>
  );
}
