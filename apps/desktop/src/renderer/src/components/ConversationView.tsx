import * as i from "@hugeicons/core-free-icons";
import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
  Bucket,
  Conversation,
  mentionsIn,
  plainText,
  PRIORITIES,
  splitText,
  STATES,
  User,
  type Message,
} from "models";
import { itemFor, me, open, setDialog, setSplit, setState, showMenu, store } from "../session";
import { bucketIcons } from "../bucketIcons";
import { link, menu as look } from "../styles/controls";
import { threadLineMarker } from "../styles/markers.stylex";
import { sx } from "../styles/sx";
import { thread } from "../styles/thread";
import { colors, fontSizes, layers, radii } from "../styles/tokens.stylex";
import { caretExtensions, closeCaretMenu, type CaretKind, type CaretMenu } from "./caretMenus";
import { Icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { MenuChip } from "./Menus";
import { send } from "./Palettes";

const styles = stylex.create({
  // The viewport minus about one block, so the last entry can reach the top but never leave the screen.
  overscroll: { height: "calc(100vh - 34px - 140px)" },
  quiet: { color: colors.textTertiary, fontSize: fontSizes.body },
  properties: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 4 },
  note: {
    padding: "0 5px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.control,
    color: colors.textTertiary,
    fontSize: 10.5,
    lineHeight: "15px",
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

const icon = (svg: IconSvgElement, size = 13): JSX.Element => (
  <Icon icon={svg} size={size} aria-hidden="true" />
);
const dot = (state: Conversation["state"]): JSX.Element => (
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
const titleOf = (id: string): string | undefined => store.findById(Conversation, id)?.title;
const nameOf = (id: string): string | undefined => store.findById(User, id)?.name;
export const plain = (text: string): string => plainText(text, titleOf, nameOf);

// Text with its conversation links and mentions live: a link opens beside, a mention opens the profile.
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
              class={sx(link.thread, props.byline && link.threadInByline)}
              onClick={() => setSplit(part.thread)}
            >
              {icon(i.GitBranchIcon, 11)}
              {titleOf(part.thread) ?? "Conversation"}
            </button>
          </Show>
        ) : "person" in part ? (
          <button
            class={sx(link.person, link.mention)}
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
        class={sx(link.person, thread.author)}
        onClick={() => props.user && open({ person: props.user.id })}
      >
        {props.user?.name ?? "Someone"}
      </button>
      {props.children}
      <span class={sx(styles.quiet)}>{ago(props.at)}</span>
    </div>
  );
}

// Due-date shortcuts, at 5pm.
const dueAt = (days: number): Date =>
  new Date(new Date(Date.now() + days * 86_400_000).setHours(17, 0, 0, 0));
const LABELS = {
  open: "Open",
  resolved: "Resolved",
  blocked: "Blocked",
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

function Header(props: { conversation: Conversation }): JSX.Element {
  const c = (): Conversation => props.conversation;
  const item = (): ReturnType<typeof itemFor> => itemFor(c());
  const edit = (change: Partial<Conversation>) => () => (Object.assign(c(), change), c().save());
  const place = (bucket: Bucket | undefined) => () => {
    const placed = item()!;
    placed.bucket = bucket;
    placed.manual = bucket !== undefined;
    placed.save();
  };
  const buckets = (): Bucket[] =>
    store.where(Bucket, "userId", me().id).sort((a, b) => a.position - b.position);
  const bucketIcon = (bucket?: Bucket): IconSvgElement =>
    bucketIcons(buckets()).get(bucket?.id ?? "") ?? i.InboxIcon;
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
        <h1 class={sx(thread.title, thread.headerTitle)}>{c().title}</h1>
        <div class={sx(styles.properties)}>
          <MenuChip
            label={LABELS[c().state]}
            icon={dot(c().state)}
            items={STATES.map((state) => ({
              label: LABELS[state],
              icon: dot(state),
              run: () => setState(c(), state),
            }))}
          />
          <Show when={item()}>
            {(it) => (
              <MenuChip
                label={it().bucket?.name ?? "Sorting…"}
                icon={icon(bucketIcon(it().bucket))}
                tone={it().bucket ? undefined : "muted"}
                title={
                  it().bucket
                    ? it().manual
                      ? "Placed by you"
                      : it().reason
                    : "Being sorted into one of your buckets"
                }
                items={[
                  ...buckets().map((b) => ({
                    label: b.name,
                    icon: icon(b === it().bucket ? i.Tick02Icon : bucketIcon(b)),
                    run: place(b),
                  })),
                  ...(it().manual ? [{ label: "Sort it for me", run: place(undefined) }] : []),
                ]}
              />
            )}
          </Show>
          <MenuChip
            label={LABELS[c().priority]}
            tone={
              c().priority === "urgent" ? "urgent" : c().priority === "none" ? "muted" : undefined
            }
            items={PRIORITIES.map((priority) => ({
              label: LABELS[priority],
              run: edit({ priority }),
            }))}
          />
          <MenuChip
            icon={icon(i.Calendar01Icon)}
            label={
              c().dueAt
                ? `Due ${c().dueAt!.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                : "No due date"
            }
            tone={
              c().dueAt && c().dueAt!.getTime() < Date.now()
                ? "urgent"
                : c().dueAt
                  ? undefined
                  : "muted"
            }
            items={[
              { label: "Today", run: edit({ dueAt: dueAt(0) }) },
              { label: "Tomorrow", run: edit({ dueAt: dueAt(1) }) },
              { label: "Next week", run: edit({ dueAt: dueAt(7) }) },
              { label: "No due date", run: edit({ dueAt: undefined }) },
            ]}
          />
        </div>
      </div>
    </header>
  );
}

function MessageBlock(props: { message: Message; conversation: Conversation }): JSX.Element {
  const m = (): Message => props.message;
  const to = (): string =>
    m()
      .toIds.filter((id) => !mentionsIn(m().body).includes(id))
      .map((id) => nameOf(id)?.split(" ")[0] ?? "someone")
      .join(", ");
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
        <Meta user={m().author} at={m().createdAt}>
          <Show when={m().toIds.length > 0} fallback={<span class={sx(styles.note)}>Note</span>}>
            <Show when={to()}>
              <span class={sx(styles.quiet)}>to {to()}</span>
            </Show>
          </Show>
        </Meta>
        <div class={sx(thread.text)}>
          <LinkedText text={m().body} current={props.conversation.id} />
        </div>
      </div>
    </div>
  );
}

// Who a reply goes to: whoever last sent you something here; else, for its owner, everyone else on it; else its owner.
function replyTo(c: Conversation): User[] {
  const messages = c.messages.sorted("createdAt");
  const asked = messages.findLast((m) => m.authorId !== me().id && m.toIds.includes(me().id));
  const ids = asked
    ? [asked.authorId]
    : c.ownerId === me().id
      ? messages.flatMap((m) => [m.authorId, ...m.toIds])
      : [c.ownerId ?? ""];
  return [...new Set(ids)]
    .filter((id) => id !== me().id)
    .flatMap((id) => store.findById(User, id) ?? []);
}

// An option shows an avatar (`seed`) or an icon.
type Option = {
  label: string;
  hint?: string;
  seed?: string;
  icon?: IconSvgElement;
  isNew?: boolean;
  pick: () => void;
};

// The next message, written at the end. Enter sends it to `replyTo` and anyone @mentioned; with nobody, it's a note.
function Reply(props: { conversation: Conversation; autofocus: boolean }): JSX.Element {
  const c = (): Conversation => props.conversation;
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
    if (open === "command")
      return [
        {
          label: "Blocked",
          hint: "Ask someone for what this needs",
          icon: i.UnavailableIcon,
          pick: () => (menu.pick(), setDialog({ kind: "blocked", conversation: c() })),
        },
        {
          label: "Resolve",
          hint: "Resolve it for everyone",
          icon: i.CheckmarkCircle02Icon,
          pick: () => (menu.pick(), setState(c(), "resolved")),
        },
      ].filter((o) => o.label.toLowerCase().startsWith(query));
    if (open === "mention")
      return store
        .all(User)
        .filter((u) => u.id !== me().id && u.name.toLowerCase().includes(query))
        .map((u) => ({
          label: u.name,
          seed: u.id,
          hint: "sends it to them too",
          pick: () => menu.pick({ id: u.id, name: u.name }),
        }));
    const found = store
      .all(Conversation)
      .filter((o) => o.id !== c().id && o.title.toLowerCase().includes(query))
      .slice(0, 6)
      .map((o) => ({
        label: o.title,
        icon: i.GitBranchIcon,
        pick: () => menu.pick({ id: o.id, title: o.title }),
      }));
    const title = menu.query.trim();
    const branch = (): void => {
      const made = store.create(Conversation, {
        title,
        state: "open",
        priority: "none",
        team: c().team,
        owner: me(),
        branchedFrom: c(),
      });
      menu.pick({ id: made.id, title });
    };
    return title
      ? [
          ...found,
          {
            label: "New conversation",
            hint: `“${title}”`,
            icon: i.Add01Icon,
            isNew: true,
            pick: branch,
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
    else if (event.key === "ArrowDown" || event.key === "ArrowUp")
      setAt((index() + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
    else if (event.key === "Enter" || event.key === "Tab") options()[index()].pick();
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
              placeholder: () => {
                const to = untrack(() => replyTo(c()));
                return to.length
                  ? `Reply to ${to.map((u) => u.name.split(" ")[0]).join(", ")}…`
                  : "Write a note…";
              },
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
              if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false;
              const body = editor.getText({ blockSeparator: "\n" }).trim();
              if (!body) return true;
              const to = [
                ...replyTo(c()),
                ...mentionsIn(body).flatMap((id) => store.findById(User, id) ?? []),
              ];
              send(
                c(),
                body,
                [...new Set(to)].filter((u) => u.id !== me().id),
              );
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
              class={sx(look.menu, styles.caretMenu)}
              role="listbox"
              style={{ left: `${rect().left}px`, top: `${rect().bottom + 6}px` }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <For each={options()}>
                {(option, at) => (
                  <button
                    class={sx(look.item, at() === index() && look.itemSelected)}
                    role="option"
                    aria-selected={at() === index() ? "true" : "false"}
                    onMouseEnter={() => setAt(at())}
                    onClick={() => option.pick()}
                  >
                    <Show
                      when={option.seed}
                      fallback={<span class={sx(look.itemIcon)}>{icon(option.icon!)}</span>}
                    >
                      {(seed) => <Identicon seed={seed()} size={14} />}
                    </Show>
                    <span class={sx(look.label)}>
                      {option.label}{" "}
                      <span class={sx(option.isNew ? look.accent : look.hint)}>{option.hint}</span>
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

// A conversation as a document: its heading, its messages, then the reply. Opened from your inbox it starts at the top
// without taking the cursor, so the inbox keys keep working.
export function ConversationView(props: {
  conversation: Conversation;
  autofocus?: boolean;
}): JSX.Element {
  let end!: HTMLDivElement;
  const messages = (): Message[] => props.conversation.messages.sorted("createdAt");
  createEffect(
    () => props.autofocus || messages().at(-1)?.authorId === me().id,
    (follow) => {
      if (follow) end.scrollIntoView({ block: "end" });
    },
  );
  return (
    <div class={sx(thread.view)}>
      <div class={sx(thread.scroll)}>
        <article class={sx(thread.doc)}>
          <Header conversation={props.conversation} />
          <For each={messages()}>
            {(message) => <MessageBlock message={message} conversation={props.conversation} />}
          </For>
          <Show when={props.conversation.isOpen}>
            <Reply conversation={props.conversation} autofocus={props.autofocus ?? true} />
          </Show>
          <div ref={end} />
        </article>
        {/* Room to scroll the last entry up to the top without losing it off screen. */}
        <div class={sx(styles.overscroll)} aria-hidden="true" />
      </div>
    </div>
  );
}
