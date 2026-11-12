import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Subspace, Thread, type Activity, plainText, splitText, User, Message } from "models";
import {
  me,
  open,
  others,
  setSplit,
  shortDate,
  showMenu,
  store,
  subspacesWithMembers,
  membersHint,
} from "../session";
import { base } from "../styles/base";
import { link, menu as look } from "../styles/controls";
import { threadLineMarker } from "../styles/markers.stylex";
import { sx } from "../styles/sx";
import { thread } from "../styles/thread";
import { colors, fontSizes, layers, radii } from "../styles/tokens.stylex";
import { caretExtensions, closeCaretMenu, type CaretKind, type CaretMenu } from "./caretMenus";
import { icon } from "./Icon";
import { Identicon } from "./Identicon";
import { moved, OptionButton, type Option } from "./Menus";
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
              {icon("thread", 11)}
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

function Meta(props: {
  user?: User;
  at: Date;
  marker?: boolean;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div {...stylex.attrs(thread.meta, props.marker && threadLineMarker)}>
      <button
        class={sx(base.bare, link.person, thread.author)}
        onClick={() => props.user && open({ person: props.user.id })}
      >
        {props.user?.name ?? "Someone"}
      </button>
      {props.children}
      <span class={sx(styles.quiet)}>{ago(props.at)}</span>
    </div>
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

function Header(props: { thread: Thread }): JSX.Element {
  const c = (): Thread => props.thread;
  return (
    <header class={sx(thread.block, thread.header)}>
      <span class={sx(thread.avatar)}>
        <Identicon seed={c().ownerId ?? ""} size={20} />
      </span>
      <div class={sx(thread.body, thread.headerBody)}>
        <Meta user={c().owner} at={c().createdAt} marker />
        <Show when={c().branchedFrom}>
          {(parent) => (
            <div {...stylex.attrs(thread.byline, threadLineMarker)}>
              <span>Branched from</span>
              <LinkedText text={`[[thread:${parent().id}]]`} current={c().id} byline />
            </div>
          )}
        </Show>
        <For each={c().blockers.filter((blocker) => blocker.isOpen)}>
          {(blocker) => (
            <div {...stylex.attrs(thread.byline, threadLineMarker)}>
              <span>Blocked on</span>
              <LinkedText text={`[[thread:${blocker.id}]]`} current={c().id} byline />
            </div>
          )}
        </For>
        <h1 class={sx(thread.title, thread.headerTitle)}>{c().title}</h1>
        <Show when={c().description}>
          {(description) => (
            <div class={sx(thread.text, thread.description, thread.headerDescription)}>
              <LinkedText text={description()} current={c().id} />
            </div>
          )}
        </Show>
      </div>
    </header>
  );
}

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
      class={sx(thread.block)}
      onContextMenu={(event) =>
        showMenu(event, [
          { label: "Copy text", run: () => void navigator.clipboard.writeText(plain(m().body)) },
          ...(m().authorId === me().id
            ? ["separator" as const, { label: "Delete message", run: () => void m().delete() }]
            : []),
        ])
      }
    >
      <span class={sx(thread.avatar)}>
        <Identicon seed={m().authorId} size={20} />
      </span>
      <div class={sx(thread.body)}>
        <Meta user={m().author} at={m().createdAt} />
        <div class={sx(thread.text)}>
          <LinkedText text={m().body} current={props.thread.id} />
        </div>
      </div>
    </div>
  );
}

// The next message, written at the end. ⌘↵ posts it (Enter is a new line), to everyone in the thread; an @mention brings
// someone in.
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
            icon: "user-list-alt" as const,
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
        icon: "thread" as const,
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
            icon: "add" as const,
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
            Placeholder.configure({
              placeholder: "Reply, @mention someone to bring them in, ⌘↵ to send",
            }),
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
              // Enter is a new line, as in any editor; ⌘↵ sends.
              if (event.key !== "Enter" || !event.metaKey || event.isComposing) return false;
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
    <div class={sx(thread.block)} onClick={() => editor.commands.focus()}>
      <span class={sx(thread.avatar)}>
        <Identicon seed={me().id} size={20} />
      </span>
      <div class={sx(thread.body)}>
        <div class={sx(thread.meta)}>
          <span class={sx(thread.author)}>{me().name}</span>
        </div>
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
    <div class={sx(thread.view)}>
      <div class={sx(thread.scroll)}>
        <article class={sx(thread.doc)}>
          <Header thread={props.thread} />
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
