import {
  mentionsIn,
  plainThreadLinks,
  withoutLeadingMentions,
  type Person,
  type Thread,
} from "model";
import { useEffect, useRef, useState } from "react";
import { useThreadLinks } from "../threadLinks";
import { Identicon } from "./Identicon";

// How long a toast stays up.
const SHOW_MS = 6000;

type Mention = { id: string; thread: Thread; author: Person; text: string; atMs: number };

// Someone mentioning you, as a short toast in the top right: who, in which conversation, and what they said. Clicking
// it opens the conversation; it goes away on its own after a few seconds. Mentions showing at the same time share
// one toast. Only mentions that arrive while the app is
// open show, never ones from before it loaded.
export function MentionToasts({
  threads,
  me,
  sinceMs,
  onOpen,
}: {
  threads: Thread[];
  me: Person;
  // When the app finished loading; older mentions aren't news.
  sinceMs: number;
  onOpen: (threadId: string) => void;
}): React.JSX.Element | null {
  const { titleOf, nameOf } = useThreadLinks();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const toasts: Mention[] = threads
    .flatMap((thread) =>
      thread.entries.flatMap((entry) =>
        entry.kind === "message" &&
        entry.author.id !== me.id &&
        entry.createdAtMs >= sinceMs &&
        entry.createdAtMs <= nowMs &&
        nowMs - entry.createdAtMs < SHOW_MS &&
        !dismissed.has(entry.id) &&
        mentionsIn(entry.text).includes(me.id)
          ? [
              {
                id: entry.id,
                thread,
                author: entry.author,
                text: entry.text,
                atMs: entry.createdAtMs,
              },
            ]
          : [],
      ),
    )
    .sort((a, b) => b.atMs - a.atMs);

  // A steady clock, so toasts come and go on time, including ones held until a block ends.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (toasts.length === 0) return null;
  // Several at once (most often, the ones held through a meeting) become one toast, so a break starts with a single
  // summary rather than a stack. It opens the newest.
  const [latest] = toasts;
  const authors = [...new Map(toasts.map((toast) => [toast.author.id, toast.author])).values()];
  const dismissAll = (): void =>
    setDismissed((current) => new Set([...current, ...toasts.map((toast) => toast.id)]));
  const open = (): void => {
    dismissAll();
    onOpen(latest.thread.id);
  };
  return (
    <div className="toasts" role="status" aria-live="polite">
      <SwipeToast key={latest.id} onOpen={open} onDismiss={dismissAll}>
        <Identicon seed={latest.author.id} size={18} />
        <div className="toast-body">
          <div className="toast-title">
            {toasts.length === 1 ? (
              <>
                <span className="toast-author">{latest.author.name}</span> mentioned you in{" "}
                <span className="toast-thread">{latest.thread.title}</span>
              </>
            ) : (
              <>
                <span className="toast-author">{toasts.length} mentions</span> from{" "}
                <span className="toast-author">{namesList(authors)}</span>
              </>
            )}
          </div>
          <div className="toast-text">
            {plainThreadLinks(withoutLeadingMentions(latest.text), titleOf, nameOf)}
          </div>
        </div>
      </SwipeToast>
    </div>
  );
}

// How far a toast has to slide before letting go dismisses it, and how long it takes to leave.
const DISMISS_PX = 80;
const LEAVE_MS = 180;

// A toast you slide off to the right to dismiss, by dragging it or with a two-finger swipe, like macOS notifications.
// Short of the threshold it springs back. A click that isn't the end of a drag opens it.
function SwipeToast({
  onOpen,
  onDismiss,
  children,
}: {
  onOpen: () => void;
  onDismiss: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [offset, setOffset] = useState(0);
  const [moving, setMoving] = useState(false);
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);
  const settle = useRef<number | undefined>(undefined);
  // The swipe so far, since trackpad events can arrive faster than renders.
  const swiped = useRef(0);
  const dragged = useRef(false);

  const release = (distance: number): void => {
    setMoving(false);
    if (distance < DISMISS_PX) {
      setOffset(0);
      return;
    }
    setOffset(window.innerWidth);
    window.setTimeout(onDismiss, LEAVE_MS);
  };
  useEffect(() => () => window.clearTimeout(settle.current), []);

  return (
    <div
      className="toast"
      role="button"
      tabIndex={0}
      data-moving={moving}
      style={{ transform: `translateX(${offset}px)`, opacity: Math.max(0, 1 - offset / 320) }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, moved: false };
        dragged.current = false;
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        const distance = Math.max(0, event.clientX - drag.current.startX);
        if (distance > 4) drag.current.moved = true;
        setMoving(true);
        setOffset(distance);
      }}
      onPointerUp={(event) => {
        if (drag.current === null) return;
        dragged.current = drag.current.moved;
        release(Math.max(0, event.clientX - drag.current.startX));
        drag.current = null;
      }}
      onWheel={(event) => {
        // A sideways two-finger swipe; it lets go once the swipe has been still for a moment.
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        setMoving(true);
        swiped.current = Math.max(0, swiped.current - event.deltaX);
        setOffset(swiped.current);
        window.clearTimeout(settle.current);
        settle.current = window.setTimeout(() => {
          release(swiped.current);
          swiped.current = 0;
        }, 120);
      }}
      onClick={() => {
        if (!dragged.current) onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
        if (event.key === "Escape") onDismiss();
      }}
    >
      {children}
    </div>
  );
}

// First names, as "Arjun", "Arjun and KK" or "Arjun, KK and 2 others".
function namesList(people: Person[]): string {
  const names = people.map((person) => person.name.split(" ")[0]);
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}
