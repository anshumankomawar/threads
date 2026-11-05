import { plainThreadLinks, withoutLeadingMentions, type Person, type Thread } from "model";
import { createMemo, createSignal, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useThreadLinks } from "../threadLinks";
import { Identicon } from "./Identicon";

// How long a toast stays up.
const SHOW_MS = 6000;

type Sent = { id: string; thread: Thread; author: Person; text: string; atMs: number };

// Something sent to you, as a short toast in the top right: who, in which thread, and what they said. Clicking it
// opens the thread; it goes away on its own after a few seconds. Messages arriving together share one toast. Only
// ones that arrive while the app is open show, never ones from before it loaded; notes never do.
export function MentionToasts(props: {
  threads: Thread[];
  me: Person;
  // When the app finished loading; anything older isn't news.
  sinceMs: number;
  onOpen: (threadId: string) => void;
}): JSX.Element {
  const links = useThreadLinks();
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set());

  const toasts = createMemo((): Sent[] =>
    props.threads
      .flatMap((thread) =>
        thread.entries.flatMap((entry) =>
          entry.kind === "message" &&
          entry.author.id !== props.me.id &&
          entry.createdAtMs >= props.sinceMs &&
          entry.createdAtMs <= nowMs() &&
          nowMs() - entry.createdAtMs < SHOW_MS &&
          !dismissed().has(entry.id) &&
          entry.sentTo.some((person) => person.id === props.me.id)
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
      .sort((a, b) => b.atMs - a.atMs),
  );

  // A steady clock, so toasts come and go on time, including ones held until a block ends.
  onSettled(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  });

  // Several at once (most often, the ones held through a meeting) become one toast, so a break starts with a single
  // summary rather than a stack. It opens the newest.
  const latest = (): Sent => toasts()[0];
  // A new newest message starts a fresh toast.
  const latestId = createMemo(() => toasts()[0]?.id);
  const authors = (): Person[] => [
    ...new Map(toasts().map((toast) => [toast.author.id, toast.author])).values(),
  ];
  const dismissAll = (): void => {
    const ids = toasts().map((toast) => toast.id);
    setDismissed((current) => new Set([...current, ...ids]));
  };
  const open = (): void => {
    const threadId = latest().thread.id;
    dismissAll();
    props.onOpen(threadId);
  };
  return (
    <Show when={toasts().length > 0}>
      <div class="toasts" role="status" aria-live="polite">
        <Show when={latestId()} keyed>
          {(_newestId) => (
            <SwipeToast onOpen={open} onDismiss={dismissAll}>
              <Identicon seed={latest().author.id} size={18} />
              <div class="toast-body">
                <div class="toast-title">
                  {toasts().length === 1 ? (
                    <>
                      <span class="toast-author">{latest().author.name}</span> sent you{" "}
                      <span class="toast-thread">{latest().thread.title}</span>
                    </>
                  ) : (
                    <>
                      <span class="toast-author">{toasts().length} messages</span> from{" "}
                      <span class="toast-author">{namesList(authors())}</span>
                    </>
                  )}
                </div>
                <div class="toast-text">
                  {plainThreadLinks(
                    withoutLeadingMentions(latest().text),
                    links.titleOf,
                    links.nameOf,
                  )}
                </div>
              </div>
            </SwipeToast>
          )}
        </Show>
      </div>
    </Show>
  );
}

// How far a toast has to slide before letting go dismisses it, and how long it takes to leave.
const DISMISS_PX = 80;
const LEAVE_MS = 180;

// A toast you slide off to the right to dismiss, by dragging it or with a two-finger swipe, like macOS notifications.
// Short of the threshold it springs back. A click that isn't the end of a drag opens it.
function SwipeToast(props: {
  onOpen: () => void;
  onDismiss: () => void;
  children: JSX.Element;
}): JSX.Element {
  const [offset, setOffset] = createSignal(0);
  const [moving, setMoving] = createSignal(false);
  let drag: { startX: number; moved: boolean } | null = null;
  let settle: number | undefined;
  // The swipe so far, since trackpad events can arrive faster than renders.
  let swiped = 0;
  let dragged = false;

  const release = (distance: number): void => {
    setMoving(false);
    if (distance < DISMISS_PX) {
      setOffset(0);
      return;
    }
    setOffset(window.innerWidth);
    window.setTimeout(() => props.onDismiss(), LEAVE_MS);
  };
  onSettled(() => () => window.clearTimeout(settle));

  return (
    <div
      class="toast"
      role="button"
      tabindex={0}
      data-moving={String(moving())}
      style={{
        transform: `translateX(${offset()}px)`,
        opacity: String(Math.max(0, 1 - offset() / 320)),
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag = { startX: event.clientX, moved: false };
        dragged = false;
      }}
      onPointerMove={(event) => {
        if (drag === null) return;
        const distance = Math.max(0, event.clientX - drag.startX);
        if (distance > 4) drag.moved = true;
        setMoving(true);
        setOffset(distance);
      }}
      onPointerUp={(event) => {
        if (drag === null) return;
        dragged = drag.moved;
        release(Math.max(0, event.clientX - drag.startX));
        drag = null;
      }}
      onWheel={(event) => {
        // A sideways two-finger swipe; it lets go once the swipe has been still for a moment.
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        setMoving(true);
        swiped = Math.max(0, swiped - event.deltaX);
        setOffset(swiped);
        window.clearTimeout(settle);
        settle = window.setTimeout(() => {
          release(swiped);
          swiped = 0;
        }, 120);
      }}
      onClick={() => {
        if (!dragged) props.onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onOpen();
        if (event.key === "Escape") props.onDismiss();
      }}
    >
      {props.children}
    </div>
  );
}

// First names, as "Arjun", "Arjun and KK" or "Arjun, KK and 2 others".
function namesList(people: Person[]): string {
  const names = people.map((person) => person.name.split(" ")[0]);
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}
