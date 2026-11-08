import * as i from "@hugeicons/core-free-icons";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Thread } from "models";
import { progressOf } from "../links";
import { display, groupedBy, listed, setDisplay, ZOOMS, type Group, type Zoom } from "../mail";
import { edit, lastActive, peek, peeked, showMenu, threadMenu } from "../session";
import { base } from "../styles/base";
import { chip } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";
import { MenuChip } from "./Menus";

// The list as a timeline, after TeamGantt: the threads named down the left, and beside each its bar, slim and solid in
// its status's color, from its start to its due date, its owner just past its end. A thread with branches fills its
// bar as far as they're resolved. A thread that blocks another is joined to it by an elbow. A group's row has a
// summary bar over all of its threads. Bars drag along the days (both dates move) and resize by either edge, a dashed
// outline left where they were and the days moved shown over them; a click opens the thread in the floating view.
// Without a start a bar starts when the thread was created; without a due date it runs on to today and fades.

const DAY_MS = 86_400_000;
// A day's width at each scale.
const DAY: Record<Zoom, number> = { weeks: 34, months: 12, quarters: 4 };
// The names' column, a row, a bar, a group's row, and the heading (months over days).
const NAMES = 240;
const ROW = 34;
const BAR = 20;
const GROUP = 34;
const HEAD = 48;
const TOP = 6;
// How far the pointer moves before a press on a bar is a drag rather than a click.
const SLOP = 3;

const startOfDay = (date: Date | number): number => new Date(date).setHours(0, 0, 0, 0);
const addDays = (time: number, days: number): number => {
  const date = new Date(time);
  date.setDate(date.getDate() + days);
  return date.getTime();
};
// Whole days from one midnight to another (an hour's daylight saving rounded away).
const daysBetween = (from: number, to: number): number => Math.round((to - from) / DAY_MS);

// Where a thread's bar runs, in midnights: from its start (or creation) to the end of its due day, or to now.
function span(thread: Thread): { from: number; to: number; open: boolean } {
  const from = startOfDay(thread.startAt ?? thread.createdAt);
  if (thread.dueAt) {
    const to = addDays(startOfDay(thread.dueAt), 1);
    return { from: Math.min(from, to - DAY_MS), to: Math.max(to, from + DAY_MS), open: false };
  }
  const end = thread.isOpen ? Date.now() : lastActive(thread);
  return { from, to: Math.max(end, from + DAY_MS), open: true };
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const DAY_MONTH = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

// Scrolls the timeline to today (⌘K's "Go to today"); the shown timeline sets it.
let toToday: (() => void) | undefined;
export const showToday = (): void => toToday?.();

// A bar being dragged: along the days (both its dates), or by an edge (one of them), and by how many days.
type Drag = { thread: Thread; kind: "move" | "start" | "end"; days: number };
// The rows, in order, each where it sits: a group's heading, or a thread.
type Line = { y: number } & ({ group: Group } | { thread: Thread });

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

  // The heading: each month over its days (by the week each day with its letter, by the month each Monday).
  const months = (): { at: number; width: number }[] => {
    const out: { at: number; width: number }[] = [];
    const end = addDays(range().from, range().days);
    const date = new Date(range().from);
    date.setDate(1);
    while (date.getTime() < end) {
      const at = Math.max(date.getTime(), range().from);
      date.setMonth(date.getMonth() + 1);
      out.push({ at, width: x(Math.min(date.getTime(), end)) - x(at) });
    }
    return out;
  };
  const ticks = (): { at: number; width: number }[] => {
    if (zoom() === "quarters") return [];
    const step = zoom() === "months" ? 7 : 1;
    const out: { at: number; width: number }[] = [];
    for (let at = range().from; at < addDays(range().from, range().days); at = addDays(at, step))
      out.push({ at, width: day() * step });
    return out;
  };

  // The groups to head, when it's grouped (by the mailbox, as the inbox's buckets, or by a field).
  const headed = (): boolean => listed().groups.length > 1 || groupedBy() !== undefined;
  const lines = (): Line[] => {
    const out: Line[] = [];
    let y = TOP;
    for (const group of listed().groups) {
      if (headed()) {
        out.push({ y, group });
        y += GROUP;
      }
      for (const thread of group.threads) {
        out.push({ y, thread });
        y += ROW;
      }
    }
    return out;
  };
  const height = (): number => (lines().at(-1)?.y ?? 0) + ROW + 24;

  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [hovered, setHovered] = createSignal<Thread | null>(null);
  // Where a bar runs as shown: dragged, by whole days (an open-ended one as if due today), never under a day long.
  const shown = (t: Thread): { from: number; to: number; open: boolean } => {
    const { from, to, open: ongoing } = span(t);
    const d = drag();
    if (d?.thread !== t || d.days === 0) return { from, to, open: ongoing };
    const end = ongoing ? addDays(startOfDay(to), 1) : to;
    if (d.kind === "move")
      return { from: addDays(from, d.days), to: addDays(end, d.days), open: false };
    if (d.kind === "start")
      return { from: Math.min(addDays(from, d.days), end - DAY_MS), to: end, open: false };
    return { from, to: Math.max(addDays(end, d.days), from + DAY_MS), open: false };
  };
  const bar = (t: Thread): { left: number; width: number; open: boolean } => {
    const { from, to, open: ongoing } = shown(t);
    const left = x(from);
    return { left, width: Math.max(day(), x(to) - left), open: ongoing };
  };
  // Its due day, and whether it's passed with the thread still open.
  const dueDay = (t: Thread): number | undefined => (t.dueAt ? addDays(span(t).to, -1) : undefined);
  const overdue = (t: Thread): boolean => t.isOpen && (dueDay(t) ?? Infinity) < today();
  const selected = (t: Thread): boolean => {
    const p = peeked();
    return p !== null && "thread" in p && p.thread === t.id;
  };

  // A press on a bar (or one of its edges): a drag once the pointer has moved, otherwise a click that opens it.
  const press = (thread: Thread, kind: Drag["kind"], event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const start = event.clientX;
    let dragged = false;
    const move = (e: PointerEvent): void => {
      if (!dragged && Math.abs(e.clientX - start) < SLOP) return;
      dragged = true;
      setDrag({ thread, kind, days: Math.round((e.clientX - start) / day()) });
    };
    const up = (): void => {
      target.removeEventListener("pointermove", move);
      const d = drag();
      if (!dragged || !d) {
        setDrag(null);
        if (kind === "move") peek({ thread: thread.id });
        return;
      }
      const { from, to } = shown(thread);
      setDrag(null);
      if (d.days === 0) return;
      const due = new Date(addDays(to, -1));
      if (d.kind === "move") edit(thread, { startAt: new Date(from), dueAt: due });
      else if (d.kind === "start") edit(thread, { startAt: new Date(from) });
      else edit(thread, { dueAt: due });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up, { once: true });
  };

  // The month in the middle of what's shown, named over it as it scrolls.
  const [scrolled, setScrolled] = createSignal(0);
  const [shownWidth, setShownWidth] = createSignal(0);
  const shownMonth = (): string => MONTH_YEAR.format(dayAt(scrolled() + shownWidth() / 2));

  let scroller!: HTMLDivElement;
  const scrollToToday = (): void => {
    scroller.scrollTo({ left: Math.max(0, x(today()) - (scroller.clientWidth - NAMES) / 3) });
  };
  // Today a third of the way in, at first, whenever it's resized (a thread opened beside it), and at a new scale.
  createEffect(day, () => void requestAnimationFrame(scrollToToday));
  onSettled(() => {
    const resized = new ResizeObserver(() => {
      setShownWidth(scroller.clientWidth - NAMES);
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

  // A thread that blocks another, joined to it: from the end of its bar, down (or up), into the start of the other's.
  const links = (): string[] => {
    const at = new Map<Thread, number>();
    for (const line of lines()) if ("thread" in line) at.set(line.thread, line.y + ROW / 2);
    const out: string[] = [];
    for (const [t, y1] of at) {
      const blocked = t.blocks;
      const y2 = blocked && at.get(blocked);
      if (!blocked || y2 === undefined) continue;
      const x1 = bar(t).left + bar(t).width;
      const x2 = bar(blocked).left;
      const turn = x1 + 10;
      out.push(
        x2 - 10 >= turn
          ? `M ${x1} ${y1} H ${turn} V ${y2} H ${x2 - 2}`
          : `M ${x1} ${y1} H ${turn} V ${(y1 + y2) / 2} H ${x2 - 10} V ${y2} H ${x2 - 2}`,
      );
    }
    return out;
  };

  const area = (): JSX.CSSProperties => ({ width: `${width()}px`, height: `${height()}px` });

  const Bar = (props: { thread: Thread; y: number }): JSX.Element => {
    const t = (): Thread => props.thread;
    const b = (): { left: number; width: number; open: boolean } => bar(t());
    const dragging = (): Drag | undefined => {
      const d = drag();
      return d?.thread === t() ? d : undefined;
    };
    const progress = (): number | undefined => {
      const p = progressOf(t());
      return p && p.done / p.total;
    };
    const tone = (): string =>
      t().state === "resolved"
        ? colors.statusClosed
        : t().state === "blocked"
          ? colors.urgent
          : colors.barOpen;
    const original = (): { left: number; width: number } => {
      const { from, to } = span(t());
      return { left: x(from), width: Math.max(day(), x(to) - x(from)) };
    };
    const grip = (): boolean => hovered() === t() || dragging() !== undefined;
    const moved = (): number => dragging()?.days ?? 0;
    return (
      <>
        {/* Where it was, while it's dragged. */}
        <Show when={moved() !== 0}>
          <span
            class={sx(styles.ghost)}
            style={{
              top: `${props.y + (ROW - BAR) / 2}px`,
              left: `${original().left}px`,
              width: `${original().width}px`,
            }}
          />
        </Show>
        <div
          class={sx(
            styles.bar,
            b().open && styles.barOpenEnded,
            selected(t()) && styles.barSelected,
            dragging() && styles.barDragged,
          )}
          style={{
            top: `${props.y + (ROW - BAR) / 2}px`,
            left: `${b().left}px`,
            width: `${b().width}px`,
            // Over the ground, so it's solid even in a translucent tone.
            background:
              progress() === undefined
                ? `linear-gradient(${tone()}, ${tone()}), ${colors.chrome}`
                : `color-mix(in oklab, ${tone()} 38%, ${colors.chrome})`,
          }}
          title={t().title}
          onPointerDown={(e) => press(t(), "move", e)}
          onPointerEnter={() => setHovered(t())}
          onPointerLeave={() => hovered() === t() && setHovered(null)}
          onContextMenu={(e) => showMenu(e, threadMenu(t()))}
        >
          {/* As far as its branches are resolved. */}
          <Show when={progress()}>
            {(done) => (
              <span
                class={sx(styles.progress)}
                style={{ width: `${done() * 100}%`, "background-color": tone() }}
              />
            )}
          </Show>
          <span
            class={sx(styles.edge, styles.edgeStart, grip() && styles.edgeShown)}
            aria-label="Change the start date"
            onPointerDown={(e) => press(t(), "start", e)}
          />
          <span
            class={sx(styles.edge, styles.edgeEnd, grip() && styles.edgeShown)}
            aria-label="Change the due date"
            onPointerDown={(e) => press(t(), "end", e)}
          />
        </div>
        {/* Its owner just past its end; its due date, red, when it's passed. */}
        <span
          class={sx(styles.after)}
          style={{ top: `${props.y}px`, left: `${b().left + b().width + 6}px` }}
        >
          <Show when={t().owner}>
            {(owner) => (
              <span class={sx(styles.avatar)}>
                <Identicon seed={owner().id} size={18} />
              </span>
            )}
          </Show>
          <Show when={overdue(t())}>
            <span class={sx(styles.overdue)}>{SHORT_DATE.format(dueDay(t())!)}</span>
          </Show>
        </span>
        {/* The days it's moved, over it. */}
        <Show when={moved() !== 0}>
          <span
            class={sx(styles.badge)}
            style={{
              top: `${props.y - 20}px`,
              left: `${
                dragging()!.kind === "start"
                  ? b().left
                  : dragging()!.kind === "end"
                    ? b().left + b().width
                    : b().left + b().width / 2
              }px`,
            }}
          >
            {`${moved() > 0 ? "+" : "−"}${Math.abs(moved())} ${Math.abs(moved()) === 1 ? "day" : "days"}`}
          </span>
        </Show>
      </>
    );
  };

  // A group's summary bar: from its first thread's start to its last's end.
  const summary = (group: Group): { left: number; width: number } | undefined => {
    if (group.threads.length === 0) return undefined;
    const spans = group.threads.map((t) => shown(t));
    const left = x(Math.min(...spans.map((s) => s.from)));
    return { left, width: x(Math.max(...spans.map((s) => s.to))) - left };
  };

  return (
    <div class={sx(styles.frame)}>
      {/* The month in view, and its scale, today and a step either way. */}
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
        <button class={sx(base.bare, base.hover, chip.chip)} onClick={scrollToToday}>
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
        <div class={sx(styles.content)} style={{ width: `${NAMES + width()}px` }}>
          {/* Months over days, stuck at the top. */}
          <div class={sx(styles.head)}>
            <div class={sx(styles.corner)} />
            <div class={sx(styles.scale)} style={{ width: `${width()}px` }}>
              <For each={months()}>
                {(month) => (
                  <span
                    class={sx(styles.month)}
                    style={{ left: `${x(month.at)}px`, width: `${month.width}px` }}
                  >
                    {new Date(month.at).getMonth() === 0 || month === months()[0]
                      ? `${MONTH.format(month.at)} ${new Date(month.at).getFullYear()}`
                      : MONTH.format(month.at)}
                  </span>
                )}
              </For>
              <For each={ticks()}>
                {(tick) => (
                  <span
                    class={sx(styles.tick)}
                    style={{ left: `${x(tick.at)}px`, width: `${tick.width}px` }}
                  >
                    <span class={sx(tick.at === today() && styles.tickToday)}>
                      {tick.at === today()
                        ? DAY_MONTH.format(tick.at)
                        : new Date(tick.at).getDate()}
                    </span>
                  </span>
                )}
              </For>
            </div>
          </div>
          <div class={sx(styles.body)}>
            {/* The names, stuck at the left as the days scroll under them. */}
            <div class={sx(styles.names)} style={{ height: `${height()}px` }}>
              <For each={lines()}>
                {(line) =>
                  "group" in line ? (
                    <span class={sx(styles.groupName)} style={{ top: `${line.y}px` }}>
                      {line.group.bucket?.name ?? line.group.title}
                      <span class={sx(styles.count)}>{line.group.threads.length}</span>
                    </span>
                  ) : (
                    <button
                      class={sx(
                        base.bare,
                        base.hover,
                        styles.name,
                        selected(line.thread) && styles.nameSelected,
                      )}
                      style={{ top: `${line.y}px` }}
                      onClick={() => peek({ thread: line.thread.id })}
                      onContextMenu={(e) => showMenu(e, threadMenu(line.thread))}
                    >
                      <span class={sx(base.ellipsis)}>{line.thread.title}</span>
                    </button>
                  )
                }
              </For>
            </div>
            <div class={sx(styles.days)} style={area()}>
              {/* A dashed line at each month's start, and a fine one at today, as Linear's. */}
              <For each={months().slice(1)}>
                {(month) => (
                  <span
                    class={sx(styles.monthLine)}
                    style={{ left: `${x(month.at)}px` }}
                    aria-hidden="true"
                  />
                )}
              </For>
              <span
                class={sx(styles.todayLine)}
                style={{ left: `${x(today()) + day() / 2}px` }}
                aria-hidden="true"
              />
              <svg class={sx(styles.links)} width={width()} height={height()} aria-hidden="true">
                <For each={links()}>{(d) => <path d={d} />}</For>
              </svg>
              <For each={lines()}>
                {(line) =>
                  "group" in line ? (
                    <Show when={summary(line.group)}>
                      {(s) => (
                        <span
                          class={sx(styles.summary)}
                          style={{
                            top: `${line.y + GROUP / 2 - 4}px`,
                            left: `${s().left}px`,
                            width: `${s().width}px`,
                          }}
                        />
                      )}
                    </Show>
                  ) : (
                    <Bar thread={line.thread} y={line.y} />
                  )
                }
              </For>
            </div>
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

  // On the window's own ground, so what's stuck to its edges covers what scrolls under it.
  timeline: { flex: 1, minHeight: 0, overflow: "auto", backgroundColor: colors.chrome },
  content: { position: "relative", minHeight: "100%" },
  head: {
    position: "sticky",
    top: 0,
    zIndex: 4,
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
    flexShrink: 0,
    width: NAMES,
    backgroundColor: colors.chrome,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
  },
  scale: { position: "relative", flexShrink: 0 },
  // Linear's: each month's name, small and spaced, from its first day.
  month: {
    position: "absolute",
    top: 6,
    paddingLeft: 4,
    overflow: "hidden",
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.06em",
    lineHeight: "14px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: colors.strokeFocused,
  },

  tick: {
    position: "absolute",
    bottom: 6,
    display: "flex",
    justifyContent: "center",
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    lineHeight: "18px",
    whiteSpace: "nowrap",
  },

  // Today, solid, as TeamGantt marks it.
  // Today, its date in a pill (not a color: the ground's opposite).
  tickToday: {
    zIndex: 1,
    padding: "0 6px",
    borderRadius: radii.control,
    color: colors.chrome,
    fontWeight: 600,
    backgroundColor: colors.textPrimary,
  },
  body: { position: "relative", display: "flex" },
  names: {
    position: "sticky",
    left: 0,
    zIndex: 3,
    flexShrink: 0,
    width: NAMES,
    backgroundColor: colors.chrome,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
  },
  // As the app's compact rows: inset, rounded, the usual hover, the chosen one shaded.
  name: {
    position: "absolute",
    left: 8,
    display: "flex",
    alignItems: "center",
    width: NAMES - 17,
    height: ROW - 6,
    marginTop: 3,
    padding: "0 8px",
    borderRadius: radii.row,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    textAlign: "left",
    cursor: "default",
  },

  nameSelected: { backgroundColor: colors.bgTertiary },
  groupName: {
    position: "absolute",
    left: 16,
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: GROUP,
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    fontWeight: 600,
  },
  count: { fontWeight: 400, color: colors.textTertiary },
  days: { position: "relative", flexShrink: 0 },
  monthLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderLeftWidth: 1,
    borderLeftStyle: "dashed",
    borderLeftColor: colors.strokeTertiary,
    pointerEvents: "none",
  },
  todayLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.textTertiary,
    opacity: 0.5,
    pointerEvents: "none",
  },

  links: {
    position: "absolute",
    top: 0,
    left: 0,
    fill: "none",
    stroke: colors.textTertiary,
    strokeWidth: 1.25,
    pointerEvents: "none",
  },
  summary: {
    position: "absolute",
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.bgTertiary,
    pointerEvents: "none",
  },
  // Slim and solid, in its status's tone (lighter, with its resolved share filled, when it has branches).
  bar: {
    position: "absolute",
    zIndex: 1,
    height: BAR,
    overflow: "hidden",
    borderRadius: radii.pill,
    cursor: "pointer",
    filter: { default: "none", ":hover": "brightness(1.08)" },
  },
  // No due date: it runs on, fading, to now.
  barOpenEnded: { maskImage: "linear-gradient(to right, black 60%, transparent)" },
  barSelected: { boxShadow: `0 0 0 2px ${colors.chrome}, 0 0 0 3.5px ${colors.textSecondary}` },
  barDragged: { cursor: "grabbing", boxShadow: "0 3px 10px rgba(0, 0, 0, 0.25)" },
  progress: { position: "absolute", top: 0, bottom: 0, left: 0 },
  ghost: {
    position: "absolute",
    height: BAR,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.strokeFocused,
    borderRadius: radii.pill,
    pointerEvents: "none",
  },
  // A bar's edges, to resize it by: a light grip while it's hovered.
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 1,
    width: 9,
    cursor: "ew-resize",
    "::after": {
      content: '""',
      position: "absolute",
      top: 5,
      bottom: 5,
      width: 2,
      borderRadius: 1,
      backgroundColor: "rgba(255, 255, 255, 0.85)",
      opacity: 0,
    },
  },
  edgeStart: { left: 0, "::after": { left: 3 } },
  edgeEnd: { right: 0, "::after": { right: 3 } },
  edgeShown: { "::after": { opacity: 1 } },
  after: {
    position: "absolute",
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: ROW,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  avatar: { display: "flex", borderRadius: "50%", boxShadow: `0 0 0 1.5px ${colors.chrome}` },
  overdue: { color: colors.urgent, fontSize: fontSizes.small },
  // The days a bar's moved, over it as it's dragged.
  // The days a bar's moved, over it as it's dragged: a small floating panel.
  badge: {
    position: "absolute",
    zIndex: 5,
    padding: "1px 7px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.control,
    color: colors.textPrimary,
    fontSize: fontSizes.small,
    fontWeight: 500,
    whiteSpace: "nowrap",
    backgroundColor: colors.panel,
    boxShadow: colors.shadowFloat,
    transform: "translateX(-50%)",
    pointerEvents: "none",
  },
});
