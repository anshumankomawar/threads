import { Notification03Icon } from "@hugeicons/core-free-icons";
import { plainThreadLinks, type Person } from "model";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ActivityItem } from "../activity";
import { formatRelativeTime } from "../format";
import type { GroupNotice } from "../groups";
import { useMe } from "../me";
import { useThreadLinks } from "../threadLinks";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

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

// The bell in the sidebar's top bar, as in Delta: a dot on it while something's new, and a panel under it listing what
// changed on your threads (`activityFor`), newest first. Opening one opens its thread and closes the panel; Escape or
// a click outside closes it too.
export function NotificationsButton(props: {
  items: ActivityItem[];
  // Groups someone added you to.
  groupNotices: GroupNotice[];
  nowMs: number;
  activeThreadId: string | null;
  onOpenThread: (id: string) => void;
  onOpenGroup: (id: string) => void;
  onMarkAllRead: () => void;
}): JSX.Element {
  const links = useThreadLinks();
  const me = useMe();
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const fresh = (): number =>
    props.items.filter((item) => item.unread > 0).length +
    props.groupNotices.filter((notice) => notice.unread).length;

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
    <div ref={root} class="notifications">
      <button
        type="button"
        class="topbar-button"
        aria-label={fresh() > 0 ? `Notifications, ${fresh()} new` : "Notifications"}
        aria-expanded={`${open()}`}
        data-open={String(open())}
        onClick={() => setOpen(!open())}
      >
        <Icon icon={Notification03Icon} size={14} aria-hidden="true" />
        <Show when={fresh() > 0}>
          <span class="notifications-dot" aria-hidden="true" />
        </Show>
      </button>
      <Show when={open()}>
        <div class="notifications-panel" role="dialog" aria-label="Notifications">
          <div class="notifications-header">
            <span>Notifications</span>
            <Show when={fresh() > 0}>
              <button
                type="button"
                class="notifications-mark"
                onClick={() => props.onMarkAllRead()}
              >
                Mark all read
              </button>
            </Show>
          </div>
          <ul class="notifications-list">
            <For each={props.groupNotices}>
              {(notice) => (
                <li>
                  <button
                    type="button"
                    class="notification"
                    data-read={String(!notice.unread)}
                    onClick={() => {
                      setOpen(false);
                      props.onOpenGroup(notice.group.id);
                    }}
                  >
                    <Identicon seed={notice.actor.id} size={16} />
                    <span class="notification-body">
                      <span class="notification-text">
                        {notice.actor.name.split(" ")[0]} {notice.text}
                      </span>
                      <span class="notification-thread">{notice.group.name}</span>
                    </span>
                    <span class="notification-time">
                      <Show when={notice.unread}>
                        <span class="unread-dot" aria-label="New" />
                      </Show>
                      {formatRelativeTime(notice.atMs, props.nowMs)}
                    </span>
                  </button>
                </li>
              )}
            </For>
            <For each={props.items}>
              {(item) => (
                <li>
                  <button
                    type="button"
                    class="notification"
                    data-active={String(item.thread.id === props.activeThreadId)}
                    data-read={String(item.unread === 0)}
                    onClick={() => {
                      setOpen(false);
                      props.onOpenThread(item.thread.id);
                    }}
                  >
                    <Identicon seed={item.actor.id} size={16} />
                    <span class="notification-body">
                      <span class="notification-text">
                        {notificationText(item, me(), (text) =>
                          plainThreadLinks(text, links.titleOf, links.nameOf),
                        )}
                      </span>
                      <span class="notification-thread">{item.thread.title}</span>
                    </span>
                    <span class="notification-time">
                      <Show when={item.unread > 0}>
                        <span class="unread-dot" aria-label="New" />
                      </Show>
                      {formatRelativeTime(item.atMs, props.nowMs)}
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
