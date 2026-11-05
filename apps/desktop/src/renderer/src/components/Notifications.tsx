import { Notification03Icon } from "@hugeicons/core-free-icons";
import { plainThreadLinks, type Person } from "model";
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

const panelIn = stylex.keyframes({
  from: {
    opacity: 0,
    transform: "translateY(-6px)",
  },
});

// Notifications: a bell in the sidebar's top bar with a dot while something's new, and a panel under it like the
// context menu's surface.
const styles = stylex.create({
  root: {
    position: "relative",
    display: "flex",
  },
  bell: {
    position: "relative",
  },
  dot: {
    position: "absolute",
    top: "3px",
    right: "3px",
    width: "6px",
    height: "6px",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: colors.chrome,
    borderRadius: "50%",
    backgroundColor: colors.accent,
    boxSizing: "content-box",
  },
  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    zIndex: layers.contextMenu,
    display: "flex",
    flexDirection: "column",
    width: "340px",
    maxHeight: "min(480px, 70vh)",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.floatBorder,
    borderRadius: radii.panel,
    backgroundColor: colors.panel,
    boxShadow: "0 6px 16px rgb(0 0 0 / 35%)",
    animationName: panelIn,
    animationDuration: "120ms",
    animationTimingFunction: "ease-out",
  },
  header: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    height: "34px",
    padding: "0 12px",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
  },
  mark: {
    padding: 0,
    borderStyle: "none",
    color: {
      default: colors.textTertiary,
      ":hover": colors.textPrimary,
    },
    font: "inherit",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  list: {
    flex: 1,
    minHeight: 0,
    margin: 0,
    padding: "4px",
    overflowY: "auto",
    listStyle: "none",
  },
  item: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    width: "100%",
    padding: "6px 8px",
    borderStyle: "none",
    borderRadius: radii.button,
    color: colors.textPrimary,
    font: "inherit",
    textAlign: "left",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.panelSelected,
    },
    cursor: "pointer",
  },
  // The open thread's notification.
  itemActive: {
    backgroundColor: colors.panelSelected,
  },
  avatar: {
    flexShrink: 0,
  },
  body: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
  },
  text: {
    overflow: "hidden",
    lineHeight: "18px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // Ones you've seen step back.
  textRead: {
    color: colors.textSecondary,
  },
  thread: {
    overflow: "hidden",
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  time: {
    display: "flex",
    flexShrink: 0,
    gap: "6px",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: "2px",
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontVariantNumeric: "tabular-nums",
  },
});

// What one notification says happened: the reply itself ("Arjun: Pushed a fix"), marked when it answers your
// question; the status line ("Arjun changed status to Closed"); or, for a new thread, who started it (its title is
// underneath).
function notificationText(item: ActivityItem, me: Person, plain: (text: string) => string): string {
  const name = item.actor.name.split(" ")[0];
  const { entry } = item;
  if (entry.kind === "event") return `${name} ${plain(entry.text)}`;
  if (item.summary === "opened") {
    return item.thread.assignees.some((person) => person.id === me.id)
      ? `${name} asked you`
      : `${name} started this`;
  }
  const text = entry.kind === "message" || entry.kind === "resolution" ? plain(entry.text) : "";
  return `${name}: ${text}`;
}

// One row of the panel: who, what happened and where, and when (with a dot while it's new).
function Notification(props: {
  actorId: string;
  text: string;
  where: string;
  atMs: number;
  unread: boolean;
  active?: boolean;
  onOpen: () => void;
}): JSX.Element {
  const app = useApp();
  return (
    <li>
      <button
        type="button"
        class={sx(styles.item, props.active === true && styles.itemActive)}
        onClick={() => props.onOpen()}
      >
        <Identicon seed={props.actorId} size={16} class={sx(styles.avatar)} />
        <span class={sx(styles.body)}>
          <span class={sx(styles.text, !props.unread && styles.textRead)}>{props.text}</span>
          <span class={sx(styles.thread)}>{props.where}</span>
        </span>
        <span class={sx(styles.time)}>
          <Show when={props.unread}>
            <span class={sx(status.unread)} aria-label="New" />
          </Show>
          {formatRelativeTime(props.atMs, app.now())}
        </span>
      </button>
    </li>
  );
}

// The bell in the sidebar's top bar, as in Delta: a dot on it while something's new, and a panel under it listing what
// changed on your threads (`activityFor`), and groups someone added you to, newest first. Opening one opens its thread
// (or the group's page) and closes the panel; Escape or a click outside closes it too.
export function NotificationsButton(): JSX.Element {
  const app = useApp();
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const fresh = (): number =>
    app.inbox.activity().filter((item) => item.unread > 0).length +
    app.inbox.groupNotices().filter((notice) => notice.unread).length;
  const plain = (text: string): string =>
    plainThreadLinks(text, app.links.titleOf, app.links.nameOf);

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
    <div ref={root} class={sx(styles.root)}>
      <button
        type="button"
        class={sx(topbar.button, styles.bell, open() && topbar.buttonOpen)}
        aria-label={fresh() > 0 ? `Notifications, ${fresh()} new` : "Notifications"}
        aria-expanded={`${open()}`}
        onClick={() => setOpen(!open())}
      >
        <Icon icon={Notification03Icon} size={14} aria-hidden="true" />
        <Show when={fresh() > 0}>
          <span class={sx(styles.dot)} aria-hidden="true" />
        </Show>
      </button>
      <Show when={open()}>
        <div class={sx(styles.panel)} role="dialog" aria-label="Notifications">
          <div class={sx(styles.header)}>
            <span>Notifications</span>
            <Show when={fresh() > 0}>
              <button type="button" class={sx(styles.mark)} onClick={() => app.inbox.markAllRead()}>
                Mark all read
              </button>
            </Show>
          </div>
          <ul class={sx(styles.list)}>
            <For each={app.inbox.groupNotices()}>
              {(notice) => (
                <Notification
                  actorId={notice.actor.id}
                  text={`${notice.actor.name.split(" ")[0]} ${notice.text}`}
                  where={notice.group.name}
                  atMs={notice.atMs}
                  unread={notice.unread}
                  onOpen={() => {
                    setOpen(false);
                    app.nav.openLabel(notice.group.labelId);
                  }}
                />
              )}
            </For>
            <For each={app.inbox.activity()}>
              {(item) => (
                <Notification
                  actorId={item.actor.id}
                  text={notificationText(item, app.me(), plain)}
                  where={item.thread.title}
                  atMs={item.atMs}
                  unread={item.unread > 0}
                  active={item.thread.id === app.nav.activeThreadId()}
                  onOpen={() => {
                    setOpen(false);
                    app.nav.openThread(item.thread.id);
                  }}
                />
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}
