import * as i from "@hugeicons/core-free-icons";
import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { base } from "../styles/base";
import { button, menu as look } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes, layers, radii } from "../styles/tokens.stylex";
import type { When } from "../when";
import { Icon } from "./Icon";

// Picking a date: two months side by side, floating under what asked. As a round trip's dates: a click is the start,
// a second the end (or Save keeps the one day, a deadline); a drag across days, or a shift-click, picks a span. Under
// them, what's picked (or how to pick), No Date when there's one to clear, and Save. Escape or a click elsewhere leaves
// it as it was.
type Ask = {
  at: Element | DOMRect;
  start?: Date;
  end?: Date;
  pick: (when: When | null) => void;
};

const [asked, setAsked] = createSignal<Ask | null>(null);
export const pickDate = (ask: Ask): void => void setAsked(ask);

export function DatePicker(): JSX.Element {
  return (
    <Show when={asked()} keyed>
      {(ask) => <Panel ask={ask} />}
    </Show>
  );
}

const day = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const same = (a: Date | undefined, b: Date | undefined): boolean =>
  !!a && !!b && a.getTime() === b.getTime();
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

// A month's days in weeks from Monday, with blanks before its first and after its last.
function weeks(first: Date): (Date | null)[] {
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

function Panel(props: { ask: Ask }): JSX.Element {
  const today = day(new Date());
  const was = {
    start: props.ask.start && day(props.ask.start),
    end: props.ask.end && day(props.ask.end),
  };
  const shownFrom = was.start ?? was.end ?? today;
  const [month, setMonth] = createSignal(
    new Date(shownFrom.getFullYear(), shownFrom.getMonth(), 1),
  );
  // What's picked so far, as a round trip's dates are: a first click is the start, a second the end (one before the
  // start moves the start instead), a third starts again. Nothing's given until Save.
  const [picked, setPicked] = createSignal<{ start?: Date; end?: Date }>({
    start: was.start ?? was.end,
    end: was.end ?? was.start,
  });
  const [awaitingEnd, setAwaitingEnd] = createSignal(false);
  // The day under the pointer (a span's end, previewed while the end's being picked), and where a drag began.
  const [over, setOver] = createSignal<Date | null>(null);
  const [pressed, setPressed] = createSignal<Date | null>(null);
  let panel!: HTMLDivElement;

  const months = (): Date[] => [
    month(),
    new Date(month().getFullYear(), month().getMonth() + 1, 1),
  ];
  const step = (by: number) => () =>
    setMonth(new Date(month().getFullYear(), month().getMonth() + by, 1));
  const ordered = (a: Date, b: Date) => (a <= b ? { start: a, end: b } : { start: b, end: a });
  // What shows: a drag under way, the end being picked (to the day pointed at), or what's picked.
  const range = (): { start?: Date; end?: Date } => {
    const from = pressed();
    const to = over();
    if (from && to) return ordered(from, to);
    const { start } = picked();
    if (awaitingEnd() && start && to && to > start) return { start, end: to };
    return picked();
  };
  const is = (d: Date, edge: "start" | "end"): boolean => same(d, range()[edge]);
  const spans = (): boolean =>
    !!range().start && !!range().end && !same(range().start, range().end);
  const between = (d: Date): boolean => {
    const { start, end } = range();
    return !!start && !!end && d > start && d < end;
  };
  const choose = (d: Date): void => {
    const { start } = picked();
    if (awaitingEnd() && start && d >= start) {
      setPicked({ start, end: d });
      setAwaitingEnd(false);
    } else {
      setPicked({ start: d, end: d });
      setAwaitingEnd(true);
    }
  };
  const release = (): void => {
    const from = pressed();
    const to = over();
    setPressed(null);
    if (!from || !to) return;
    // A press and release on one day is a click; across days, a drag picks the span.
    if (same(from, to)) return choose(from);
    setPicked(ordered(from, to));
    setAwaitingEnd(false);
  };
  const done = (when: When | null): void => {
    props.ask.pick(when);
    panel.hidePopover();
  };
  const save = (): void => {
    const { start, end } = picked();
    if (start) done({ start, end: end ?? start });
  };
  const summary = (): string => {
    const { start, end } = picked();
    if (!start) return "Pick a day, or a start and an end";
    if (awaitingEnd()) return `${SHORT.format(start)} – pick an end, or save one day`;
    return !end || same(start, end)
      ? SHORT.format(start)
      : `${SHORT.format(start)} – ${SHORT.format(end)}`;
  };

  // Under what asked, its left edges level, kept on screen.
  const place = (el: HTMLDivElement): void => {
    panel = el;
    queueMicrotask(() => {
      el.showPopover();
      el.focus();
      const at =
        props.ask.at instanceof Element ? props.ask.at.getBoundingClientRect() : props.ask.at;
      const { width, height } = el.getBoundingClientRect();
      const below = at.bottom + 4;
      el.style.left = `${Math.max(8, Math.min(at.left, innerWidth - width - 8))}px`;
      el.style.top = `${below + height > innerHeight - 8 ? Math.max(8, at.top - height - 4) : below}px`;
    });
  };

  return (
    <div
      ref={place}
      popover="auto"
      tabindex={-1}
      class={sx(base.panel, look.popover, s.panel)}
      role="dialog"
      aria-label="Pick a date"
      onToggle={(event) => event.newState === "closed" && asked() === props.ask && setAsked(null)}
      // Enter saves, except on a button, which does its own thing (a day picks it, No Date clears).
      onKeyDown={(event) => {
        if (event.key !== "Enter" || (event.target as HTMLElement).closest("button")) return;
        event.preventDefault();
        save();
      }}
    >
      <div class={sx(s.months)}>
        <For each={months()}>
          {(first, at) => (
            <div class={sx(s.month)}>
              <div class={sx(s.head)}>
                <Show when={at() === 0} fallback={<span class={sx(s.stepSpace)} />}>
                  <button
                    class={sx(base.bare, base.hover, s.step)}
                    aria-label="Earlier"
                    onClick={step(-1)}
                  >
                    <Icon icon={i.ArrowLeft01Icon} size={13} aria-hidden="true" />
                  </button>
                </Show>
                <span class={sx(s.monthName)}>{MONTH.format(first)}</span>
                <Show when={at() === 1} fallback={<span class={sx(s.stepSpace)} />}>
                  <button
                    class={sx(base.bare, base.hover, s.step)}
                    aria-label="Later"
                    onClick={step(1)}
                  >
                    <Icon icon={i.ArrowRight01Icon} size={13} aria-hidden="true" />
                  </button>
                </Show>
              </div>
              <div class={sx(s.grid)}>
                <For each={WEEKDAYS}>{(name) => <span class={sx(s.weekday)}>{name}</span>}</For>
                <For each={weeks(first)}>
                  {(d) =>
                    d ? (
                      // The band behind a span runs into its round ends: half a cell from each.
                      <span
                        class={sx(
                          s.cell,
                          between(d) && s.band,
                          spans() && is(d, "start") && s.bandAfter,
                          spans() && is(d, "end") && s.bandBefore,
                        )}
                      >
                        <button
                          class={sx(
                            base.bare,
                            s.day,
                            (is(d, "start") || is(d, "end")) && s.picked,
                            same(d, today) && !is(d, "start") && !is(d, "end") && s.today,
                          )}
                          aria-label={SHORT.format(d)}
                          aria-pressed={is(d, "start") || is(d, "end") ? "true" : "false"}
                          onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            if (event.shiftKey && picked().start) {
                              setPicked(ordered(picked().start!, d));
                              setAwaitingEnd(false);
                              return;
                            }
                            setPressed(d);
                            setOver(d);
                            // Let go anywhere: on a day it picks; off the days, the press is forgotten.
                            const up = (): void => {
                              removeEventListener("pointercancel", up);
                              release();
                            };
                            addEventListener("pointerup", up, { once: true });
                            addEventListener("pointercancel", up, { once: true });
                          }}
                          onPointerEnter={() => setOver(d)}
                          onPointerLeave={() => setOver(null)}
                          // The keyboard's click (Enter or Space on a day): pick it as a click would.
                          onClick={(event) => event.detail === 0 && choose(d)}
                        >
                          {d.getDate()}
                        </button>
                      </span>
                    ) : (
                      <span />
                    )
                  }
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
      <div class={sx(s.foot)}>
        <span class={sx(base.ellipsis, s.summary)}>{summary()}</span>
        <Show when={was.start || was.end}>
          <button class={sx(base.bare, base.hover, s.clear)} onClick={() => done(null)}>
            No Date
          </button>
        </Show>
        <button
          class={sx(base.bare, button.solid, s.save)}
          disabled={!picked().start}
          onClick={save}
        >
          Save
        </button>
      </div>
    </div>
  );
}

const CELL = 26;
const s = stylex.create({
  panel: {
    position: "fixed",
    zIndex: layers.contextMenu,
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px 8px",
    borderRadius: 11,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    userSelect: "none",
  },
  months: { display: "flex", gap: 20 },
  month: { display: "flex", flexDirection: "column", gap: 6 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", height: 22 },
  monthName: { fontWeight: 600 },
  step: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    color: colors.textSecondary,
    cursor: "pointer",
  },
  stepSpace: { width: 22 },
  grid: { display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, rowGap: 2 },
  weekday: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 18,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
  },
  cell: { display: "flex", height: CELL },
  band: { backgroundColor: colors.bgTertiary },
  bandAfter: {
    backgroundImage: `linear-gradient(to right, transparent 50%, ${colors.bgTertiary} 50%)`,
  },
  bandBefore: {
    backgroundImage: `linear-gradient(to right, ${colors.bgTertiary} 50%, transparent 50%)`,
  },
  day: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: CELL,
    borderRadius: radii.pill,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    backgroundColor: { default: "transparent", ":hover": colors.bgTertiary },
    cursor: "pointer",
  },
  // Its ends, or the one day: round, in the app's blue (New's).
  picked: {
    color: "white",
    fontWeight: 600,
    backgroundColor: { default: colors.primary, ":hover": colors.primaryHover },
  },
  today: { color: colors.primary, fontWeight: 600 },
  foot: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 24,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.strokeTertiary,
  },
  summary: { flex: 1, minWidth: 0, color: colors.textSecondary },
  save: { height: 24, marginLeft: 0, padding: "0 12px", borderRadius: radii.pill },
  clear: {
    padding: "2px 8px",
    borderRadius: radii.pill,
    color: colors.textSecondary,
    cursor: "pointer",
  },
});
