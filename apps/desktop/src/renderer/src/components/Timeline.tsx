import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Thread } from "models";
import { display, groupedBy, listed, type Zoom } from "../mail";
import { active, edit, lastActive, open, showMenu, threadMenu } from "../session";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { colors, fontSizes } from "../styles/tokens.stylex";
import { dot } from "./ThreadView";

// The list as a timeline: a row a thread, its bar from when it was started to when it's due. Nothing new is kept for
// it: a thread starts when it was created and ends on its due date; without one, it runs on to today (or, resolved, to
// its last activity) and fades out. Dragging a bar's end sets the due date. A click opens the thread beside it.

const DAY_MS = 86_400_000;
// A day's width at each scale.
const DAY: Record<Zoom, number> = { weeks: 36, months: 12, quarters: 4 };
// The titles' column, a row, its bar, and the heading (months over days).
const TITLES = 240;
const ROW = 40;
const BAR = 24;
const HEAD = 62;

const startOfDay = (date: Date | number): number => new Date(date).setHours(0, 0, 0, 0);
const addDays = (time: number, days: number): number => {
  const date = new Date(time);
  date.setDate(date.getDate() + days);
  return date.getTime();
};
// Whole days from one midnight to another (an hour's daylight saving rounded away).
const daysBetween = (from: number, to: number): number => Math.round((to - from) / DAY_MS);

// Where a thread's bar runs, in midnights: to the end of its due day, or (without one) to now.
function span(thread: Thread): { from: number; to: number; open: boolean } {
  const created = startOfDay(thread.createdAt);
  if (thread.dueAt) {
    const due = addDays(startOfDay(thread.dueAt), 1);
    return {
      from: Math.min(created, due - DAY_MS),
      to: Math.max(due, created + DAY_MS),
      open: false,
    };
  }
  const end = thread.isOpen ? Date.now() : lastActive(thread);
  return { from: created, to: Math.max(end, created + DAY_MS), open: true };
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });
const LONG_MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

// Scrolls the timeline to today (⌘K's "Go to today"); the shown timeline sets it.
let toToday: (() => void) | undefined;
export const showToday = (): void => toToday?.();

export function Timeline(): JSX.Element {
  const day = (): number => DAY[display().zoom ?? "weeks"];
  const threads = (): Thread[] => [...new Set(listed().order)];
  // From the Monday before the first thread began (or a fortnight ago) to two months past the last due date.
  const range = (): { from: number; days: number } => {
    const today = startOfDay(Date.now());
    let first = addDays(today, -14);
    let last = addDays(today, 60);
    for (const t of threads()) {
      const { from, to } = span(t);
      first = Math.min(first, from);
      last = Math.max(last, addDays(to, 60));
    }
    const start = addDays(first, -7);
    const monday = addDays(start, -((new Date(start).getDay() + 6) % 7));
    return { from: monday, days: daysBetween(monday, startOfDay(last)) };
  };
  const x = (time: number): number => ((time - range().from) / DAY_MS) * day();
  const width = (): number => range().days * day();

  // The first of each month, and the days (or, zoomed out, the Mondays) to number under them.
  const months = (): number[] => {
    const out: number[] = [];
    const date = new Date(range().from);
    date.setDate(1);
    while (date.getTime() < addDays(range().from, range().days)) {
      if (date.getTime() >= range().from) out.push(date.getTime());
      date.setMonth(date.getMonth() + 1);
    }
    return out;
  };
  const ticks = (): number[] => {
    const step = display().zoom === "months" ? 7 : display().zoom === "quarters" ? 0 : 1;
    if (!step) return [];
    return Array.from({ length: Math.ceil(range().days / step) }, (_, n) =>
      addDays(range().from, n * step),
    );
  };

  // The groups to head, when it's grouped (by the mailbox, as the inbox's buckets, or by a field).
  const headed = (): boolean => listed().groups.length > 1 || groupedBy() !== undefined;

  // A due date being dragged: the thread and how many days it's moved.
  const [dragging, setDragging] = createSignal<{ thread: Thread; days: number } | null>(null);
  const resize = (thread: Thread, event: PointerEvent): void => {
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const start = event.clientX;
    setDragging({ thread, days: 0 });
    const move = (e: PointerEvent): void =>
      void setDragging({ thread, days: Math.round((e.clientX - start) / day()) });
    const up = (): void => {
      handle.removeEventListener("pointermove", move);
      const moved = dragging()?.days ?? 0;
      setDragging(null);
      const { to } = span(thread);
      // The due day is the last the bar covers; without a due date, the day it's let go on.
      const due = addDays(thread.dueAt ? startOfDay(thread.dueAt) : startOfDay(to), moved);
      if (moved !== 0)
        edit(thread, { dueAt: new Date(Math.max(due, startOfDay(thread.createdAt))) });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
  };

  // The month in the middle of what's shown, named in the corner as it scrolls.
  const [scrolled, setScrolled] = createSignal(0);
  const [shownWidth, setShownWidth] = createSignal(0);
  const shownMonth = (): string =>
    LONG_MONTH_YEAR.format(range().from + ((scrolled() + shownWidth() / 2) / day()) * DAY_MS);
  const today = (): number => startOfDay(Date.now());

  let scroller!: HTMLDivElement;
  const scrollToToday = (): void => {
    const room = scroller.clientWidth - TITLES;
    scroller.scrollTo({ left: Math.max(0, x(startOfDay(Date.now())) - room / 3) });
  };
  // Today a third of the way in, at first, whenever it's resized (a thread opened beside it), and at a new scale.
  createEffect(day, () => void requestAnimationFrame(scrollToToday));
  onSettled(() => {
    const resized = new ResizeObserver(() => {
      setShownWidth(scroller.clientWidth - TITLES);
      scrollToToday();
    });
    resized.observe(scroller);
    toToday = scrollToToday;
    return () => {
      resized.disconnect();
      if (toToday === scrollToToday) toToday = undefined;
    };
  });

  // Behind the rows, from the Monday it starts on: a faint line a week, and (by the week) the weekends shaded.
  const weeks = (): JSX.CSSProperties => {
    const d = day();
    const weekend = (display().zoom ?? "weeks") === "weeks" ? colors.bgQuaternary : "transparent";
    return {
      width: `${width()}px`,
      "background-image":
        display().zoom === "quarters"
          ? "none"
          : `repeating-linear-gradient(to right, ${colors.strokeTertiary} 0 1px, transparent 1px ${d * 5}px, ${weekend} ${d * 5}px ${d * 7}px)`,
    };
  };

  const Row = (props: { thread: Thread }): JSX.Element => {
    const t = (): Thread => props.thread;
    const bar = (): { left: number; width: number; open: boolean } => {
      const { from, to, open: ongoing } = span(t());
      const moved = dragging()?.thread === t() ? dragging()!.days : 0;
      const end =
        ongoing && moved === 0
          ? to
          : addDays(ongoing ? startOfDay(to) : to, ongoing ? moved + 1 : moved);
      const left = x(from);
      return { left, width: Math.max(day(), x(end) - left), open: ongoing && moved === 0 };
    };
    // Its due date (as it's dragged, where it'll land), and whether it's passed with the thread still open.
    const dueDay = (): number | undefined => {
      const moved = dragging()?.thread === t() ? dragging()!.days : 0;
      if (!t().dueAt && moved === 0) return undefined;
      return addDays(startOfDay(t().dueAt ?? span(t()).to), moved);
    };
    const overdue = (): boolean => t().isOpen && (dueDay() ?? Infinity) < today();
    return (
      <div
        class={sx(styles.row, active() === t() && styles.rowOpen)}
        onClick={() => open({ thread: t().id })}
        onContextMenu={(e) => showMenu(e, threadMenu(t()))}
      >
        <div class={sx(styles.title, active() === t() && styles.rowOpen)}>
          {dot(t().state)}
          <span class={sx(base.ellipsis)}>{t().title}</span>
        </div>
        <div class={sx(styles.track)} style={{ width: `${width()}px` }}>
          <div
            class={sx(
              styles.bar,
              t().state === "resolved" && styles.barResolved,
              t().state === "blocked" && styles.barBlocked,
              bar().open && styles.barOpenEnded,
            )}
            style={{ left: `${bar().left}px`, width: `${bar().width}px` }}
          >
            <span
              class={sx(styles.handle)}
              aria-label="Change the due date"
              onPointerDown={(e) => resize(t(), e)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <Show when={dueDay()}>
            {(due) => (
              <span
                class={sx(styles.due, overdue() && styles.overdue)}
                style={{ left: `${bar().left + bar().width + 8}px` }}
              >
                {SHORT_DATE.format(due())}
              </span>
            )}
          </Show>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={scroller}
      class={sx(styles.timeline)}
      onScroll={() => setScrolled(scroller.scrollLeft)}
    >
      <div class={sx(styles.content)} style={{ width: `${TITLES + width()}px` }}>
        <div class={sx(styles.head)}>
          <div class={sx(styles.corner)}>
            <span class={sx(styles.shownMonth)}>{shownMonth()}</span>
            <button class={sx(base.bare, styles.today)} onClick={scrollToToday}>
              Today
            </button>
          </div>
          <div class={sx(styles.scale)} style={{ width: `${width()}px` }}>
            <For each={months()}>
              {(month) => (
                <span class={sx(styles.month)} style={{ left: `${x(month)}px` }}>
                  {new Date(month).getMonth() === 0 || month === months()[0]
                    ? MONTH_YEAR.format(month)
                    : MONTH.format(month)}
                </span>
              )}
            </For>
            {/* By the week, each day: its letter over its date, today's in a pill; zoomed out, the Mondays' dates. */}
            <For each={ticks()}>
              {(tick) => (
                <span
                  class={sx(styles.tick)}
                  style={{
                    left: `${x(tick)}px`,
                    width: `${day() * (display().zoom === "months" ? 7 : 1)}px`,
                  }}
                >
                  <Show when={(display().zoom ?? "weeks") === "weeks"}>
                    <span class={sx(styles.weekday)}>{WEEKDAY.format(tick)}</span>
                  </Show>
                  <span class={sx(styles.date, tick === today() && styles.dateToday)}>
                    {new Date(tick).getDate()}
                  </span>
                </span>
              )}
            </For>
            <Show when={(display().zoom ?? "weeks") !== "weeks"}>
              <span class={sx(styles.todayMark)} style={{ left: `${x(Date.now()) - 3}px` }} />
            </Show>
          </div>
        </div>
        <div class={sx(styles.rows)} style={weeks()}>
          <For each={months()}>
            {(month) => (
              <span
                class={sx(styles.monthLine)}
                style={{ left: `${TITLES + x(month)}px` }}
                aria-hidden="true"
              />
            )}
          </For>
          <span
            class={sx(styles.todayLine)}
            style={{ left: `${TITLES + x(Date.now())}px` }}
            aria-hidden="true"
          />
          <For each={listed().groups}>
            {(group) => (
              <>
                <Show when={headed()}>
                  <div class={sx(styles.groupRow)}>
                    <span class={sx(styles.groupTitle)}>
                      {group.bucket?.name ?? group.title}
                      <span class={sx(styles.count)}>{group.threads.length}</span>
                    </span>
                  </div>
                </Show>
                <For each={group.threads}>{(t) => <Row thread={t} />}</For>
              </>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// The bars' tint: the status's color over the ground.
const tint = (color: string, percent: number): string =>
  `color-mix(in oklab, ${color} ${percent}%, transparent)`;

const styles = stylex.create({
  // On the window's own ground, so what's stuck to its edges (the titles, the heading) covers what scrolls under it.
  timeline: { flex: 1, minHeight: 0, overflow: "auto", backgroundColor: colors.chrome },
  content: { position: "relative", minHeight: "100%" },
  // Months over days, staying put as the rows scroll under it.
  head: {
    position: "sticky",
    top: 0,
    zIndex: 3,
    display: "flex",
    height: HEAD,
    backgroundColor: colors.chrome,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
  },
  corner: {
    position: "sticky",
    left: 0,
    zIndex: 1,
    display: "flex",
    flexShrink: 0,
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "flex-start",
    width: TITLES,
    padding: "6px 0 8px 16px",
    backgroundColor: colors.chrome,
  },
  shownMonth: { color: colors.textPrimary, fontSize: fontSizes.body, fontWeight: 600 },
  today: {
    height: 20,
    padding: "0 8px",
    borderRadius: 6,
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    backgroundColor: colors.bgQuaternary,
    cursor: "pointer",
  },
  scale: { position: "relative", flexShrink: 0 },
  month: {
    position: "absolute",
    top: 6,
    paddingLeft: 4,
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  tick: {
    position: "absolute",
    bottom: 6,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    alignItems: "center",
  },
  weekday: { color: colors.textTertiary, fontSize: 9, fontWeight: 500, lineHeight: "11px" },
  date: {
    minWidth: 20,
    padding: "0 4px",
    borderRadius: 6,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: "18px",
    textAlign: "center",
  },
  dateToday: { color: "#fff", fontWeight: 600, backgroundColor: colors.accent },
  todayMark: {
    position: "absolute",
    bottom: 0,
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: colors.accent,
    transform: "translateY(50%)",
  },
  rows: {
    position: "relative",
    minHeight: `calc(100% - ${HEAD}px)`,
    backgroundPosition: `${TITLES}px 0`,
    backgroundRepeat: "repeat-y",
  },
  // The first of each month, down through the rows: stronger than the weeks' lines.
  monthLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.strokeFocused,
    pointerEvents: "none",
  },
  todayLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 1,
    width: 1,
    backgroundColor: colors.accent,
    opacity: 0.5,
    pointerEvents: "none",
  },
  groupRow: { display: "flex", height: 30, alignItems: "flex-end" },
  groupTitle: {
    position: "sticky",
    left: 0,
    zIndex: 2,
    display: "flex",
    flexShrink: 0,
    gap: 6,
    alignItems: "flex-end",
    width: TITLES,
    height: 30,
    padding: "0 0 4px 16px",
    backgroundColor: colors.chrome,
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    fontWeight: 500,
  },
  count: { fontWeight: 400, color: colors.textTertiary },
  row: { display: "flex", height: ROW, cursor: "pointer" },
  // The open one (opaque, as its title covers what scrolls under it).
  rowOpen: { backgroundColor: colors.panelSelected },
  // Sticky at the left as the days scroll under it.
  title: {
    position: "sticky",
    left: 0,
    zIndex: 2,
    display: "flex",
    flexShrink: 0,
    gap: 8,
    alignItems: "center",
    width: TITLES,
    padding: "0 12px 0 16px",
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    backgroundColor: colors.chrome,
  },
  track: { position: "relative", flexShrink: 0 },
  bar: {
    position: "absolute",
    top: (ROW - BAR) / 2,
    height: BAR,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tint(colors.accent, 55),
    borderRadius: 7,
    backgroundColor: tint(colors.accent, 22),
  },
  barResolved: {
    borderColor: tint(colors.statusClosed, 55),
    backgroundColor: tint(colors.statusClosed, 22),
  },
  barBlocked: { borderColor: tint(colors.urgent, 55), backgroundColor: tint(colors.urgent, 18) },
  // No due date: it runs on, fading, to now.
  barOpenEnded: {
    borderRightWidth: 0,
    maskImage: "linear-gradient(to right, black 60%, transparent)",
  },
  // The bar's end, to drag its due date by.
  handle: {
    position: "absolute",
    top: -2,
    right: -4,
    bottom: -2,
    width: 10,
    cursor: "ew-resize",
  },
  due: {
    position: "absolute",
    top: 0,
    display: "flex",
    alignItems: "center",
    height: ROW,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  overdue: { color: colors.urgent },
});
