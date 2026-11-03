import { HugeiconsIcon } from "@hugeicons/react";
import { Notification03Icon } from "@hugeicons/core-free-icons";
import { plainThreadLinks, type Person } from "model";
import { useEffect, useRef, useState } from "react";
import type { ActivityItem } from "../activity";
import { formatRelativeTime } from "../format";
import type { GroupNotice } from "../groups";
import { useMe } from "../me";
import { useThreadLinks } from "../threadLinks";
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
export function NotificationsButton({
  items,
  groupNotices,
  nowMs,
  activeThreadId,
  onOpenThread,
  onOpenGroup,
  onMarkAllRead,
}: {
  items: ActivityItem[];
  // Groups someone added you to.
  groupNotices: GroupNotice[];
  nowMs: number;
  activeThreadId: string | null;
  onOpenThread: (id: string) => void;
  onOpenGroup: (id: string) => void;
  onMarkAllRead: () => void;
}): React.JSX.Element {
  const { titleOf, nameOf } = useThreadLinks();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fresh =
    items.filter((item) => item.unread > 0).length +
    groupNotices.filter((notice) => notice.unread).length;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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
  }, [open]);

  return (
    <div ref={rootRef} className="notifications">
      <button
        type="button"
        className="topbar-button"
        aria-label={fresh > 0 ? `Notifications, ${fresh} new` : "Notifications"}
        aria-expanded={open}
        data-open={open}
        onClick={() => setOpen(!open)}
      >
        <HugeiconsIcon icon={Notification03Icon} size={14} aria-hidden />
        {fresh > 0 && <span className="notifications-dot" aria-hidden />}
      </button>
      {open && (
        <div className="notifications-panel" role="dialog" aria-label="Notifications">
          <div className="notifications-header">
            <span>Notifications</span>
            {fresh > 0 && (
              <button type="button" className="notifications-mark" onClick={onMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="notifications-list">
            {groupNotices.map((notice) => (
              <li key={notice.group.id}>
                <button
                  type="button"
                  className="notification"
                  data-read={!notice.unread}
                  onClick={() => {
                    setOpen(false);
                    onOpenGroup(notice.group.id);
                  }}
                >
                  <Identicon seed={notice.actor.id} size={16} />
                  <span className="notification-body">
                    <span className="notification-text">
                      {notice.actor.name.split(" ")[0]} {notice.text}
                    </span>
                    <span className="notification-thread">{notice.group.name}</span>
                  </span>
                  <span className="notification-time">
                    {notice.unread && <span className="unread-dot" aria-label="New" />}
                    {formatRelativeTime(notice.atMs, nowMs)}
                  </span>
                </button>
              </li>
            ))}
            {items.map((item) => (
              <li key={item.thread.id}>
                <button
                  type="button"
                  className="notification"
                  data-active={item.thread.id === activeThreadId}
                  data-read={item.unread === 0}
                  onClick={() => {
                    setOpen(false);
                    onOpenThread(item.thread.id);
                  }}
                >
                  <Identicon seed={item.actor.id} size={16} />
                  <span className="notification-body">
                    <span className="notification-text">
                      {notificationText(item, me, (text) =>
                        plainThreadLinks(text, titleOf, nameOf),
                      )}
                    </span>
                    <span className="notification-thread">{item.thread.title}</span>
                  </span>
                  <span className="notification-time">
                    {item.unread > 0 && <span className="unread-dot" aria-label="New" />}
                    {formatRelativeTime(item.atMs, nowMs)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
