import * as i from "@hugeicons/core-free-icons";
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
  save,
  saved,
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
import { colors, fontSizes, layers, zotero } from "../styles/tokens.stylex";
import { caretExtensions, closeCaretMenu, type CaretKind, type CaretMenu } from "./caretMenus";
import { icon, Icon, type IconSvgElement } from "./Icon";
import { moved, OptionButton, type Option } from "./Menus";
import { createThread, send } from "./Palettes";

// A thread as Zotero 7 shows an item in its item pane (zotero/zotero scss/elements/_itemPaneHeader.scss,
// _collapsibleSection.scss, _infoBox.scss, _noteRow.scss, _itemPaneSidenav.scss, _itemDetails.scss): a header with
// its title, then collapsible sections (Info, Abstract, Related, Messages with the reply), and the side navigation's
// section buttons down its right edge. Each size is Zotero's CSS pixels ÷ 1.1, for the window's 110%.
const styles = stylex.create({
  // .zotero-view-item-container: the pane's sections and, on their right, the side navigation.
  pane: {
    position: "relative",
    display: "flex",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    color: colors.zFillPrimary,
    fontSize: fontSizes.body,
    lineHeight: zotero.lineHeight,
    backgroundColor: colors.zSidepane,
  },
  main: { display: "flex", flex: 1, flexDirection: "column", minWidth: 0 },
  // item-pane-header: 8px in, at least 41px, a --fill-quinary line under it; its title 600 on 1.333 lines, then the
  // creator and year in --fill-secondary.
  header: {
    display: "flex",
    flexShrink: 0,
    flexDirection: "column",
    justifyContent: "center",
    gap: 1.82,
    minHeight: zotero.toolbar,
    padding: zotero.xs,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.zFillQuinary,
  },
  headerTitle: {
    margin: 0,
    paddingInline: "4.55px",
    fontSize: fontSizes.body,
    fontWeight: 600,
    lineHeight: zotero.lineHeight,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  creatorYear: { paddingInline: "4.55px", color: colors.zFillSecondary, overflowWrap: "anywhere" },
  // .zotero-view-item: scrolls, 8px in, its sections 1px apart.
  scroll: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: 1,
    minHeight: 0,
    paddingInline: zotero.xs,
    overflowY: "scroll",
    overflowAnchor: "none",
  },
  // Room to scroll the last section up to the top (Zotero's --min-scroll-height).
  overscroll: { flexShrink: 0, height: "calc(100vh - 34px - 160px)" },
  // collapsible-section: 4px above and below, its head and body 2px apart, a --fill-quinary line under all but the
  // last.
  section: {
    display: "flex",
    flexShrink: 0,
    flexDirection: "column",
    gap: 1.82,
    paddingBlock: zotero.min,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.zFillQuinary,
    scrollMarginTop: 0,
  },
  sectionLast: { borderBottomWidth: 0 },
  // .head: its title in --fill-secondary at 600, the section's 16px icon 4px before it; a summary after, 8px on, while
  // closed; and the twisty at the end. 2px above and below in the comfortable density.
  head: {
    display: "flex",
    alignItems: "center",
    paddingBlock: 1.82,
    borderRadius: zotero.radius,
    cursor: "default",
  },
  titleBox: { display: "flex", flex: 1, gap: zotero.xs, alignItems: "center", minWidth: 0 },
  title: {
    display: "flex",
    flex: "0 0 auto",
    gap: zotero.min,
    alignItems: "center",
    color: colors.zFillSecondary,
    fontWeight: 600,
  },
  sectionIcon: { display: "flex", width: zotero.icon, height: zotero.icon },
  summary: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: colors.zFillSecondary,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    opacity: 1,
    transitionProperty: "opacity",
    transitionDuration: "0.2s",
  },
  summaryHidden: { opacity: 0 },
  // toolbarbutton.twisty: 20px, 2px in, its chevron turned up while open.
  twisty: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "18.18px",
    height: "18.18px",
    padding: 1.82,
    borderRadius: 1.82,
    color: colors.zFillSecondary,
    backgroundColor: { default: "transparent", ":hover": colors.zFillQuinary },
  },
  chevron: {
    display: "flex",
    transitionProperty: "transform",
    transitionDuration: "0.2s",
    transitionTimingFunction: "ease-in-out",
  },
  chevronOpen: { transform: "rotate(-180deg)" },
  // Shut: the body takes no room.
  closed: { display: "none" },
  // info-box's meta-table: labels and values in two columns 8px apart, rows 2px apart; a label right-aligned in
  // --fill-secondary, a value as editable-text (4px in, inside a 1px border).
  table: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: zotero.xs,
    rowGap: 1.82,
    paddingBottom: 1.82,
  },
  label: {
    paddingTop: "4.55px",
    color: colors.zFillSecondary,
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  value: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    minWidth: 0,
    padding: "3.64px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: zotero.radius,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  // A person: their page, as a clicky value.
  person: {
    padding: "0 3.64px",
    marginInline: "-3.64px",
    borderRadius: zotero.radius,
    color: colors.zFillPrimary,
    backgroundColor: { default: "transparent", ":hover": colors.zFillQuinary },
    cursor: "pointer",
  },
  none: { color: colors.zFillTertiary },
  // abstract-box's text.
  abstract: {
    padding: "3.64px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  // related-box: its rows 12px in, each a clicky item (an icon 4px before its label, rounded 5px, a quinary fill
  // under the pointer).
  related: { display: "flex", flexDirection: "column", paddingLeft: zotero.sm },
  relatedRow: {
    display: "flex",
    gap: zotero.min,
    alignItems: "flex-start",
    paddingBlock: 1.82,
    paddingLeft: zotero.min,
    borderRadius: zotero.radius,
    color: colors.zFillPrimary,
    backgroundColor: {
      default: "transparent",
      ":hover": colors.zFillQuinary,
      ":active": colors.zFillQuarternary,
    },
    cursor: "default",
  },
  relatedLabel: { flex: 1, minWidth: 0, paddingBlock: 1.82 },
  relatedKind: { color: colors.zFillSecondary },
  relatedIcon: {
    display: "flex",
    flexShrink: 0,
    paddingTop: 2.73,
    color: colors.zSectionRelated,
  },
  // The messages, as note-rows 4px apart.
  notes: { display: "flex", flexDirection: "column", gap: zotero.min, paddingBottom: 1.82 },
  // note-row: --material-background inside a --color-quinary-on-sidepane border, rounded 5px; its head and body 8px
  // in and 4px from their edges, a --fill-quinary line between.
  note: {
    display: "flex",
    flexDirection: "column",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.zQuinaryOnSidepane,
    borderRadius: zotero.radius,
    backgroundColor: colors.zBackground,
  },
  replyNote: { cursor: "text" },
  noteHead: {
    display: "flex",
    gap: "4.55px",
    alignItems: "center",
    padding: "3.64px 7.27px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.zFillQuinary,
  },
  noteIcon: { display: "flex", flexShrink: 0, color: colors.zSectionNotes },
  noteAuthor: { flex: 1, fontWeight: 600 },
  noteDate: { flexShrink: 0, color: colors.zFillSecondary },
  noteBody: { display: "flex", padding: "3.64px 7.27px" },
  text: {
    flex: 1,
    minWidth: 0,
    color: colors.zFillPrimary,
    fontSize: fontSizes.body,
    lineHeight: zotero.lineHeight,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  // What someone did to it (a rename), between the messages.
  event: { paddingInline: "7.27px", color: colors.zFillSecondary },
  reply: { display: "flex", flex: 1, minWidth: 0 },
  replyEditor: { flex: 1, minHeight: zotero.lineHeight, outline: "none", cursor: "text" },
  caretMenu: { position: "fixed", zIndex: layers.caretMenu, width: 300 },
  linkSelf: { color: colors.zFillSecondary },
  // item-pane-sidenav: 37px wide on the side pane, a pane divider on its start, 6px over and 4px in, its 28px buttons
  // 6px apart.
  sidenav: {
    display: "flex",
    flexShrink: 0,
    flexDirection: "column",
    gap: "5.45px",
    alignItems: "center",
    width: zotero.sidenav,
    paddingTop: "5.45px",
    paddingInline: zotero.min,
    paddingBottom: "5.45px",
    backgroundColor: colors.zSidepane,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: colors.zPanedivider,
  },
  // .btn: 28px, 4px in, rounded 5px, the section's 20px icon in its colour.
  sidenavButton: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: zotero.button,
    height: zotero.button,
    padding: zotero.min,
    borderStyle: "none",
    borderRadius: zotero.radius,
    backgroundColor: {
      default: "transparent",
      ":hover": colors.zFillQuinary,
      ":active": colors.zFillQuarternary,
    },
    cursor: "default",
  },
  // The locate and toggle-pane buttons: --fill-secondary.
  sidenavAction: { color: colors.zFillSecondary },
  // .divider: 20px wide, a --fill-quinary line.
  divider: {
    flexShrink: 0,
    width: "18.18px",
    height: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.zFillQuinary,
  },
  sidenavEnd: { marginTop: "auto" },
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
              class: `${sx(styles.text, styles.replyEditor)} reply`,
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
    <div class={sx(styles.note, styles.replyNote)} onClick={() => editor.commands.focus()}>
      <div class={sx(styles.noteHead)}>
        <span class={sx(styles.noteIcon)}>{icon(i.ArrowTurnBackwardIcon, 12.73)}</span>
        <span class={sx(base.ellipsis, styles.noteAuthor)}>Reply as {me().name}</span>
      </div>
      <div class={sx(styles.noteBody)}>
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

// ── The item pane ──

// $item-pane-sections: each section's colour, and an icon like Zotero's itempane/16 and /20 ones.
type Pane = "info" | "abstract" | "related" | "messages";
const PANES: Record<Pane, { title: string; icon: IconSvgElement }> = {
  info: { title: "Info", icon: i.InformationCircleIcon },
  abstract: { title: "Abstract", icon: i.TextAlignLeftIcon },
  related: { title: "Related", icon: i.Link04Icon },
  messages: { title: "Messages", icon: i.BubbleChatIcon },
};
const tint = stylex.create({
  info: { color: colors.zSectionInfo },
  abstract: { color: colors.zSectionAbstract },
  related: { color: colors.zSectionRelated },
  // Zotero's Notes yellow.
  messages: { color: colors.zSectionNotes },
});

// Which sections are shut, kept as Zotero persists each pane's open state.
const [shut, setShut] = createSignal<Partial<Record<Pane, boolean>>>(
  saved("zotero-sections-shut", {}),
);
const toggle = (pane: Pane, open = !!shut()[pane]): void => {
  const next = { ...shut(), [pane]: !open };
  setShut(next);
  save("zotero-sections-shut", next);
};

// collapsible-section: a head that opens and shuts it (its summary showing only while shut), then its body.
function Section(props: {
  pane: Pane;
  summary?: string;
  last?: boolean;
  ref?: (element: HTMLElement) => void;
  children: JSX.Element;
}): JSX.Element {
  const isOpen = (): boolean => !shut()[props.pane];
  return (
    <section
      ref={props.ref}
      class={sx(styles.section, props.last && styles.sectionLast)}
      data-pane={props.pane}
      aria-label={PANES[props.pane].title}
    >
      <div
        role="button"
        tabindex={0}
        aria-expanded={isOpen() ? "true" : "false"}
        class={sx(styles.head)}
        onClick={() => toggle(props.pane)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          toggle(props.pane);
        }}
      >
        <span class={sx(styles.titleBox)}>
          <span class={sx(styles.title)}>
            <span class={sx(styles.sectionIcon, tint[props.pane])}>
              <Icon icon={PANES[props.pane].icon} size={14.55} aria-hidden="true" />
            </span>
            {PANES[props.pane].title}
          </span>
          <Show when={props.summary}>
            <span class={sx(styles.summary, isOpen() && styles.summaryHidden)}>
              {props.summary}
            </span>
          </Show>
        </span>
        <span class={sx(styles.twisty)} aria-hidden="true">
          <span class={sx(styles.chevron, isOpen() && styles.chevronOpen)}>
            <Icon icon={i.ArrowDown01Icon} size={14.55} />
          </span>
        </span>
      </div>
      <div class={sx(!isOpen() && styles.closed)}>{props.children}</div>
    </section>
  );
}

// A person as a value: their page.
const Person = (props: { user: User }): JSX.Element => (
  <button class={sx(base.bare, styles.person)} onClick={() => open({ person: props.user.id })}>
    {props.user.name}
  </button>
);

// Info: who asked and who's in it (as an item's creators, a row each), when it started and its last message.
function Info(props: { thread: Thread; last?: Message }): JSX.Element {
  const c = (): Thread => props.thread;
  const members = (): User[] => c().assigneeIds.flatMap((id) => store.findById(User, id) ?? []);
  const Row = (row: { label: string; children: JSX.Element }): JSX.Element => (
    <>
      <span class={sx(styles.label)}>{row.label}:</span>
      <span class={sx(styles.value)}>{row.children}</span>
    </>
  );
  return (
    <div class={sx(styles.table)}>
      <Row label="Item Type">Thread</Row>
      <Row label="Requester">
        <Show when={c().owner} fallback={<span class={sx(styles.none)}>Someone</span>}>
          {(owner) => <Person user={owner()} />}
        </Show>
      </Row>
      <For
        each={members()}
        fallback={
          <Row label="Members">
            <span class={sx(styles.none)}>@mention someone to bring them in</span>
          </Row>
        }
      >
        {(user) => (
          <Row label="Member">
            <Person user={user} />
          </Row>
        )}
      </For>
      <Row label="Started">{c().createdAt.toLocaleString()}</Row>
      <Show when={props.last}>
        {(last) => (
          <Row label="Last Message">
            {last().createdAt.toLocaleString()}
            {" · "}
            {last().author?.name ?? "Someone"}
          </Row>
        )}
      </Show>
    </div>
  );
}

// Related: what it branched from and what it's waiting on, as related items.
function Related(props: { thread: Thread }): JSX.Element {
  const RelatedRow = (row: { kind: string; to: Thread }): JSX.Element => (
    <div class={sx(styles.relatedRow)} role="button" onClick={() => setSplit(row.to.id)}>
      <span class={sx(styles.relatedIcon)}>
        <Icon icon={i.BubbleChatIcon} size={14.55} aria-hidden="true" />
      </span>
      <span class={sx(styles.relatedLabel)}>
        <span class={sx(styles.relatedKind)}>{row.kind} </span>
        {row.to.title}
      </span>
    </div>
  );
  return (
    <div class={sx(styles.related)}>
      <Show when={props.thread.branchedFrom}>
        {(parent) => <RelatedRow kind="Branched from" to={parent()} />}
      </Show>
      <For each={props.thread.blockers.filter((blocker) => blocker.isOpen)}>
        {(blocker) => <RelatedRow kind="Blocked on" to={blocker} />}
      </For>
    </div>
  );
}

function ActivityLine(props: { activity: Activity; thread: Thread }): JSX.Element {
  const line = (): Activity => props.activity;
  return (
    <div class={sx(styles.event)}>
      {line().actor?.name ?? "Someone"} <LinkedText text={line().text} current={props.thread.id} />
      <span> · {ago(line().createdAt)}</span>
    </div>
  );
}

// A message as a note-row: who wrote it and when, then what they wrote.
function MessageBlock(props: { message: Message; thread: Thread }): JSX.Element {
  const m = (): Message => props.message;
  return (
    <div
      class={sx(styles.note)}
      onContextMenu={(event) =>
        showMenu(event, [
          { label: "Copy text", run: () => void navigator.clipboard.writeText(plain(m().body)) },
          ...(m().authorId === me().id
            ? ["separator" as const, { label: "Delete message", run: () => void m().delete() }]
            : []),
        ])
      }
    >
      <div class={sx(styles.noteHead)}>
        <span class={sx(styles.noteIcon)}>{icon(i.BubbleChatIcon, 12.73)}</span>
        <button
          class={sx(base.bare, base.ellipsis, link.person, styles.noteAuthor)}
          onClick={() => m().author && open({ person: m().author.id })}
        >
          {m().author?.name ?? "Someone"}
        </button>
        <span class={sx(styles.noteDate)} title={m().createdAt.toLocaleString()}>
          {ago(m().createdAt)}
        </span>
      </div>
      <div class={sx(styles.noteBody)}>
        <div class={sx(styles.text)}>
          <LinkedText text={m().body} current={props.thread.id} />
        </div>
      </div>
    </div>
  );
}

// A thread as an item in Zotero's item pane: its header, its sections, and the side navigation to them. Opened from
// your inbox it starts at the top without taking the cursor, so the inbox keys keep working. `onClose` and `onExpand`
// put Close and Open as the Main Thread at the foot of the side navigation, where Zotero's locate and toggle-pane are.
export function ThreadView(props: {
  thread: Thread;
  autofocus?: boolean;
  onClose?: () => void;
  onExpand?: () => void;
}): JSX.Element {
  let end!: HTMLDivElement;
  const sections: Partial<Record<Pane, HTMLElement>> = {};
  const messages = (): Message[] => props.thread.messages.sorted("createdAt");
  const last = (): Message | undefined => messages().at(-1);
  const entries = (): (Message | Activity)[] =>
    // Of what people did to it, only renames: status, labels and the rest are gone from threads for now.
    [
      ...messages(),
      ...props.thread.activity.sorted("createdAt").filter((a) => a.text.startsWith("renamed")),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const hasRelated = (): boolean =>
    !!props.thread.branchedFrom ||
    props.thread.blockers.filter((blocker) => blocker.isOpen).length > 0;
  const panes = (): Pane[] => [
    "info",
    ...(props.thread.description ? (["abstract"] as const) : []),
    ...(hasRelated() ? (["related"] as const) : []),
    "messages",
  ];
  // To the end on opening to reply, and whenever you send something.
  let opened = false;
  createEffect(
    () => (last()?.authorId === me().id ? messages().length : 0),
    (mine) => {
      if (opened ? mine : props.autofocus) end.scrollIntoView({ block: "end" });
      opened = true;
    },
  );
  // A side navigation button scrolls its section to the top, opening it.
  const go = (pane: Pane): void => {
    if (shut()[pane]) toggle(pane, false);
    sections[pane]?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const creator = (): string =>
    `${props.thread.owner?.name ?? "Someone"} (${shortDate(props.thread.createdAt)})`;
  return (
    <div class={sx(styles.pane)}>
      <div class={sx(styles.main)}>
        <header class={sx(styles.header)}>
          <h1 class={sx(styles.headerTitle)}>{props.thread.title}</h1>
          <div class={sx(styles.creatorYear)}>{creator()}</div>
        </header>
        <div class={sx(styles.scroll)}>
          <Section pane="info" ref={(el) => (sections.info = el)}>
            <Info thread={props.thread} last={last()} />
          </Section>
          <Show when={props.thread.description}>
            {(description) => (
              <Section
                pane="abstract"
                summary={plain(description())}
                ref={(el) => (sections.abstract = el)}
              >
                <div class={sx(styles.abstract)}>
                  <LinkedText text={description()} current={props.thread.id} />
                </div>
              </Section>
            )}
          </Show>
          <Show when={hasRelated()}>
            <Section pane="related" ref={(el) => (sections.related = el)}>
              <Related thread={props.thread} />
            </Section>
          </Show>
          <Section
            pane="messages"
            summary={`${messages().length} message${messages().length === 1 ? "" : "s"}`}
            last
            ref={(el) => (sections.messages = el)}
          >
            <div class={sx(styles.notes)}>
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
            </div>
          </Section>
          <div class={sx(styles.overscroll)} aria-hidden="true" />
        </div>
      </div>
      <nav class={sx(styles.sidenav)} aria-label="Sections">
        <For each={panes()}>
          {(pane) => (
            <button
              class={sx(styles.sidenavButton, tint[pane])}
              aria-label={PANES[pane].title}
              title={PANES[pane].title}
              onClick={() => go(pane)}
            >
              <Icon icon={PANES[pane].icon} size={18.18} aria-hidden="true" />
            </button>
          )}
        </For>
        <Show when={props.onExpand || props.onClose}>
          <span class={sx(styles.divider, styles.sidenavEnd)} />
        </Show>
        <Show when={props.onExpand}>
          {(expand) => (
            <button
              class={sx(styles.sidenavButton, styles.sidenavAction)}
              aria-label="Open as the Main Thread"
              title="Open as the Main Thread"
              onClick={() => expand()()}
            >
              <Icon icon={i.ArrowUpRight01Icon} size={18.18} aria-hidden="true" />
            </button>
          )}
        </Show>
        <Show when={props.onClose}>
          {(close) => (
            <button
              class={sx(styles.sidenavButton, styles.sidenavAction)}
              aria-label="Close"
              title="Close"
              onClick={() => close()()}
            >
              <Icon icon={i.SidebarRightIcon} size={18.18} aria-hidden="true" />
            </button>
          )}
        </Show>
      </nav>
    </div>
  );
}
