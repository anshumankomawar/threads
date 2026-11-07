import * as i from "@hugeicons/core-free-icons";
import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Thread, User } from "models";
import {
  active,
  canPeekBack,
  canPeekForward,
  open,
  peek,
  peekBack,
  peeked,
  peekForward,
  save,
  saved,
  setSplit,
  store,
  type Peeked,
} from "../session";
import { commandFor, keysFor, keysOf } from "../hotkeys";
import { base } from "../styles/base";
import { topbar } from "../styles/controls";
import { peekMarker } from "../styles/markers.stylex";
import { sx } from "../styles/sx";
import { colors, motion, radii } from "../styles/tokens.stylex";
import { Icon } from "./Icon";
import { PersonView } from "./Pages";
import { ThreadView } from "./ThreadView";

// A link's thread or person in a small window floating over the app, as Little Arc opens a link: read it where you are,
// then expand it into the reading pane, split it beside the thread you're in, or click away (or Escape) to let it go.
// Its title bar moves it and its edges resize it, and it opens where you left it. A link inside it peeks in its place.

const peekIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(6px) scale(0.98)" },
});

const styles = stylex.create({
  window: {
    position: "fixed",
    outline: "none",
    display: { default: "none", ":popover-open": "flex" },
    flexDirection: "column",
    margin: 0,
    padding: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    color: colors.textPrimary,
    backgroundColor: colors.chrome,
    boxShadow: colors.shadowFloat,
    animationName: { default: peekIn, [motion.reduced]: "none" },
    animationDuration: "160ms",
    animationTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
    "::backdrop": { backgroundColor: "transparent" },
  },
  // Its title bar moves it.
  bar: {
    flexShrink: 0,
    cursor: "default",
    userSelect: "none",
    gap: 2,
    padding: "0 8px",
  },
  title: { flex: 1 },
  lastNav: { marginRight: 6 },
  // Its edges and corners resize it: thin strips just inside, over what's under them.
  edge: { position: "absolute", zIndex: 2 },
  n: { top: 0, left: 8, right: 8, height: 5, cursor: "ns-resize" },
  s: { bottom: 0, left: 8, right: 8, height: 5, cursor: "ns-resize" },
  e: { right: 0, top: 8, bottom: 8, width: 5, cursor: "ew-resize" },
  w: { left: 0, top: 8, bottom: 8, width: 5, cursor: "ew-resize" },
  ne: { top: 0, right: 0, width: 10, height: 10, cursor: "nesw-resize" },
  nw: { top: 0, left: 0, width: 10, height: 10, cursor: "nwse-resize" },
  se: { bottom: 0, right: 0, width: 10, height: 10, cursor: "nwse-resize" },
  sw: { bottom: 0, left: 0, width: 10, height: 10, cursor: "nesw-resize" },
  // Its own layer, under the edges, whatever its content stacks inside it.
  body: {
    position: "relative",
    zIndex: 0,
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    overflowY: "auto",
  },
});

const titleOf = (shown: Peeked): string =>
  "thread" in shown
    ? (store.findById(Thread, shown.thread)?.title ?? "Thread")
    : (store.findById(User, shown.person)?.name ?? "Someone");

// Where it is and how big, kept for next time; at first, centred, about three quarters of the window.
type Frame = { x: number; y: number; w: number; h: number };
const MIN = { w: 360, h: 240 };
const centred = (): Frame => {
  const w = Math.min(760, innerWidth * 0.72);
  const h = Math.min(720, innerHeight * 0.82);
  return { x: (innerWidth - w) / 2, y: (innerHeight - h) / 2, w, h };
};
// Inside the window, as far from its edges as the traffic lights are from its corner, and never smaller than MIN.
const INSET = 12;
const kept = (f: Frame): Frame => {
  const w = Math.min(Math.max(f.w, MIN.w), innerWidth - 2 * INSET);
  const h = Math.min(Math.max(f.h, MIN.h), innerHeight - 2 * INSET);
  return {
    x: Math.min(Math.max(f.x, INSET), innerWidth - INSET - w),
    y: Math.min(Math.max(f.y, INSET), innerHeight - INSET - h),
    w,
    h,
  };
};
const [frame, setFrame] = createSignal<Frame | null>(saved<Frame | null>("peek-frame", null));
const place = (next: Frame): void => {
  setFrame(next);
  save("peek-frame", next);
};

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
// A drag from `start` by (dx, dy): moving it, or pulling one of its edges.
function dragged(start: Frame, how: Edge | "move", dx: number, dy: number): Frame {
  if (how === "move") return { ...start, x: start.x + dx, y: start.y + dy };
  // An edge stops at the inset, and the opposite edge stays put.
  // (`start` is already inside, so there's always room for its own size.)
  const clamp = (v: number, most: number): number => Math.min(v, most);
  let { x, y, w, h } = start;
  if (how.includes("e")) w = clamp(Math.max(MIN.w, start.w + dx), innerWidth - INSET - start.x);
  if (how.includes("s")) h = clamp(Math.max(MIN.h, start.h + dy), innerHeight - INSET - start.y);
  if (how.includes("w")) {
    w = clamp(Math.max(MIN.w, start.w - dx), start.x + start.w - INSET);
    x = start.x + start.w - w;
  }
  if (how.includes("n")) {
    h = clamp(Math.max(MIN.h, start.h - dy), start.y + start.h - INSET);
    y = start.y + start.h - h;
  }
  return { x, y, w, h };
}

export function Peek(): JSX.Element {
  let window!: HTMLDivElement;
  const shownFrame = (): Frame => kept(frame() ?? centred());
  // Pointer captured on what you grabbed, so a fast drag doesn't lose it.
  const grab =
    (how: Edge | "move") =>
    (event: PointerEvent): void => {
      if (event.button !== 0) return;
      if (how === "move" && (event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      const start = shownFrame();
      const from = { x: event.clientX, y: event.clientY };
      const move = (e: PointerEvent): void =>
        place(kept(dragged(start, how, e.clientX - from.x, e.clientY - from.y)));
      const stop = (): void => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", stop);
        target.removeEventListener("pointercancel", stop);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", stop);
      target.addEventListener("pointercancel", stop);
    };
  const close = (): void => window.hidePopover();
  // Into the reading pane, as if you'd opened it from a list.
  const expand = (shown: Peeked): void => {
    close();
    open("thread" in shown ? { thread: shown.thread } : { person: shown.person });
  };
  // Beside the thread you're reading; with none open, it's the one you read.
  const split = (thread: string): void => {
    close();
    if (active()) setSplit(thread);
    else open({ thread });
  };
  return (
    <div
      ref={(el) => {
        window = el;
        // A manual popover, so a menu opened in it (a right-click, a property's, the reply's) doesn't close it: it
        // closes itself on Escape or a click outside it and outside anything opened over it.
        document.addEventListener(
          "pointerdown",
          (event) => {
            const target = event.target as Element;
            if (!el.matches(":popover-open") || el.contains(target)) return;
            if (target.closest(":popover-open, dialog[open]")) return;
            close();
          },
          { capture: true },
        );
        // Open while there's something to peek at; a link inside it replaces what's shown.
        createEffect(peeked, (shown) => {
          // Taking the focus, so Escape and the keys are its, not the reply's behind it.
          if (shown && !el.matches(":popover-open")) {
            el.showPopover();
            el.focus();
          } else if (!shown && el.matches(":popover-open")) el.hidePopover();
        });
      }}
      popover="manual"
      data-peek
      tabindex={-1}
      class={sx(styles.window)}
      style={{
        left: `${shownFrame().x}px`,
        top: `${shownFrame().y}px`,
        width: `${shownFrame().w}px`,
        height: `${shownFrame().h}px`,
      }}
      role="dialog"
      aria-label={peeked() ? titleOf(peeked()!) : undefined}
      onToggle={(event) => event.newState === "closed" && peek(null)}
      // Back and forward (⌘[ ⌘] as rebound) go through what you've peeked at, not the app behind it.
      onKeyDown={(event) => {
        // Escape closes it, once whatever's open over it (a menu, the reply's) has had it.
        if (event.key === "Escape") {
          if (event.defaultPrevented || document.querySelector(":popover-open:not([data-peek])"))
            return;
          event.preventDefault();
          return close();
        }
        const id = commandFor(keysOf(event) ?? "");
        if (id === "back") peekBack();
        else if (id === "forward") peekForward();
        else return;
        event.preventDefault();
      }}
    >
      <Show when={peeked()} keyed>
        {(shown) => (
          <>
            <For each={EDGES}>
              {(edge) => (
                <span
                  class={sx(styles.edge, styles[edge])}
                  onPointerDown={grab(edge)}
                  aria-hidden="true"
                />
              )}
            </For>
            <div data-bar class={sx(topbar.bar, styles.bar)} onPointerDown={grab("move")}>
              <button
                class={sx(topbar.button)}
                aria-label="Back"
                title={`Back (${keysFor("back")})`}
                disabled={!canPeekBack()}
                onClick={peekBack}
              >
                <Icon icon={i.ArrowLeft01Icon} size={14} aria-hidden="true" />
              </button>
              <button
                class={sx(topbar.button, styles.lastNav)}
                aria-label="Forward"
                title={`Forward (${keysFor("forward")})`}
                disabled={!canPeekForward()}
                onClick={peekForward}
              >
                <Icon icon={i.ArrowRight01Icon} size={14} aria-hidden="true" />
              </button>
              <span class={sx(base.ellipsis, topbar.title, styles.title)}>{titleOf(shown)}</span>
              <Show when={"thread" in shown && shown.thread}>
                {(thread) => (
                  <button
                    class={sx(topbar.button)}
                    aria-label="Split beside"
                    title="Split beside"
                    onClick={() => split(thread())}
                  >
                    <Icon icon={i.LayoutTwoColumnIcon} size={14} aria-hidden="true" />
                  </button>
                )}
              </Show>
              <button
                class={sx(topbar.button)}
                aria-label="Expand"
                title="Expand"
                onClick={() => expand(shown)}
              >
                <Icon icon={i.ArrowExpand01Icon} size={13} aria-hidden="true" />
              </button>
              <button
                class={sx(topbar.button)}
                aria-label="Close"
                title="Close (Esc)"
                onClick={close}
              >
                <Icon icon={i.Cancel01Icon} size={14} aria-hidden="true" />
              </button>
            </div>
            <div {...stylex.attrs(styles.body, peekMarker)}>
              <Switch>
                <Match when={"thread" in shown && store.findById(Thread, shown.thread)} keyed>
                  {(thread) => <ThreadView thread={thread} autofocus={false} />}
                </Match>
                <Match when={"person" in shown && store.findById(User, shown.person)} keyed>
                  {(user) => <PersonView user={user} />}
                </Match>
              </Switch>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
