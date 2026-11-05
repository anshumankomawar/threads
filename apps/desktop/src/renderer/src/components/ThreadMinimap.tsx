import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { formatRelativeTime } from "../format";
import { plainThreadLinks, type Entry, type Person } from "model";
import { useApp } from "../app/state";
import { sx } from "../styles/sx";
import { colors, layers, radii, shadows } from "../styles/tokens.stylex";
import { Identicon } from "./Identicon";

const TICK_SPACING = 6;
// Every tick rests at the same length, whatever kind of entry it marks. While hovering, the tick under the cursor is
// longest and its neighbors taper back to rest; at rest the entry you're reading is marked by color alone.
const RESTING_LENGTH = 8;
const PEAK_LENGTH = 14;
const TAPER_PER_TICK = 2;
// Gap between ⌥ + scroll jumps, so one flick moves one marker.
const JUMP_THROTTLE_MS = 180;

// One tick per entry, right-aligned and centered on the thread.
const styles = stylex.create({
  // .minimap
  minimap: {
    position: "absolute",
    top: "50%",
    right: "14px",
    zIndex: layers.float,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    transform: "translateY(-50%)",
  },
  // .minimap-tick
  tick: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    width: "32px",
    // TICK_SPACING.
    height: "6px",
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  // .minimap-tick::after — the tick's line, its length set inline.
  line: {
    height: "1.5px",
    borderRadius: "1px",
    backgroundColor: colors.iconTertiary,
    opacity: 0.45,
    transitionProperty: "width",
    transitionDuration: "120ms",
    transitionTimingFunction: "ease-out",
  },
  // .minimap-tick[data-active="true"]::after, .minimap-tick[data-hovered="true"]::after
  lineLit: {
    backgroundColor: colors.textPrimary,
    opacity: 1,
  },
  // .minimap-card — hover card: the entry's text, who and when, then the shortcuts. Its top is set inline.
  card: {
    position: "absolute",
    right: "38px",
    width: "300px",
    padding: "8px 10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    backgroundColor: colors.panel,
    boxShadow: shadows.panel,
    transform: "translateY(-16px)",
    pointerEvents: "none",
  },
  // .minimap-card-text
  cardText: {
    display: "-webkit-box",
    overflow: "hidden",
    color: colors.textPrimary,
    fontSize: "13px",
    lineHeight: "19px",
    WebkitLineClamp: 5,
    WebkitBoxOrient: "vertical",
  },
  // .minimap-card-meta
  cardMeta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    marginTop: "8px",
    paddingTop: "8px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.panelDivider,
    color: colors.textSecondary,
    fontSize: "12px",
  },
  // .minimap-card-person
  cardPerson: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    color: colors.textPrimary,
  },
  // .minimap-card-time
  cardTime: {
    color: colors.textTertiary,
  },
  // .minimap-card-hints
  cardHints: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    marginTop: "8px",
    paddingTop: "8px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.panelDivider,
    color: colors.textTertiary,
    fontSize: "12px",
  },
});

type Marker = {
  id: string;
  label: string;
  text: string;
  person: Person | null;
  atMs: number;
};

// Thread links in a message read as `#<title>` here.
function toMarker(
  entry: Entry,
  titleOf: (threadId: string) => string | undefined,
  nameOf: (personId: string) => string | undefined,
): Marker {
  const base = { id: entry.id, atMs: entry.createdAtMs };
  switch (entry.kind) {
    case "message":
      return {
        ...base,
        label: entry.author.name,
        text: plainThreadLinks(entry.text, titleOf, nameOf),
        person: entry.author,
      };
    case "event":
      return {
        ...base,
        label: "Activity",
        text: `${entry.actor.name} ${plainThreadLinks(entry.text, titleOf, nameOf)}`,
        person: entry.actor,
      };
    case "resolution":
      return {
        ...base,
        label: "Done",
        text: plainThreadLinks(entry.text, titleOf, nameOf),
        person: entry.author,
      };
  }
}

function elementFor(id: string): HTMLElement | null {
  return document.getElementById(`entry-${id}`);
}

// A strip of ticks along the thread's right edge, one per entry, for seeing its shape and jumping around.
// The entry you're reading is raised and bright. Hovering a tick previews the entry; clicking scrolls to it, and
// ⌥ + scroll steps from marker to marker.
export function ThreadMinimap(props: {
  entries: Entry[];
  // The thread's scrolling element, once it's there.
  scrollRef: () => HTMLDivElement | undefined;
}): JSX.Element {
  const app = useApp();
  const links = app.links;
  const markers = createMemo(() =>
    props.entries.map((entry) => toMarker(entry, links.titleOf, links.nameOf)),
  );
  const [visible, setVisible] = createSignal<Set<string>>(new Set());
  const [hovered, setHovered] = createSignal<number | null>(null);

  const ids = createMemo(() =>
    markers()
      .map((marker) => marker.id)
      .join(","),
  );

  // Track which entries are on screen.
  createEffect(
    () => ({ ids: ids(), root: props.scrollRef() }),
    ({ ids: shown, root }) => {
      if (root === undefined) return;
      const observer = new IntersectionObserver(
        (records) =>
          setVisible((current) => {
            const next = new Set(current);
            for (const record of records) {
              const id = record.target.id.replace(/^entry-/, "");
              if (record.isIntersecting) next.add(id);
              else next.delete(id);
            }
            return next;
          }),
        { root },
      );
      for (const id of shown.split(",")) {
        const element = elementFor(id);
        if (element !== null) observer.observe(element);
      }
      return () => observer.disconnect();
    },
  );

  // ⌥ + scroll jumps to the next or previous marker instead of scrolling freely.
  onSettled(() => {
    const root = props.scrollRef();
    if (root === undefined) return;
    let lastJump = 0;
    const onWheel = (event: WheelEvent): void => {
      if (!event.altKey || event.deltaY === 0) return;
      event.preventDefault();
      if (event.timeStamp - lastJump < JUMP_THROTTLE_MS) return;
      lastJump = event.timeStamp;
      const all = markers();
      const current = all.findIndex((marker) => visible().has(marker.id));
      const index = Math.min(
        all.length - 1,
        Math.max(0, (current === -1 ? 0 : current) + Math.sign(event.deltaY)),
      );
      elementFor(all[index].id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  });

  const card = (): Marker | undefined => {
    const index = hovered();
    return index === null ? undefined : markers()[index];
  };
  const active = createMemo(() => markers().findIndex((marker) => visible().has(marker.id)));
  const lengthAt = (index: number): number => {
    const focus = hovered();
    return focus === null
      ? RESTING_LENGTH
      : Math.max(RESTING_LENGTH, PEAK_LENGTH - TAPER_PER_TICK * Math.abs(index - focus));
  };

  return (
    <Show when={markers().length >= 2}>
      <nav
        class={sx(styles.minimap)}
        aria-label="Thread outline"
        onMouseLeave={() => setHovered(null)}
      >
        <For each={markers()} keyed={(marker) => marker.id}>
          {(marker, index) => (
            <button
              type="button"
              class={sx(styles.tick)}
              aria-label={`${marker().label}: ${marker().text}`}
              onMouseEnter={() => setHovered(index())}
              onClick={() =>
                elementFor(marker().id)?.scrollIntoView({ block: "start", behavior: "smooth" })
              }
            >
              <span
                class={sx(
                  styles.line,
                  (index() === active() || hovered() === index()) && styles.lineLit,
                )}
                style={{ width: `${lengthAt(index())}px` }}
              />
            </button>
          )}
        </For>
        <Show when={card()}>
          {(shown) => (
            <div
              class={sx(styles.card)}
              style={{ top: `${(hovered() ?? 0) * TICK_SPACING}px` }}
              role="tooltip"
            >
              <div class={sx(styles.cardText)}>{shown().text}</div>
              <div class={sx(styles.cardMeta)}>
                <Show when={shown().person}>
                  {(person) => (
                    <span class={sx(styles.cardPerson)}>
                      <Identicon seed={person().id} size={16} />
                      {person().name}
                    </span>
                  )}
                </Show>
                <span class={sx(styles.cardTime)}>
                  {shown().label === shown().person?.name ? "" : `${shown().label} · `}
                  {formatRelativeTime(shown().atMs, app.now())}
                </span>
              </div>
              <div class={sx(styles.cardHints)}>
                <span>⌥ + scroll by marker</span>
              </div>
            </div>
          )}
        </Show>
      </nav>
    </Show>
  );
}
