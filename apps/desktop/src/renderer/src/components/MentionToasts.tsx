import { mentionsIn, Message, Subspace, subspaceMentionsIn, type User } from "models";
import { createMemo, createSignal, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { me, open, store, firstName, memberIn } from "../session";
import { base } from "../styles/base";
import { toast } from "../styles/controls";
import { sx } from "../styles/sx";
import { Identicon } from "./Identicon";
import { plain } from "./ThreadView";

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
const LOADED_AT = Date.now();

// "Arjun", "Arjun and KK" or "Arjun, KK and 2 others".
function namesList(people: User[]): string {
  const names = people.map(firstName);
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}

const mentionsMe = (message: Message): boolean =>
  mentionsIn(message.body).includes(me().id) ||
  subspaceMentionsIn(message.body).some((id) => {
    const sub = store.findById(Subspace, id);
    return sub !== undefined && memberIn(sub, me().id) !== undefined;
  });

// Messages that @mention you while the app is open, as one toast at the top right that opens the newest and goes away
// after a few seconds.
export function MentionToasts(): JSX.Element {
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set());
  const toasts = createMemo((): Message[] =>
    store
      .all(Message)
      .filter((message) => {
        const at = message.createdAt.getTime();
        return (
          message.authorId !== me().id &&
          at >= LOADED_AT &&
          nowMs() - at < SHOW_MS &&
          !dismissed().has(message.id) &&
          mentionsMe(message)
        );
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  );
  onSettled(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  });
  const dismissAll = (): void => {
    const ids = toasts().map((message) => message.id);
    setDismissed((current) => new Set([...current, ...ids]));
  };
  const openNewest = (): void => {
    const { threadId } = toasts()[0];
    dismissAll();
    open({ thread: threadId });
  };
  const authors = (): User[] => [...new Set(toasts().map((message) => message.author))];
  const em = (text: string): JSX.Element => <span class={sx(toast.emphasis)}>{text}</span>;
  return (
    <Show when={toasts()[0]} keyed>
      {(newest: Message) => (
        <div class={sx(toast.stack)} role="status" aria-live="polite">
          <SwipeToast onOpen={openNewest} onDismiss={dismissAll}>
            <span class={sx(toast.avatar)}>
              <Identicon seed={newest.authorId} size={18} />
            </span>
            <div class={sx(toast.body)}>
              <div class={sx(base.clip, toast.title)}>
                {toasts().length === 1 ? (
                  <>
                    {em(newest.author.name)} mentioned you in {em(newest.thread.title)}
                  </>
                ) : (
                  <>
                    {em(`${toasts().length} messages`)} from {em(namesList(authors()))}
                  </>
                )}
              </div>
              <div class={sx(toast.text)}>{plain(newest.body)}</div>
            </div>
          </SwipeToast>
        </div>
      )}
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
    if (distance < DISMISS_PX) return void setOffset(0);
    setOffset(window.innerWidth);
    window.setTimeout(() => props.onDismiss(), LEAVE_MS);
  };
  onSettled(() => () => window.clearTimeout(settle));
  return (
    <div
      {...stylex.attrs(base.panel, toast.mention, moving() && toast.moving, dyn.slide(offset()))}
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
    >
      {props.children}
    </div>
  );
}
