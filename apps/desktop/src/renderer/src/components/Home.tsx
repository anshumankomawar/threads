import * as i from "@hugeicons/core-free-icons";
import { For } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Message, Thread } from "models";
import { keysFor } from "../hotkeys";
import { firstName, inbox, me, open, sent, setDialog, shortDate, store } from "../session";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { icon, type IconSvgElement } from "./Icon";
import { ago, dot } from "./ThreadView";

// Home: the reading pane with nothing open, on the scene (Scene.tsx). A greeting, a way to start a thread, and cards
// of what's yours right now: what needs you, what you're waiting on, what's due soon, and how busy the workspace has
// been. Cards are glass over the picture, as Devin's dashboard is.

const DAY = 86_400_000;
const WEEKS = 16;

const s = stylex.create({
  home: {
    position: "relative",
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: 14,
    width: "100%",
    maxWidth: 760,
    minHeight: 0,
    margin: "0 auto",
    padding: "56px 28px 40px",
    overflowY: "auto",
  },
  // Over the picture itself, so a soft dark shadow keeps them legible on its brightest dots.
  greeting: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: 600,
    textShadow: "0 0 6px rgb(0 0 0 / 85%), 0 0 20px rgb(0 0 0 / 70%)",
  },
  date: {
    marginTop: -8,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    textShadow: "0 0 6px rgb(0 0 0 / 90%), 0 0 16px rgb(0 0 0 / 70%)",
  },
  glass: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "rgb(255 255 255 / 8%)",
    borderRadius: radii.panel,
    backgroundColor: `color-mix(in srgb, ${colors.chrome} 58%, transparent)`,
    backdropFilter: "blur(22px) saturate(1.3)",
  },
  start: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    height: 52,
    marginTop: 8,
    padding: "0 16px",
    color: colors.textTertiary,
    fontSize: fontSizes.input,
    textAlign: "left",
    cursor: "text",
  },
  startText: { flex: 1 },
  keys: { color: colors.textTertiary, fontSize: fontSizes.small },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 },
  card: { display: "flex", flexDirection: "column", gap: 2, padding: "12px 8px 8px" },
  cardHead: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    padding: "0 8px 6px",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
  },
  count: { marginLeft: "auto", color: colors.textPrimary, fontSize: 18, fontWeight: 600 },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    height: 26,
    padding: "0 8px",
    borderRadius: radii.row,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    textAlign: "left",
    cursor: "pointer",
  },
  rowTitle: { flex: 1 },
  rowMeta: { flexShrink: 0, color: colors.textTertiary, fontSize: fontSizes.small },
  late: { color: colors.urgent },
  empty: { padding: "2px 8px 6px", color: colors.textTertiary, fontSize: fontSizes.body },
  // Activity: a week a column, a day a row, as a contributions graph is.
  activity: { display: "flex", flexDirection: "column", gap: 10, padding: "12px 16px 14px" },
  cells: {
    display: "grid",
    gridAutoFlow: "column",
    gridTemplateRows: "repeat(7, 11px)",
    gridAutoColumns: "11px",
    gap: 3,
  },
  cell: { borderRadius: 3, backgroundColor: "rgb(255 255 255 / 6%)" },
  caption: { color: colors.textTertiary, fontSize: fontSizes.small },
});

// Up to four threads, each opening on a click, with something about it on the right.
function Card(props: {
  title: string;
  icon: IconSvgElement;
  threads: Thread[];
  meta: (t: Thread) => string;
  // Whether what's on the right is a warning (a date gone by).
  late?: (t: Thread) => boolean;
  empty: string;
}): JSX.Element {
  return (
    <section class={sx(s.glass, s.card)}>
      <div class={sx(s.cardHead)}>
        {icon(props.icon, 13)}
        <span>{props.title}</span>
        <span class={sx(s.count)}>{props.threads.length}</span>
      </div>
      <For
        each={props.threads.slice(0, 4)}
        fallback={<span class={sx(s.empty)}>{props.empty}</span>}
      >
        {(t) => (
          <button class={sx(base.bare, base.hover, s.row)} onClick={() => open({ thread: t.id })}>
            {dot(t.state)}
            <span class={sx(base.ellipsis, s.rowTitle)}>{t.title}</span>
            <span class={sx(s.rowMeta, props.late?.(t) && s.late)}>{props.meta(t)}</span>
          </button>
        )}
      </For>
    </section>
  );
}

// Messages a day across the workspace, the last WEEKS weeks, ending today.
function Activity(): JSX.Element {
  const days = (): number[] => {
    const today = new Date().setHours(0, 0, 0, 0);
    const start = today - (WEEKS * 7 - 1) * DAY - new Date(today).getDay() * DAY;
    const counts = Array.from({ length: Math.round((today - start) / DAY) + 1 }, () => 0);
    for (const m of store.all(Message)) {
      const at = Math.floor((new Date(m.createdAt).setHours(0, 0, 0, 0) - start) / DAY);
      if (at >= 0 && at < counts.length) counts[at]++;
    }
    return counts;
  };
  const total = (): number => days().reduce((sum, n) => sum + n, 0);
  const shade = (n: number): string =>
    n === 0
      ? ""
      : `color-mix(in srgb, ${colors.accent} ${n >= 6 ? 95 : n >= 3 ? 70 : 42}%, transparent)`;
  return (
    <section class={sx(s.glass, s.activity)}>
      <div class={sx(s.cardHead)}>
        {icon(i.Calendar03Icon, 13)}
        <span>Activity</span>
      </div>
      <div class={sx(s.cells)} role="img" aria-label={`${total()} messages in ${WEEKS} weeks`}>
        <For each={days()}>
          {(n) => <span class={sx(s.cell)} style={{ "background-color": shade(n) || undefined }} />}
        </For>
      </div>
      <span class={sx(s.caption)}>
        {total()} messages in the last {WEEKS} weeks
      </span>
    </section>
  );
}

const greeting = (): string => {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
};

export function Home(): JSX.Element {
  const mine = (t: Thread): boolean => t.ownerId === me().id || t.assigneeIds.includes(me().id);
  const dueSoon = (): Thread[] =>
    store
      .all(Thread)
      .filter((t) => t.isOpen && t.dueAt && mine(t) && t.dueAt.getTime() < Date.now() + 7 * DAY)
      .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());
  const lastAt = (t: Thread): Date =>
    t.messages.sorted("createdAt").at(-1)?.createdAt ?? t.createdAt;
  return (
    <div class={sx(s.home)}>
      <h1 class={sx(s.greeting)}>
        {greeting()}, {firstName(me())}
      </h1>
      <span class={sx(s.date)}>
        {new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </span>
      <button
        class={sx(base.bare, s.glass, s.start)}
        onClick={() => setDialog({ kind: "compose" })}
      >
        {icon(i.PencilEdit02Icon, 15)}
        <span class={sx(s.startText)}>Start a thread, and @mention who it's for</span>
        <span class={sx(s.keys)}>{keysFor("compose")}</span>
      </button>
      <div class={sx(s.grid)}>
        <Card
          title="Needs you"
          icon={i.InboxIcon}
          threads={inbox().order}
          meta={(t) => ago(lastAt(t))}
          empty="Nothing waiting on you."
        />
        <Card
          title="Waiting on others"
          icon={i.SentIcon}
          threads={sent()}
          meta={(t) => ago(lastAt(t))}
          empty="You're not waiting on anyone."
        />
        <Card
          title="Due this week"
          icon={i.Calendar01Icon}
          threads={dueSoon()}
          meta={(t) => shortDate(t.dueAt!)}
          late={(t) => t.dueAt!.getTime() < Date.now()}
          empty="Nothing due this week."
        />
        <Activity />
      </div>
    </div>
  );
}
