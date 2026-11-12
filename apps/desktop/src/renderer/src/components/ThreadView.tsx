import * as i from "@hugeicons/core-free-icons";
import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Subspace, Thread, type Activity, plainText, splitText, User, Message } from "models";
import {
  itemFor,
  markDone,
  me,
  myBuckets,
  open,
  others,
  placeIn,
  threadMenu,
  setSplit,
  shortDate,
  showMenu,
  store,
  subspacesWithMembers,
  membersHint,
} from "../session";
import { base } from "../styles/base";
import { link, menu as look } from "../styles/controls";
import { sx } from "../styles/sx";
import { thread } from "../styles/thread";
import { colors, fontSizes, layers, radii, tb } from "../styles/tokens.stylex";
import { caretExtensions, closeCaretMenu, type CaretKind, type CaretMenu } from "./caretMenus";
import { icon } from "./Icon";
import { MenuChip, moved, OptionButton, type Option } from "./Menus";
import { TbIcon } from "./TbIcon";
import type { TbIconName } from "../tbIcons";
import { createThread, send } from "./Palettes";

const styles = stylex.create({
  // The viewport minus about one block, so the last entry can reach the top but never leave the screen.
  overscroll: { height: "calc(100vh - 34px - 140px)" },
  quiet: { color: colors.textTertiary, fontSize: fontSizes.body },
  event: { marginBlock: -6 },
  eventMarker: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 18,
    marginTop: 0,
  },
  eventText: { flex: 1, minWidth: 0, lineHeight: "18px" },
  eventActor: { color: colors.textSecondary },
  // Pulled out by a value's padding, so the first one's icon lines up with the title.
  properties: {
    display: "flex",
    flexWrap: "wrap",
    gap: 2,
    alignItems: "center",
    margin: "4px 0 0 -6px",
  },
  field: { paddingInline: 6, color: colors.textTertiary, fontSize: fontSizes.body },
  fieldAfter: { marginLeft: 10 },
  none: { paddingInline: 6, color: colors.textTertiary, fontSize: fontSizes.body },
  // A person in it: their page, plain until you hover it.
  value: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    minWidth: 0,
    height: 26,
    padding: "0 6px",
    borderRadius: radii.row,
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    fontSize: fontSizes.body,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  // The message pane: the page's white, one readable column in it.
  messagePane: { flexDirection: "column", backgroundColor: tb.page },
  messageBody: { backgroundColor: tb.page },
  column: { maxWidth: 760, padding: "0 24px", zoom: "var(--content-zoom)" },
  // The head: the subject (17px, semibold) with the buttons on its line, who started it under it, a hairline below.
  mh: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "20px 0 14px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
  },
  mhTitleRow: { display: "flex", gap: 12, alignItems: "flex-start" },
  mhSubject: {
    flex: 1,
    margin: 0,
    color: colors.textPrimary,
    fontSize: 15.45,
    fontWeight: 600,
    lineHeight: 1.3,
    letterSpacing: "-0.005em",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  mhButtons: { display: "flex", flexShrink: 0, gap: 4, marginTop: -1 },
  // A toolbarbutton: --button-background-color (--layout-background-3), lighter under the pointer, 3px corners.
  headerButton: {
    display: "flex",
    gap: 4,
    alignItems: "center",
    height: 22,
    padding: "0 7px",
    borderRadius: 3,
    color: colors.textPrimary,
    backgroundColor: {
      default: tb.button,
      ":hover:not(:disabled)": tb.buttonHover,
      ":active:not(:disabled)": tb.buttonActive,
    },
    fontSize: fontSizes.body,
    whiteSpace: "nowrap",
    opacity: { default: 1, ":disabled": 0.4 },
    cursor: "default",
  },
  headerIconButton: { padding: "0 4px" },
  mhByline: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    color: colors.textTertiary,
    fontSize: fontSizes.caption,
  },
  mhName: {
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    fontWeight: 600,
    cursor: "default",
  },
  avatar: {
    display: "inline-grid",
    flexShrink: 0,
    placeItems: "center",
    borderRadius: "50%",
    fontWeight: 600,
    letterSpacing: "0.02em",
  },
  mails: { display: "flex", flexDirection: "column", paddingTop: 6 },
  // A message: a 26px gutter for the avatar (or, in a run, its time under the pointer), its words beside it. A faint wash
  // under the pointer, as a chat's.
  mail: {
    display: "grid",
    gridTemplateColumns: "26px minmax(0, 1fr)",
    columnGap: 10,
    margin: "0 -8px",
    padding: "8px 8px 2px",
    borderRadius: 5,
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${colors.textPrimary} 3.5%, transparent)`,
    },
  },
  mailContinued: { paddingTop: 1 },
  gutter: { display: "flex", justifyContent: "center", paddingTop: 1 },
  gutterTime: {
    color: colors.textTertiary,
    fontSize: 9.09,
    lineHeight: "20px",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1 },
  },
  mailMain: { minWidth: 0 },
  mailHead: { display: "flex", gap: 7, alignItems: "baseline", marginBottom: 1 },
  mailFrom: {
    color: colors.textPrimary,
    fontWeight: 600,
    textDecoration: { default: "none", ":hover": "underline" },
    cursor: "default",
  },
  mailTime: {
    color: colors.textTertiary,
    fontSize: fontSizes.caption,
    fontVariantNumeric: "tabular-nums",
  },
  // What they said: 14px on 1.5 lines.
  mailBody: {
    paddingBottom: 4,
    color: colors.textPrimary,
    fontSize: 12.73,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  // A day's name centred on a hairline.
  day: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    margin: "14px 0 6px",
    color: colors.textTertiary,
    fontSize: fontSizes.caption,
    fontWeight: 600,
    "::before": { content: '""', flex: 1, height: 1, backgroundColor: colors.strokeTertiary },
    "::after": { content: '""', flex: 1, height: 1, backgroundColor: colors.strokeTertiary },
  },
  dayLabel: { flexShrink: 0 },
  compose: { padding: "14px 0 24px" },
  // The compose frame: the page's white, a --color-gray-40 line, 6px corners; the accent's line and a soft ring of it
  // while you type.
  composeBox: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "9px 10px 7px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tb.cardBorder, ":focus-within": colors.accent },
    borderRadius: 6,
    backgroundColor: tb.page,
    boxShadow: {
      default: "none",
      ":focus-within": `0 0 0 3px color-mix(in srgb, ${colors.accent} 20%, transparent)`,
    },
    cursor: "text",
  },
  composeFoot: { display: "flex", gap: 8, alignItems: "center" },
  composeHint: { flex: 1, color: colors.textTertiary, fontSize: fontSizes.small },
  // Send: the primary button, small.
  send: {
    height: 22,
    padding: "0 10px",
    borderRadius: 3,
    color: tb.selectedText,
    backgroundColor: {
      default: tb.selected,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tb.selected} 85%, black)`,
    },
    fontSize: fontSizes.body,
    fontWeight: 600,
    opacity: { default: 1, ":disabled": 0.4 },
    cursor: "default",
  },
  reply: { display: "flex", flex: 1, minWidth: 0, fontSize: 12.73, lineHeight: 1.5 },
  replyEditor: { flex: 1, minHeight: 21, outline: "none", cursor: "text" },
  caretMenu: { position: "fixed", zIndex: layers.caretMenu, width: 300 },
  linkSelf: { color: colors.textSecondary },
  // A hollow ring while open, filled once it's resolved or blocked.
  dot: {
    flexShrink: 0,
    width: 8,
    height: 8,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: colors.iconTertiary,
    borderRadius: "50%",
  },
  resolved: { borderColor: colors.statusClosed, backgroundColor: colors.statusClosed },
  blocked: { borderColor: colors.urgent, backgroundColor: colors.urgent },
});

export const dot = (state: Thread["state"]): JSX.Element => (
  <span class={sx(styles.dot, state !== "open" && styles[state])} aria-hidden="true" />
);

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { style: "narrow" });
export function ago(date: Date): string {
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  const [value, unit] =
    Math.abs(minutes) < 60
      ? [minutes, "minute"]
      : Math.abs(minutes) < 1440
        ? [minutes / 60, "hour"]
        : [minutes / 1440, "day"];
  return RELATIVE.format(Math.round(value), unit as Intl.RelativeTimeFormatUnit);
}
const titleOf = (id: string): string | undefined => store.findById(Thread, id)?.title;
const nameOf = (id: string): string | undefined => store.findById(User, id)?.name;
const subspaceOf = (id: string): string | undefined => store.findById(Subspace, id)?.name;
export const plain = (text: string): string => plainText(text, titleOf, nameOf, subspaceOf);

// Text with its thread links and mentions live: a link opens beside, a mention opens the profile.
function LinkedText(props: { text: string; current: string; byline?: boolean }): JSX.Element {
  return (
    <For each={splitText(props.text)}>
      {(part) =>
        "thread" in part ? (
          <Show
            when={part.thread !== props.current}
            fallback={<span class={sx(styles.linkSelf)}>#{titleOf(part.thread)}</span>}
          >
            <button
              class={sx(base.bare, link.thread, props.byline && link.threadInByline)}
              onClick={() => setSplit(part.thread)}
            >
              {icon(i.GitBranchIcon, 11)}
              {titleOf(part.thread) ?? "Thread"}
            </button>
          </Show>
        ) : "date" in part ? (
          shortDate(new Date(part.date))
        ) : "subspace" in part ? (
          <button
            class={sx(base.bare, link.person, link.mention)}
            onClick={() => open({ subspace: part.subspace })}
          >
            @{subspaceOf(part.subspace) ?? "subspace"}
          </button>
        ) : "person" in part ? (
          <button
            class={sx(base.bare, link.person, link.mention)}
            onClick={() => open({ person: part.person })}
          >
            @{nameOf(part.person) ?? "someone"}
          </button>
        ) : (
          part.text
        )
      }
    </For>
  );
}

export const LABELS = {
  open: "Open",
  resolved: "Resolved",
  blocked: "Blocked",
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

function ActivityLine(props: { activity: Activity; thread: Thread }): JSX.Element {
  const line = (): Activity => props.activity;
  return (
    <div class={sx(thread.block, styles.event)}>
      <span class={sx(thread.avatar, styles.eventMarker)} aria-hidden="true" />
      <div class={sx(styles.quiet, styles.eventText)}>
        <span class={sx(styles.eventActor)}>{line().actor?.name ?? "Someone"}</span>{" "}
        <LinkedText text={line().text} current={props.thread.id} />
        <span> · {ago(line().createdAt)}</span>
      </div>
    </div>
  );
}

// When it was said: the time on its own, the day in a divider above it.
const time = (date: Date): string =>
  date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const longDate = (date: Date): string =>
  `${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} at ${time(date)}`;
const dayOf = (date: Date): number => new Date(date).setHours(0, 0, 0, 0);
function dayLabel(date: Date): string {
  const today = dayOf(new Date());
  const day = dayOf(date);
  if (day === today) return "Today";
  if (day === today - 86_400_000) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(new Date(date).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}
const sinceStarted = (date: Date): string =>
  dayOf(date) === dayOf(new Date())
    ? `today at ${time(date)}`
    : dayOf(date) === dayOf(new Date()) - 86_400_000
      ? `yesterday at ${time(date)}`
      : `on ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${time(date)}`;

// A run of messages from one person: within ten minutes of the last, on the same day, with nothing between.
const RUN = 10 * 60_000;
const continues = (message: Message, before: Message | Activity | undefined): boolean =>
  before instanceof Message &&
  before.authorId === message.authorId &&
  message.createdAt.getTime() - before.createdAt.getTime() < RUN &&
  dayOf(before.createdAt) === dayOf(message.createdAt);

// A message: the first of a run under its sender's avatar, name and time; the rest of the run just their words, the
// time in the gutter under the pointer.
function MessageBlock(props: {
  message: Message;
  thread: Thread;
  continued: boolean;
}): JSX.Element {
  const m = (): Message => props.message;
  return (
    <div
      class={sx(styles.mail, props.continued && styles.mailContinued, stylex.defaultMarker())}
      onContextMenu={(event) =>
        showMenu(event, [
          { label: "Copy Text", run: () => void navigator.clipboard.writeText(plain(m().body)) },
          ...(m().authorId === me().id
            ? ["separator" as const, { label: "Delete Message", run: () => void m().delete() }]
            : []),
        ])
      }
    >
      <div class={sx(styles.gutter)}>
        <Show
          when={!props.continued}
          fallback={
            <span class={sx(styles.gutterTime)} title={longDate(m().createdAt)}>
              {time(m().createdAt)}
            </span>
          }
        >
          <Avatar name={m().author?.name ?? "?"} size={26} />
        </Show>
      </div>
      <div class={sx(styles.mailMain)}>
        <Show when={!props.continued}>
          <div class={sx(styles.mailHead)}>
            <button
              class={sx(base.bare, styles.mailFrom)}
              onClick={() => m().author && open({ person: m().authorId })}
            >
              {m().author?.name ?? "Someone"}
            </button>
            <span class={sx(styles.mailTime)} title={longDate(m().createdAt)}>
              {time(m().createdAt)}
            </span>
          </div>
        </Show>
        <div class={sx(styles.mailBody)}>
          <LinkedText text={m().body} current={props.thread.id} />
        </div>
      </div>
    </div>
  );
}

// A day's start in the conversation: its name between two hairlines.
const DayDivider = (props: { date: Date }): JSX.Element => (
  <div class={sx(styles.day)} role="separator">
    <span class={sx(styles.dayLabel)}>{dayLabel(props.date)}</span>
  </div>
);

// Someone's initials in a soft circle of their own colour, worked out from their name, so the same person is always
// the same colour; light-dark() keeps it legible in either theme.
function Avatar(props: { name: string; size: number }): JSX.Element {
  const initials = (): string =>
    props.name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("");
  const hue = (): number => {
    let h = 7;
    for (let i = 0; i < props.name.length; i++) h = (h * 33 + props.name.charCodeAt(i)) % 3600;
    // Twelve hues 30° apart, so similar names land on clearly different colours.
    return (h % 12) * 30;
  };
  return (
    <span
      class={sx(styles.avatar)}
      style={{
        width: `${props.size}px`,
        height: `${props.size}px`,
        "font-size": `${Math.round(props.size * 0.4)}px`,
        "background-color": `light-dark(hsl(${hue()} 60% 90%), hsl(${hue()} 30% 30%))`,
        color: `light-dark(hsl(${hue()} 45% 32%), hsl(${hue()} 70% 85%))`,
      }}
      aria-hidden="true"
    >
      {initials()}
    </span>
  );
}

// One of the header's buttons: Thunderbird's toolbarbutton, a grey button with its icon and label.
function HeaderButton(props: {
  label: string;
  icon: TbIconName;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      class={sx(base.bare, styles.headerButton)}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      <TbIcon name={props.icon} />
      {props.label}
    </button>
  );
}

// The thread's head: its subject with what you can do with it, and under it who started it and when. Who's in it shows
// where they were tagged, in the messages.
function MessageHeader(props: { thread: Thread }): JSX.Element {
  const c = (): Thread => props.thread;
  const item = () => {
    const it = itemFor(c());
    return it && !it.doneAt ? it : undefined;
  };
  return (
    <header class={sx(styles.mh)}>
      <div class={sx(styles.mhTitleRow)}>
        <h1 class={sx(styles.mhSubject)}>{c().title}</h1>
        <div class={sx(styles.mhButtons)}>
          <HeaderButton
            label="Reply"
            icon="reply"
            onClick={() => document.querySelector<HTMLElement>(".reply")?.focus()}
          />
          <HeaderButton
            label="Archive"
            icon="archive"
            disabled={!item()}
            onClick={() => item() && markDone(item()!)}
          />
          <Show
            when={item()}
            fallback={<HeaderButton label="Move" icon="folder" disabled onClick={() => {}} />}
          >
            {(it) => (
              <MenuChip
                look={[base.bare, styles.headerButton]}
                title="Move to a bucket"
                icon={<TbIcon name="folder" />}
                label="Move"
                items={myBuckets().map((bucket) => ({
                  label: bucket.name,
                  checked: it().bucketId === bucket.id,
                  run: () => placeIn(it(), bucket),
                }))}
              />
            )}
          </Show>
          <button
            class={sx(base.bare, styles.headerButton, styles.headerIconButton)}
            aria-label="More"
            title="More"
            onClick={(e) => showMenu(e, threadMenu(c()))}
          >
            <TbIcon name="more" />
          </button>
        </div>
      </div>
      <div class={sx(styles.mhByline)}>
        <Avatar name={c().owner?.name ?? "?"} size={18} />
        <button
          class={sx(base.bare, styles.mhName)}
          onClick={() => c().ownerId && open({ person: c().ownerId! })}
        >
          {c().owner?.name ?? "Someone"}
        </button>
        <span title={longDate(c().createdAt)}>started this {sinceStarted(c().createdAt)}</span>
      </div>
    </header>
  );
}

// The next message, written at the end. Enter posts it, to everyone in the thread; an @mention brings someone in.
function Reply(props: { thread: Thread; autofocus: boolean }): JSX.Element {
  const c = (): Thread => props.thread;
  const [menus, setMenus] = createSignal<Partial<Record<CaretKind, CaretMenu | null>>>({});
  const [at, setAt] = createSignal(0);
  const kind = (): CaretKind | undefined =>
    (["command", "mention", "thread"] as const).find((k) => menus()[k]);
  let editor!: Editor;
  const options = createMemo((): Option[] => {
    const open = kind();
    if (!open) return [];
    const menu = menus()[open]!;
    const query = menu.query.trim().toLowerCase();
    if (open === "command") return [];
    if (open === "mention")
      return [
        ...others()
          .filter((u) => u.name.toLowerCase().includes(query))
          .map((u) => ({
            label: u.name,
            seed: u.id,
            hint: "brings them in",
            run: () => menu.pick({ id: u.id, name: u.name }),
          })),
        ...subspacesWithMembers()
          .filter((sub) => sub.name.toLowerCase().includes(query))
          .map((sub) => ({
            label: sub.name,
            icon: i.UserMultipleIcon,
            hint: membersHint(sub),
            run: () => menu.pick({ id: `subspace:${sub.id}`, name: sub.name }),
          })),
      ];
    const found = store
      .all(Thread)
      .filter((o) => o.id !== c().id && o.title.toLowerCase().includes(query))
      .slice(0, 6)
      .map((o) => ({
        label: o.title,
        icon: i.GitBranchIcon,
        run: () => menu.pick({ id: o.id, title: o.title }),
      }));
    const title = menu.query.trim();
    const branch = (): void => {
      // With the same people, so it reaches them.
      const people = [...c().assigneeIds, c().ownerId ?? ""].filter((id) => id !== me().id);
      const made = createThread({
        title,
        labelIds: [...c().labelIds],
        subspaceIds: [...c().subspaceIds],
        assignees: [...new Set(people)].flatMap((id) => store.findById(User, id) ?? []),
        branchedFrom: c(),
      });
      menu.pick({ id: made.id, title });
    };
    return title
      ? [
          ...found,
          {
            label: "New thread",
            hint: `“${title}”`,
            icon: i.Add01Icon,
            accent: true,
            run: branch,
          },
        ]
      : found;
  });
  const index = (): number => Math.min(at(), options().length - 1);
  const onMenuKey = (event: KeyboardEvent): boolean => {
    const open = kind();
    if (!open) return false;
    const count = options().length;
    if (event.key === "Escape") closeCaretMenu(editor.view, open);
    else if (count === 0) return false;
    else if (moved(event.key, index(), count) !== undefined)
      setAt(moved(event.key, index(), count)!);
    else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab")
      options()[index()].run();
    else return false;
    return true;
  };
  // Made once, as its element is.
  const mount = (element: HTMLDivElement): void => {
    editor = untrack(
      () =>
        new Editor({
          element,
          autofocus: props.autofocus ? "end" : false,
          extensions: [
            // No underline, so ⌘U stays View As.
            StarterKit.configure({ heading: false, horizontalRule: false, underline: false }),
            Placeholder.configure({ placeholder: "Reply to everyone in this thread" }),
            ...caretExtensions(
              (caret, menu) => (setMenus((all) => ({ ...all, [caret]: menu })), setAt(0)),
            ),
          ],
          editorProps: {
            attributes: {
              class: `${sx(thread.text, styles.replyEditor)} reply`,
              "aria-label": "Reply",
            },
            handleKeyDown: (_view, event) => {
              if (onMenuKey(event)) return true;
              if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false;
              submit();
              return true;
            },
          },
        }),
    );
  };
  // Sends what's written to everyone in the thread, and clears the field for the next.
  const [empty, setEmpty] = createSignal(true);
  const submit = (): void => {
    const body = editor.getText({ blockSeparator: "\n" }).trim();
    if (!body) return;
    send(c(), body);
    editor.commands.clearContent(true);
  };
  onSettled(() => () => editor.destroy());
  return (
    <div class={sx(styles.compose)}>
      {/* The field and its foot in one rounded frame, which takes the accent's ring while you type in it. */}
      <div class={sx(styles.composeBox)} onClick={() => editor.commands.focus()}>
        <div
          ref={mount}
          class={sx(styles.reply)}
          onInput={() => setEmpty(!editor.getText().trim())}
        />
        <div class={sx(styles.composeFoot)}>
          <span class={sx(styles.composeHint)}>
            ↵ to send · ⇧↵ for a new line · @ to bring someone in
          </span>
          <button
            class={sx(base.bare, styles.send)}
            disabled={empty()}
            onClick={(event) => {
              event.stopPropagation();
              submit();
              setEmpty(true);
            }}
          >
            Send
          </button>
        </div>
      </div>
      <Show when={options().length > 0 && menus()[kind()!]?.rect}>
        {(rect) => (
          <Portal mount={document.body}>
            <div
              class={sx(base.panel, look.menu, styles.caretMenu)}
              role="listbox"
              style={{ left: `${rect().left}px`, top: `${rect().bottom + 6}px` }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <For each={options()}>
                {(option, at) => (
                  <OptionButton
                    option={option}
                    selected={at() === index()}
                    onHover={() => setAt(at())}
                  />
                )}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}

// A thread as a document: its heading, its messages, then the reply. Opened from your inbox it starts at the top
// without taking the cursor, so the inbox keys keep working.

export function ThreadView(props: { thread: Thread; autofocus?: boolean }): JSX.Element {
  let end!: HTMLDivElement;
  const messages = (): Message[] => props.thread.messages.sorted("createdAt");
  const entries = (): (Message | Activity)[] =>
    // Of what people did to it, only renames: status, labels and the rest are gone from threads for now.
    [
      ...messages(),
      ...props.thread.activity.sorted("createdAt").filter((a) => a.text.startsWith("renamed")),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // To the end on opening to reply, and whenever you send something.
  let opened = false;
  createEffect(
    () => (messages().at(-1)?.authorId === me().id ? messages().length : 0),
    (mine) => {
      if (opened ? mine : props.autofocus) end.scrollIntoView({ block: "end" });
      opened = true;
    },
  );
  return (
    <div class={sx(thread.view, styles.messagePane)}>
      <div class={sx(thread.scroll, styles.messageBody)}>
        {/* The header scrolls away with the messages rather than staying put. */}
        <div class={sx(styles.column)}>
          <MessageHeader thread={props.thread} />
          <article class={sx(styles.mails)}>
            <For each={entries()}>
              {(entry, at) => {
                const before = (): Message | Activity | undefined => entries()[at() - 1];
                // A new day starts with its name, unless it's the day the thread was started (the header says so).
                const newDay = (): boolean =>
                  dayOf(entry.createdAt) !==
                  dayOf((before() ?? { createdAt: props.thread.createdAt }).createdAt);
                return (
                  <>
                    <Show when={newDay()}>
                      <DayDivider date={entry.createdAt} />
                    </Show>
                    {entry instanceof Message ? (
                      <MessageBlock
                        message={entry}
                        thread={props.thread}
                        continued={!newDay() && continues(entry, before())}
                      />
                    ) : (
                      <ActivityLine activity={entry} thread={props.thread} />
                    )}
                  </>
                );
              }}
            </For>
            <Reply thread={props.thread} autofocus={props.autofocus ?? true} />
            <div ref={end} />
          </article>
        </div>
        {/* Room to scroll the last entry up to the top without losing it off screen. */}
        <div class={sx(styles.overscroll)} aria-hidden="true" />
      </div>
    </div>
  );
}
