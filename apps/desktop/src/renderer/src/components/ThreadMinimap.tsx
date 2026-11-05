import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { formatRelativeTime } from "../format";
import { plainThreadLinks, type Entry, type Person } from "model";
import { useThreadLinks } from "../threadLinks";
import { Identicon } from "./Identicon";

const TICK_SPACING = 6;
// Every tick rests at the same length, whatever kind of entry it marks. While hovering, the tick under the cursor is
// longest and its neighbors taper back to rest; at rest the entry you're reading is marked by color alone.
const RESTING_LENGTH = 8;
const PEAK_LENGTH = 14;
const TAPER_PER_TICK = 2;
// Gap between ⌥ + scroll jumps, so one flick moves one marker.
const JUMP_THROTTLE_MS = 180;

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
  nowMs: number;
}): JSX.Element {
  const links = useThreadLinks();
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
      <nav class="minimap" aria-label="Thread outline" onMouseLeave={() => setHovered(null)}>
        <For each={markers()} keyed={(marker) => marker.id}>
          {(marker, index) => (
            <button
              type="button"
              class="minimap-tick"
              aria-label={`${marker().label}: ${marker().text}`}
              data-active={String(index() === active())}
              data-hovered={String(hovered() === index())}
              style={{ "--tick-length": `${lengthAt(index())}px` }}
              onMouseEnter={() => setHovered(index())}
              onClick={() =>
                elementFor(marker().id)?.scrollIntoView({ block: "start", behavior: "smooth" })
              }
            />
          )}
        </For>
        <Show when={card()}>
          {(shown) => (
            <div
              class="minimap-card"
              style={{ top: `${(hovered() ?? 0) * TICK_SPACING}px` }}
              role="tooltip"
            >
              <div class="minimap-card-text">{shown().text}</div>
              <div class="minimap-card-meta">
                <Show when={shown().person}>
                  {(person) => (
                    <span class="minimap-card-person">
                      <Identicon seed={person().id} size={16} />
                      {person().name}
                    </span>
                  )}
                </Show>
                <span class="minimap-card-time">
                  {shown().label === shown().person?.name ? "" : `${shown().label} · `}
                  {formatRelativeTime(shown().atMs, props.nowMs)}
                </span>
              </div>
              <div class="minimap-card-hints">
                <span>⌥ + scroll by marker</span>
              </div>
            </div>
          )}
        </Show>
      </nav>
    </Show>
  );
}
