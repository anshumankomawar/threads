import { Notification03Icon } from "@hugeicons/core-free-icons";
import { plainThreadLinks } from "model";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { ActivityItem } from "../activity";
import { useApp } from "../app/state";
import { formatRelativeTime } from "../format";
import { status, topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes, layers, radii } from "../styles/tokens.stylex";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

const panelIn = stylex.keyframes({ from: { opacity: 0, transform: "translateY(-6px)" } });
const clip = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

const center = { display: "flex", alignItems: "center" } as const;
const quiet = { borderStyle: "none", font: "inherit", cursor: "pointer" } as const;
const motion = { animationName: panelIn, animationDuration: "120ms" } as const;

const s = stylex.create({
  root: { position: "relative", display: "flex" },
  avatar: { flexShrink: 0 },
  dot: { position: "absolute", top: 3, right: 3, width: 6, height: 6, borderRadius: "50%" },
  dotLook: {
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: colors.chrome,
    boxSizing: "content-box",
  },
  dotFill: { backgroundColor: colors.accent },
  panel: { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: layers.contextMenu },
  panelBox: { display: "flex", flexDirection: "column", width: 340, maxHeight: "min(480px, 70vh)" },
  panelEdge: {
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.floatBorder,
  },
  panelLook: {
    borderRadius: radii.panel,
    backgroundColor: colors.panel,
    boxShadow: "0 6px 16px rgb(0 0 0 / 35%)",
  },
  panelIn: { ...motion, animationTimingFunction: "ease-out" },
  header: {
    ...center,
    flexShrink: 0,
    justifyContent: "space-between",
    height: 34,
    padding: "0 12px",
  },
  headerLook: { color: colors.textSecondary, fontSize: fontSizes.body },
  mark: { ...quiet, padding: 0, backgroundColor: "transparent" },
  markColor: { color: { default: colors.textTertiary, ":hover": colors.textPrimary } },
  list: { flex: 1, minHeight: 0, margin: 0, padding: 4, overflowY: "auto", listStyle: "none" },
  item: { ...center, ...quiet, gap: 8, width: "100%", padding: "6px 8px", textAlign: "left" },
  itemLook: { borderRadius: radii.button, color: colors.textPrimary },
  hover: { backgroundColor: { default: "transparent", ":hover": colors.panelSelected } },
  active: { backgroundColor: colors.panelSelected },
  body: { display: "flex", flex: 1, flexDirection: "column", minWidth: 0 },
  text: { ...clip, lineHeight: "18px" },
  read: { color: colors.textSecondary },
  where: { ...clip, color: colors.textTertiary, fontSize: fontSizes.small },
  time: { ...center, flexShrink: 0, gap: 6, alignSelf: "flex-start", marginTop: 2 },
  timeLook: {
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontVariantNumeric: "tabular-nums",
  },
});

type Row = {
  actorId: string;
  text: string;
  where: string;
  atMs: number;
  unread: boolean;
  active: boolean;
  open: () => void;
};

// The bell in the sidebar's top bar, with a dot while something's new, and a panel under it: groups someone added you
// to, then what changed on your threads (`activityFor`). Escape or a click outside closes it.
export function NotificationsButton(): JSX.Element {
  const app = useApp();
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const fresh = (): number =>
    app.inbox.activity().filter((item) => item.unread > 0).length +
    app.inbox.groupNotices().filter((notice) => notice.unread).length;
  const plain = (text: string): string =>
    plainThreadLinks(text, app.links.titleOf, app.links.nameOf);
  // "Arjun: Pushed a fix", "Arjun changed status to Closed", or for a new thread, who started it.
  const textOf = ({ actor, entry, summary, thread }: ActivityItem): string => {
    const name = actor.name.split(" ")[0];
    if (entry.kind === "event") return `${name} ${plain(entry.text)}`;
    if (summary !== "opened") return `${name}: ${plain(entry.text)}`;
    const asked = thread.assignees.some((person) => person.id === app.me().id);
    return asked ? `${name} asked you` : `${name} started this`;
  };
  const rows = (): Row[] => [
    ...app.inbox.groupNotices().map((notice) => ({
      actorId: notice.actor.id,
      text: `${notice.actor.name.split(" ")[0]} ${notice.text}`,
      where: notice.group.name,
      atMs: notice.atMs,
      unread: notice.unread,
      active: false,
      open: () => app.nav.openLabel(notice.group.labelId),
    })),
    ...app.inbox.activity().map((item) => ({
      actorId: item.actor.id,
      text: textOf(item),
      where: item.thread.title,
      atMs: item.atMs,
      unread: item.unread > 0,
      active: item.thread.id === app.nav.activeThreadId(),
      open: () => app.nav.openThread(item.thread.id),
    })),
  ];
  createEffect(open, (isOpen) => {
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
  });
  return (
    <div ref={root} class={sx(s.root)}>
      <button
        class={sx(topbar.button, s.root, open() && topbar.buttonOpen)}
        aria-label={fresh() > 0 ? `Notifications, ${fresh()} new` : "Notifications"}
        aria-expanded={`${open()}`}
        onClick={() => setOpen(!open())}
      >
        <Icon icon={Notification03Icon} size={14} aria-hidden="true" />
        <Show when={fresh() > 0}>
          <span class={sx(s.dot, s.dotLook, s.dotFill)} aria-hidden="true" />
        </Show>
      </button>
      <Show when={open()}>
        <div
          class={sx(s.panel, s.panelBox, s.panelEdge, s.panelLook, s.panelIn)}
          role="dialog"
          aria-label="Notifications"
        >
          <div class={sx(s.header, s.headerLook)}>
            <span>Notifications</span>
            <Show when={fresh() > 0}>
              <button class={sx(s.mark, s.markColor)} onClick={() => app.inbox.markAllRead()}>
                Mark all read
              </button>
            </Show>
          </div>
          <ul class={sx(s.list)}>
            <For each={rows()}>
              {(row) => (
                <li>
                  <button
                    class={sx(s.item, s.itemLook, s.hover, row.active && s.active)}
                    onClick={() => {
                      setOpen(false);
                      row.open();
                    }}
                  >
                    <Identicon seed={row.actorId} size={16} class={sx(s.avatar)} />
                    <span class={sx(s.body)}>
                      <span class={sx(s.text, !row.unread && s.read)}>{row.text}</span>
                      <span class={sx(s.where)}>{row.where}</span>
                    </span>
                    <span class={sx(s.time, s.timeLook)}>
                      <Show when={row.unread}>
                        <span class={sx(status.unread)} aria-label="New" />
                      </Show>
                      {formatRelativeTime(row.atMs, app.now())}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}
