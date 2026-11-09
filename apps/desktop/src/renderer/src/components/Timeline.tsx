import * as i from "@hugeicons/core-free-icons";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Thread } from "models";
import { progressOf } from "../links";
import { display, groupedBy, listed, setDisplay, ZOOMS, type Group, type Zoom } from "../mail";
import { edit, peek, peeked, save, saved, shortDate, showMenu, threadMenu } from "../session";
import { base } from "../styles/base";
import { toolbarMarker } from "../styles/markers.stylex";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";
import { MenuChip } from "./Menus";
import { Tabs, type Tab } from "./Tabs";
import { dot } from "./ThreadView";
import { dueOn, whenFields, type When } from "../when";
import { pickDate } from "./DatePicker";

// The list as a timeline, after TeamGantt: the threads named down the left, and beside each its bar, a slim card with
// its status's dot, from its start to its due date, its owner just past its end. A thread with branches fills its
// bar as far as they're resolved. A thread that blocks another is joined to it by an elbow. A group's row has a
// summary bar over all of its threads. Bars drag along the days (both dates move) and resize by either edge, a dashed
// outline left where they were and the days moved shown over them; a click opens the thread in the floating view.
// Without a start a bar starts when the thread was created; with a start alone it is a day long. Threads without
// either are listed under the timeline, each given a start or due date from its row.

const DAY_MS = 86_400_000;
// A day's width at each scale.
const DAY: Record<Zoom, number> = { weeks: 34, months: 12, quarters: 4 };
// The names' column (as wide as it was left, within these), a row, a bar, a group's row, and the heading.
// The names' column and its rows as the sidebar's (its points ÷ 1.1, for the 110% scale): 220px wide (180 to 320), rows
// 30pt tall 2pt apart, inset and padded 8pt, rounded 8pt, names at 13pt.
// The names column: fitted to its titles up to `fit` (longer ones end in an ellipsis), dragged anywhere from `min` to
// `max`.
const NAMES = { min: 120, fit: 260, max: 420 };
const ROW = 29.09;
const INSET = 7.27;
const BAR = 22;
const GROUP = 33.1;
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

// Only threads with a date are on the timeline; the rest are listed under it.
const dated = (thread: Thread): boolean =>
  thread.dueAt !== undefined || thread.startAt !== undefined;
// Where a thread's bar runs, in midnights, from only what was set: a start and a due date are a bar between them; a due date alone is a deadline, one day on its day
// (dragging its left edge out gives it a start).
function span(thread: Thread): { from: number; to: number } {
  const from = startOfDay(thread.startAt ?? thread.dueAt ?? thread.createdAt);
  const to = thread.dueAt ? addDays(startOfDay(thread.dueAt), 1) : addDays(from, 1);
  return { from: Math.min(from, to - DAY_MS), to: Math.max(to, from + DAY_MS) };
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: "long" });

// Scrolls the timeline to today (⌘K's "Go to today"); the shown timeline sets it.
let toToday: (() => void) | undefined;
export const showToday = (): void => toToday?.();

// A bar being dragged: along the days (both its dates), or by an edge (one of them), and by how many days.
type Drag = { thread: Thread; kind: "move" | "start" | "end"; days: number };
// The rows, in order, each where it sits: a group's heading, or a thread.
type Line = { y: number } & ({ group: Group } | { thread: Thread });

// `start` and `end`: what the list puts on the timeline's toolbar (its filters after the month, New at the end).
export function Timeline(props: { start?: JSX.Element; end?: JSX.Element }): JSX.Element {
  // The names' width: as wide as the longest title (up to a limit), or as dragged by the edge on its right (a
  // double click puts it back to fitting).
  const clamp = (px: number): number => Math.min(NAMES.max, Math.max(NAMES.min, Math.round(px)));
  const [dragged, setDragged] = createSignal<number | null>(
    saved<number | null>("timeline-names", null),
  );
  const fitted = (): number =>
    Math.min(
      NAMES.fit,
      clamp(Math.max(0, ...threads().map((t) => textWidth(t.title))) + 4 * INSET + 2),
    );
  const names = (): number => clamp(dragged() ?? fitted());
  const setNames = (px: number): void => void setDragged(clamp(px));
  const resizeNames = (event: PointerEvent): void => {
    const edge = event.currentTarget as HTMLElement;
    edge.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const from = names();
    const move = (e: PointerEvent): void => setNames(from + e.clientX - start);
    edge.addEventListener("pointermove", move);
    const done = (): void => {
      edge.removeEventListener("pointermove", move);
      edge.removeEventListener("pointerup", done);
      edge.removeEventListener("pointercancel", done);
      save("timeline-names", names());
    };
    edge.addEventListener("pointerup", done);
    edge.addEventListener("pointercancel", done);
  };
  const zoom = (): Zoom => display().zoom ?? "weeks";
  const day = (): number => DAY[zoom()];
  const today = (): number => startOfDay(Date.now());
  const threads = (): Thread[] => [...new Set(listed().order)].filter(dated);
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
    for (const all of listed().groups) {
      const group = { ...all, threads: all.threads.filter(dated) };
      if (group.threads.length === 0) continue;
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
  // Those without a date: in a list from the toolbar, to be dragged onto a day or given one from their menu.
  const undated = (): Thread[] => [...new Set(listed().order)].filter((t) => !dated(t));
  const place = (thread: Thread, when: When, label: string): void =>
    edit(thread, whenFields(when), label);
  // The timeline, or those without dates: tabs on its toolbar, the one chosen kept.
  const tabs: Tab[] = [
    { label: "Scheduled", icon: i.Calendar03Icon },
    { label: "Unscheduled", icon: i.InboxIcon, count: () => undated().length },
  ];
  const [tab, setTab] = createSignal(saved<string>("timeline-tab", "Scheduled"));
  const unscheduled = (): boolean => tab() === "Unscheduled";
  // Room under the last row for the layout pill over the foot.
  const height = (): number => (lines().at(-1)?.y ?? 0) + ROW + 56;

  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [hovered, setHovered] = createSignal<Thread | null>(null);
  // Where a bar runs as shown: dragged, by whole days, never under a day long.
  const shown = (t: Thread): { from: number; to: number } => {
    const { from, to } = span(t);
    const d = drag();
    if (d?.thread !== t || d.days === 0) return { from, to };
    if (d.kind === "move") return { from: addDays(from, d.days), to: addDays(to, d.days) };
    if (d.kind === "start") return { from: Math.min(addDays(from, d.days), to - DAY_MS), to };
    return { from, to: Math.max(addDays(to, d.days), from + DAY_MS) };
  };
  const bar = (t: Thread): { left: number; width: number } => {
    const { from, to } = shown(t);
    const left = x(from);
    return { left, width: Math.max(day(), x(to) - left) };
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
    // A control-click is the Mac's right click: the menu, not a drag or Peek.
    if (event.button !== 0 || event.ctrlKey) return;
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
    // Let go, or the press taken away (the window losing it): either way it's over, cancelled without a drop.
    const cancel = (): void => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      setDrag(null);
    };
    const up = (): void => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointercancel", cancel);
      const d = drag();
      if (!dragged || !d) {
        setDrag(null);
        if (kind === "move") peek({ thread: thread.id });
        return;
      }
      const { from, to } = shown(thread);
      setDrag(null);
      if (d.days === 0) return;
      const due = dueOn(addDays(to, -1));
      // A deadline moved stays a deadline, a start alone stays a start; a span moves both ends.
      if (d.kind === "move")
        edit(
          thread,
          !thread.dueAt
            ? { startAt: new Date(from) }
            : thread.startAt
              ? { startAt: new Date(from), dueAt: due }
              : { dueAt: due },
          "Change Dates",
        );
      else if (d.kind === "start") edit(thread, { startAt: new Date(from) }, "Change Dates");
      else edit(thread, { dueAt: due }, "Change Dates");
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up, { once: true });
    target.addEventListener("pointercancel", cancel, { once: true });
  };

  let scroller!: HTMLDivElement;
  // The range starting earlier (a bar dropped before it) moves every day right: scroll with it, so nothing jumps.
  let shownFrom: number | undefined;
  createEffect(
    () => range().from,
    (from) => {
      if (shownFrom !== undefined && from !== shownFrom && scroller)
        scroller.scrollLeft += Math.round((shownFrom - from) / DAY_MS) * day();
      shownFrom = from;
    },
  );
  const scrollToToday = (): void => {
    scroller.scrollTo({ left: Math.max(0, x(today()) - (scroller.clientWidth - names()) / 3) });
  };
  // Today a third of the way in, at first, whenever it's resized (a thread opened beside it), and at a new scale.
  createEffect(day, () => void requestAnimationFrame(scrollToToday));
  onSettled(() => {
    const resized = new ResizeObserver(() => {
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
    const b = (): { left: number; width: number } => bar(t());
    const dragging = (): Drag | undefined => {
      const d = drag();
      return d?.thread === t() ? d : undefined;
    };
    const progress = (): number | undefined => {
      const p = progressOf(t());
      return p && p.done / p.total;
    };
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
            selected(t()) && styles.barSelected,
            dragging() && styles.barDragged,
          )}
          style={{
            top: `${props.y + (ROW - BAR) / 2}px`,
            left: `${b().left}px`,
            width: `${b().width}px`,
          }}
          title={t().title}
          onPointerDown={(e) => press(t(), "move", e)}
          onPointerEnter={() => setHovered(t())}
          onPointerLeave={() => hovered() === t() && setHovered(null)}
          onContextMenu={(e) => showMenu(e, threadMenu(t()))}
        >
          {/* As far as its branches are resolved; its status, as the app's dots show it. */}
          <Show when={progress()}>
            {(done) => <span class={sx(styles.progress)} style={{ width: `${done() * 100}%` }} />}
          </Show>
          <span class={sx(styles.status)}>{dot(t().state)}</span>
          <span
            class={sx(styles.edge, styles.edgeStart, grip() && styles.edgeShown)}
            aria-label="Change the Start Date"
            onPointerDown={(e) => press(t(), "start", e)}
          />
          <span
            class={sx(styles.edge, styles.edgeEnd, grip() && styles.edgeShown)}
            aria-label="Change the Due Date"
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
            <span class={sx(styles.overdue)}>{shortDate(new Date(dueDay(t())!))}</span>
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
      {/* The month in view and the list's filters; its scale, today and a step either way; then New. */}
      <div {...stylex.attrs(styles.toolbar, toolbarMarker)}>
        <Tabs
          label="Timeline or Unscheduled"
          tabs={tabs}
          chosen={tabs.find((t) => t.label === tab()) ?? tabs[0]}
          onChoose={(t) => {
            setTab(t.label);
            save("timeline-tab", t.label);
          }}
        />
        {props.start}
        <span class={sx(styles.toolbarSpacer)} />
        <Show when={!unscheduled()}>
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
          {/* Back, today and on: one control, bordered as the chips beside it. */}
          <span class={sx(styles.stepper)}>
            <button
              class={sx(base.bare, base.hover, styles.step)}
              aria-label="Back"
              onClick={() => step(-1)}
            >
              <Icon icon={i.ArrowLeft01Icon} size={13} aria-hidden="true" />
            </button>
            <button class={sx(base.bare, base.hover, styles.stepToday)} onClick={scrollToToday}>
              Today
            </button>
            <button
              class={sx(base.bare, base.hover, styles.step)}
              aria-label="On"
              onClick={() => step(1)}
            >
              <Icon icon={i.ArrowRight01Icon} size={13} aria-hidden="true" />
            </button>
          </span>
        </Show>
        {props.end}
      </div>
      <div ref={scroller} class={sx(styles.timeline, unscheduled() && styles.away)}>
        <div class={sx(styles.content)} style={{ width: `${names() + width()}px` }}>
          {/* Months over days, stuck at the top. */}
          <div class={sx(styles.head)}>
            <div class={sx(styles.corner)} style={{ width: `${names()}px` }} />
            <div class={sx(styles.scale)} style={{ width: `${width()}px` }}>
              <For each={months()}>
                {(month, at) => (
                  <span
                    class={sx(styles.month)}
                    style={{ left: `${x(month.at)}px`, width: `${month.width}px` }}
                  >
                    {new Date(month.at).getMonth() === 0 || at() === 0
                      ? `${MONTH.format(month.at)} ${new Date(month.at).getFullYear()}`
                      : MONTH.format(month.at)}
                  </span>
                )}
              </For>
              <For each={ticks()}>
                {(tick) => (
                  <span
                    class={sx(styles.tick)}
                    // Centred on the line where its day begins, which is where bars starting that day start.
                    style={{ left: `${x(tick.at) - tick.width / 2}px`, width: `${tick.width}px` }}
                  >
                    <span class={sx(tick.at === today() && styles.tickToday)}>
                      {tick.at === today()
                        ? shortDate(new Date(tick.at))
                        : new Date(tick.at).getDate()}
                    </span>
                  </span>
                )}
              </For>
            </div>
          </div>
          <div class={sx(styles.body)}>
            {/* The names, stuck at the left as the days scroll under them. */}
            <div
              class={sx(styles.names)}
              style={{ width: `${names()}px`, height: `${height()}px` }}
            >
              <hr
                class={sx(styles.resize)}
                aria-label="Resize the Names"
                aria-orientation="vertical"
                onPointerDown={resizeNames}
                onDblClick={() => {
                  setDragged(null);
                  save("timeline-names", null);
                }}
              />
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
                        styles.name,
                        selected(line.thread) && styles.nameSelected,
                      )}
                      style={{ top: `${line.y}px`, width: `${names() - 2 * INSET - 1}px` }}
                      title={line.thread.title}
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
                style={{ left: `${x(today())}px` }}
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
      {/* Those without dates: each opens as it's clicked, and its Schedule gives it a day (it moves to the
          timeline). */}
      <Show when={unscheduled()}>
        <div class={sx(styles.backlog)}>
          <For
            each={undated()}
            fallback={<p class={sx(styles.backlogEmpty)}>Everything here has a date.</p>}
          >
            {(thread) => (
              <div class={sx(styles.backlogRow)}>
                <button
                  class={sx(base.bare, styles.backlogTitle)}
                  onClick={() => peek({ thread: thread.id })}
                  onContextMenu={(e) => showMenu(e, threadMenu(thread))}
                >
                  <Show when={thread.owner}>
                    {(owner) => <Identicon seed={owner().id} size={16} />}
                  </Show>
                  <span class={sx(base.ellipsis)}>{thread.title}</span>
                </button>
                <DateField onDate={(when) => place(thread, when, "Schedule")} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// A date for a thread without one: picked on the calendar under the button (it moves to the timeline).
function DateField(props: { onDate: (when: When) => void }): JSX.Element {
  return (
    <button
      class={sx(base.bare, base.hover, styles.dateButton)}
      onClick={(event) =>
        pickDate({ at: event.currentTarget, pick: (when) => when && props.onDate(when) })
      }
    >
      <Icon icon={i.Calendar03Icon} size={12} aria-hidden="true" />
      Add a Date
    </button>
  );
}

// How wide a title is as the names show it (11.82px, the app's font).
let measure: CanvasRenderingContext2D | null = null;
function textWidth(text: string): number {
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return 0;
  measure.font = `11.82px ${getComputedStyle(document.body).fontFamily}`;
  return Math.ceil(measure.measureText(text).width);
}

const styles = stylex.create({
  frame: { display: "flex", flex: 1, flexDirection: "column", minHeight: 0 },
  // The grid while the unscheduled tab's shown: kept, out of sight.
  away: { display: "none" },
  // Those without dates, as the sidebar's rows: 30pt, 8pt in, 13pt names.
  backlog: { flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 7.27px 56px" },
  backlogRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    height: 29.09,
    padding: "0 7.27px",
  },
  backlogTitle: {
    display: "flex",
    flex: 1,
    gap: 8,
    alignItems: "center",
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    textAlign: "left",
    cursor: "pointer",
  },
  // A field as plain as the text by it: its words quiet until something's typed, what that means just after.
  dateButton: {
    display: "flex",
    flexShrink: 0,
    gap: 6,
    alignItems: "center",
    height: 22,
    padding: "0 7.27px",
    borderRadius: radii.control,
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    cursor: "pointer",
  },
  backlogEmpty: { padding: "24px 7.27px", color: colors.textTertiary },
  toolbar: {
    display: "flex",
    flexShrink: 0,
    gap: 6,
    alignItems: "center",
    // Its first line as far below the top bar as every page's (17pt).
    height: 46.91,
    padding: "2.31px 12px 0",
  },
  toolbarSpacer: { flex: 1 },
  stepper: {
    display: "inline-flex",
    alignItems: "center",
    height: 24,
    padding: 1,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.control,
  },
  step: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: 4,
    color: colors.textSecondary,
    cursor: "pointer",
  },
  stepToday: {
    height: 20,
    padding: "0 5px",
    borderRadius: 4,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
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
    // The line under the days, the whole width.
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
  },
  // Over the names, holding their room in the header: clear, so the days run on across the top behind it.
  corner: { flexShrink: 0 },
  scale: { position: "relative", flexShrink: 0 },
  // Each month's name over its first day: plain, quiet, starting where that day's number does.
  month: {
    position: "absolute",
    top: 6,
    marginLeft: -3,
    overflow: "hidden",
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    fontWeight: 500,
    lineHeight: "14px",
    whiteSpace: "nowrap",
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

  // Today: its date, darker and bold.
  tickToday: { color: colors.textPrimary, fontWeight: 600 },

  body: { position: "relative", display: "flex" },
  // The names' resize edge: invisible, only its cursor says it's there (the column's border is the line).
  resize: {
    position: "absolute",
    top: 0,
    right: -3,
    bottom: 0,
    zIndex: 1,
    width: 6,
    margin: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    cursor: "col-resize",
  },
  names: {
    position: "sticky",
    left: 0,
    zIndex: 3,
    flexShrink: 0,
    backgroundColor: colors.chrome,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
  },
  // As the sidebar's rows: inset, rounded, the chosen one shaded, nothing under the pointer.
  name: {
    position: "absolute",
    left: INSET,
    display: "flex",
    alignItems: "center",
    height: 27.27,
    marginTop: 0.91,
    padding: `0 ${INSET}px`,
    borderRadius: 7.27,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    textAlign: "left",
    cursor: "default",
  },

  nameSelected: { backgroundColor: colors.bgTertiary },
  // As the sidebar's headings: 12pt medium, quiet, just over their rows.
  groupName: {
    position: "absolute",
    left: 2 * INSET,
    right: INSET,
    overflow: "hidden",
    whiteSpace: "nowrap",
    display: "flex",
    gap: 6,
    alignItems: "flex-end",
    height: GROUP,
    paddingBottom: 3.64,
    color: colors.textTertiary,
    fontSize: fontSizes.caption,
    fontWeight: 500,
  },
  count: { fontWeight: 400, color: colors.textTertiary },
  // Its own stacking: what's drawn in it (a drag's badge) stays under the stuck names and header.
  days: { position: "relative", zIndex: 0, flexShrink: 0 },
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
  // A card, as the app's raised surfaces are: a hairline edge, the controls' radius, its status's dot at its start.
  bar: {
    position: "absolute",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    height: BAR,
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.raisedBorder,
    borderRadius: radii.control,
    backgroundColor: colors.raised,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
    cursor: "pointer",
    filter: { default: "none", ":hover": "brightness(0.98)" },
  },
  status: { position: "relative", display: "flex", marginLeft: 6 },

  barSelected: {
    boxShadow: `0 0 0 2px ${colors.chrome}, 0 0 0 3.5px ${colors.textSecondary}, 0 1px 2px rgba(0, 0, 0, 0.08)`,
  },
  barDragged: { cursor: "grabbing", boxShadow: "0 3px 10px rgba(0, 0, 0, 0.25)" },
  progress: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.bgTertiary,
  },
  ghost: {
    position: "absolute",
    height: BAR,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.strokeFocused,
    borderRadius: radii.control,
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
      backgroundColor: colors.textTertiary,
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
