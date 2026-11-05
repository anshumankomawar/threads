import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import {
  Add01Icon,
  ArrowDown02Icon,
  Calendar01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import {
  CheckmarkCircle02Icon,
  GitBranchIcon,
  HourglassIcon,
  InboxIcon,
} from "@hugeicons/core-free-icons";
import { Tag01Icon, TaskAdd01Icon, Tick02Icon, UnavailableIcon } from "@hugeicons/core-free-icons";
import { createEffect, createMemo, createSignal, For, merge, onSettled } from "solid-js";
import { Show, untrack, useContext } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { bucketsOf, descriptionOf, EFFORT_OPTIONS, formatEffort, GROUP_TARGET } from "model";
import { groupMentionsIn, groupTarget, inboxPeople, isDone, labelSlug, mentionsIn } from "model";
import { plainThreadLinks, PRIORITY_LABELS, replyTo, splitThreadLinks, STATUS_LABELS } from "model";
import type { Entry, Person, Priority, Status, Thread } from "model";
import { useApp } from "../app/state";
import { CurrentThreadContext } from "../threadLinks";
import { sx } from "../styles/sx";
import { thread } from "../styles/thread";
import { threadLineMarker } from "../styles/markers.stylex";
import { chip, chipTone, link, menu as menuStyles, status, statusDot } from "../styles/controls";
import { colors, fontSizes, layers, radii } from "../styles/tokens.stylex";
import { caretExtensions, closeCaretMenu, type CaretKind, type CaretMenu } from "./caretMenus";
import { selectableLabels } from "../groups";
import { bucketIcons } from "../bucketIcons";
import { DAY, formatDue, formatRelativeTime, startOfDay } from "../format";
import { recipientsOf } from "../compose";
import { Keyed } from "./Keyed";
import { Icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { ThreadMinimap } from "./ThreadMinimap";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

const icon = (svg: IconSvgElement, size = 13, cls?: string) => (
  <Icon icon={svg} size={size} aria-hidden="true" class={cls} />
);
const avatar = (person: { id: string }, size = 20) => <Identicon seed={person.id} size={size} />;
const firstName = (person: { name: string }): string => person.name.split(" ")[0];
const muted = (when: boolean): "muted" | undefined => (when ? "muted" : undefined);

const COMMANDS = [
  ["blocked", "Blocked", "Ask someone for what you need in a new thread", UnavailableIcon],
  ["task", "Task", "Turn what you were asked into a task of your own", TaskAdd01Icon],
  ["close", "Close", "Close this thread for everyone", CheckmarkCircle02Icon],
] as const;

export type MessageEntry = Extract<Entry, { kind: "message" }>;
type SelectMode = "toggle" | "range";
type Run = "start" | "middle" | "end" | undefined;

export type ThreadActions = {
  // A note: nobody is told.
  onNote: (text: string) => void;
  onSend: (text: string, to: Person[]) => void;
  // `/blocked`: ask someone for what this needs, in a new thread that blocks it.
  onBlocked: () => void;
  // `/task`: what you were asked here as a task of your own, linked from this one.
  onTask: () => void;
  onSetStatus: (status: Status) => void;
  onSetPriority: (priority: Priority) => void;
  onSetDue: (dueAtMs: number | null) => void;
  onSetEffort: (effortHours: number | null) => void;
  onToggleLabel: (label: { id: string; name: string }) => void;
  // null hands it back to the model to sort.
  onSetBucket: (bucketId: string | null) => void;
  // A branch with the same people, from "New thread" in the `#` menu; returns its id.
  onBranch: (title: string) => string;
  onMoveMessages: (messages: MessageEntry[]) => void;
  onDeleteMessage: (message: MessageEntry) => void;
};

// A thread link as a chip with the thread's current title, opening beside this one; plain text for this thread.
function ThreadLinkChip(props: { threadId: string; inByline?: boolean }): JSX.Element {
  const app = useApp();
  const current = useContext(CurrentThreadContext);
  const title = (): string => app.links.titleOf(props.threadId) ?? "Thread";
  const self = <span class={sx(styles.linkSelf)}>#{title()}</span>;
  const open = (event: MouseEvent): void => {
    event.stopPropagation();
    app.links.open(props.threadId);
  };
  return (
    <Show when={current() !== props.threadId} fallback={self}>
      <button
        type="button"
        class={sx(link.thread, props.inByline && link.threadInByline)}
        onClick={open}
      >
        {icon(GitBranchIcon, 11, props.inByline ? sx(thread.bylineIcon) : undefined)}
        {title()}
      </button>
    </Show>
  );
}

// Text with its thread links and mentions as chips.
function LinkedText(props: { text: string }): JSX.Element {
  const links = useApp().links;
  const mention = (name: string) => <span class={sx(link.mention)}>@{name}</span>;
  const person = (id: string, name: string) => (
    <button
      type="button"
      class={sx(link.person, link.mention)}
      onClick={() => links.openPerson(id)}
    >
      @{name}
    </button>
  );
  return (
    <For each={splitThreadLinks(props.text)}>
      {(part) =>
        "threadId" in part ? (
          <ThreadLinkChip threadId={part.threadId} />
        ) : "personId" in part ? (
          <Show when={links.nameOf(part.personId)} fallback={mention("someone")}>
            {(name) => person(part.personId, name())}
          </Show>
        ) : "groupId" in part ? (
          mention(links.nameOf(groupTarget(part.groupId)) ?? "group")
        ) : (
          <span>{part.text}</span>
        )
      }
    </For>
  );
}

const MessageText = (props: { text: string; description?: boolean }): JSX.Element => (
  <div class={sx(thread.text, props.description && [thread.description, thread.headerDescription])}>
    <LinkedText text={props.text} />
  </div>
);

// Who wrote it and when: the author opens their profile.
function Meta(props: { person: Person; atMs: number; marker?: boolean; children?: JSX.Element }) {
  const app = useApp();
  const open = (): void => app.links.openPerson(props.person.id);
  return (
    <div {...stylex.attrs(thread.meta, props.marker && threadLineMarker)}>
      <button type="button" class={sx(link.person, thread.author)} onClick={open}>
        {props.person.name}
      </button>
      {props.children}
      <span class={sx(styles.quiet)}>{formatRelativeTime(props.atMs, app.now())}</span>
    </div>
  );
}

// Due-date shortcuts, each at 5pm on that day.
function dueOptions(nowMs: number) {
  const at5pm = (days: number) => new Date(startOfDay(nowMs) + days * DAY).setHours(17, 0, 0, 0);
  const days = {
    Today: 0,
    Tomorrow: 1,
    "This Friday": (5 - new Date(nowMs).getDay() + 7) % 7 || 7,
    "Next week": 7,
  };
  const options = Object.entries(days).map(([label, n]) => ({
    label,
    value: at5pm(n) as number | null,
  }));
  return [...options, { label: "No due date", value: null }];
}

// A property chip that opens a small menu of options, optionally with a field for typing a value in words.
export function MenuChip<T>(props: {
  label: string;
  icon?: JSX.Element;
  tone?: keyof typeof chipTone;
  options: { label: string; value: T; icon?: JSX.Element }[];
  onSelect: (value: T) => void;
  title?: string;
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
  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    const close = (event: Event): void => {
      const key = event instanceof KeyboardEvent;
      if (key ? event.key === "Escape" : !root.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  });
  const item = (label: string, value: T, optionIcon?: JSX.Element) => (
    <div
      class={sx(menuStyles.item, menuStyles.itemHover)}
      role="menuitem"
      onClick={() => choose(value)}
    >
      {optionIcon}
      {label}
    </div>
  );
  return (
    <span ref={root} class={sx(styles.chipAnchor)}>
      <button
        type="button"
        class={sx(chip.chip, open() && chip.open, props.tone && chipTone[props.tone])}
        title={props.title}
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setOpen((value) => !value)}
      >
        {props.icon}
        {props.label}
      </button>
      <Show when={open()}>
        <div class={[sx(menuStyles.menu, chip.menu), "chip-menu"]} role="menu">
          <Show when={props.typed}>
            {(typed) => (
              <input
                ref={(input) => queueMicrotask(() => input.focus())}
                class={sx(menuStyles.input)}
                placeholder={typed().placeholder}
                spellcheck={false}
                value={text()}
                onInput={(event) => setText(event.currentTarget.value)}
                onKeyDown={(event) => event.key === "Enter" && parsed() && choose(parsed()!.value)}
              />
            )}
          </Show>
          <Show when={parsed()}>{(value) => item(value().label, value().value)}</Show>
          <For each={props.options}>{(o) => item(o.label, o.value, o.icon)}</For>
        </div>
      </Show>
    </span>
  );
}

const statusIcon = (value: Status) => (
  <span class={sx(status.dot, value !== "open" && statusDot[value])} aria-hidden="true" />
);

// The top of a thread: who asked and when, the title and description, then its properties, including which of your
// buckets it's in while it's in your inbox.
function ThreadHeader(props: { thread: Thread; ask: MessageEntry | undefined }): JSX.Element {
  const app = useApp();
  const links = app.links;
  const t = (): Thread => props.thread;
  const actions = (): ThreadActions => app.threads.actionsFor(t());
  const due = () => (t().dueAtMs === null ? null : formatDue(t().dueAtMs!, app.now()));
  const buckets = createMemo(() => bucketsOf(app.me()));
  const icons = createMemo(() => bucketIcons(buckets()));
  const bucketIcon = (id?: string) => icons().get(id ?? "") ?? InboxIcon;
  const triage = (): Thread["triage"][string] | undefined => t().triage[app.me().id];
  const bucket = () => buckets().find((b) => b.id === triage()?.bucketId);
  const bucketTitle = (): string =>
    triage() === undefined
      ? "Being sorted into one of your buckets"
      : triage()!.manual
        ? "Placed by you"
        : triage()!.reason;
  const has = (id: string): boolean => t().labelIds.includes(id);
  const offered = () => {
    const all = [
      ...selectableLabels(links.labels, links.groups),
      ...links.labels.filter((l) => has(l.id)),
    ];
    return [...new Map(all.map(({ id, name }) => [id, { id, name }])).values()];
  };
  const labelsLabel = (): string => {
    const [first, ...rest] = links.labels.filter((label) => has(label.id));
    if (first === undefined) return "No labels";
    return rest.length === 0 ? first.name : `${first.name} +${rest.length}`;
  };
  const parseLabel = (text: string) => {
    const name = text.trim();
    const id = labelSlug(name);
    if (id === "") return null;
    const found = links.labels.find((label) => label.id === id || labelSlug(label.name) === id);
    if (found === undefined) return { label: `Make “${name}”`, value: { id, name } };
    return { label: found.name, value: { id: found.id, name: found.name } };
  };
  const description = (): string => props.ask?.text.trim() ?? "";
  const priorityTone = () =>
    t().priority === "urgent" ? "urgent" : muted(t().priority === "none");
  const bucketOptions = () => [
    ...buckets().map(({ id, name }) => ({
      label: name,
      value: id as string | null,
      icon: icon(id === bucket()?.id ? Tick02Icon : bucketIcon(id)),
    })),
    ...(triage()?.manual ? [{ label: "Sort it for me", value: null }] : []),
  ];

  return (
    <header class={sx(thread.block, thread.header)} id={props.ask && `entry-${props.ask.id}`}>
      <span class={sx(thread.avatar)}>{props.ask && avatar(props.ask.author)}</span>
      <div class={sx(thread.body, thread.headerBody)}>
        <Show when={props.ask}>
          {(ask) => <Meta person={ask().author} atMs={ask().createdAtMs} marker />}
        </Show>
        <Show when={t().branchedFromId}>
          {(id) => (
            <div {...stylex.attrs(thread.byline, threadLineMarker)}>
              <span>Branched from</span>
              <ThreadLinkChip threadId={id()} inByline />
            </div>
          )}
        </Show>
        <h1 class={sx(thread.title, thread.headerTitle)}>{t().title}</h1>
        <Show when={description() !== ""}>
          <MessageText text={description()} description />
        </Show>
        <div class={sx(styles.properties)}>
          <MenuChip
            label={STATUS_LABELS[t().status]}
            icon={statusIcon(t().status)}
            options={(Object.keys(STATUS_LABELS) as Status[]).map((value) => ({
              label: STATUS_LABELS[value],
              value,
              icon: statusIcon(value),
            }))}
            onSelect={(value) => actions().onSetStatus(value)}
          />
          <Show when={inboxPeople(t()).includes(app.me().id)}>
            <MenuChip
              label={bucket()?.name ?? "Sorting…"}
              icon={icon(bucketIcon(bucket()?.id))}
              tone={muted(bucket() === undefined)}
              title={bucketTitle()}
              options={bucketOptions()}
              onSelect={(id) => actions().onSetBucket(id)}
            />
          </Show>
          <MenuChip
            label={PRIORITY_LABELS[t().priority]}
            tone={priorityTone()}
            options={(Object.keys(PRIORITY_LABELS) as Priority[]).map((value) => ({
              label: PRIORITY_LABELS[value],
              value,
            }))}
            onSelect={(value) => actions().onSetPriority(value)}
          />
          <MenuChip
            label={due()?.label ?? "No due date"}
            icon={icon(Calendar01Icon)}
            tone={due()?.overdue ? "urgent" : muted(due() === null)}
            options={dueOptions(app.now())}
            onSelect={(value) => actions().onSetDue(value)}
          />
          <MenuChip
            label={t().effortHours === null ? "No estimate" : formatEffort(t().effortHours!)}
            icon={icon(HourglassIcon)}
            tone={muted(t().effortHours === null)}
            options={[
              ...EFFORT_OPTIONS.map((hours) => ({
                label: formatEffort(hours),
                value: hours as number | null,
              })),
              { label: "No estimate", value: null },
            ]}
            onSelect={(value) => actions().onSetEffort(value)}
          />
          <MenuChip
            label={labelsLabel()}
            icon={icon(Tag01Icon)}
            tone={muted(t().labelIds.length === 0)}
            options={offered().map((label) => ({
              label: label.name,
              value: label,
              icon: has(label.id) ? icon(Tick02Icon) : undefined,
            }))}
            typed={{ placeholder: "Find or make a label…", parse: parseLabel }}
            onSelect={(label) => actions().onToggleLabel(label)}
          />
        </div>
      </div>
    </header>
  );
}

// One entry after the header. Messages can be selected to move: a run of selected neighbours reads as one box.
function EntryBlock(props: {
  entry: Entry;
  afterEvent: boolean;
  selected: boolean;
  run: Run;
  selecting: boolean;
  onSelect: (mode: SelectMode) => void;
  onContextMenu: (event: MouseEvent) => void;
}): JSX.Element {
  const app = useApp();
  const entry = (): Entry => props.entry;
  const message = (): MessageEntry => props.entry as MessageEntry;
  const time = (): string => formatRelativeTime(entry().createdAtMs, app.now());
  // Whoever the message names: the people it mentions and the members of the groups it mentions.
  const named = (): Set<string> => {
    const groupIds = groupMentionsIn(message().text);
    const groups = app.links.groups.filter((group) => groupIds.includes(group.id));
    return new Set([...mentionsIn(message().text), ...groups.flatMap((group) => group.memberIds)]);
  };
  const sentTo = (): Person[] => message().sentTo;
  const onClick = (event: MouseEvent): void => {
    if ((event.target as HTMLElement).closest("button, a") !== null) return;
    if (event.shiftKey) props.onSelect("range");
    else if (event.metaKey || props.selecting) props.onSelect("toggle");
  };
  const event = (): JSX.Element => (
    <div
      class={sx(thread.block, styles.event, props.afterEvent && styles.eventAfterEvent)}
      id={`entry-${entry().id}`}
    >
      <span class={sx(thread.avatar, styles.eventMarker)} aria-hidden="true" />
      <div class={sx(styles.quiet, styles.eventText)}>
        <span class={sx(styles.eventActor)}>{(entry() as { actor: Person }).actor.name}</span>{" "}
        <LinkedText text={entry().text} />
        <span> · {time()}</span>
      </div>
    </div>
  );
  const resolution = (): JSX.Element => (
    <div class={sx(thread.block)} id={`entry-${entry().id}`}>
      <span class={sx(thread.avatar, styles.resolutionMarker, styles.resolved)} aria-hidden="true">
        {icon(Tick02Icon, 12)}
      </span>
      <div class={sx(thread.body)}>
        <div class={sx(thread.meta)}>
          <span class={sx(thread.author, thread.authorResolved)}>Done</span>
          <span class={sx(styles.quiet)}>
            {message().author.name} · {time()}
          </span>
        </div>
        <MessageText text={entry().text} />
      </div>
    </div>
  );
  return (
    <Show when={entry().kind !== "event"} fallback={event()}>
      <Show when={entry().kind === "message"} fallback={resolution()}>
        <div
          class={sx(
            thread.block,
            styles.message,
            props.selected && styles.selected,
            props.run && styles[props.run],
            props.selecting && styles.selecting,
          )}
          id={`entry-${entry().id}`}
          // Shift-click selects messages, not text.
          onMouseDown={(event) => event.shiftKey && event.preventDefault()}
          onClick={onClick}
          onContextMenu={(event) => props.onContextMenu(event)}
        >
          <span class={sx(thread.avatar)}>{avatar(message().author)}</span>
          <div class={sx(thread.body)}>
            <Meta person={message().author} atMs={message().createdAtMs}>
              {/* Who it went to, unless it @mentions them all already; or that it's a note nobody was told about. */}
              <Show
                when={sentTo().length !== 0}
                fallback={<span class={sx(styles.note, styles.noteShape)}>Note</span>}
              >
                <Show when={!sentTo().every((person) => named().has(person.id))}>
                  <span class={sx(styles.quiet)}>to {sentTo().map(firstName).join(", ")}</span>
                </Show>
              </Show>
            </Meta>
            <MessageText text={message().text} />
          </div>
        </div>
      </Show>
    </Show>
  );
}

type MenuOption = {
  kind: CaretKind | "new";
  id: string;
  label: string;
  hint?: string;
  svg?: IconSvgElement;
};

// The next message, written in place at the end of the thread. Enter sends it to `defaultTo` plus anyone you
// @mention, or with nobody to send to, keeps it as a note. The To line shows once you've mentioned someone.
function ReplyBlock(props: {
  thread: Thread;
  placeholder: string;
  // Hands the thread a way to focus the reply (null once it's gone), for clicks on empty space.
  focusRef: (focus: (() => void) | null) => void;
  defaultTo: Person[];
  autoFocus: boolean;
}): JSX.Element {
  const app = useApp();
  const me = app.me;
  const links = app.links;
  const actions = (): ThreadActions => app.threads.actionsFor(props.thread);
  const [mentionedIds, setMentionedIds] = createSignal<string[]>([]);
  const [addedIds, setAddedIds] = createSignal<string[]>([]);
  const [removedIds, setRemovedIds] = createSignal<string[]>([]);
  const unremove = (id: string): string[] =>
    setRemovedIds((ids) => ids.filter((other) => other !== id));
  const to = createMemo(() => {
    const mentioned = recipientsOf(
      [...mentionedIds(), ...addedIds()],
      app.data.people(),
      links.groups,
      me(),
    );
    return [...props.defaultTo, ...mentioned].filter(
      (person, index, all) =>
        person.id !== me().id &&
        !removedIds().includes(person.id) &&
        all.findIndex((other) => other.id === person.id) === index,
    );
  });

  // Made as its element is, so the reply has its full height when the thread first scrolls to it.
  let editor!: Editor;
  const mountEditor = (element: HTMLDivElement): void => {
    const { placeholder, autoFocus } = untrack(() => ({ ...props }));
    editor = new Editor({
      element,
      autofocus: autoFocus ? "end" : false,
      extensions: [
        // No underline, so ⌘U stays the app's user picker.
        StarterKit.configure({ heading: false, horizontalRule: false, underline: false }),
        Placeholder.configure({ placeholder }),
        ...caretExtensions((kind, menu) => {
          setMenus((all) => ({ ...all, [kind]: menu }));
          setSelected(0);
        }),
      ],
      onUpdate: ({ editor: current }) => {
        const ids: string[] = [];
        current.state.doc.descendants((node) => {
          if (node.type.name === "mention") ids.push(String(node.attrs.id));
        });
        if (ids.join() !== mentionedIds().join()) setMentionedIds(ids);
      },
      editorProps: {
        attributes: {
          class: `${sx(thread.text, styles.replyEditor)} thread-reply-editor`,
          "aria-label": "Reply",
        },
        handleKeyDown: (view, event) => {
          // An open caret menu gets keys first.
          if (onMenuKey(event)) return true;
          if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false;
          // Chips go out as their tokens (`[[thread:<id>]]`, `[[person:<id>]]`).
          const text = editor.getText({ blockSeparator: "\n" }).trim();
          if (text.length === 0) return true;
          if (to().length > 0) actions().onSend(text, to());
          else actions().onNote(text);
          view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
          setAddedIds([]);
          setRemovedIds([]);
          return true;
        },
      },
    });
  };

  // The caret menus; with more than one open (`#a @b`), `/` wins, then `@`.
  const [menus, setMenus] = createSignal<Partial<Record<CaretKind, CaretMenu | null>>>({});
  const [selected, setSelected] = createSignal(0);
  const openKind = (): CaretKind | undefined =>
    (["command", "mention", "thread"] as const).find((k) => menus()[k]);
  const options = createMemo((): MenuOption[] => {
    const kind = openKind();
    if (kind === undefined) return [];
    const typed = menus()[kind]!.query;
    const query = typed.toLowerCase();
    const has = (name: string): boolean => name.toLowerCase().includes(query);
    if (kind === "command")
      return COMMANDS.filter(([id]) => id.startsWith(query)).map(([id, label, hint, svg]) => ({
        kind,
        id,
        label,
        hint,
        svg,
      }));
    if (kind === "mention") {
      const people = links.people.filter((person) => person.id !== me().id && has(person.name));
      const groups = links.groups.filter((group) => !group.archived && has(group.name));
      const named = [
        ...people,
        ...groups.map((group) => ({ id: groupTarget(group.id), name: group.name })),
      ];
      return named.map(({ id, name }) => ({
        kind,
        id,
        label: name,
        hint: id.startsWith(GROUP_TARGET)
          ? "sends it to everyone in the group"
          : "sends it to them too",
      }));
    }
    // Threads matching what's typed, then a new thread titled by it unless one already has that title.
    const title = typed.trim();
    const found = links.search(title);
    const result: MenuOption[] = found
      .filter((match) => match.id !== props.thread.id)
      .slice(0, 6)
      .map((match) => ({ kind, id: match.id, label: match.title, svg: GitBranchIcon }));
    if (title !== "" && !found.some((match) => match.title.toLowerCase() === title.toLowerCase()))
      result.push({ kind: "new", id: "", label: "New thread", hint: title, svg: Add01Icon });
    return result;
  });
  const current = (): number => Math.min(selected(), options().length - 1);
  const choose = (option: MenuOption): void => {
    const menu = menus()[openKind()!];
    if (option.kind === "command") {
      menu?.pick();
      if (option.id === "blocked") actions().onBlocked();
      if (option.id === "close") actions().onSetStatus("closed");
      if (option.id === "task") actions().onTask();
    } else if (option.kind === "mention") {
      menu?.pick({ id: option.id, name: option.label });
      unremove(option.id);
    } else if (option.kind === "thread") menu?.pick({ id: option.id, title: option.label });
    else menu?.pick({ id: actions().onBranch(option.hint!), title: option.hint });
  };

  const onMenuKey = (key: KeyboardEvent): boolean => {
    const kind = openKind();
    const count = options().length;
    if (kind === undefined) return false;
    if (key.key === "Escape") closeCaretMenu(editor.view, kind);
    else if (count === 0) return false;
    else if (key.key === "ArrowDown") setSelected((selected() + 1) % count);
    else if (key.key === "ArrowUp") setSelected((selected() - 1 + count) % count);
    else if ((key.key === "Enter" && !key.shiftKey) || key.key === "Tab")
      choose(options()[current()]);
    else return false;
    return true;
  };
  onSettled(() => {
    props.focusRef(() => editor.commands.focus("end"));
    return () => {
      props.focusRef(null);
      editor.destroy();
    };
  });
  const addable = (): Person[] =>
    app.data
      .people()
      .filter((person) => person.id !== me().id && !to().some((other) => other.id === person.id));

  return (
    <div class={sx(thread.block)} onClick={() => editor.commands.focus()}>
      <span class={sx(thread.avatar)}>{avatar(me())}</span>
      <div class={sx(thread.body)}>
        <div class={sx(thread.meta)}>
          <span class={sx(thread.author)}>{me().name}</span>
        </div>
        <div ref={mountEditor} class={sx(styles.reply)} />
        <Show when={mentionedIds().length > 0}>
          <div
            class={sx(styles.quiet, styles.replyTo)}
            onClick={(event) => event.stopPropagation()}
          >
            <span class={sx(styles.replyToLabel)}>To</span>
            <For each={to()}>
              {(person) => (
                <span class={sx(chip.chip, chipTone.static, styles.replyToPerson)}>
                  {avatar(person, 12)}
                  {firstName(person)}
                  <button
                    type="button"
                    class={sx(styles.replyToRemove)}
                    aria-label={`Don't send to ${person.name}`}
                    onClick={() => setRemovedIds((ids) => [...ids, person.id])}
                  >
                    {icon(Cancel01Icon, 10)}
                  </button>
                </span>
              )}
            </For>
            <MenuChip
              label={to().length === 0 ? "Add someone" : "Add"}
              icon={icon(Add01Icon, 11)}
              tone="muted"
              options={addable().map((person) => ({
                label: person.name,
                value: person,
                icon: avatar(person, 14),
              }))}
              onSelect={(person) => {
                setAddedIds((ids) => [...ids, person.id]);
                unremove(person.id);
              }}
            />
          </div>
        </Show>
      </div>
      {/* On the body, so the content zoom doesn't move it. */}
      <Show when={options().length > 0 && menus()[openKind()!]?.rect}>
        {(rect) => (
          <Portal mount={document.body}>
            <div
              class={[sx(menuStyles.menu, styles.caretMenu), "thread-menu"]}
              role="listbox"
              aria-label="Link a thread"
              style={{ left: `${rect().left}px`, top: `${rect().bottom + 6}px` }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <For each={options()}>
                {(option, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index() === current() ? "true" : "false"}
                    class={sx(menuStyles.item, index() === current() && menuStyles.itemSelected)}
                    onMouseEnter={() => setSelected(index())}
                    onClick={() => choose(option)}
                  >
                    {option.svg ? icon(option.svg) : avatar(option, 14)}
                    <span class={sx(styles.menuTitle)}>
                      {option.label}{" "}
                      <span class={sx(option.kind === "new" ? styles.menuNew : styles.menuHint)}>
                        {option.kind === "new" ? `“${option.hint}”` : option.hint}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}

export function ThreadView(props: {
  thread: Thread;
  // Off while working through the inbox, so its keys work until you choose to reply (R).
  autoFocusReply?: boolean;
}): JSX.Element {
  const merged = merge({ autoFocusReply: true }, props);
  let endEl!: HTMLDivElement;
  let scrollEl!: HTMLDivElement;
  let docEl!: HTMLElement;
  let focusReply: (() => void) | null = null;
  const app = useApp();
  const me = app.me;
  const links = app.links;
  const actions = (): ThreadActions => app.threads.actionsFor(props.thread);
  const entries = (): Entry[] => props.thread.entries;
  const by = (entry: Entry): string => (entry.kind === "event" ? entry.actor : entry.author).id;
  // The description moves into the header.
  const ask = createMemo(() => descriptionOf(props.thread));
  const rest = createMemo(() => entries().filter((entry) => entry !== ask()));

  // Following: the reply block is on screen. Read back and new entries from others stop moving the view; a pill
  // counts them instead. `seenCount` is how many entries there were when you last followed.
  const [following, setFollowing] = createSignal(true);
  const [seenCount, setSeenCount] = createSignal(untrack(() => props.thread.entries.length));
  let followingNow = true;
  let lastLength: number | undefined;
  const replyOffset = () =>
    endEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
  // The reply's bottom edge a third of the way down the view; the overscroll spacer leaves room to scroll that far.
  const bringReplyIntoView = (behavior: ScrollBehavior = "auto"): void => {
    const top = Math.max(0, scrollEl.scrollTop + replyOffset() - scrollEl.clientHeight / 3);
    scrollEl.scrollTo({ top, behavior });
  };
  createEffect(
    () => ({ all: entries(), meId: me().id, autoFocus: merged.autoFocusReply }),
    ({ all, meId, autoFocus }) => {
      const previous = lastLength;
      lastLength = all.length;
      if (previous !== undefined && all.length <= previous) return;
      // Opened from the inbox, a thread starts at its top; growing, it follows if you were or if you made the change.
      const yours = previous !== undefined && all.slice(previous).some((e) => by(e) === meId);
      if (previous === undefined ? autoFocus : followingNow || yours) bringReplyIntoView();
    },
  );
  const onScroll = (): void => {
    const onScreen = replyOffset() > 0 && replyOffset() <= scrollEl.clientHeight;
    followingNow = onScreen;
    if (onScreen !== following()) setFollowing(onScreen);
    if (onScreen && seenCount() !== entries().length) setSeenCount(entries().length);
  };

  // Messages selected to move (right-click → Select, ⌘-click, shift-click for a range), kept per thread.
  const none = { threadId: untrack(() => props.thread.id), ids: [] as string[], anchor: "" };
  const [selection, setSelection] = createSignal(none);
  const messages = createMemo(() => rest().filter((e): e is MessageEntry => e.kind === "message"));
  const pickedIds = () => (selection().threadId === props.thread.id ? selection().ids : []);
  const selected = createMemo(() => messages().filter((m) => pickedIds().includes(m.id)));
  const selecting = (): boolean => selected().length > 0;
  const setPicked = (ids: string[], anchor = ""): void => {
    setSelection({ threadId: props.thread.id, ids, anchor });
  };
  const select = (id: string, mode: SelectMode): void => {
    const picked = pickedIds();
    const toggled = picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id];
    if (mode === "toggle") return setPicked(toggled, id);
    const all = messages().map((message) => message.id);
    const to = all.indexOf(id);
    const from = all.includes(selection().anchor) ? all.indexOf(selection().anchor) : to;
    const range = all.slice(Math.min(from, to), Math.max(from, to) + 1);
    setPicked([...new Set([...picked, ...range])], id);
  };
  const isPicked = (entry?: Entry) => !!entry && pickedIds().includes(entry.id);
  const runAt = (index: number): Run => {
    const [before, after] = [isPicked(rest()[index - 1]), isPicked(rest()[index + 1])];
    if (!isPicked(rest()[index])) return undefined;
    return before ? (after ? "middle" : "end") : after ? "start" : undefined;
  };
  createEffect(selecting, (on) => {
    if (!on) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) setPicked([]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const [menu, setMenu] = createSignal<{ x: number; y: number; items: ContextMenuItem[] }>();
  const move = (picked: MessageEntry[]): { label: string; run: () => void } => ({
    label: picked.length === 1 ? "Move to thread…" : `Move ${picked.length} messages to thread…`,
    run: () => actions().onMoveMessages(picked),
  });
  const menuFor = (message: MessageEntry): ContextMenuItem[] => {
    if (pickedIds().includes(message.id))
      return [
        move(selected()),
        "separator",
        { label: "Clear selection", shortcut: "Esc", run: () => setPicked([]) },
      ];
    const text = plainThreadLinks(message.text, links.titleOf, links.nameOf);
    const label = selecting() ? "Add to selection" : "Select";
    return [
      move([message]),
      { label, shortcut: "⌘ Click", run: () => select(message.id, "toggle") },
      "separator",
      { label: "Copy text", run: () => void navigator.clipboard.writeText(text) },
      // Your own messages, other than the description, can be deleted.
      ...(message.author.id === me().id && message.id !== props.thread.id
        ? [
            "separator" as const,
            { label: "Delete message", run: () => actions().onDeleteMessage(message) },
          ]
        : []),
    ];
  };

  // What arrived while you were reading back: messages and resolutions by others, else any activity.
  const unseen = createMemo(() => (following() ? [] : entries().slice(seenCount())));
  const pill = (): string => {
    const count = unseen().filter((e) => e.kind !== "event" && by(e) !== me().id).length;
    return count === 0 ? "New activity" : `${count} new ${count === 1 ? "message" : "messages"}`;
  };

  // As in email, a reply goes back to whoever last sent you something here, else the other side.
  const defaultTo = createMemo(() => replyTo(props.thread, me().id));
  const placeholder = () =>
    defaultTo().length === 0
      ? "Write a note…"
      : `Reply to ${defaultTo().map(firstName).join(", ")}…`;
  // The editor takes its placeholder only when made, so someone new to reply to makes the reply again.
  const replyKey = () =>
    isDone(props.thread.status)
      ? null
      : `${props.thread.id}:${defaultTo()
          .map((person) => person.id)
          .join()}`;
  // Clicking empty space in the thread, including below the last block, puts the cursor in the reply.
  const onBackgroundDown = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (target !== scrollEl && target !== docEl && !target.classList.contains("thread-overscroll"))
      return;
    event.preventDefault();
    focusReply?.();
  };

  return (
    <CurrentThreadContext value={() => props.thread.id}>
      <div class={[sx(thread.view), "thread-view"]}>
        <div
          ref={scrollEl}
          class={sx(thread.scroll)}
          onScroll={onScroll}
          onMouseDown={onBackgroundDown}
        >
          <article ref={docEl} class={sx(thread.doc)}>
            <ThreadHeader thread={props.thread} ask={ask()} />
            <For each={rest()} keyed={(entry) => entry.id}>
              {(entry, index) => (
                <EntryBlock
                  entry={entry()}
                  afterEvent={rest()[index() - 1]?.kind === "event"}
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
              )}
            </For>
            <Keyed value={replyKey()} by={(key) => key}>
              {() => (
                <ReplyBlock
                  thread={props.thread}
                  placeholder={placeholder()}
                  focusRef={(focus) => (focusReply = focus)}
                  defaultTo={defaultTo()}
                  autoFocus={merged.autoFocusReply}
                />
              )}
            </Keyed>
            <div ref={endEl} />
          </article>
          {/* Room to scroll the last entry up to the top without losing it off screen. */}
          <div class={[sx(styles.overscroll), "thread-overscroll"]} aria-hidden="true" />
        </div>
        <Show when={selecting()}>
          <div
            class={sx(menuStyles.menu, styles.floating, styles.bar, styles.selectionBar)}
            role="toolbar"
            aria-label="Selected messages"
          >
            <span class={sx(styles.selectionCount)}>{selected().length} selected</span>
            <button
              type="button"
              class={sx(styles.barButton, styles.move)}
              onClick={() => move(selected()).run()}
            >
              {icon(GitBranchIcon)}
              Move to thread…
            </button>
            <button
              type="button"
              class={sx(styles.barButton, styles.clear)}
              aria-label="Clear selection"
              title="Clear selection (Esc)"
              onClick={() => setPicked([])}
            >
              {icon(Cancel01Icon)}
            </button>
          </div>
        </Show>
        <Show when={menu()}>
          {(shown) => <ContextMenu {...shown()} onClose={() => setMenu()} />}
        </Show>
        <Show when={unseen().length > 0 && !selecting()}>
          <button
            type="button"
            class={sx(
              menuStyles.menu,
              styles.floating,
              styles.bar,
              styles.newPill,
              styles.newPillHover,
            )}
            onClick={() => bringReplyIntoView("smooth")}
          >
            {icon(ArrowDown02Icon)}
            {pill()}
          </button>
        </Show>
        <ThreadMinimap entries={entries()} scrollRef={() => scrollEl} />
      </div>
    </CurrentThreadContext>
  );
}

const quiet = { color: colors.textTertiary, fontSize: fontSizes.body };
const bare = { borderStyle: "none", backgroundColor: "transparent", cursor: "pointer" } as const;
const center = { alignItems: "center", justifyContent: "center" } as const;
const edge = "-10.25px";
const hoverColor = (base: string) => ({ default: base, ":hover": colors.textPrimary });
const hoverFill = (base: string) => ({ default: base, ":hover": colors.panelSelected });

const styles = stylex.create({
  // The viewport minus about one block, so the last entry can reach the top but never leave the screen.
  overscroll: { height: "calc(100vh - 34px - 140px)" },
  quiet,
  properties: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 4 },
  chipAnchor: { position: "relative", display: "inline-flex" },
  note: { borderWidth: 1, borderStyle: "solid", borderColor: colors.strokeTertiary, ...quiet },
  noteShape: { padding: "0 5px", borderRadius: radii.control, fontSize: 10.5, lineHeight: "15px" },
  message: { position: "relative", isolation: "isolate" },
  selected: {
    "::before": {
      content: '""',
      position: "absolute",
      inset: "-7px -10px",
      zIndex: -1,
      borderRadius: radii.item,
      backgroundColor: colors.accentFill,
      boxShadow: `inset 2px 0 ${colors.accent}`,
    },
  },
  // The tint fills the gap between selected neighbours.
  start: { "::before": { bottom: edge, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } },
  middle: { "::before": { top: edge, bottom: edge, borderRadius: 0 } },
  end: { "::before": { top: edge, borderTopLeftRadius: 0, borderTopRightRadius: 0 } },
  selecting: { cursor: "pointer", userSelect: "none" },
  event: { marginBlock: -6 },
  eventAfterEvent: { marginTop: -14.5 },
  eventMarker: { ...center, height: 18, marginTop: 0 },
  eventText: { flex: 1, minWidth: 0, lineHeight: "18px" },
  eventActor: { color: colors.textSecondary },
  resolutionMarker: { ...center, width: 20, marginInline: 1, borderRadius: "50%" },
  resolved: {
    color: colors.statusClosed,
    backgroundColor: `color-mix(in srgb, ${colors.statusClosed} 18%, transparent)`,
  },
  reply: { display: "flex", flex: 1, minWidth: 0 },
  replyEditor: { minHeight: 21, outline: "none", cursor: "text" },
  replyTo: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 },
  replyToLabel: { marginRight: 2 },
  replyToPerson: { padding: "0 4px 0 6px", borderRadius: radii.item },
  replyToRemove: { ...bare, display: "flex", padding: 2, color: hoverColor(colors.iconTertiary) },
  caretMenu: { position: "fixed", zIndex: layers.caretMenu, width: 300 },
  menuTitle: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  menuNew: { color: colors.accent },
  menuHint: { marginLeft: 6, color: colors.textTertiary },
  linkSelf: { color: colors.textSecondary },
  floating: {
    position: "absolute",
    bottom: 16,
    left: "50%",
    zIndex: layers.float,
    transform: "translateX(-50%)",
  },
  // On the menu panel.
  bar: {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    overflowY: "visible",
    fontSize: fontSizes.body,
  },
  newPill: { gap: 6, height: 26, padding: "0 12px", borderRadius: 13, color: colors.textPrimary },
  newPillHover: { font: "inherit", backgroundColor: hoverFill(colors.panel), cursor: "pointer" },
  selectionBar: { gap: 4, height: 30, padding: "0 4px 0 12px", color: colors.textSecondary },
  selectionCount: { marginRight: 6 },
  barButton: {
    ...bare,
    ...center,
    display: "inline-flex",
    gap: 6,
    height: 22,
    borderRadius: radii.control,
  },
  move: {
    padding: "0 8px",
    color: colors.textPrimary,
    font: "inherit",
    backgroundColor: hoverFill("transparent"),
  },
  clear: { width: 22, padding: 0, color: hoverColor(colors.textTertiary) },
});
