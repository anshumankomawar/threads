import { plainThreadLinks, withoutLeadingMentions, type Person, type Thread } from "model";
import { createMemo, createSignal, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { useApp } from "../app/state";
import { toast } from "../styles/controls";
import { sx } from "../styles/sx";
import { Identicon } from "./Identicon";
import { Keyed } from "./Keyed";

const dyn = stylex.create({
  slide: (offset: number) => ({
    transform: `translateX(${offset}px)`,
    opacity: Math.max(0, 1 - offset / 320),
  }),
});

const SHOW_MS = 6000;
// How far a toast slides before letting go dismisses it, and how long it takes to leave.
const DISMISS_PX = 80;
const LEAVE_MS = 180;

type Sent = { id: string; thread: Thread; author: Person; text: string; atMs: number };

// "Arjun", "Arjun and KK" or "Arjun, KK and 2 others".
function namesList(people: Person[]): string {
  const names = people.map((person) => person.name.split(" ")[0]);
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}

// Messages sent to you while the app is open (never ones from before it loaded, `readyAtMs`), as one toast in the top
// right that opens the newest and goes away after a few seconds. Notes never show.
export function MentionToasts(): JSX.Element {
  const app = useApp();
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set());
  const toasts = createMemo((): Sent[] =>
    app.data
      .threads()
      .flatMap((thread) =>
        thread.entries.flatMap((entry) =>
          entry.kind === "message" &&
          entry.author.id !== app.me().id &&
          entry.createdAtMs >= app.client().readyAtMs &&
          entry.createdAtMs <= nowMs() &&
          nowMs() - entry.createdAtMs < SHOW_MS &&
          !dismissed().has(entry.id) &&
          entry.sentTo.some((person) => person.id === app.me().id)
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
  onSettled(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  });
  const dismissAll = (): void => {
    const ids = toasts().map((sent) => sent.id);
    setDismissed((current) => new Set([...current, ...ids]));
  };
  const open = (): void => {
    const threadId = toasts()[0].thread.id;
    dismissAll();
    app.nav.openThread(threadId);
  };
  const authors = (): Person[] => [
    ...new Map(toasts().map((sent) => [sent.author.id, sent.author])).values(),
  ];
  const em = (text: string): JSX.Element => <span class={sx(toast.emphasis)}>{text}</span>;
  return (
    <Show when={toasts().length > 0}>
      <div class={sx(toast.stack)} role="status" aria-live="polite">
        <Keyed value={toasts()[0]} by={(newest) => newest.id}>
          {(newest) => (
            <SwipeToast onOpen={open} onDismiss={dismissAll}>
              <Identicon seed={newest().author.id} size={18} class={sx(toast.avatar)} />
              <div class={sx(toast.body)}>
                <div class={sx(toast.title)}>
                  {toasts().length === 1 ? (
                    <>
                      {em(newest().author.name)} sent you {em(newest().thread.title)}
                    </>
                  ) : (
                    <>
                      {em(`${toasts().length} messages`)} from {em(namesList(authors()))}
                    </>
                  )}
                </div>
                <div class={sx(toast.text)}>
                  {plainThreadLinks(
                    withoutLeadingMentions(newest().text),
                    app.links.titleOf,
                    app.links.nameOf,
                  )}
                </div>
              </div>
            </SwipeToast>
          )}
        </Keyed>
      </div>
    </Show>
  );
}

// Slid off to the right to dismiss, by dragging or a two-finger swipe; short of the threshold it springs back. A click
// that isn't the end of a drag opens it.
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
      {...stylex.attrs(toast.toast, moving() && toast.moving, dyn.slide(offset()))}
      role="button"
      tabindex={0}
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
