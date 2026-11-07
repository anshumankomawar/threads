import * as i from "@hugeicons/core-free-icons";
import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
  Bucket,
  Label,
  Subspace,
  Thread,
  type Activity,
  plainText,
  PRIORITIES,
  splitText,
  STATES,
  User,
  Message,
  mentionsIn,
} from "models";
import {
  byName,
  edit,
  firstName,
  itemFor,
  me,
  myBuckets,
  open,
  others,
  placeIn,
  setDialog,
  setSplit,
  setState,
  shortDate,
  showMenu,
  store,
  subspacesWithMembers,
  membersHint,
  summary,
  toggled,
  type MenuItem,
} from "../session";
import { bucketIcons } from "../bucketIcons";
import { base } from "../styles/base";
import { link, menu as look } from "../styles/controls";
import { threadLineMarker } from "../styles/markers.stylex";
import { sx } from "../styles/sx";
import { AVATAR, AVATAR_TOP, thread, TURN_GAP } from "../styles/thread";
import { colors, fontSizes, layers, radii } from "../styles/tokens.stylex";
import { caretExtensions, closeCaretMenu, type CaretKind, type CaretMenu } from "./caretMenus";
import { icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { MenuChip, moved, OptionButton, type Option } from "./Menus";
import { createThread, send } from "./Palettes";

const styles = stylex.create({
  // The viewport minus about one block, so the last entry can reach the top but never leave the screen.
  overscroll: { height: "calc(100vh - 34px - 140px)" },
  quiet: { color: colors.textTertiary, fontSize: fontSizes.body },
  eventMarker: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 18,
    marginTop: 0,
  },
  // An activity's mark on the spine, and the one that says it's your turn.
  eventDot: { width: 6, height: 6, borderRadius: "50%", backgroundColor: colors.iconTertiary },
  yourTurn: { backgroundColor: colors.systemBlue },
  waitingOn: { color: colors.textPrimary, fontWeight: 500 },
  to: { color: colors.textSecondary, fontSize: fontSizes.body },
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
  // A property's value: its menu, plain until you hover it.
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

// ── The conversation: each turn on a spine down the avatar column ──

// How a turn sits on the spine: an avatar (someone speaking), a dot (activity, or whose turn it is), or a message that
// carries on the one before it, with neither. Each is pulled up toward the turn before by its own amount, and the line
// stops a little short of its avatar or dot.
type Turn = "avatar" | "dot" | "grouped";
const PULL: Record<Turn, number> = { avatar: 0, dot: -(TURN_GAP - 12), grouped: -(TURN_GAP - 6) };
const MARK: Record<Turn, [top: number, bottom: number]> = {
  avatar: [AVATAR_TOP - 4, AVATAR_TOP + AVATAR + 4],
  dot: [3, 15],
  grouped: [0, 0],
};
const pulled = (turn: Turn): JSX.CSSProperties | undefined =>
  PULL[turn] ? { "margin-top": `${PULL[turn]}px` } : undefined;

// The line from this turn down to the next one, if there is a next.
function Spine(props: { turn: Turn; next?: Turn }): JSX.Element {
  return (
    <Show when={props.next}>
      {(next) => (
        <span
          class={sx(thread.spine)}
          aria-hidden="true"
          style={{
            top: `${MARK[props.turn][1]}px`,
            bottom: `${-(TURN_GAP + PULL[next()] + MARK[next()][0])}px`,
          }}
        />
      )}
    </Show>
  );
}

// Who a message is to: the @mentions it opens with, which its byline shows ("→ You, Sam") instead of its text.
const LEADING = /^(?:\s*\[\[(?:person|subspace):[^\]\s]+\]\])+[\s,:]*/;
function addressed(body: string): { to: string[]; rest: string } {
  const lead = LEADING.exec(body)?.[0];
  const rest = lead ? body.slice(lead.length) : body;
  if (!lead || !rest.trim()) return { to: [], rest: body };
  const to = splitText(lead).flatMap((part) =>
    "person" in part
      ? part.person === me().id
        ? ["You"]
        : [firstName(store.findById(User, part.person) ?? { name: "Someone" })]
      : "subspace" in part
        ? [store.findById(Subspace, part.subspace)?.name ?? "a space"]
        : [],
  );
  return { to, rest };
}
const LIST = new Intl.ListFormat(undefined, { type: "conjunction" });
// Others in a thread, by first name: whoever started it, is on it, or has written in it.
const peopleIn = (c: Thread): User[] =>
  [
    ...new Set([
      c.ownerId ?? "",
      ...c.assigneeIds,
      ...c.messages.sorted("createdAt").map((m) => m.authorId),
    ]),
  ]
    .filter((id) => id && id !== me().id)
    .flatMap((id) => store.findById(User, id) ?? []);

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

// Due-date shortcuts, at 5pm.
const dueAt = (days: number): Date =>
  new Date(new Date(Date.now() + days * 86_400_000).setHours(17, 0, 0, 0));
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

type ListField = "labelIds" | "subspaceIds" | "assigneeIds";

// A chip for one of a thread's lists: what's in it ("Security +1"), and a checklist of what can be.
function ListChip(props: {
  thread: Thread;
  field: ListField;
  records: { id: string; name: string }[];
  none: string;
  icon: IconSvgElement;
  title?: string;
  short?: (name: string) => string;
  more?: MenuItem[];
  look?: stylex.StyleXStyles;
}): JSX.Element {
  const ids = (): string[] => props.thread[props.field];
  const name = (id: string): string => {
    const found = props.records.find((r) => r.id === id)?.name ?? "Someone";
    return props.short ? props.short(found) : found;
  };
  return (
    <MenuChip
      label={<span class={sx(base.ellipsis)}>{summary(ids().map(name), props.none)}</span>}
      icon={icon(props.icon, 13)}
      tone={ids().length === 0 ? "muted" : undefined}
      title={props.title}
      look={props.look}
      items={[
        ...byName(props.records).map((record) => ({
          label: record.name,
          icon: ids().includes(record.id) ? icon(i.Tick02Icon, 13) : undefined,
          run: () => edit(props.thread, { [props.field]: toggled(ids(), record.id) }),
        })),
        ...(props.more ?? []),
      ]}
    />
  );
}

function Header(props: { thread: Thread; next?: Turn }): JSX.Element {
  const c = (): Thread => props.thread;
  return (
    <header class={sx(thread.block, thread.header)}>
      <Spine turn="avatar" next={props.next} />
      <span class={sx(thread.avatar)}>
        <Identicon seed={c().ownerId ?? ""} size={AVATAR} />
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
        <Properties thread={c()} />
      </div>
    </header>
  );
}

function ActivityLine(props: { activity: Activity; thread: Thread; next?: Turn }): JSX.Element {
  const line = (): Activity => props.activity;
  return (
    <div class={sx(thread.block)} style={pulled("dot")}>
      <Spine turn="dot" next={props.next} />
      <span class={sx(thread.avatar, styles.eventMarker)} aria-hidden="true">
        <span class={sx(styles.eventDot)} />
      </span>
      <div class={sx(styles.quiet, styles.eventText)}>
        <span class={sx(styles.eventActor)}>{line().actor?.name ?? "Someone"}</span>{" "}
        <LinkedText text={line().text} current={props.thread.id} />
        <span> · {ago(line().createdAt)}</span>
      </div>
    </div>
  );
}

function MessageBlock(props: {
  message: Message;
  thread: Thread;
  turn: Turn;
  next?: Turn;
}): JSX.Element {
  const m = (): Message => props.message;
  const said = (): { to: string[]; rest: string } => addressed(m().body);
  return (
    <div
      class={sx(thread.block)}
      style={pulled(props.turn)}
      onContextMenu={(event) =>
        showMenu(event, [
          {
            label: "Copy Text",
            icon: icon(i.Copy01Icon, 13),
            run: () => void navigator.clipboard.writeText(plain(m().body)),
          },
          ...(m().authorId === me().id
            ? [
                "separator" as const,
                {
                  label: "Delete Message",
                  icon: icon(i.Delete02Icon, 13),
                  run: () => void m().delete(),
                },
              ]
            : []),
        ])
      }
    >
      <Spine turn={props.turn} next={props.next} />
      <span class={sx(thread.avatar)}>
        <Show when={props.turn === "avatar"}>
          <Identicon seed={m().authorId} size={AVATAR} />
        </Show>
      </span>
      <div class={sx(thread.body)}>
        <Show when={props.turn === "avatar"}>
          <Meta user={m().author} at={m().createdAt}>
            <Show when={said().to.length > 0}>
              <span class={sx(styles.to)}>→ {said().to.join(", ")}</span>
            </Show>
          </Meta>
        </Show>
        <div class={sx(thread.text)}>
          <LinkedText text={said().rest} current={props.thread.id} />
        </div>
      </div>
    </div>
  );
}

// Whose turn it is, just above the reply: yours when the last message asked you, else whoever your last one asked.
type Waiting = { you: boolean; on: string; since?: string };
function waitingIn(c: Thread): Waiting | undefined {
  const last = c.messages.sorted("createdAt").at(-1);
  if (!c.isOpen || !last) return undefined;
  const asked = mentionsIn(last.body);
  if (last.authorId !== me().id)
    return asked.includes(me().id) || (asked.length === 0 && c.assigneeIds.includes(me().id))
      ? {
          you: true,
          on: "you",
          since: `${last.author ? firstName(last.author) : "Someone"} asked ${ago(last.createdAt)}`,
        }
      : undefined;
  const on = (asked.length > 0 ? asked : c.assigneeIds)
    .filter((id) => id !== me().id)
    .flatMap((id) => store.findById(User, id) ?? []);
  return on.length > 0 ? { you: false, on: LIST.format(on.map(firstName)) } : undefined;
}
function WaitingLine(props: { waiting: Waiting; next?: Turn }): JSX.Element {
  return (
    <div class={sx(thread.block)} style={pulled("dot")}>
      <Spine turn="dot" next={props.next} />
      <span class={sx(thread.avatar, styles.eventMarker)} aria-hidden="true">
        <span class={sx(styles.eventDot, props.waiting.you && styles.yourTurn)} />
      </span>
      <div class={sx(styles.quiet, styles.eventText)}>
        <span class={sx(props.waiting.you && styles.waitingOn)}>Waiting on {props.waiting.on}</span>
        <Show when={props.waiting.since}>{(since) => <span> · {since()}</span>}</Show>
      </div>
    </div>
  );
}

// The next message, written at the end. Enter posts it; only someone @mentioned hears about it.
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
    if (open === "command")
      return [
        {
          label: "Blocked",
          hint: "Ask someone for what this needs",
          icon: i.UnavailableIcon,
          run: () => (menu.pick(), setDialog({ kind: "blocked", thread: c() })),
        },
        {
          label: "Resolve",
          hint: "Resolve it for everyone",
          icon: i.CheckmarkCircle02Icon,
          run: () => (menu.pick(), setState(c(), "resolved")),
        },
      ].filter((o) => o.label.toLowerCase().startsWith(query));
    if (open === "mention")
      return [
        ...others()
          .filter((u) => u.name.toLowerCase().includes(query))
          .map((u) => ({
            label: u.name,
            seed: u.id,
            hint: "assigns them",
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
            // Addressed to whoever's in it, as a letter's reply is.
            Placeholder.configure({
              placeholder: () => {
                const names = peopleIn(c()).map(firstName);
                return names.length === 0
                  ? "Reply… @mention someone to bring them in"
                  : `Reply to ${LIST.format(names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} others`] : names)}…`;
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
        <Identicon seed={me().id} size={AVATAR} />
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

// A thread's properties, under its title: a row of values, each a menu you change it from, plain until you hover it.
const value = [base.bare, base.hover, styles.value];
function Properties(props: { thread: Thread }): JSX.Element {
  const c = (): Thread => props.thread;
  const item = (): ReturnType<typeof itemFor> => itemFor(c());
  const change = (fields: Partial<Thread>) => () => edit(c(), fields);
  const place = (bucket: Bucket | undefined) => () => placeIn(item()!, bucket);
  const bucketIcon = (bucket?: Bucket): IconSvgElement =>
    bucketIcons(myBuckets()).get(bucket?.id ?? "") ?? i.InboxIcon;
  return (
    <div class={sx(styles.properties)} aria-label="Properties">
      <MenuChip
        look={value}
        label={<span class={sx(base.ellipsis)}>{LABELS[c().state]}</span>}
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
            look={value}
            label={<span class={sx(base.ellipsis)}>{it().bucket?.name ?? "Sorting…"}</span>}
            icon={icon(bucketIcon(it().bucket), 13)}
            tone={it().bucket ? undefined : "muted"}
            title={
              it().bucket
                ? it().manual
                  ? "Placed by you"
                  : it().reason
                : "Being sorted into one of your buckets"
            }
            items={[
              ...myBuckets().map((b) => ({
                label: b.name,
                icon: icon(b === it().bucket ? i.Tick02Icon : bucketIcon(b), 13),
                run: place(b),
              })),
              ...(it().manual ? [{ label: "Sort it for me", run: place(undefined) }] : []),
            ]}
          />
        )}
      </Show>
      <ListChip
        look={value}
        thread={c()}
        field="labelIds"
        records={store.all(Label)}
        none="No labels"
        icon={i.Tag01Icon}
        more={[{ label: "New label…", run: () => setDialog({ kind: "newLabel", thread: c() }) }]}
      />
      <ListChip
        look={value}
        thread={c()}
        field="subspaceIds"
        records={store.all(Subspace)}
        none="Everyone"
        icon={i.Layers01Icon}
        title="Where it lives: its subspaces' members see it, and only they when one is private"
      />
      <ListChip
        look={value}
        thread={c()}
        field="assigneeIds"
        records={store.all(User)}
        none="No assignees"
        icon={i.UserMultipleIcon}
        short={(name) => firstName({ name })}
      />
      <MenuChip
        look={value}
        label={<span class={sx(base.ellipsis)}>{LABELS[c().priority]}</span>}
        tone={c().priority === "urgent" ? "urgent" : c().priority === "none" ? "muted" : undefined}
        items={PRIORITIES.map((priority) => ({
          label: LABELS[priority],
          run: change({ priority }),
        }))}
      />
      <MenuChip
        look={value}
        icon={icon(i.Calendar01Icon, 13)}
        label={
          <span class={sx(base.ellipsis)}>
            {c().dueAt ? `Due ${shortDate(c().dueAt!)}` : "No due date"}
          </span>
        }
        tone={
          c().dueAt && c().dueAt!.getTime() < Date.now()
            ? "urgent"
            : c().dueAt
              ? undefined
              : "muted"
        }
        items={[
          { label: "Today", run: change({ dueAt: dueAt(0) }) },
          { label: "Tomorrow", run: change({ dueAt: dueAt(1) }) },
          { label: "Next week", run: change({ dueAt: dueAt(7) }) },
          { label: "No due date", run: change({ dueAt: undefined }) },
        ]}
      />
    </div>
  );
}

export function ThreadView(props: { thread: Thread; autofocus?: boolean }): JSX.Element {
  let end!: HTMLDivElement;
  const messages = (): Message[] => props.thread.messages.sorted("createdAt");
  const entries = (): (Message | Activity)[] =>
    [...messages(), ...props.thread.activity.sorted("createdAt")].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  // Each entry's place on the spine: a message carries on the one before when it's the same person's, soon after, and
  // not addressed anew.
  const turns = createMemo(() => {
    const list = entries();
    return list.map((entry, at): Turn => {
      if (!(entry instanceof Message)) return "dot";
      const prev = list[at - 1];
      return prev instanceof Message &&
        prev.authorId === entry.authorId &&
        entry.createdAt.getTime() - prev.createdAt.getTime() < 60 * 60_000 &&
        addressed(entry.body).to.length === 0
        ? "grouped"
        : "avatar";
    });
  });
  const waiting = createMemo(() => waitingIn(props.thread));
  // What follows the entry at `at` (-1 for the header): the next entry, whose turn it is, then the reply.
  const nextAfter = (at: number): Turn | undefined =>
    turns()[at + 1] ?? (waiting() ? "dot" : props.thread.isOpen ? "avatar" : undefined);
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
          <Header thread={props.thread} next={turns()[0] ?? nextAfter(-1)} />
          <For each={entries()}>
            {(entry, at) =>
              entry instanceof Message ? (
                <MessageBlock
                  message={entry}
                  thread={props.thread}
                  turn={turns()[at()] ?? "avatar"}
                  next={nextAfter(at())}
                />
              ) : (
                <ActivityLine activity={entry} thread={props.thread} next={nextAfter(at())} />
              )
            }
          </For>
          <Show when={waiting()}>
            {(w) => <WaitingLine waiting={w()} next={props.thread.isOpen ? "avatar" : undefined} />}
          </Show>
          <Show when={props.thread.isOpen}>
            <Reply thread={props.thread} autofocus={props.autofocus ?? true} />
          </Show>
          <div ref={end} />
        </article>
        {/* Room to scroll the last entry up to the top without losing it off screen. */}
        <div class={sx(styles.overscroll)} aria-hidden="true" />
      </div>
    </div>
  );
}
