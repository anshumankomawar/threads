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
  // #messagePane: the header on --layout-background-1, the messages on the page's white under it.
  messagePane: { flexDirection: "column", backgroundColor: tb.page },
  mh: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flexShrink: 0,
    padding: "10px 14px 10px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
    backgroundColor: colors.chrome,
    zoom: "var(--content-zoom)",
  },
  mhTop: { display: "flex", gap: 8, alignItems: "center", minWidth: 0 },
  mhFrom: { display: "flex", flex: 1, flexDirection: "column", minWidth: 0 },
  mhName: { color: colors.textPrimary, fontWeight: 700, textAlign: "left" },
  mhRole: { color: colors.textTertiary, fontSize: fontSizes.caption },
  mhButtons: { display: "flex", flexShrink: 0, gap: 4 },
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
  // The subject: 1.2rem bold.
  mhSubject: {
    margin: "2px 0 0 34px",
    color: colors.textPrimary,
    fontSize: fontSizes.pageTitle,
    fontWeight: 700,
    lineHeight: 1.3,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  avatar: {
    display: "inline-grid",
    flexShrink: 0,
    placeItems: "center",
    borderRadius: "50%",
    color: tb.avatarText,
    backgroundColor: tb.avatar,
    fontWeight: 700,
  },
  messageBody: { backgroundColor: tb.page },
  mails: { display: "flex", flexDirection: "column", zoom: "var(--content-zoom)" },
  // Each message as a mail: its sender and date over its body, a hairline under it.
  // Each message as a mail: its sender and date over its body, set apart by space alone.
  mail: { padding: "10px 14px 8px" },
  mailHead: { display: "flex", gap: 8, alignItems: "center", marginBottom: 6 },
  mailFrom: { color: colors.textPrimary, fontWeight: 700 },
  mailDate: { marginLeft: "auto", color: colors.textTertiary, fontSize: fontSizes.caption },
  mailBody: {
    marginLeft: 28,
    color: colors.textPrimary,
    fontSize: fontSizes.message,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  compose: { padding: "12px 14px" },
  // The compose field: the page's white in a 1px --color-gray-40 frame, 3px corners.
  composeBox: {
    marginLeft: 28,
    padding: "6px 8px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tb.border1,
    borderRadius: 3,
    backgroundColor: tb.page,
  },
  reply: { display: "flex", flex: 1, minWidth: 0 },
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

function MessageBlock(props: { message: Message; thread: Thread }): JSX.Element {
  const m = (): Message => props.message;
  return (
    <div
      class={sx(styles.mail)}
      onContextMenu={(event) =>
        showMenu(event, [
          { label: "Copy text", run: () => void navigator.clipboard.writeText(plain(m().body)) },
          ...(m().authorId === me().id
            ? ["separator" as const, { label: "Delete message", run: () => void m().delete() }]
            : []),
        ])
      }
    >
      <div class={sx(styles.mailHead)}>
        <Avatar name={m().author?.name ?? "?"} size={20} />
        <button
          class={sx(base.bare, link.person, styles.mailFrom)}
          onClick={() => m().author && open({ person: m().authorId })}
        >
          {m().author?.name ?? "Someone"}
        </button>
        <span class={sx(styles.mailDate)}>{longDate(m().createdAt)}</span>
      </div>
      <div class={sx(styles.mailBody)}>
        <LinkedText text={m().body} current={props.thread.id} />
      </div>
    </div>
  );
}

// messageHeader.css's recipient avatar: a grey circle with their initials.
function Avatar(props: { name: string; size: number }): JSX.Element {
  const initials = (): string =>
    props.name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("");
  return (
    <span
      class={sx(styles.avatar)}
      style={{
        width: `${props.size}px`,
        height: `${props.size}px`,
        "font-size": `${Math.round(props.size * 0.42)}px`,
      }}
      aria-hidden="true"
    >
      {initials()}
    </span>
  );
}

const longDate = (date: Date): string =>
  `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

// One of the message header's buttons: Thunderbird's toolbarbutton, a grey button with its icon and label.
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

// #messageHeader: who it's from and when beside their avatar, the buttons at the end, then the subject in bold. Who's in
// it shows where they were tagged, in the messages.
function MessageHeader(props: { thread: Thread }): JSX.Element {
  const c = (): Thread => props.thread;
  const item = () => {
    const it = itemFor(c());
    return it && !it.doneAt ? it : undefined;
  };
  return (
    <header class={sx(styles.mh)}>
      <div class={sx(styles.mhTop)}>
        <Avatar name={c().owner?.name ?? "?"} size={26} />
        <div class={sx(styles.mhFrom)}>
          <button
            class={sx(base.bare, link.person, styles.mhName)}
            onClick={() => c().ownerId && open({ person: c().ownerId! })}
          >
            {c().owner?.name ?? "Someone"}
          </button>
          <span class={sx(styles.mhRole)}>{longDate(c().createdAt)}</span>
        </div>
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
      <h1 class={sx(styles.mhSubject)}>{c().title}</h1>
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
            Placeholder.configure({ placeholder: "Reply… @mention someone to bring them in" }),
            ...caretExtensions(
              (caret, menu) => (setMenus((all) => ({ ...all, [caret]: menu })), setAt(0)),
            ),
          ],
          editorProps: {
            attributes: {
              class: `${sx(thread.text, styles.replyEditor)} reply`,
              "aria-label": "Reply",
            },
            handleKeyDown: (view, event) => {
              if (onMenuKey(event)) return true;
              if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false;
              const body = editor.getText({ blockSeparator: "\n" }).trim();
              if (!body) return true;
              send(c(), body);
              view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
              return true;
            },
          },
        }),
    );
  };
  onSettled(() => () => editor.destroy());
  return (
    <div class={sx(styles.compose)} onClick={() => editor.commands.focus()}>
      <div class={sx(styles.mailHead)}>
        <Avatar name={me().name} size={20} />
        <span class={sx(styles.mailFrom)}>Reply as {me().name}</span>
        <span class={sx(styles.mailDate)}>↵ to send</span>
      </div>
      <div class={sx(styles.composeBox)}>
        <div ref={mount} class={sx(styles.reply)} />
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
        <MessageHeader thread={props.thread} />
        <article class={sx(styles.mails)}>
          <For each={entries()}>
            {(entry) =>
              entry instanceof Message ? (
                <MessageBlock message={entry} thread={props.thread} />
              ) : (
                <ActivityLine activity={entry} thread={props.thread} />
              )
            }
          </For>
          <Reply thread={props.thread} autofocus={props.autofocus ?? true} />
          <div ref={end} />
        </article>
        {/* Room to scroll the last entry up to the top without losing it off screen. */}
        <div class={sx(styles.overscroll)} aria-hidden="true" />
      </div>
    </div>
  );
}
