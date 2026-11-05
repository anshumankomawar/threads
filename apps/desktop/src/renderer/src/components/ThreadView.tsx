import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
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
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  merge,
  onSettled,
  Show,
  Switch,
  untrack,
  useContext,
} from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
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
import { bucketIcons } from "../bucketIcons";
import { DAY, formatDue, formatRelativeTime, startOfDay } from "../format";
import { recipientsOf } from "../compose";
import { Icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { ThreadMinimap } from "./ThreadMinimap";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

const ICON_PROPS = { size: 13, "aria-hidden": "true" } as const;

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
  // Deletes one of your own messages.
  onDeleteMessage: (message: MessageEntry) => void;
};

// A thread link as a chip with the linked thread's current title; clicking opens it beside this one.
function ThreadLinkChip(props: { threadId: string }): JSX.Element {
  const links = useThreadLinks();
  const currentThreadId = useContext(CurrentThreadContext);
  const title = (): string => links.titleOf(props.threadId) ?? "Thread";
  return (
    <Show
      when={currentThreadId() !== props.threadId}
      fallback={<span class="thread-link-self">#{title()}</span>}
    >
      <button
        type="button"
        class="thread-link"
        onClick={(event) => {
          event.stopPropagation();
          links.open(props.threadId);
        }}
      >
        <Icon icon={GitBranchIcon} size={11} aria-hidden="true" />
        {title()}
      </button>
    </Show>
  );
}

// A message's text, with its thread links as chips.
function MessageText(props: { text: string; class?: string }): JSX.Element {
  return (
    <div class={props.class ?? "thread-text"}>
      <LinkedText text={props.text} />
    </div>
  );
}

// Text with its thread links as chips, inline.
function LinkedText(props: { text: string }): JSX.Element {
  const links = useThreadLinks();
  return (
    <For each={splitThreadLinks(props.text)}>
      {(part) =>
        "threadId" in part ? (
          <ThreadLinkChip threadId={part.threadId} />
        ) : "personId" in part ? (
          <Show
            when={links.nameOf(part.personId) !== undefined}
            fallback={<span class="mention">@someone</span>}
          >
            <button
              type="button"
              class="mention person-link"
              onClick={() => links.openPerson(part.personId)}
            >
              @{links.nameOf(part.personId)}
            </button>
          </Show>
        ) : "groupId" in part ? (
          <span class="mention">@{links.nameOf(groupTarget(part.groupId)) ?? "group"}</span>
        ) : (
          <span>{part.text}</span>
        )
      }
    </For>
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

function useNow(intervalMs: number): () => number {
  const [now, setNow] = createSignal(Date.now());
  onSettled(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  });
  return now;
}

function Avatar(props: { person: Person }): JSX.Element {
  return (
    <span class="thread-avatar">
      <Identicon seed={props.person.id} size={20} />
    </span>
  );
}

// A property chip that opens a small menu of options, styled like the search panel.
export function MenuChip<T>(props: {
  label: string;
  icon?: JSX.Element;
  tone?: string;
  options: { label: string; value: T; icon?: JSX.Element }[];
  onSelect: (value: T) => void;
  // Shown on hover.
  title?: string;
  // A field at the top of the menu for typing a value in words, with what it reads as.
  typed?: { placeholder: string; parse: (text: string) => { label: string; value: T } | null };
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [text, setText] = createSignal("");
  const parsed = createMemo(() => props.typed?.parse(text()) ?? null);
  const choose = (value: T): void => {
    props.onSelect(value);
    setOpen(false);
    setText("");
  };
  let root!: HTMLSpanElement;

  createEffect(
    () => open(),
    (isOpen) => {
      if (!isOpen) return;
      const onPointerDown = (event: PointerEvent): void => {
        if (!root.contains(event.target as Node)) setOpen(false);
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
    },
  );

  return (
    <span ref={root} class="chip-anchor">
      <button
        type="button"
        class="chip"
        data-tone={props.tone}
        title={props.title}
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setOpen((value) => !value)}
      >
        {props.icon}
        {props.label}
      </button>
      <Show when={open()}>
        <div class="menu chip-menu" role="menu">
          <Show when={props.typed}>
            {(typed) => (
              <input
                ref={(input) => queueMicrotask(() => input.focus())}
                class="menu-input"
                placeholder={typed().placeholder}
                spellcheck={false}
                value={text()}
                onInput={(event) => setText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  const value = parsed();
                  if (event.key === "Enter" && value !== null) choose(value.value);
                }}
              />
            )}
          </Show>
          <Show when={parsed()}>
            {(value) => (
              <div class="menu-item" role="menuitem" onClick={() => choose(value().value)}>
                {value().label}
              </div>
            )}
          </Show>
          <For each={props.options}>
            {(option) => (
              <div class="menu-item" role="menuitem" onClick={() => choose(option.value)}>
                {option.icon}
                {option.label}
              </div>
            )}
          </For>
        </div>
      </Show>
    </span>
  );
}

// A thread's labels: pick any, or type a new one. A group's label puts the thread in that group.
function LabelChip(props: { thread: Thread; actions: ThreadActions }): JSX.Element {
  const links = useThreadLinks();
  const offered = createMemo(() => [
    ...new Map(
      [
        ...selectableLabels(links.labels, links.groups),
        ...links.labels.filter((label) => props.thread.labelIds.includes(label.id)),
      ].map((label) => [label.id, label]),
    ).values(),
  ]);
  return (
    <MenuChip
      label={labelsLabel(props.thread.labelIds, links.labels)}
      icon={<Icon icon={Tag01Icon} {...ICON_PROPS} />}
      tone={props.thread.labelIds.length === 0 ? "muted" : undefined}
      options={offered().map((label) => ({
        label: label.name,
        value: { id: label.id, name: label.name },
        icon: props.thread.labelIds.includes(label.id) ? (
          <Icon icon={Tick02Icon} {...ICON_PROPS} />
        ) : undefined,
      }))}
      typed={{
        placeholder: "Find or make a label…",
        parse: (text) => {
          const name = text.trim();
          const id = labelSlug(name);
          if (id === "") return null;
          const existing = links.labels.find(
            (label) => label.id === id || labelSlug(label.name) === id,
          );
          return existing === undefined
            ? { label: `Make “${name}”`, value: { id, name } }
            : { label: existing.name, value: { id: existing.id, name: existing.name } };
        },
      }}
      onSelect={(label) => props.actions.onToggleLabel(label)}
    />
  );
}

// "No labels", "Security", or "Security +1".
function labelsLabel(labelIds: string[], labels: { id: string; name: string }[]): string {
  const [first, ...rest] = labels.filter((label) => labelIds.includes(label.id));
  if (first === undefined) return "No labels";
  return rest.length === 0 ? first.name : `${first.name} +${rest.length}`;
}

function StatusDot(props: { status: Status }): JSX.Element {
  return <span class="status-dot" data-status={props.status} aria-hidden="true" />;
}

// The top of every thread. An issue shows the ask (who wants what from whom), its title and description, and its
// properties, including which of your buckets it's in while it waits on you; a conversation shows who's in it.
function ThreadHeader(props: {
  thread: Thread;
  ask: MessageEntry | undefined;
  nowMs: number;
  actions: ThreadActions;
}): JSX.Element {
  const due = createMemo(() =>
    props.thread.dueAtMs === null ? null : formatDue(props.thread.dueAtMs, props.nowMs),
  );
  const statuses = Object.keys(STATUS_LABELS) as Status[];
  const priorities = Object.keys(PRIORITY_LABELS) as Priority[];
  const priorityTone = (): string | undefined =>
    props.thread.priority === "urgent"
      ? "urgent"
      : props.thread.priority === "none"
        ? "muted"
        : undefined;
  const dueTone = (): string | undefined => {
    const shown = due();
    return shown === null ? "muted" : shown.overdue ? "urgent" : undefined;
  };
  const me = useMe();
  // Its bucket shows only to people whose inbox it's in, since buckets are theirs.
  const inMyInbox = createMemo(() => inboxPeople(props.thread).includes(me().id));
  const buckets = createMemo(() => bucketsOf(me()));
  const triage = createMemo(() => props.thread.triage[me().id] ?? null);
  const bucket = createMemo(() =>
    buckets().find((candidate) => candidate.id === triage()?.bucketId),
  );
  const icons = createMemo(() => bucketIcons(buckets()));
  const bucketIcon = createMemo(() => {
    const current = bucket();
    return (current && icons().get(current.id)) ?? InboxIcon;
  });

  const description = (): string => props.ask?.text.trim() ?? "";
  const links = useThreadLinks();

  return (
    <header
      class="thread-header thread-block"
      id={props.ask === undefined ? undefined : `entry-${props.ask.id}`}
    >
      {/* The thread opens like its first message: who asked and when, then what it's about. */}
      <Show when={props.ask} fallback={<span class="thread-avatar" />}>
        {(ask) => <Avatar person={ask().author} />}
      </Show>
      <div class="thread-body">
        <Show when={props.ask}>
          {(ask) => (
            <div class="thread-meta">
              <button
                type="button"
                class="thread-author person-link"
                onClick={() => links.openPerson(ask().author.id)}
              >
                {ask().author.name}
              </button>
              <span class="thread-time">{formatRelativeTime(ask().createdAtMs, props.nowMs)}</span>
            </div>
          )}
        </Show>
        <Show when={props.thread.branchedFromId}>
          {(branchedFromId) => (
            <div class="thread-byline">
              <span>Branched from</span>
              <ThreadLinkChip threadId={branchedFromId()} />
            </div>
          )}
        </Show>
        <h1 class="thread-title">{props.thread.title}</h1>
        <Show when={description() !== ""}>
          <MessageText text={description()} class="thread-text thread-description" />
        </Show>
        <div class="thread-properties">
          <MenuChip
            label={STATUS_LABELS[props.thread.status]}
            icon={<StatusDot status={props.thread.status} />}
            options={statuses.map((status) => ({
              label: STATUS_LABELS[status],
              value: status,
              icon: <StatusDot status={status} />,
            }))}
            onSelect={(status) => props.actions.onSetStatus(status)}
          />
          <Show when={inMyInbox()}>
            <MenuChip
              label={bucket()?.name ?? "Sorting…"}
              icon={<Icon icon={bucketIcon()} {...ICON_PROPS} />}
              tone={bucket() === undefined ? "muted" : undefined}
              title={(() => {
                const current = triage();
                return current === null
                  ? "Being sorted into one of your buckets"
                  : current.manual
                    ? "Placed by you"
                    : current.reason;
              })()}
              options={[
                ...buckets().map((option) => ({
                  label: option.name,
                  value: option.id as string | null,
                  icon: (
                    <Icon
                      icon={
                        option.id === bucket()?.id
                          ? Tick02Icon
                          : (icons().get(option.id) ?? InboxIcon)
                      }
                      {...ICON_PROPS}
                    />
                  ),
                })),
                ...(triage()?.manual ? [{ label: "Sort it for me", value: null }] : []),
              ]}
              onSelect={(bucketId) => props.actions.onSetBucket(bucketId)}
            />
          </Show>
          <MenuChip
            label={PRIORITY_LABELS[props.thread.priority]}
            tone={priorityTone()}
            options={priorities.map((priority) => ({
              label: PRIORITY_LABELS[priority],
              value: priority,
            }))}
            onSelect={(priority) => props.actions.onSetPriority(priority)}
          />
          <MenuChip
            label={due()?.label ?? "No due date"}
            icon={<Icon icon={Calendar01Icon} {...ICON_PROPS} />}
            tone={dueTone()}
            options={dueOptions(props.nowMs)}
            onSelect={(dueAtMs) => props.actions.onSetDue(dueAtMs)}
          />
          <MenuChip
            label={
              props.thread.effortHours === null
                ? "No estimate"
                : formatEffort(props.thread.effortHours)
            }
            icon={<Icon icon={HourglassIcon} {...ICON_PROPS} />}
            tone={props.thread.effortHours === null ? "muted" : undefined}
            options={[
              ...EFFORT_OPTIONS.map((hours) => ({
                label: formatEffort(hours),
                value: hours as number | null,
              })),
              { label: "No estimate", value: null },
            ]}
            onSelect={(effortHours) => props.actions.onSetEffort(effortHours)}
          />
          <LabelChip thread={props.thread} actions={props.actions} />
        </div>
      </div>
    </header>
  );
}

function MessageBlock(props: {
  message: MessageEntry;
  nowMs: number;
  selected: boolean;
  // Where a selected message sits in a run of selected neighbours, so the run reads as one box.
  run: "single" | "start" | "middle" | "end" | undefined;
  // While some messages are selected, a click selects instead of placing the cursor.
  selecting: boolean;
  onSelect?: (mode: SelectMode) => void;
  onContextMenu?: (event: MouseEvent) => void;
}): JSX.Element {
  // Whoever the message names: the people it mentions and the members of the groups it mentions.
  const links = useThreadLinks();
  const named = createMemo(
    () =>
      new Set([
        ...mentionsIn(props.message.text),
        ...groupMentionsIn(props.message.text).flatMap(
          (groupId) => links.groups.find((group) => group.id === groupId)?.memberIds ?? [],
        ),
      ]),
  );
  const modeFor = (event: MouseEvent): SelectMode | undefined =>
    event.shiftKey ? "range" : event.metaKey || props.selecting ? "toggle" : undefined;
  return (
    <div
      class="thread-block thread-message"
      id={`entry-${props.message.id}`}
      data-selected={String(props.selected)}
      data-run={props.run}
      data-selecting={String(props.selecting)}
      onMouseDown={(event) => {
        // Shift-click selects messages, not text.
        if (event.shiftKey) event.preventDefault();
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a") !== null) return;
        const mode = modeFor(event);
        if (mode !== undefined) props.onSelect?.(mode);
      }}
      onContextMenu={(event) => props.onContextMenu?.(event)}
    >
      <Avatar person={props.message.author} />
      <div class="thread-body">
        <div class="thread-meta">
          <button
            type="button"
            class="thread-author person-link"
            onClick={() => links.openPerson(props.message.author.id)}
          >
            {props.message.author.name}
          </button>
          {/* Who it was sent to, unless the message @mentions them all already (or the groups they're in), or that it's
              a note nobody was told about. The description is neither. */}
          <Show
            when={props.message.sentTo.length !== 0}
            fallback={<span class="thread-note">Note</span>}
          >
            <Show when={!props.message.sentTo.every((person) => named().has(person.id))}>
              <span class="thread-sent-to">
                to {props.message.sentTo.map((person) => person.name.split(" ")[0]).join(", ")}
              </span>
            </Show>
          </Show>
          <span class="thread-time">
            {formatRelativeTime(props.message.createdAtMs, props.nowMs)}
          </span>
        </div>
        <MessageText text={props.message.text} />
      </div>
    </div>
  );
}

function EventLine(props: { event: EventEntry; nowMs: number }): JSX.Element {
  return (
    <div class="thread-block thread-event" id={`entry-${props.event.id}`}>
      {/* No marker, just the avatar's width, so the line lines up with the text column. */}
      <span class="thread-avatar thread-event-marker" aria-hidden="true" />
      <div class="thread-event-text">
        <span class="thread-event-actor">{props.event.actor.name}</span>{" "}
        <LinkedText text={props.event.text} />
        <span class="thread-event-time">
          {" "}
          · {formatRelativeTime(props.event.createdAtMs, props.nowMs)}
        </span>
      </div>
    </div>
  );
}

function ResolutionMarker(): JSX.Element {
  return (
    <span class="thread-avatar thread-resolution-marker" aria-hidden="true">
      <Icon icon={Tick02Icon} size={12} />
    </span>
  );
}

function ResolutionBlock(props: { resolution: ResolutionEntry; nowMs: number }): JSX.Element {
  return (
    <div class="thread-block thread-resolution" id={`entry-${props.resolution.id}`}>
      <ResolutionMarker />
      <div class="thread-body">
        <div class="thread-meta">
          <span class="thread-author">Done</span>
          <span class="thread-time">
            {props.resolution.author.name} ·{" "}
            {formatRelativeTime(props.resolution.createdAtMs, props.nowMs)}
          </span>
        </div>
        <MessageText text={props.resolution.text} />
      </div>
    </div>
  );
}

// The next message, written in place at the end of the thread. Enter sends it to the other side (whoever last sent you
// something here, else whoever's on the other end) plus anyone you @mention, which puts the thread in their inbox.
// With nobody to send to, it's a note. The To line shows only once you've mentioned someone, to add or take people
// off. Shift+Enter breaks the line.
function ReplyBlock(props: {
  threadId: string;
  placeholder: string;
  // Hands the thread a way to focus the reply (null once it's gone), for clicks on empty space around the document.
  focusRef: (focus: (() => void) | null) => void;
  // Who Enter sends to, before mentions.
  defaultTo: Person[];
  people: Person[];
  onNote: (text: string) => void;
  onSend: (text: string, to: Person[]) => void;
  onBranch: ThreadActions["onBranch"];
  onCommand: (name: CommandName) => void;
  // Whether the reply takes the cursor when it appears.
  autoFocus: boolean;
}): JSX.Element {
  const me = useMe();
  // Who's @mentioned in the draft, read from the editor, and who's been added or taken off the To line by hand. Both
  // clear once the message is sent.
  const [mentionedIds, setMentionedIds] = createSignal<string[]>([]);
  const [addedIds, setAddedIds] = createSignal<string[]>([]);
  const [removedIds, setRemovedIds] = createSignal<string[]>([]);
  // A mentioned group sends it to its members as they are now.
  const links = useThreadLinks();
  const to = createMemo(() =>
    [
      ...props.defaultTo,
      ...recipientsOf([...mentionedIds(), ...addedIds()], props.people, links.groups, me()),
    ].filter(
      (person, index, all) =>
        person.id !== me().id &&
        !removedIds().includes(person.id) &&
        all.findIndex((other) => other.id === person.id) === index,
    ),
  );
  const reset = (): void => {
    setAddedIds([]);
    setRemovedIds([]);
  };

  // Made as its element is, so the reply has its full height when the thread first scrolls to it.
  let editor: Editor | undefined;
  const mountEditor = (element: HTMLDivElement): void => {
    const { placeholder, autoFocus } = untrack(() => ({
      placeholder: props.placeholder,
      autoFocus: props.autoFocus,
    }));
    editor = new Editor({
      element,
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
        const previous = mentionedIds();
        if (previous.length !== ids.length || previous.some((id, index) => id !== ids[index]))
          setMentionedIds(ids);
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
            const recipients = to();
            if (recipients.length > 0) props.onSend(text, recipients);
            else props.onNote(text);
            view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
            reset();
          }
          return true;
        },
      },
    });
  };

  // The `#` and `/` menus: their extensions announce them on the editor; this renders whichever is open and handles
  // its keys.
  const [menu, setMenu] = createSignal<ThreadMenuState>(null);
  const [commandMenu, setCommandMenu] = createSignal<CommandMenuState>(null);
  const [mentionMenu, setMentionMenu] = createSignal<MentionMenuState>(null);
  const [selected, setSelected] = createSignal(0);
  const open = createMemo(() => commandMenu() ?? mentionMenu() ?? menu());
  const options = createMemo((): MenuOption[] => {
    const commands = commandMenu();
    const mentions = mentionMenu();
    const threads = menu();
    return commands !== null
      ? COMMANDS.filter((command) => command.name.startsWith(commands.query.toLowerCase())).map(
          (command) => ({ kind: "command", ...command }),
        )
      : mentions !== null
        ? links.people
            .filter(
              (person) =>
                person.id !== me().id &&
                person.name.toLowerCase().includes(mentions.query.toLowerCase()),
            )
            .map((person): MenuOption => ({ kind: "person", person }))
            .concat(
              links.groups
                .filter(
                  (group) =>
                    !group.archived &&
                    group.name.toLowerCase().includes(mentions.query.toLowerCase()),
                )
                .map((group) => ({
                  kind: "person",
                  person: { id: groupTarget(group.id), name: group.name },
                })),
            )
        : threads === null
          ? []
          : menuOptions(threads.query, links.search, props.threadId);
  });
  const choose = (option: MenuOption): void => {
    const threads = menu();
    if (option.kind === "command") {
      commandMenu()?.take();
      props.onCommand(option.name);
    } else if (option.kind === "person") {
      // The mention puts them on the To line (read back from the editor).
      mentionMenu()?.pick(option.person);
      setRemovedIds((current) => current.filter((id) => id !== option.person.id));
    } else if (threads === null) return;
    else if (option.kind === "link") threads.pick(option.link);
    else threads.pick({ id: props.onBranch(option.title), title: option.title });
  };

  onSettled(() => {
    const current = editor;
    if (current === undefined) return;
    const view = current.view;
    const dom = view.dom;
    props.focusRef(() => current.commands.focus("end"));
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
    const onKey = (event: Event): void => {
      if (open() === null) return;
      const key = (event as CustomEvent<KeyboardEvent>).detail;
      const shown = options();
      const index = selected();
      if (key.key === "Escape") {
        if (commandMenu() !== null) closeCommandMenu(view);
        else if (mentionMenu() !== null) closeMentionMenu(view);
        else closeThreadMenu(view);
      } else if (shown.length === 0) return;
      else if (key.key === "ArrowDown") setSelected((index + 1) % shown.length);
      else if (key.key === "ArrowUp") setSelected((index - 1 + shown.length) % shown.length);
      else if ((key.key === "Enter" && !key.shiftKey) || key.key === "Tab")
        choose(shown[Math.min(index, shown.length - 1)]);
      else return;
      event.preventDefault();
    };
    dom.addEventListener(THREAD_MENU_EVENT, onMenu);
    dom.addEventListener(COMMAND_MENU_EVENT, onCommandMenu);
    dom.addEventListener(MENTION_MENU_EVENT, onMentionMenu);
    dom.addEventListener(THREAD_MENU_KEY, onKey);
    return () => {
      dom.removeEventListener(THREAD_MENU_EVENT, onMenu);
      dom.removeEventListener(COMMAND_MENU_EVENT, onCommandMenu);
      dom.removeEventListener(MENTION_MENU_EVENT, onMentionMenu);
      dom.removeEventListener(THREAD_MENU_KEY, onKey);
      props.focusRef(null);
      current.destroy();
    };
  });

  return (
    <div class="thread-block" onClick={() => editor?.commands.focus()}>
      <Avatar person={me()} />
      <div class="thread-body">
        <div class="thread-meta">
          <span class="thread-author">{me().name}</span>
        </div>
        <div ref={mountEditor} class="thread-reply" />
        <Show when={mentionedIds().length > 0}>
          <div class="reply-to" onClick={(event) => event.stopPropagation()}>
            <span class="reply-to-label">To</span>
            <For each={to()}>
              {(person) => (
                <span class="reply-to-person">
                  <Identicon seed={person.id} size={12} />
                  {person.name.split(" ")[0]}
                  <button
                    type="button"
                    class="reply-to-remove"
                    aria-label={`Don't send to ${person.name}`}
                    onClick={() => setRemovedIds((current) => [...current, person.id])}
                  >
                    <Icon icon={Cancel01Icon} size={10} aria-hidden="true" />
                  </button>
                </span>
              )}
            </For>
            <MenuChip
              label={to().length === 0 ? "Add someone" : "Add"}
              icon={<Icon icon={Add01Icon} size={11} aria-hidden="true" />}
              tone="muted"
              options={props.people
                .filter(
                  (person) =>
                    person.id !== me().id && !to().some((other) => other.id === person.id),
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
        </Show>
      </div>
      <Show when={open() !== null && options().length > 0}>
        <ThreadMenu
          rect={open()?.rect ?? null}
          options={options()}
          selected={Math.min(selected(), options().length - 1)}
          onHover={setSelected}
          onChoose={choose}
        />
      </Show>
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
function ThreadMenu(props: {
  rect: DOMRect | null;
  options: MenuOption[];
  selected: number;
  onHover: (index: number) => void;
  onChoose: (option: MenuOption) => void;
}): JSX.Element {
  return (
    <Show when={props.rect}>
      {(rect) => (
        <Portal mount={document.body}>
          <div
            class="menu thread-menu"
            role="listbox"
            aria-label="Link a thread"
            style={{ left: `${rect().left}px`, top: `${rect().bottom + 6}px` }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <For each={props.options}>
              {(option, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index() === props.selected ? "true" : "false"}
                  class="menu-item"
                  onMouseEnter={() => props.onHover(index())}
                  onClick={() => props.onChoose(option)}
                >
                  {option.kind === "person" ? (
                    <>
                      <Identicon seed={option.person.id} size={14} />
                      <span class="thread-menu-title">
                        {option.person.name}{" "}
                        <span class="thread-menu-hint">
                          {option.person.id.startsWith(GROUP_TARGET)
                            ? "sends it to everyone in the group"
                            : "sends it to them too"}
                        </span>
                      </span>
                    </>
                  ) : option.kind === "command" ? (
                    <>
                      <Icon icon={COMMAND_ICONS[option.name]} {...ICON_PROPS} />
                      <span class="thread-menu-title">
                        {option.label} <span class="thread-menu-hint">{option.hint}</span>
                      </span>
                    </>
                  ) : option.kind === "link" ? (
                    <>
                      <Icon icon={GitBranchIcon} {...ICON_PROPS} />
                      <span class="thread-menu-title">{option.link.title}</span>
                    </>
                  ) : (
                    <>
                      <Icon icon={Add01Icon} {...ICON_PROPS} />
                      <span class="thread-menu-title">
                        New thread <span class="thread-menu-new">“{option.title}”</span>
                      </span>
                    </>
                  )}
                </button>
              )}
            </For>
          </div>
        </Portal>
      )}
    </Show>
  );
}

// Who made an entry, if a person did.
function entryPerson(entry: Entry): Person | undefined {
  if (entry.kind === "message" || entry.kind === "resolution") return entry.author;
  if (entry.kind === "event") return entry.actor;
  return undefined;
}

export function ThreadView(props: {
  thread: Thread;
  people: Person[];
  actions: ThreadActions;
  // Off while working through the inbox, so its keys work until you choose to reply (R).
  autoFocusReply?: boolean;
}): JSX.Element {
  const merged = merge({ autoFocusReply: true }, props);
  let endEl!: HTMLDivElement;
  let scrollEl!: HTMLDivElement;
  let docEl!: HTMLElement;
  let focusReply: (() => void) | null = null;
  const nowMs = useNow(60_000);
  const me = useMe();
  const entries = (): Entry[] => props.thread.entries;
  // The description moves into the header, under the title.
  const ask = createMemo(() => descriptionOf(props.thread));
  const rest = createMemo(() => {
    const description = ask();
    return description === undefined
      ? entries()
      : entries().filter((entry) => entry !== description);
  });

  // Whether you're following the conversation: the reply block is on screen. Scroll it away to read back and new
  // entries from others stop moving the view; a pill counts them instead. `seenCount` is how many entries the thread
  // had the last time you were following.
  const [following, setFollowing] = createSignal(true);
  const [seenCount, setSeenCount] = createSignal(untrack(() => props.thread.entries.length));
  let followingNow = true;
  let lastLength: number | undefined;

  // Puts the reply block at eye level: its bottom edge a third of the way down the view, so where you type sits just
  // above it. The overscroll spacer leaves room to scroll that far.
  const bringReplyIntoView = (behavior: ScrollBehavior = "auto"): void => {
    const offset = endEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
    scrollEl.scrollTo({
      top: Math.max(0, scrollEl.scrollTop + offset - scrollEl.clientHeight / 3),
      behavior,
    });
  };

  // On opening a thread and whenever it grows: back to the reply block if you're following, or if you made the change.
  createEffect(
    () => ({ entries: entries(), meId: me().id, autoFocusReply: merged.autoFocusReply }),
    ({ entries: all, meId, autoFocusReply }) => {
      const previous = lastLength;
      lastLength = all.length;
      if (previous !== undefined && all.length <= previous) return;
      const added = previous === undefined ? [] : all.slice(previous);
      const yours = added.some((entry) => entryPerson(entry)?.id === meId);
      // Opened from the inbox, a thread starts at its top, title first.
      if (previous === undefined ? autoFocusReply : followingNow || yours) bringReplyIntoView();
    },
  );

  // Tracks following as you scroll; reaching the reply block marks everything seen.
  const onScroll = (): void => {
    const offset = endEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
    const onScreen = offset > 0 && offset <= scrollEl.clientHeight;
    followingNow = onScreen;
    if (onScreen !== following()) setFollowing(onScreen);
    if (onScreen && seenCount() !== entries().length) setSeenCount(entries().length);
  };

  // Messages selected to move, in thread order: right-click → Select, ⌘-click, or shift-click for a range. Kept
  // per thread; moved messages drop out of it on their own. Escape clears it.
  const links = useThreadLinks();
  const [selection, setSelection] = createSignal<{
    threadId: string;
    ids: string[];
    anchor: string | null;
  }>({ threadId: untrack(() => props.thread.id), ids: [], anchor: null });
  const messages = createMemo(() =>
    rest().filter((entry): entry is MessageEntry => entry.kind === "message"),
  );
  const pickedIds = createMemo(() =>
    selection().threadId === props.thread.id ? selection().ids : [],
  );
  const selected = createMemo(() =>
    messages().filter((message) => pickedIds().includes(message.id)),
  );
  const selecting = createMemo(() => selected().length > 0);
  const select = (messageId: string, mode: SelectMode): void => {
    const picked = pickedIds();
    let ids: string[];
    if (mode === "toggle") {
      ids = picked.includes(messageId)
        ? picked.filter((id) => id !== messageId)
        : [...picked, messageId];
    } else {
      const all = messages();
      const to = all.findIndex((message) => message.id === messageId);
      const anchor = all.findIndex((message) => message.id === selection().anchor);
      const from = anchor === -1 ? to : anchor;
      const range = all.slice(Math.min(from, to), Math.max(from, to) + 1).map(({ id }) => id);
      ids = [...new Set([...picked, ...range])];
    }
    setSelection({ threadId: props.thread.id, ids, anchor: messageId });
  };
  const clearSelection = (): void => {
    setSelection({ threadId: props.thread.id, ids: [], anchor: null });
  };
  const isPicked = (entry: Entry | undefined): boolean =>
    entry?.kind === "message" && pickedIds().includes(entry.id);
  const runAt = (index: number): "single" | "start" | "middle" | "end" | undefined => {
    const all = rest();
    if (!isPicked(all[index])) return undefined;
    const before = isPicked(all[index - 1]);
    const after = isPicked(all[index + 1]);
    return before ? (after ? "middle" : "end") : after ? "start" : "single";
  };

  createEffect(
    () => selecting(),
    (on) => {
      if (!on) return;
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape" && !event.defaultPrevented)
          setSelection((current) => ({ ...current, ids: [], anchor: null }));
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    },
  );

  const [menu, setMenu] = createSignal<{ x: number; y: number; items: ContextMenuItem[] } | null>(
    null,
  );
  const moveLabel = (count: number): string =>
    count === 1 ? "Move to thread…" : `Move ${count} messages to thread…`;
  const menuFor = (message: MessageEntry): ContextMenuItem[] => {
    if (pickedIds().includes(message.id)) {
      const picked = selected();
      return [
        { label: moveLabel(picked.length), run: () => props.actions.onMoveMessages(picked) },
        "separator",
        { label: "Clear selection", shortcut: "Esc", run: clearSelection },
      ];
    }
    return [
      { label: moveLabel(1), run: () => props.actions.onMoveMessages([message]) },
      {
        label: selecting() ? "Add to selection" : "Select",
        shortcut: "⌘ Click",
        run: () => select(message.id, "toggle"),
      },
      "separator",
      {
        label: "Copy text",
        run: () =>
          void navigator.clipboard.writeText(
            plainThreadLinks(message.text, links.titleOf, links.nameOf),
          ),
      },
      // Your own messages, other than the description, can be deleted.
      ...(message.author.id === me().id && message.id !== props.thread.id
        ? [
            "separator" as const,
            { label: "Delete message", run: () => props.actions.onDeleteMessage(message) },
          ]
        : []),
    ];
  };

  // What arrived while you were reading back: messages and resolutions by others, else any activity.
  const unseen = createMemo(() => (following() ? [] : entries().slice(seenCount())));
  const unseenMessages = createMemo(
    () =>
      unseen().filter(
        (entry) =>
          (entry.kind === "message" || entry.kind === "resolution") &&
          entryPerson(entry)?.id !== me().id,
      ).length,
  );

  // As in email, a reply goes back to whoever last sent you something here, else the other side.
  const defaultTo = createMemo(() => replyTo(props.thread, me().id));
  const placeholder = (): string =>
    defaultTo().length === 0
      ? "Write a note…"
      : `Reply to ${defaultTo()
          .map((person) => person.name.split(" ")[0])
          .join(", ")}…`;
  // Someone new to reply to changes the prompt, which the editor only takes when it's made, so the reply is made
  // again when this changes.
  const replyKey = createMemo(() =>
    isDone(props.thread.status)
      ? null
      : `${props.thread.id}:${defaultTo()
          .map((person) => person.id)
          .join(",")}`,
  );

  // Clicking empty space in the thread, including below the last block, puts the cursor in the reply.
  const onBackgroundMouseDown = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    const empty =
      target === scrollEl || target === docEl || target.classList.contains("thread-overscroll");
    if (!empty) return;
    event.preventDefault();
    focusReply?.();
  };

  return (
    <CurrentThreadContext value={() => props.thread.id}>
      <div class="thread-view">
        <div
          ref={scrollEl}
          class="thread-scroll"
          onMouseDown={onBackgroundMouseDown}
          onScroll={onScroll}
        >
          <article ref={docEl} class="thread-doc">
            <ThreadHeader
              thread={props.thread}
              ask={ask()}
              nowMs={nowMs()}
              actions={props.actions}
            />
            <For each={rest()} keyed={(entry) => entry.id}>
              {(entry, index) => {
                const kind = createMemo(() => entry().kind);
                return (
                  <Switch>
                    <Match when={kind() === "message"}>
                      <MessageBlock
                        message={entry() as MessageEntry}
                        nowMs={nowMs()}
                        selected={pickedIds().includes(entry().id)}
                        run={runAt(index())}
                        selecting={selecting()}
                        onSelect={(mode) => select(entry().id, mode)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setMenu({
                            x: event.clientX,
                            y: event.clientY,
                            items: menuFor(entry() as MessageEntry),
                          });
                        }}
                      />
                    </Match>
                    <Match when={kind() === "event"}>
                      <EventLine event={entry() as EventEntry} nowMs={nowMs()} />
                    </Match>
                    <Match when={kind() === "resolution"}>
                      <ResolutionBlock resolution={entry() as ResolutionEntry} nowMs={nowMs()} />
                    </Match>
                  </Switch>
                );
              }}
            </For>
            <Show when={replyKey()} keyed>
              <ReplyBlock
                placeholder={placeholder()}
                focusRef={(focus) => (focusReply = focus)}
                defaultTo={defaultTo()}
                people={props.people}
                onNote={(text) => props.actions.onNote(text)}
                onSend={(text, to) => props.actions.onSend(text, to)}
                onBranch={(title) => props.actions.onBranch(title)}
                onCommand={(name) => {
                  if (name === "blocked") props.actions.onBlocked();
                  if (name === "close") props.actions.onSetStatus("closed");
                  if (name === "task") props.actions.onTask();
                }}
                threadId={props.thread.id}
                autoFocus={merged.autoFocusReply}
              />
            </Show>
            <div ref={endEl} />
          </article>
          {/* Room to scroll the last entry up to the top without losing it off screen. */}
          <div class="thread-overscroll" aria-hidden="true" />
        </div>
        <Show when={selecting()}>
          <div class="selection-bar" role="toolbar" aria-label="Selected messages">
            <span class="selection-bar-count">{selected().length} selected</span>
            <button
              type="button"
              class="selection-bar-move"
              onClick={() => props.actions.onMoveMessages(selected())}
            >
              <Icon icon={GitBranchIcon} {...ICON_PROPS} />
              Move to thread…
            </button>
            <button
              type="button"
              class="icon-button selection-bar-clear"
              aria-label="Clear selection"
              title="Clear selection (Esc)"
              onClick={clearSelection}
            >
              <Icon icon={Cancel01Icon} {...ICON_PROPS} />
            </button>
          </div>
        </Show>
        <Show when={menu()}>
          {(shown) => (
            <ContextMenu
              x={shown().x}
              y={shown().y}
              items={shown().items}
              onClose={() => setMenu(null)}
            />
          )}
        </Show>
        <Show when={unseen().length > 0 && !selecting()}>
          <button
            type="button"
            class="thread-new-pill"
            onClick={() => bringReplyIntoView("smooth")}
          >
            <Icon icon={ArrowDown02Icon} {...ICON_PROPS} />
            {unseenMessages() === 0
              ? "New activity"
              : `${unseenMessages()} new ${unseenMessages() === 1 ? "message" : "messages"}`}
          </button>
        </Show>
        <ThreadMinimap entries={entries()} scrollRef={() => scrollEl} nowMs={nowMs()} />
      </div>
    </CurrentThreadContext>
  );
}
