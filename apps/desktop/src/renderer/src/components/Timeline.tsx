import * as i from "@hugeicons/core-free-icons";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Thread } from "models";
import { display, groupedBy, listed, setDisplay, ZOOMS, type Zoom } from "../mail";
import { active, edit, lastActive, open, showMenu, threadMenu } from "../session";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { colors, fontSizes } from "../styles/tokens.stylex";
import { Icon } from "./Icon";
import { MenuChip } from "./Menus";

// The list as a timeline, as Notion draws one: each thread's bar, from when it was started to when it's due, its title
// on it. Nothing new is kept for it: a thread starts when it was created and ends on its due date; without one, it
// runs on to today (or, resolved, to its last activity) and fades out. Dragging a bar's end sets the due date. A click
// opens the thread beside it.

const DAY_MS = 86_400_000;
// A day's width at each scale.
const DAY: Record<Zoom, number> = { weeks: 36, months: 12, quarters: 4 };
// A row, its bar, and the days' heading.
const ROW = 36;
const BAR = 32;
const HEAD = 30;
// Where a bar's title starts in it (a short bar's runs on past its end), and the gap before its due date.
const PAD = 8;
const GAP = 8;

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
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

// How wide a title is on a bar (its font: the name size, semibold), so its due date can follow it.
const measure = document.createElement("canvas").getContext("2d")!;
const titleWidth = (title: string): number => {
  measure.font = `600 13px ${getComputedStyle(document.body).fontFamily}`;
  return measure.measureText(title).width;
};

// Scrolls the timeline to today (⌘K's "Go to today"); the shown timeline sets it.
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
  const x = (time: number): number => ((time - range().from) / DAY_MS) * day();
  const dayAt = (px: number): number => addDays(range().from, Math.floor(px / day()));
  const width = (): number => range().days * day();

  // What the days' heading marks: each day by the week, each Monday by the month, each month by the quarter.
  const ticks = (): { at: number; width: number; label: string }[] => {
    const out: { at: number; width: number; label: string }[] = [];
    const end = addDays(range().from, range().days);
    if (zoom() === "quarters") {
      const date = new Date(range().from);
      date.setDate(1);
      while (date.getTime() < end) {
        const at = date.getTime();
        date.setMonth(date.getMonth() + 1);
        if (at >= range().from)
          out.push({ at, width: x(date.getTime()) - x(at), label: MONTH.format(at) });
      }
      return out;
    }
    const step = zoom() === "months" ? 7 : 1;
    for (let at = range().from; at < end; at = addDays(at, step))
      out.push({ at, width: day() * step, label: String(new Date(at).getDate()) });
    return out;
  };

  // The groups to head, when it's grouped (by the mailbox, as the inbox's buckets, or by a field).
  const headed = (): boolean => listed().groups.length > 1 || groupedBy() !== undefined;

  // A due date being dragged: the thread and how many days it's moved.
  const [dragging, setDragging] = createSignal<{ thread: Thread; days: number } | null>(null);
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

  // The month in the middle of what's shown, named over it as it scrolls.
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

  // Back or on by a step of the scale: a week, four weeks, a quarter.
  const step = (by: -1 | 1): void => {
    const days = zoom() === "weeks" ? 7 : zoom() === "months" ? 28 : 91;
    scroller.scrollBy({ left: by * days * day(), behavior: "smooth" });
  };

  const Row = (props: { thread: Thread }): JSX.Element => {
    const t = (): Thread => props.thread;
    const bar = (): { left: number; width: number; open: boolean } => {
      const { from, to, open: ongoing } = shown(t());
      const left = x(from);
      return { left, width: Math.max(day(), x(to) - left), open: ongoing };
    };
    // The due date after the bar, or after its title when that runs on further.
    const dueAt = (): number =>
      Math.max(bar().left + bar().width, bar().left + PAD + titleWidth(t().title)) + GAP;
    const due = (): string | undefined => {
      const d = dueDay(t());
      return d === undefined || !(overdue(t()) || dragging()?.thread === t())
        ? undefined
        : SHORT_DATE.format(d);
    };
    return (
      <div
        class={sx(styles.row, active() === t() && styles.rowOpen)}
        onClick={() => open({ thread: t().id })}
        onContextMenu={(e) => showMenu(e, threadMenu(t()))}
      >
        <div class={sx(styles.track)} style={{ width: `${width()}px` }}>
          <div
            class={sx(
              styles.bar,
              t().state === "resolved" && styles.barResolved,
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
          {/* Its title, starting on the bar and running on past a short one's end. */}
          <span
            class={sx(styles.title, t().state === "resolved" && styles.titleResolved)}
            style={{ left: `${bar().left + PAD}px` }}
          >
            {t().title}
          </span>
          {/* Its due date, when it's passed (or the end's being dragged). */}
          <Show when={due()}>
            <span
              class={sx(styles.beside, overdue(t()) && styles.overdue)}
              style={{ left: `${dueAt()}px` }}
            >
              {due()}
            </span>
          </Show>
        </div>
      </div>
    );
  };

  return (
    <div class={sx(styles.frame)}>
      {/* As Notion's: the month in view, and its scale, today and a step either way. */}
      <div class={sx(styles.toolbar)}>
        <span class={sx(styles.shownMonth)}>{shownMonth()}</span>
        <MenuChip
          title="Zoom"
          tone="muted"
          label={ZOOMS[zoom()]}
          items={(Object.keys(ZOOMS) as Zoom[]).map((z) => ({
            label: ZOOMS[z],
            checked: zoom() === z,
            run: () => setDisplay({ zoom: z }),
          }))}
        />
        <button
          class={sx(base.bare, base.hover, styles.step)}
          aria-label="Back"
          onClick={() => step(-1)}
        >
          <Icon icon={i.ArrowLeft01Icon} size={14} aria-hidden="true" />
        </button>
        <button class={sx(base.bare, base.hover, styles.today)} onClick={scrollToToday}>
          Today
        </button>
        <button
          class={sx(base.bare, base.hover, styles.step)}
          aria-label="On"
          onClick={() => step(1)}
        >
          <Icon icon={i.ArrowRight01Icon} size={14} aria-hidden="true" />
        </button>
      </div>
      <div
        ref={scroller}
        class={sx(styles.timeline)}
        onScroll={() => setScrolled(scroller.scrollLeft)}
      >
        <div class={sx(styles.content)} style={{ width: `${width()}px` }}>
          <div class={sx(styles.head)}>
            <div class={sx(styles.days)} style={{ width: `${width()}px` }}>
              <For each={ticks()}>
                {(tick) => (
                  <span
                    class={sx(styles.tick)}
                    style={{ left: `${x(tick.at)}px`, width: `${tick.width}px` }}
                  >
                    <span class={sx(styles.tickLabel, tick.at === today() && styles.tickToday)}>
                      {tick.label}
                    </span>
                  </span>
                )}
              </For>
            </div>
          </div>
          <div class={sx(styles.rows)}>
            <span
              class={sx(styles.todayDot)}
              style={{ left: `${x(Date.now())}px` }}
              aria-hidden="true"
            />
            <span
              class={sx(styles.todayLine)}
              style={{ left: `${x(Date.now())}px` }}
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
    </div>
  );
}

const styles = stylex.create({
  frame: { display: "flex", flex: 1, flexDirection: "column", minHeight: 0 },
  toolbar: {
    display: "flex",
    flexShrink: 0,
    gap: 2,
    alignItems: "center",
    height: 40,
    padding: "0 12px 0 16px",
  },
  shownMonth: { flex: 1, color: colors.textPrimary, fontSize: fontSizes.name, fontWeight: 600 },
  step: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: 6,
    color: colors.textSecondary,
    cursor: "pointer",
  },
  today: {
    height: 24,
    padding: "0 6px",
    borderRadius: 6,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    cursor: "pointer",
  },
  // On the window's own ground, so the heading stuck at its top covers what scrolls under it.
  timeline: { flex: 1, minHeight: 0, overflow: "auto", backgroundColor: colors.chrome },
  content: { position: "relative", minHeight: "100%" },
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

  days: { position: "relative", flexShrink: 0 },
  tick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  tickLabel: {
    minWidth: 20,
    padding: "0 3px",
    borderRadius: 10,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    lineHeight: "20px",
    textAlign: "center",
  },
  // Today in a red circle, as its line through the rows is red.
  tickToday: { color: "#fff", fontWeight: 600, backgroundColor: colors.urgent },
  rows: { position: "relative", minHeight: `calc(100% - ${HEAD}px)`, paddingBottom: 24 },

  // Where today's line starts, at the top of the rows.
  todayDot: {
    position: "absolute",
    top: -3,
    zIndex: 1,
    width: 7,
    height: 7,
    marginLeft: -3,
    borderRadius: "50%",
    backgroundColor: colors.urgent,
    pointerEvents: "none",
  },
  todayLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 1,
    width: 1,
    backgroundColor: colors.urgent,
    pointerEvents: "none",
  },
  groupRow: { display: "flex", height: 32, alignItems: "flex-end" },
  groupTitle: {
    position: "sticky",
    left: 0,
    zIndex: 3,
    display: "flex",
    flexShrink: 0,
    gap: 6,
    alignItems: "center",
    height: 32,
    paddingLeft: 16,
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    fontWeight: 600,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
  },
  count: { fontWeight: 400, color: colors.textTertiary },
  row: { display: "flex", height: ROW, cursor: "pointer" },
  rowOpen: { backgroundColor: colors.bgQuaternary },
  // The table's cell: its status, title and owner, stuck at the left as the days scroll under it.

  track: { position: "relative", flexShrink: 0 },
  // A card filling its row, a shade off the ground with a hairline edge, as Notion's are.
  bar: {
    position: "absolute",
    top: (ROW - BAR) / 2,
    zIndex: 1,
    height: BAR,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.raisedBorder,
    borderRadius: 8,
    backgroundColor: colors.raised,
  },
  barResolved: { opacity: 0.55 },
  // No due date: it runs on, fading, to now.
  barOpenEnded: {
    borderRightWidth: 0,
    maskImage: "linear-gradient(to right, black 70%, transparent)",
  },
  title: {
    position: "absolute",
    top: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    height: ROW,
    color: colors.textPrimary,
    fontSize: fontSizes.name,
    fontWeight: 600,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  titleResolved: { color: colors.textTertiary },

  // The bar's end, to drag its due date by.
  handle: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 10,
    cursor: "ew-resize",
  },
  beside: {
    position: "absolute",
    top: 0,
    zIndex: 1,
    display: "flex",
    gap: 8,
    alignItems: "center",
    height: ROW,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  overdue: { color: colors.urgent },
});
