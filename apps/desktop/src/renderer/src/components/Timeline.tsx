import * as i from "@hugeicons/core-free-icons";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Thread } from "models";
import { display, groupedBy, listed, setDisplay, ZOOMS, type Zoom } from "../mail";
import { edit, lastActive, peek, peeked, setDialog, showMenu, threadMenu } from "../session";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { colors, fontSizes } from "../styles/tokens.stylex";
import { Icon } from "./Icon";
import { MenuChip } from "./Menus";

// The list as a timeline, as Notion draws one: each thread a card from its start to its due date, its title on it (a
// short card's runs on past its end). Without a start a card starts when the thread was created; without a due date it
// runs on to today (or, resolved, to its last activity) and fades out. A card drags along the days (both dates move)
// and either edge resizes it, its dates shown beside it as it goes; a click opens the thread in the floating view. A
// row whose card is out of view has an arrow at the edge that brings it in.

const DAY_MS = 86_400_000;
// A day's width at each scale.
const DAY: Record<Zoom, number> = { weeks: 36, months: 12, quarters: 4 };
// A row, its card, and the days' heading.
const ROW = 36;
const BAR = 32;
const HEAD = 30;
// Where a card's title starts in it, and the gap before what follows it.
const PAD = 8;
const GAP = 8;
// How far the pointer moves before a press on a card is a drag rather than a click.
const SLOP = 3;

const startOfDay = (date: Date | number): number => new Date(date).setHours(0, 0, 0, 0);
const addDays = (time: number, days: number): number => {
  const date = new Date(time);
  date.setDate(date.getDate() + days);
  return date.getTime();
};
// Whole days from one midnight to another (an hour's daylight saving rounded away).
const daysBetween = (from: number, to: number): number => Math.round((to - from) / DAY_MS);

// Where a thread's card runs, in midnights: from its start (or creation) to the end of its due day, or to now.
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
const LONG_MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

// How wide a title is on a card (its font: the name size, semibold), so what follows it can.
const measure = document.createElement("canvas").getContext("2d")!;
const titleWidth = (title: string): number => {
  measure.font = `600 13px ${getComputedStyle(document.body).fontFamily}`;
  return measure.measureText(title).width;
};

// Scrolls the timeline to today (⌘K's "Go to today"); the shown timeline sets it.
let toToday: (() => void) | undefined;
export const showToday = (): void => toToday?.();

// A card being dragged: along the days (both its dates), or by an edge (one of them), and by how many days.
type Drag = { thread: Thread; kind: "move" | "start" | "end"; days: number };

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

  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [hovered, setHovered] = createSignal<Thread | null>(null);
  // Where a card runs as shown: dragged, by whole days (an open-ended one as if due today), never under a day long.
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
  // Its due day (as it's dragged, where it'll land), and whether it's passed with the thread still open.
  const dueDay = (t: Thread): number | undefined =>
    t.dueAt || drag()?.thread === t ? addDays(shown(t).to, -1) : undefined;
  const overdue = (t: Thread): boolean => t.isOpen && (dueDay(t) ?? Infinity) < today();

  // A press on a card (or one of its edges): a drag once the pointer has moved, otherwise a click that opens it.
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
    const card = (): { left: number; width: number; open: boolean } => {
      const { from, to, open: ongoing } = shown(t());
      const left = x(from);
      return { left, width: Math.max(day(), x(to) - left), open: ongoing };
    };
    // Past the card, or past its title when that runs on further.
    const after = (): number =>
      Math.max(card().left + card().width, card().left + PAD + titleWidth(t().title)) + GAP;
    const dragged = (): boolean => drag()?.thread === t();
    const due = (): string | undefined => {
      const d = dueDay(t());
      return d === undefined || !(overdue(t()) || dragged()) ? undefined : SHORT_DATE.format(d);
    };
    // Which way it is when it's out of view.
    const away = (): "before" | "after" | undefined => {
      if (card().left + card().width < scrolled()) return "before";
      if (card().left > scrolled() + shownWidth()) return "after";
      return undefined;
    };
    const selected = (): boolean => {
      const p = peeked();
      return p !== null && "thread" in p && p.thread === t().id;
    };
    const grip = (): boolean => hovered() === t() || dragged();
    return (
      <div class={sx(styles.row)} style={{ width: `${width()}px` }}>
        <div
          class={sx(
            styles.card,
            t().state === "resolved" && styles.cardResolved,
            card().open && styles.cardOpenEnded,
            selected() && styles.cardSelected,
            dragged() && styles.cardDragged,
          )}
          style={{ left: `${card().left}px`, width: `${card().width}px` }}
          onPointerDown={(e) => press(t(), "move", e)}
          onPointerEnter={() => setHovered(t())}
          onPointerLeave={() => hovered() === t() && setHovered(null)}
          onContextMenu={(e) => showMenu(e, threadMenu(t()))}
        >
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
        <span
          class={sx(styles.title, t().state === "resolved" && styles.titleResolved)}
          style={{ left: `${card().left + PAD}px` }}
        >
          {t().title}
        </span>
        {/* As it's dragged, its start before it; its due date after it then, or when it's passed. */}
        <Show when={dragged()}>
          <span
            class={sx(styles.date, styles.dateBefore)}
            style={{ left: `${card().left - GAP}px` }}
          >
            {SHORT_DATE.format(shown(t()).from)}
          </span>
        </Show>
        <Show when={due()}>
          <span
            class={sx(styles.date, overdue(t()) && styles.overdue)}
            style={{ left: `${after()}px` }}
          >
            {due()}
          </span>
        </Show>
        <Show when={away()}>
          {(side) => (
            <button
              class={sx(base.bare, base.hover, styles.away)}
              style={{
                left: `${side() === "before" ? scrolled() + 8 : scrolled() + shownWidth() - 32}px`,
              }}
              aria-label={`Show ${t().title}`}
              onClick={() =>
                scroller.scrollTo({ left: card().left - shownWidth() / 3, behavior: "smooth" })
              }
            >
              <Icon
                icon={side() === "before" ? i.ArrowLeft01Icon : i.ArrowRight01Icon}
                size={14}
                aria-hidden="true"
              />
            </button>
          )}
        </Show>
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
            {/* A new thread, at the foot as Notion's New is. */}
            <div class={sx(styles.newRow)}>
              <button
                class={sx(base.bare, base.hover, styles.new)}
                onClick={() => setDialog({ kind: "newThread" })}
              >
                <Icon icon={i.Add01Icon} size={14} aria-hidden="true" />
                New
              </button>
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
    height: HEAD,
    backgroundColor: colors.chrome,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
  },
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
  rows: { position: "relative", minHeight: `calc(100% - ${HEAD}px)`, paddingTop: 4 },
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
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 28,
    paddingLeft: 16,
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    fontWeight: 600,
  },
  count: { fontWeight: 400, color: colors.textTertiary },
  row: { position: "relative", height: ROW },
  // A card filling its row, a shade off the ground with a hairline edge, as Notion's are.
  card: {
    position: "absolute",
    top: (ROW - BAR) / 2,
    zIndex: 1,
    height: BAR,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.raisedBorder,
    borderRadius: 8,
    backgroundColor: colors.raised,
    cursor: "pointer",
    filter: { default: "none", ":hover": "brightness(1.08)" },
  },
  cardResolved: { opacity: 0.55 },
  // No due date: it runs on, fading, to now.
  cardOpenEnded: {
    borderRightWidth: 0,
    maskImage: "linear-gradient(to right, black 70%, transparent)",
  },
  // Open in the floating view.
  cardSelected: { boxShadow: `0 0 0 2px ${colors.accent}` },
  cardDragged: { cursor: "grabbing", boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)" },
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
  // A card's edges, to resize it by: a grip shown while it's hovered.
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    zIndex: 2,
    width: 10,
    cursor: "ew-resize",
    "::after": {
      content: '""',
      position: "absolute",
      top: 8,
      bottom: 8,
      width: 3,
      borderRadius: 2,
      backgroundColor: colors.textTertiary,
      opacity: 0,
    },
  },
  edgeStart: { left: 0, "::after": { left: 4 } },
  edgeEnd: { right: 0, "::after": { right: 4 } },
  edgeShown: { "::after": { opacity: 0.6 } },
  date: {
    position: "absolute",
    top: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    height: ROW,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  dateBefore: { transform: "translateX(-100%)" },
  overdue: { color: colors.urgent },
  // At the edge of what's shown, for a card that's out of view.
  away: {
    position: "absolute",
    top: (ROW - 24) / 2,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: 6,
    color: colors.textSecondary,
    backgroundColor: colors.raised,
    cursor: "pointer",
  },
  newRow: {
    position: "sticky",
    left: 0,
    display: "flex",
    width: "max-content",
    height: ROW,
    alignItems: "center",
  },
  new: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 26,
    marginLeft: 10,
    padding: "0 8px",
    borderRadius: 6,
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    cursor: "pointer",
  },
});
