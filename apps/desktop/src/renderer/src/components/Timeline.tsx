import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Thread } from "models";
import { display, groupedBy, listed, type Zoom } from "../mail";
import { active, edit, lastActive, open, showMenu, threadMenu } from "../session";
import { sx } from "../styles/sx";
import { colors, fontSizes } from "../styles/tokens.stylex";
import { Identicon } from "./Identicon";
import { dot } from "./ThreadView";

// The list as a timeline: a row a thread, its bar from when it was started to when it's due, its title on it. Nothing
// new is kept for it: a thread starts when it was created and ends on its due date; without one, it runs on to today
// (or, resolved, to its last activity) and fades out. Dragging a bar's end sets the due date. A click opens the thread
// beside it. Hovering a bar marks its span in the heading; a line follows the pointer with its day.

const DAY_MS = 86_400_000;
// A day's width at each scale.
const DAY: Record<Zoom, number> = { weeks: 36, months: 12, quarters: 4 };
// A row, its bar, and the heading (months over days).
const ROW = 40;
const BAR = 26;
const HEAD = 62;
// Room before the first day, so a bar starting there still shows its title.
const LEAD = 16;

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
const LONG_MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

// Scrolls the timeline to today (the query bar's Today, ⌘K's "Go to today"); the shown timeline sets it.
let toToday: (() => void) | undefined;
export const showToday = (): void => toToday?.();

export function Timeline(): JSX.Element {
  const zoom = (): Zoom => display().zoom ?? "weeks";
  const day = (): number => DAY[zoom()];
  const today = (): number => startOfDay(Date.now());
  const threads = (): Thread[] => [...new Set(listed().order)];
  // From the Monday before the first thread began (or a fortnight ago) to two months past the last due date.
  const range = (): { from: number; days: number } => {
    let first = addDays(today(), -14);
    let last = addDays(today(), 60);
    for (const t of threads()) {
      const { from, to } = span(t);
      first = Math.min(first, from);
      last = Math.max(last, addDays(to, 60));
    }
    const start = addDays(first, -7);
    const monday = addDays(start, -((new Date(start).getDay() + 6) % 7));
    return { from: monday, days: daysBetween(monday, startOfDay(last)) };
  };
  const x = (time: number): number => LEAD + ((time - range().from) / DAY_MS) * day();
  const dayAt = (px: number): number => addDays(range().from, Math.floor((px - LEAD) / day()));
  const width = (): number => LEAD + range().days * day();

  // The first of each month, and the days (or, zoomed out, the Mondays) to mark under them.
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
    const step = zoom() === "months" ? 7 : zoom() === "quarters" ? 0 : 1;
    if (!step) return [];
    return Array.from({ length: Math.ceil(range().days / step) }, (_, n) =>
      addDays(range().from, n * step),
    );
  };

  // The groups to head, when it's grouped (by the mailbox, as the inbox's buckets, or by a field).
  const headed = (): boolean => listed().groups.length > 1 || groupedBy() !== undefined;

  // A due date being dragged (the thread and how many days it's moved), the bar under the pointer, and the pointer's x.
  const [dragging, setDragging] = createSignal<{ thread: Thread; days: number } | null>(null);
  const [hovered, setHovered] = createSignal<Thread | null>(null);
  const [pointer, setPointer] = createSignal<number | null>(null);
  const moved = (t: Thread): number => (dragging()?.thread === t ? dragging()!.days : 0);

  // Where a bar runs as shown: dragged, its end moves by whole days (an open-ended one's from today).
  const shown = (t: Thread): { from: number; to: number; open: boolean } => {
    const { from, to, open: ongoing } = span(t);
    const by = moved(t);
    if (by === 0) return { from, to, open: ongoing };
    const end = addDays(startOfDay(to), ongoing ? by + 1 : by);
    return { from, to: Math.max(from + DAY_MS, end), open: false };
  };
  // Its due day (as it's dragged, where it'll land), and whether it's passed with the thread still open.
  const dueDay = (t: Thread): number | undefined =>
    t.dueAt || moved(t) ? addDays(shown(t).to, -1) : undefined;
  const overdue = (t: Thread): boolean => t.isOpen && (dueDay(t) ?? Infinity) < today();

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
      const by = dragging()?.days ?? 0;
      const due = dueDay(thread);
      setDragging(null);
      if (by !== 0 && due !== undefined)
        edit(thread, { dueAt: new Date(Math.max(due, startOfDay(thread.createdAt))) });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
  };

  // The month in the middle of what's shown, pinned at the corner as it scrolls.
  const [scrolled, setScrolled] = createSignal(0);
  const [shownWidth, setShownWidth] = createSignal(0);
  const shownMonth = (): string => LONG_MONTH_YEAR.format(dayAt(scrolled() + shownWidth() / 2));

  let scroller!: HTMLDivElement;
  const scrollToToday = (): void => {
    scroller.scrollTo({ left: Math.max(0, x(today()) - scroller.clientWidth / 3) });
  };
  // Today a third of the way in, at first, whenever it's resized (a thread opened beside it), and at a new scale.
  createEffect(day, () => void requestAnimationFrame(scrollToToday));
  onSettled(() => {
    const resized = new ResizeObserver(() => {
      setShownWidth(scroller.clientWidth);
      scrollToToday();
    });
    resized.observe(scroller);
    toToday = scrollToToday;
    return () => {
      resized.disconnect();
      if (toToday === scrollToToday) toToday = undefined;
    };
  });

  // Behind the rows, from the Monday it starts on: by the week, the weekends shaded; zoomed out, a faint line a week.
  const ground = (): JSX.CSSProperties => {
    const d = day();
    const image =
      zoom() === "weeks"
        ? `repeating-linear-gradient(to right, transparent 0 ${d * 5}px, ${colors.bgQuaternary} ${d * 5}px ${d * 7}px)`
        : zoom() === "months"
          ? `repeating-linear-gradient(to right, ${colors.strokeTertiary} 0 1px, transparent 1px ${d * 7}px)`
          : "none";
    return {
      width: `${width()}px`,
      "background-image": image,
      "background-position": `${LEAD}px 0`,
    };
  };

  const Row = (props: { thread: Thread }): JSX.Element => {
    const t = (): Thread => props.thread;
    const bar = (): { left: number; width: number; open: boolean } => {
      const { from, to, open: ongoing } = shown(t());
      const left = x(from);
      return { left, width: Math.max(day(), x(to) - left), open: ongoing };
    };
    const grip = (): boolean => hovered() === t() || dragging()?.thread === t();
    return (
      <div
        class={sx(styles.row, active() === t() && styles.rowOpen)}
        onClick={() => open({ thread: t().id })}
        onContextMenu={(e) => showMenu(e, threadMenu(t()))}
      >
        <div
          class={sx(
            styles.bar,
            t().state === "resolved" && styles.barResolved,
            t().state === "blocked" && styles.barBlocked,
            bar().open && styles.barOpenEnded,
            overdue(t()) && styles.barOverdue,
          )}
          style={{ left: `${bar().left}px`, width: `${bar().width}px` }}
          onPointerEnter={() => setHovered(t())}
          onPointerLeave={() => hovered() === t() && setHovered(null)}
        >
          <span
            class={sx(styles.handle, grip() && styles.handleShown)}
            aria-label="Change the due date"
            onPointerDown={(e) => resize(t(), e)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        {/* On the bar, running past its end when it's short. */}
        <span
          class={sx(styles.label, t().state === "resolved" && styles.labelResolved)}
          style={{ left: `${bar().left + 9}px` }}
        >
          {dot(t().state)}
          <span>{t().title}</span>
          <Show when={t().owner}>{(owner) => <Identicon seed={owner().id} size={14} />}</Show>
        </span>
      </div>
    );
  };

  // The span of the bar under the pointer (or being dragged), marked in the heading with its dates.
  const marked = (): { left: number; width: number; from: number; due?: number } | undefined => {
    const t = dragging()?.thread ?? hovered();
    if (!t) return undefined;
    const { from, to } = shown(t);
    return { left: x(from), width: x(to) - x(from), from, due: dueDay(t) };
  };

  return (
    <div class={sx(styles.frame)}>
      <span class={sx(styles.shownMonth)}>{shownMonth()}</span>
      <div
        ref={scroller}
        class={sx(styles.timeline)}
        onScroll={() => setScrolled(scroller.scrollLeft)}
        onPointerMove={(e) => {
          const at = e.clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft;
          setPointer(at >= LEAD ? at : null);
        }}
        onPointerLeave={() => setPointer(null)}
      >
        <div class={sx(styles.content)} style={{ width: `${width()}px` }}>
          <div class={sx(styles.head)}>
            <For each={months()}>
              {(month) => (
                <span class={sx(styles.month)} style={{ left: `${x(month)}px` }}>
                  {MONTH.format(month)}
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
                    width: `${day() * (zoom() === "months" ? 7 : 1)}px`,
                  }}
                >
                  <Show when={zoom() === "weeks"}>
                    <span class={sx(styles.weekday)}>{WEEKDAY.format(tick)}</span>
                  </Show>
                  <span class={sx(styles.date, tick === today() && styles.dateToday)}>
                    {new Date(tick).getDate()}
                  </span>
                </span>
              )}
            </For>
            <Show when={zoom() !== "weeks"}>
              <span class={sx(styles.todayMark)} style={{ left: `${x(Date.now()) - 3}px` }} />
            </Show>
            <Show when={marked()}>
              {(m) => (
                <span
                  class={sx(styles.span)}
                  style={{ left: `${m().left}px`, width: `${m().width}px` }}
                >
                  <span class={sx(styles.spanDate)}>{SHORT_DATE.format(m().from)}</span>
                  <Show when={m().due}>
                    {(due) => (
                      <span class={sx(styles.spanDate, styles.spanEnd)}>
                        {SHORT_DATE.format(due())}
                      </span>
                    )}
                  </Show>
                </span>
              )}
            </Show>
            <Show when={!marked() && pointer()}>
              {(at) => (
                <span class={sx(styles.cursorDate)} style={{ left: `${at()}px` }}>
                  {SHORT_DATE.format(dayAt(at()))}
                </span>
              )}
            </Show>
          </div>
          <div class={sx(styles.rows)} style={ground()}>
            <For each={months()}>
              {(month) => (
                <span
                  class={sx(styles.monthLine)}
                  style={{ left: `${x(month)}px` }}
                  aria-hidden="true"
                />
              )}
            </For>
            <span
              class={sx(styles.todayLine)}
              style={{ left: `${x(Date.now())}px` }}
              aria-hidden="true"
            />
            <Show when={!dragging() && pointer()}>
              {(at) => (
                <span
                  class={sx(styles.cursorLine)}
                  style={{ left: `${at()}px` }}
                  aria-hidden="true"
                />
              )}
            </Show>
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
    </div>
  );
}

const styles = stylex.create({
  frame: {
    position: "relative",
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
  },
  // On the window's own ground, so the heading stuck at its top covers what scrolls under it.
  timeline: { flex: 1, minHeight: 0, overflow: "auto", backgroundColor: colors.chrome },
  content: { position: "relative", minHeight: "100%" },
  // The month in view, over the heading's corner.
  shownMonth: {
    position: "absolute",
    top: 7,
    left: 0,
    zIndex: 4,
    padding: "0 24px 0 16px",
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    fontWeight: 600,
    lineHeight: "18px",
    backgroundImage: `linear-gradient(to right, ${colors.chrome} 75%, transparent)`,
    pointerEvents: "none",
  },
  // Months over days, staying put as the rows scroll under it.
  head: {
    position: "sticky",
    top: 0,
    zIndex: 3,
    height: HEAD,
    backgroundColor: colors.chrome,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
  },
  month: {
    position: "absolute",
    top: 7,
    paddingLeft: 6,
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    fontWeight: 500,
    lineHeight: "18px",
    whiteSpace: "nowrap",
  },
  tick: {
    position: "absolute",
    bottom: 6,
    display: "flex",
    flexDirection: "column",
    gap: 1,
    alignItems: "center",
  },
  weekday: { color: colors.textTertiary, fontSize: 9, fontWeight: 500, lineHeight: "10px" },
  date: {
    minWidth: 20,
    padding: "0 4px",
    borderRadius: 6,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: "17px",
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
  // The hovered bar's span in the heading: a band along its foot, its start and due dates at its ends.
  span: {
    position: "absolute",
    bottom: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  spanDate: {
    position: "absolute",
    bottom: 6,
    left: 0,
    padding: "0 6px",
    borderRadius: 5,
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: 500,
    lineHeight: "18px",
    whiteSpace: "nowrap",
    backgroundColor: colors.panel,
    boxShadow: "0 1px 3px rgba(0,0,0,0.14)",
    transform: "translateX(-50%)",
  },
  spanEnd: { left: "100%" },
  cursorDate: {
    position: "absolute",
    bottom: 6,
    padding: "0 6px",
    borderRadius: 5,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: "18px",
    whiteSpace: "nowrap",
    backgroundColor: colors.panel,
    boxShadow: "0 1px 3px rgba(0,0,0,0.14)",
    transform: "translateX(-50%)",
    pointerEvents: "none",
  },
  rows: {
    position: "relative",
    minHeight: `calc(100% - ${HEAD}px)`,
    paddingTop: 6,
    paddingBottom: 24,
    backgroundRepeat: "repeat-y",
  },
  // The first of each month, down through the rows.
  monthLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.strokeTertiary,
    pointerEvents: "none",
  },
  todayLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 1,
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.accent,
    opacity: 0.55,
    pointerEvents: "none",
  },
  cursorLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.strokeFocused,
    pointerEvents: "none",
  },
  groupRow: { position: "relative", display: "flex", height: 34, alignItems: "flex-end" },
  groupTitle: {
    position: "sticky",
    left: 0,
    zIndex: 2,
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 24,
    padding: "0 8px 0 16px",
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    fontWeight: 600,
  },
  count: { fontWeight: 400, color: colors.textTertiary },
  row: { position: "relative", height: ROW, cursor: "pointer" },
  rowOpen: { backgroundColor: colors.bgQuaternary },
  // A soft fill in the status's color, its edge a shade stronger.
  bar: {
    position: "absolute",
    top: (ROW - BAR) / 2,
    zIndex: 1,
    height: BAR,
    borderRadius: 8,
    backgroundColor: `color-mix(in oklab, ${colors.accent} 16%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colors.accent} 24%, transparent)`,
  },
  barResolved: {
    backgroundColor: `color-mix(in oklab, ${colors.statusClosed} 14%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colors.statusClosed} 22%, transparent)`,
  },
  barBlocked: {
    backgroundColor: `color-mix(in oklab, ${colors.urgent} 14%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colors.urgent} 24%, transparent)`,
  },
  // Past due and still open: its end in red.
  barOverdue: {
    boxShadow: `inset -3px 0 0 ${colors.urgent}, inset 0 0 0 1px color-mix(in oklab, ${colors.urgent} 30%, transparent)`,
  },
  // No due date: it runs on, fading, to now.
  barOpenEnded: { maskImage: "linear-gradient(to right, black 55%, transparent)" },
  label: {
    position: "absolute",
    top: 0,
    zIndex: 2,
    display: "flex",
    gap: 7,
    alignItems: "center",
    height: ROW,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    fontWeight: 500,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  labelResolved: { color: colors.textTertiary },
  // The bar's end, to drag its due date by: a grip shown while it's hovered.
  handle: {
    position: "absolute",
    top: 0,
    right: -2,
    bottom: 0,
    zIndex: 3,
    width: 12,
    cursor: "ew-resize",
    "::after": {
      content: '""',
      position: "absolute",
      top: 7,
      right: 5,
      bottom: 7,
      width: 3,
      borderRadius: 2,
      backgroundColor: colors.textTertiary,
      opacity: 0,
    },
  },
  handleShown: { "::after": { opacity: 0.7 } },
});
