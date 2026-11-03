import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  InboxIcon,
  ArrowDown02Icon,
  Calendar01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  GitBranchIcon,
  HourglassIcon,
  TaskAdd01Icon,
  Tag01Icon,
  Tick02Icon,
  UnavailableIcon,
} from "@hugeicons/core-free-icons";
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
import {
  closeCommandMenu,
  COMMAND_MENU_EVENT,
  COMMANDS,
  SlashCommands,
  type CommandMenuState,
  type CommandName,
} from "./slashCommands";
import {
  closeMentionMenu,
  MENTION_MENU_EVENT,
  MentionNode,
  type MentionMenuState,
} from "./mentionNode";
import { selectableLabels } from "../groups";
import {
  isDone,
  EFFORT_OPTIONS,
  formatEffort,
  labelSlug,
  plainThreadLinks,
  PRIORITY_LABELS,
  splitThreadLinks,
  STATUS_LABELS,
  threadLink,
  type Entry,
  type Person,
  type Priority,
  type Status,
  type Thread,
  mentionsIn,
  groupMentionsIn,
  groupTarget,
  GROUP_TARGET,
  mentionToken,
  descriptionOf,
  bucketsOf,
  inboxPeople,
  replyTo,
} from "model";
import { DAY, formatDue, formatRelativeTime, startOfDay } from "../format";
import { recipientsOf } from "../compose";
import { Identicon } from "./Identicon";
import { ThreadMinimap } from "./ThreadMinimap";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

const ICON_PROPS = { size: 13, "aria-hidden": true } as const;

// What each `/` command shows in the menu.
const COMMAND_ICONS: Record<CommandName, IconSvgElement> = {
  blocked: UnavailableIcon,
  task: TaskAdd01Icon,
  close: CheckmarkCircle02Icon,
};

export type MessageEntry = Extract<Entry, { kind: "message" }>;
type EventEntry = Extract<Entry, { kind: "event" }>;
// How a click changes the selection: toggle one message, or extend from the last one clicked.
type SelectMode = "toggle" | "range";
type ResolutionEntry = Extract<Entry, { kind: "resolution" }>;

export type ThreadActions = {
  // A note in the thread (Enter): nobody is told.
  onNote: (text: string) => void;
  // A message sent to people (⌘↵), which puts the thread in their inbox.
  onSend: (text: string, to: Person[]) => void;
  // `/blocked`: opens the form for asking someone what this thread needs, in a new thread that blocks it.
  onBlocked: () => void;
  // `/task`: turns what you were asked here into a task of your own, a new thread linked from this one.
  onTask: () => void;
  onSetStatus: (status: Status) => void;
  onSetPriority: (priority: Priority) => void;
  onSetDue: (dueAtMs: number | null) => void;
  onSetEffort: (effortHours: number | null) => void;
  // Adds or removes a label, making it first if it's new.
  onToggleLabel: (label: { id: string; name: string }) => void;
  // Puts it in one of your buckets by hand, or (null) hands it back to the model to sort.
  onSetBucket: (bucketId: string | null) => void;
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
      <HugeiconsIcon icon={GitBranchIcon} size={11} aria-hidden />
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
  const { nameOf, openPerson } = useThreadLinks();
  return (
    <>
      {splitThreadLinks(text).map((part, index) =>
        "threadId" in part ? (
          <ThreadLinkChip key={index} threadId={part.threadId} />
        ) : "personId" in part ? (
          nameOf(part.personId) === undefined ? (
            <span key={index} className="mention">
              @someone
            </span>
          ) : (
            <button
              key={index}
              type="button"
              className="mention person-link"
              onClick={() => openPerson(part.personId)}
            >
              @{nameOf(part.personId)}
            </button>
          )
        ) : "groupId" in part ? (
          <span key={index} className="mention">
            @{nameOf(groupTarget(part.groupId)) ?? "group"}
          </span>
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
export function MenuChip<T>({
  label,
  icon,
  tone,
  options,
  onSelect,
  title,
  typed,
}: {
  label: string;
  icon?: React.ReactNode;
  tone?: string;
  options: { label: string; value: T; icon?: React.ReactNode }[];
  onSelect: (value: T) => void;
  // Shown on hover.
  title?: string;
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
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
      </button>
      {open && (
        <div className="menu chip-menu" role="menu">
          {typed !== undefined && (
            <input
              className="menu-input"
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
            <div className="menu-item" role="menuitem" onClick={() => choose(parsed.value)}>
              {parsed.label}
            </div>
          )}
          {options.map((option) => (
            <div
              key={option.label}
              className="menu-item"
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

// A thread's labels: pick any, or type a new one. A group's label puts the thread in that group.
function LabelChip({
  thread,
  actions,
}: {
  thread: Thread;
  actions: ThreadActions;
}): React.JSX.Element {
  const { labels, groups } = useThreadLinks();
  const offered = [
    ...new Map(
      [
        ...selectableLabels(labels, groups),
        ...labels.filter((label) => thread.labelIds.includes(label.id)),
      ].map((label) => [label.id, label]),
    ).values(),
  ];
  return (
    <MenuChip
      label={labelsLabel(thread.labelIds, labels)}
      icon={<HugeiconsIcon icon={Tag01Icon} {...ICON_PROPS} />}
      tone={thread.labelIds.length === 0 ? "muted" : undefined}
      options={offered.map((label) => ({
        label: label.name,
        value: { id: label.id, name: label.name },
        icon: thread.labelIds.includes(label.id) ? (
          <HugeiconsIcon icon={Tick02Icon} {...ICON_PROPS} />
        ) : undefined,
      }))}
      typed={{
        placeholder: "Find or make a label…",
        parse: (text) => {
          const name = text.trim();
          const id = labelSlug(name);
          if (id === "") return null;
          const existing = labels.find((label) => label.id === id || labelSlug(label.name) === id);
          return existing === undefined
            ? { label: `Make “${name}”`, value: { id, name } }
            : { label: existing.name, value: { id: existing.id, name: existing.name } };
        },
      }}
      onSelect={actions.onToggleLabel}
    />
  );
}

// "No labels", "Security", or "Security +1".
function labelsLabel(labelIds: string[], labels: { id: string; name: string }[]): string {
  const [first, ...rest] = labels.filter((label) => labelIds.includes(label.id));
  if (first === undefined) return "No labels";
  return rest.length === 0 ? first.name : `${first.name} +${rest.length}`;
}

function StatusDot({ status }: { status: Status }): React.JSX.Element {
  return <span className="status-dot" data-status={status} aria-hidden />;
}

// The top of every thread. An issue shows the ask (who wants what from whom), its title and description, and its
// properties, including which of your buckets it's in while it waits on you; a conversation shows who's in it.
function ThreadHeader({
  thread,
  ask,
  nowMs,
  actions,
}: {
  thread: Thread;
  ask: MessageEntry | undefined;
  nowMs: number;
  actions: ThreadActions;
}): React.JSX.Element {
  const due = thread.dueAtMs === null ? null : formatDue(thread.dueAtMs, nowMs);
  const statuses = Object.keys(STATUS_LABELS) as Status[];
  const priorities = Object.keys(PRIORITY_LABELS) as Priority[];
  const priorityTone =
    thread.priority === "urgent" ? "urgent" : thread.priority === "none" ? "muted" : undefined;
  const dueTone = due === null ? "muted" : due.overdue ? "urgent" : undefined;
  const me = useMe();
  // Its bucket shows only to people whose inbox it's in, since buckets are theirs.
  const inMyInbox = inboxPeople(thread).includes(me.id);
  const buckets = bucketsOf(me);
  const triage = thread.triage[me.id] ?? null;
  const bucket = buckets.find((candidate) => candidate.id === triage?.bucketId);

  const description = ask?.text.trim() ?? "";

  return (
    <header className="thread-header" id={ask === undefined ? undefined : `entry-${ask.id}`}>
      {thread.branchedFromId !== null && (
        <div className="thread-byline">
          <span>Branched from</span>
          <ThreadLinkChip threadId={thread.branchedFromId} />
        </div>
      )}
      <h1 className="thread-title">{thread.title}</h1>
      {description !== "" && (
        <MessageText text={description} className="thread-text thread-description" />
      )}
      <div className="thread-properties">
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
        {inMyInbox && (
          <MenuChip
            label={bucket?.name ?? "Sorting…"}
            icon={<HugeiconsIcon icon={InboxIcon} {...ICON_PROPS} />}
            tone={bucket === undefined ? "muted" : undefined}
            title={
              triage === null
                ? "Being sorted into one of your buckets"
                : triage.manual
                  ? "Placed by you"
                  : triage.reason
            }
            options={[
              ...buckets.map((option) => ({
                label: option.name,
                value: option.id as string | null,
                icon:
                  option.id === bucket?.id ? (
                    <HugeiconsIcon icon={Tick02Icon} {...ICON_PROPS} />
                  ) : undefined,
              })),
              ...(triage?.manual ? [{ label: "Sort it for me", value: null }] : []),
            ]}
            onSelect={actions.onSetBucket}
          />
        )}
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
          icon={<HugeiconsIcon icon={Calendar01Icon} {...ICON_PROPS} />}
          tone={dueTone}
          options={dueOptions(nowMs)}
          onSelect={actions.onSetDue}
        />
        <MenuChip
          label={thread.effortHours === null ? "No estimate" : formatEffort(thread.effortHours)}
          icon={<HugeiconsIcon icon={HourglassIcon} {...ICON_PROPS} />}
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
        <LabelChip thread={thread} actions={actions} />
      </div>
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
  onSelect?: (mode: SelectMode) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  // Whoever the message names: the people it mentions and the members of the groups it mentions.
  const { groups, openPerson } = useThreadLinks();
  const named = new Set([
    ...mentionsIn(message.text),
    ...groupMentionsIn(message.text).flatMap(
      (groupId) => groups.find((group) => group.id === groupId)?.memberIds ?? [],
    ),
  ]);
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
        if (mode !== undefined) onSelect?.(mode);
      }}
      onContextMenu={onContextMenu}
    >
      <Avatar person={message.author} />
      <div className="thread-body">
        <div className="thread-meta">
          <button
            type="button"
            className="thread-author person-link"
            onClick={() => openPerson(message.author.id)}
          >
            {message.author.name}
          </button>
          {/* Who it was sent to, unless the message @mentions them all already (or the groups they're in), or that it's
              a note nobody was told about. The description is neither. */}
          {message.sentTo.length === 0 ? (
            <span className="thread-note">Note</span>
          ) : (
            !message.sentTo.every((person) => named.has(person.id)) && (
              <span className="thread-sent-to">
                to {message.sentTo.map((person) => person.name.split(" ")[0]).join(", ")}
              </span>
            )
          )}
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
      {/* No marker, just the avatar's width, so the line lines up with the text column. */}
      <span className="thread-avatar thread-event-marker" aria-hidden />
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
      <HugeiconsIcon icon={Tick02Icon} size={12} />
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

// The next message, written in place at the end of the thread. Enter sends it to the other side (whoever last sent you
// something here, else whoever's on the other end) plus anyone you @mention, which puts the thread in their inbox.
// With nobody to send to, it's a note. The To line shows only once you've mentioned someone, to add or take people
// off. Shift+Enter breaks the line.
function ReplyBlock({
  placeholder,
  focusRef,
  defaultTo,
  people,
  onNote,
  onSend,
  onBranch,
  onCommand,
  threadId,
  autoFocus,
}: {
  threadId: string;
  placeholder: string;
  focusRef: React.RefObject<(() => void) | null>;
  // Who Enter sends to, before mentions.
  defaultTo: Person[];
  people: Person[];
  onNote: (text: string) => void;
  onSend: (text: string, to: Person[]) => void;
  onBranch: ThreadActions["onBranch"];
  onCommand: (name: CommandName) => void;
  // Whether the reply takes the cursor when it appears.
  autoFocus: boolean;
}): React.JSX.Element {
  const me = useMe();
  // Who's @mentioned in the draft, read from the editor, and who's been added or taken off the To line by hand. Both
  // clear once the message is sent.
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  // A mentioned group sends it to its members as they are now.
  const { groups } = useThreadLinks();
  const to = [
    ...defaultTo,
    ...recipientsOf([...mentionedIds, ...addedIds], people, groups, me),
  ].filter(
    (person, index, all) =>
      person.id !== me.id &&
      !removedIds.includes(person.id) &&
      all.findIndex((other) => other.id === person.id) === index,
  );
  const reset = (): void => {
    setAddedIds([]);
    setRemovedIds([]);
  };
  const handlersRef = useRef({ onNote, onSend, to, reset });
  useEffect(() => {
    handlersRef.current = { onNote, onSend, to, reset };
  });

  const editor = useEditor({
    autofocus: autoFocus ? "end" : false,
    extensions: [
      // No underline, so ⌘U stays the app's user picker.
      StarterKit.configure({ heading: false, horizontalRule: false, underline: false }),
      Placeholder.configure({ placeholder }),
      ThreadLinkNode,
      MentionNode,
      SlashCommands,
    ],
    onUpdate: ({ editor: current }) => {
      const ids: string[] = [];
      current.state.doc.descendants((node) => {
        if (node.type.name === "mention") ids.push(String(node.attrs.id));
      });
      setMentionedIds((previous) =>
        previous.length === ids.length && previous.every((id, index) => id === ids[index])
          ? previous
          : ids,
      );
    },
    editorProps: {
      attributes: { class: "thread-text thread-reply-editor", "aria-label": "Reply" },
      handleKeyDown: (view, event) => {
        // The `#` and `/` menus, when open, get keys first.
        if (offerKey(view.dom, event)) return true;
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false;
        // Thread links go out as `[[thread:<id>]]`.
        const text = view.state.doc
          .textBetween(0, view.state.doc.content.size, "\n", (leaf) =>
            leaf.type.name === "threadLink"
              ? threadLink(String(leaf.attrs.id))
              : leaf.type.name === "mention"
                ? mentionToken(String(leaf.attrs.id))
                : "",
          )
          .trim();
        if (text.length > 0) {
          const { onNote, onSend, to, reset } = handlersRef.current;
          if (to.length > 0) onSend(text, to);
          else onNote(text);
          view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
          reset();
        }
        return true;
      },
    },
  });

  // The `#` and `/` menus: their extensions announce them on the editor; this renders whichever is open and handles
  // its keys.
  const links = useThreadLinks();
  const [menu, setMenu] = useState<ThreadMenuState>(null);
  const [commandMenu, setCommandMenu] = useState<CommandMenuState>(null);
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState>(null);
  const [selected, setSelected] = useState(0);
  const open = commandMenu ?? mentionMenu ?? menu;
  const options: MenuOption[] =
    commandMenu !== null
      ? COMMANDS.filter((command) => command.name.startsWith(commandMenu.query.toLowerCase())).map(
          (command) => ({ kind: "command", ...command }),
        )
      : mentionMenu !== null
        ? links.people
            .filter(
              (person) =>
                person.id !== me.id &&
                person.name.toLowerCase().includes(mentionMenu.query.toLowerCase()),
            )
            .map((person): MenuOption => ({ kind: "person", person }))
            .concat(
              links.groups
                .filter(
                  (group) =>
                    !group.archived &&
                    group.name.toLowerCase().includes(mentionMenu.query.toLowerCase()),
                )
                .map((group) => ({
                  kind: "person",
                  person: { id: groupTarget(group.id), name: group.name },
                })),
            )
        : menu === null
          ? []
          : menuOptions(menu.query, links.search, threadId);
  const choose = (option: MenuOption): void => {
    if (option.kind === "command") {
      commandMenu?.take();
      onCommand(option.name);
    } else if (option.kind === "person") {
      // The mention puts them on the To line (read back from the editor).
      mentionMenu?.pick(option.person);
      setRemovedIds((current) => current.filter((id) => id !== option.person.id));
    } else if (menu === null) return;
    else if (option.kind === "link") menu.pick(option.link);
    else menu.pick({ id: onBranch(option.title), title: option.title });
  };

  useEffect(() => {
    const dom = editor?.view.dom;
    if (dom === undefined) return;
    const onMenu = (event: Event): void => {
      setMenu((event as CustomEvent<ThreadMenuState>).detail);
      setSelected(0);
    };
    const onCommandMenu = (event: Event): void => {
      setCommandMenu((event as CustomEvent<CommandMenuState>).detail);
      setSelected(0);
    };
    const onMentionMenu = (event: Event): void => {
      setMentionMenu((event as CustomEvent<MentionMenuState>).detail);
      setSelected(0);
    };
    dom.addEventListener(THREAD_MENU_EVENT, onMenu);
    dom.addEventListener(COMMAND_MENU_EVENT, onCommandMenu);
    dom.addEventListener(MENTION_MENU_EVENT, onMentionMenu);
    return () => {
      dom.removeEventListener(THREAD_MENU_EVENT, onMenu);
      dom.removeEventListener(COMMAND_MENU_EVENT, onCommandMenu);
      dom.removeEventListener(MENTION_MENU_EVENT, onMentionMenu);
    };
  }, [editor]);

  useEffect(() => {
    const view = editor?.view;
    if (view === undefined || open === null) return;
    const onKey = (event: Event): void => {
      const key = (event as CustomEvent<KeyboardEvent>).detail;
      if (key.key === "Escape") {
        if (commandMenu !== null) closeCommandMenu(view);
        else if (mentionMenu !== null) closeMentionMenu(view);
        else closeThreadMenu(view);
      } else if (options.length === 0) return;
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
        {mentionedIds.length > 0 && (
          <div className="reply-to" onClick={(event) => event.stopPropagation()}>
            <span className="reply-to-label">To</span>
            {to.map((person) => (
              <span key={person.id} className="reply-to-person">
                <Identicon seed={person.id} size={12} />
                {person.name.split(" ")[0]}
                <button
                  type="button"
                  className="reply-to-remove"
                  aria-label={`Don't send to ${person.name}`}
                  onClick={() => setRemovedIds((current) => [...current, person.id])}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={10} aria-hidden />
                </button>
              </span>
            ))}
            <MenuChip
              label={to.length === 0 ? "Add someone" : "Add"}
              icon={<HugeiconsIcon icon={Add01Icon} size={11} aria-hidden />}
              tone="muted"
              options={people
                .filter(
                  (person) => person.id !== me.id && !to.some((other) => other.id === person.id),
                )
                .map((person) => ({
                  label: person.name,
                  value: person,
                  icon: <Identicon seed={person.id} size={14} />,
                }))}
              onSelect={(person) => {
                setAddedIds((current) => [...current, person.id]);
                setRemovedIds((current) => current.filter((id) => id !== person.id));
              }}
            />
          </div>
        )}
      </div>
      {open !== null && options.length > 0 && (
        <ThreadMenu
          rect={open.rect}
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
  | { kind: "new"; title: string }
  | { kind: "command"; name: CommandName; label: string; hint: string }
  | { kind: "person"; person: { id: string; name: string } };

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
      className="menu thread-menu"
      role="listbox"
      aria-label="Link a thread"
      style={{ left: rect.left, top: rect.bottom + 6 }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {options.map((option, index) => (
        <button
          key={
            option.kind === "link"
              ? option.link.id
              : option.kind === "command"
                ? option.name
                : option.kind === "person"
                  ? option.person.id
                  : "new"
          }
          type="button"
          role="option"
          aria-selected={index === selected}
          className="menu-item"
          onMouseEnter={() => onHover(index)}
          onClick={() => onChoose(option)}
        >
          {option.kind === "person" ? (
            <>
              <Identicon seed={option.person.id} size={14} />
              <span className="thread-menu-title">
                {option.person.name}{" "}
                <span className="thread-menu-hint">
                  {option.person.id.startsWith(GROUP_TARGET)
                    ? "sends it to everyone in the group"
                    : "sends it to them too"}
                </span>
              </span>
            </>
          ) : option.kind === "command" ? (
            <>
              <HugeiconsIcon icon={COMMAND_ICONS[option.name]} {...ICON_PROPS} />
              <span className="thread-menu-title">
                {option.label} <span className="thread-menu-hint">{option.hint}</span>
              </span>
            </>
          ) : option.kind === "link" ? (
            <>
              <HugeiconsIcon icon={GitBranchIcon} {...ICON_PROPS} />
              <span className="thread-menu-title">{option.link.title}</span>
            </>
          ) : (
            <>
              <HugeiconsIcon icon={Add01Icon} {...ICON_PROPS} />
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
  autoFocusReply = true,
}: {
  thread: Thread;
  people: Person[];
  actions: ThreadActions;
  // Off while working through the inbox, so its keys work until you choose to reply (R).
  autoFocusReply?: boolean;
}): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLElement>(null);
  const focusReplyRef = useRef<(() => void) | null>(null);
  const nowMs = useNow(60_000);
  const me = useMe();
  const entries = thread.entries;
  // The description moves into the header, under the title.
  const ask = descriptionOf(thread);
  const rest = ask === undefined ? entries : entries.filter((entry) => entry !== ask);

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
    // Opened from the inbox, a thread starts at its top, title first.
    if (previous === undefined ? autoFocusReply : followingRef.current || yours)
      bringReplyIntoView();
  }, [entries, me.id, autoFocusReply]);

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
  const { titleOf, nameOf } = useThreadLinks();
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
        run: () =>
          void navigator.clipboard.writeText(plainThreadLinks(message.text, titleOf, nameOf)),
      },
    ];
  };

  // What arrived while you were reading back: messages and resolutions by others, else any activity.
  const unseen = following ? [] : entries.slice(seenCount);
  const unseenMessages = unseen.filter(
    (entry) =>
      (entry.kind === "message" || entry.kind === "resolution") && entryPerson(entry)?.id !== me.id,
  ).length;

  // As in email, a reply goes back to whoever last sent you something here, else the other side.
  const defaultTo = replyTo(thread, me.id);
  const placeholder =
    defaultTo.length === 0
      ? "Write a note…"
      : `Reply to ${defaultTo.map((person) => person.name.split(" ")[0]).join(", ")}…`;

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
            <ThreadHeader thread={thread} ask={ask} nowMs={nowMs} actions={actions} />
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
              return <ResolutionBlock key={entry.id} resolution={entry} nowMs={nowMs} />;
            })}
            {isDone(thread.status) ? null : (
              <ReplyBlock
                // Someone new to reply to changes the prompt, which the editor only takes when it's made.
                key={`${thread.id}:${defaultTo.map((person) => person.id).join(",")}`}
                placeholder={placeholder}
                focusRef={focusReplyRef}
                defaultTo={defaultTo}
                people={people}
                onNote={actions.onNote}
                onSend={actions.onSend}
                onBranch={actions.onBranch}
                onCommand={(name) => {
                  if (name === "blocked") actions.onBlocked();
                  if (name === "close") actions.onSetStatus("closed");
                  if (name === "task") actions.onTask();
                }}
                threadId={thread.id}
                autoFocus={autoFocusReply}
              />
            )}
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
              <HugeiconsIcon icon={GitBranchIcon} {...ICON_PROPS} />
              Move to thread…
            </button>
            <button
              type="button"
              className="icon-button selection-bar-clear"
              aria-label="Clear selection"
              title="Clear selection (Esc)"
              onClick={clearSelection}
            >
              <HugeiconsIcon icon={Cancel01Icon} {...ICON_PROPS} />
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
            <HugeiconsIcon icon={ArrowDown02Icon} {...ICON_PROPS} />
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
