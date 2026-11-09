import * as i from "@hugeicons/core-free-icons";
import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { base } from "../styles/base";
import { menu as look } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes, layers, radii } from "../styles/tokens.stylex";
import type { When } from "../when";
import { Icon } from "./Icon";

// Picking a date: two months side by side, floating under what asked. A click is one day (a deadline), a drag across
// days is a span, and a shift-click stretches what's picked to the day clicked. Under them, what's picked (or how to
// pick), and No Date when there's one to clear. A click elsewhere or Escape closes it; picking does too.
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
  // While dragging: the day it started on, and the one under the pointer.
  const [anchor, setAnchor] = createSignal<Date | null>(null);
  const [over, setOver] = createSignal<Date | null>(null);
  let panel!: HTMLDivElement;

  const months = (): Date[] => [
    month(),
    new Date(month().getFullYear(), month().getMonth() + 1, 1),
  ];
  const step = (by: number) => () =>
    setMonth(new Date(month().getFullYear(), month().getMonth() + by, 1));
  // What's picked as it shows: the drag under way, or what it was.
  const range = (): { start?: Date; end?: Date } => {
    const a = anchor();
    const b = over();
    if (a && b) return a <= b ? { start: a, end: b } : { start: b, end: a };
    return { start: was.start ?? was.end, end: was.end ?? was.start };
  };
  const picked = (d: Date): boolean => same(d, range().start) || same(d, range().end);
  const between = (d: Date): boolean => {
    const { start, end } = range();
    return !!start && !!end && d > start && d < end;
  };
  const done = (when: When | null): void => {
    props.ask.pick(when);
    panel.hidePopover();
  };
  const finish = (): void => {
    const a = anchor();
    const b = over() ?? a;
    setAnchor(null);
    setOver(null);
    if (!a || !b) return;
    done(a <= b ? { start: a, end: b } : { start: b, end: a });
  };
  const summary = (): string => {
    const { start, end } = range();
    if (!start || !end) return "Pick a day, or drag across days";
    return same(start, end) ? SHORT.format(end) : `${SHORT.format(start)} – ${SHORT.format(end)}`;
  };

  // Under what asked, its left edges level, kept on screen.
  const place = (el: HTMLDivElement): void => {
    panel = el;
    queueMicrotask(() => {
      el.showPopover();
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
      class={sx(base.panel, look.popover, s.panel)}
      role="dialog"
      aria-label="Pick a date"
      onToggle={(event) => event.newState === "closed" && asked() === props.ask && setAsked(null)}
      onPointerUp={finish}
      onPointerLeave={() => anchor() && setOver(anchor())}
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
                      <button
                        class={sx(
                          base.bare,
                          s.day,
                          between(d) && s.between,
                          picked(d) && s.picked,
                          same(d, today) && !picked(d) && s.today,
                        )}
                        aria-label={SHORT.format(d)}
                        aria-pressed={picked(d) ? "true" : "false"}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          if (event.shiftKey && (was.start || was.end)) {
                            setAnchor((was.start ?? was.end)!);
                            setOver(d);
                            return;
                          }
                          setAnchor(d);
                          setOver(d);
                        }}
                        onPointerEnter={() => anchor() && setOver(d)}
                      >
                        {d.getDate()}
                      </button>
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
        <span class={sx(s.summary)}>{summary()}</span>
        <Show when={was.start || was.end}>
          <button class={sx(base.bare, base.hover, s.clear)} onClick={() => done(null)}>
            No Date
          </button>
        </Show>
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
    borderRadius: radii.control,
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
  day: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: CELL,
    borderRadius: radii.control,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    backgroundColor: { default: "transparent", ":hover": colors.bgTertiary },
    cursor: "pointer",
  },
  // Inside a span: a band behind its days.
  between: { borderRadius: 0, backgroundColor: colors.bgTertiary },
  // Its ends, or the one day.
  picked: {
    color: "white",
    fontWeight: 600,
    backgroundColor: { default: colors.accent, ":hover": colors.accent },
  },
  today: { color: colors.accent, fontWeight: 600 },
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 24,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.strokeTertiary,
  },
  summary: { color: colors.textSecondary },
  clear: {
    padding: "2px 6px",
    borderRadius: radii.control,
    color: colors.textSecondary,
    cursor: "pointer",
  },
});
