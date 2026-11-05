import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { formatRelativeTime } from "../format";
import { plainThreadLinks, type Entry } from "model";
import { useApp } from "../app/state";
import { sx } from "../styles/sx";
import { menu } from "../styles/controls";
import { colors, layers } from "../styles/tokens.stylex";
import { Identicon } from "./Identicon";

const TICK = 6;
const scrollTo = (id: string): void =>
  document.getElementById(`entry-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });

// One tick per entry along the thread's right edge: the one you're reading is lit, hovering previews an entry and
// lengthens the ticks around it, clicking jumps there, and ⌥ + scroll steps from marker to marker.
export function ThreadMinimap(props: {
  entries: Entry[];
  scrollRef: () => HTMLDivElement | undefined;
}): JSX.Element {
  const app = useApp();
  const markers = createMemo(() =>
    props.entries.map((entry) => {
      const person = entry.kind === "event" ? entry.actor : entry.author;
      const text = plainThreadLinks(entry.text, app.links.titleOf, app.links.nameOf);
      return {
        id: entry.id,
        atMs: entry.createdAtMs,
        person,
        label: { message: person.name, event: "Activity", resolution: "Done" }[entry.kind],
        text: entry.kind === "event" ? `${person.name} ${text}` : text,
      };
    }),
  );
  const [visible, setVisible] = createSignal<Set<string>>(new Set());
  const [hovered, setHovered] = createSignal<number | null>(null);
  const active = createMemo(() => markers().findIndex((marker) => visible().has(marker.id)));

  createEffect(
    () => ({ ids: markers().map((marker) => marker.id), root: props.scrollRef() }),
    ({ ids, root }) => {
      if (root === undefined) return;
      const observer = new IntersectionObserver(
        (records) => {
          const next = new Set(visible());
          for (const { target, isIntersecting } of records)
            next[isIntersecting ? "add" : "delete"](target.id.replace(/^entry-/, ""));
          setVisible(next);
        },
        { root },
      );
      for (const id of ids) {
        const element = document.getElementById(`entry-${id}`);
        if (element !== null) observer.observe(element);
      }
      return () => observer.disconnect();
    },
  );

  onSettled(() => {
    const root = props.scrollRef();
    if (root === undefined) return;
    let lastJump = 0;
    const onWheel = (event: WheelEvent): void => {
      if (!event.altKey || event.deltaY === 0) return;
      event.preventDefault();
      // Throttled, so one flick moves one marker.
      if (event.timeStamp - lastJump < 180) return;
      lastJump = event.timeStamp;
      const all = markers();
      const next = Math.max(0, active()) + Math.sign(event.deltaY);
      scrollTo(all[Math.min(all.length - 1, Math.max(0, next))].id);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  });

  const lengthAt = (index: number): number =>
    hovered() === null ? 8 : Math.max(8, 14 - 2 * Math.abs(index - hovered()!));
  const lit = (index: number): boolean => index === active() || index === hovered();

  return (
    <Show when={markers().length >= 2}>
      <nav
        class={sx(styles.minimap, styles.column)}
        aria-label="Thread outline"
        onMouseLeave={() => setHovered(null)}
      >
        <For each={markers()} keyed={(marker) => marker.id}>
          {(marker, index) => (
            <button
              type="button"
              class={sx(styles.tick, styles.bare)}
              aria-label={`${marker().label}: ${marker().text}`}
              onMouseEnter={() => setHovered(index())}
              onClick={() => scrollTo(marker().id)}
            >
              <span
                class={sx(styles.line, styles.grow, lit(index()) && styles.lineLit)}
                style={{ width: `${lengthAt(index())}px` }}
              />
            </button>
          )}
        </For>
        <Show when={hovered() === null ? undefined : markers()[hovered()!]}>
          {(shown) => (
            <div
              class={sx(menu.menu, styles.card, styles.cardOff)}
              style={{ top: `${(hovered() ?? 0) * TICK}px` }}
              role="tooltip"
            >
              <div class={sx(styles.cardText, styles.clamp)}>{shown().text}</div>
              <div class={sx(styles.cardMeta, styles.cardSection, styles.divider)}>
                <span class={sx(styles.cardPerson)}>
                  <Identicon seed={shown().person.id} size={16} />
                  {shown().person.name}
                </span>
                <span class={sx(styles.cardTime)}>
                  {shown().label === shown().person.name ? "" : `${shown().label} · `}
                  {formatRelativeTime(shown().atMs, app.now())}
                </span>
              </div>
              <div class={sx(styles.cardSection, styles.divider, styles.cardTime)}>
                ⌥ + scroll by marker
              </div>
            </div>
          )}
        </Show>
      </nav>
    </Show>
  );
}

const styles = stylex.create({
  minimap: {
    position: "absolute",
    top: "50%",
    right: 14,
    zIndex: layers.float,
    transform: "translateY(-50%)",
  },
  column: { display: "flex", flexDirection: "column", alignItems: "flex-end" },
  tick: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    width: 32,
    height: TICK,
  },
  bare: { padding: 0, borderStyle: "none", backgroundColor: "transparent", cursor: "pointer" },
  line: { height: 1.5, borderRadius: 1, backgroundColor: colors.iconTertiary, opacity: 0.45 },
  grow: {
    transitionProperty: "width",
    transitionDuration: "120ms",
    transitionTimingFunction: "ease-out",
  },
  lineLit: { backgroundColor: colors.textPrimary, opacity: 1 },
  // On the menu panel.
  card: {
    position: "absolute",
    right: 38,
    width: 300,
    padding: "8px 10px",
    transform: "translateY(-16px)",
  },
  cardOff: { pointerEvents: "none" },
  cardText: { display: "-webkit-box", overflow: "hidden", color: colors.textPrimary, fontSize: 13 },
  clamp: { lineHeight: "19px", WebkitLineClamp: 5, WebkitBoxOrient: "vertical" },
  cardSection: { marginTop: 8, paddingTop: 8, color: colors.textSecondary, fontSize: 12 },
  divider: { borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: colors.panelDivider },
  cardMeta: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  cardPerson: { display: "inline-flex", alignItems: "center", gap: 6, color: colors.textPrimary },
  cardTime: { color: colors.textTertiary },
});
