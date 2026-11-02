import { useEffect, useRef, useState } from "react";
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
    case "call":
      return {
        ...base,
        label: "Video call",
        text: `Video call · ${entry.link}`,
        person: null,
      };
    case "notes":
      return { ...base, label: "Meeting notes", text: entry.summary, person: null };
  }
}

function elementFor(id: string): HTMLElement | null {
  return document.getElementById(`entry-${id}`);
}

// A strip of ticks along the thread's right edge, one per entry, for seeing its shape and jumping around.
// The entry you're reading is raised and bright. Hovering a tick previews the entry; clicking scrolls to it, and
// ⌥ + scroll steps from marker to marker.
export function ThreadMinimap({
  entries,
  scrollRef,
  nowMs,
}: {
  entries: Entry[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  nowMs: number;
}): React.JSX.Element | null {
  const { titleOf, nameOf } = useThreadLinks();
  const markers = entries.map((entry) => toMarker(entry, titleOf, nameOf));
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const visibleRef = useRef(visible);
  const markersRef = useRef(markers);
  useEffect(() => {
    visibleRef.current = visible;
    markersRef.current = markers;
  });

  const ids = markers.map((marker) => marker.id).join(",");

  // Track which entries are on screen.
  useEffect(() => {
    const root = scrollRef.current;
    if (root === null) return;
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
    for (const id of ids.split(",")) {
      const element = elementFor(id);
      if (element !== null) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids, scrollRef]);

  // ⌥ + scroll jumps to the next or previous marker instead of scrolling freely.
  useEffect(() => {
    const root = scrollRef.current;
    if (root === null) return;
    let lastJump = 0;
    const onWheel = (event: WheelEvent): void => {
      if (!event.altKey || event.deltaY === 0) return;
      event.preventDefault();
      if (event.timeStamp - lastJump < JUMP_THROTTLE_MS) return;
      lastJump = event.timeStamp;
      const all = markersRef.current;
      const current = all.findIndex((marker) => visibleRef.current.has(marker.id));
      const index = Math.min(
        all.length - 1,
        Math.max(0, (current === -1 ? 0 : current) + Math.sign(event.deltaY)),
      );
      elementFor(all[index].id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [scrollRef]);

  if (markers.length < 2) return null;
  const card = hovered === null ? undefined : markers[hovered];
  const active = markers.findIndex((marker) => visible.has(marker.id));
  const focus = hovered;
  const lengthAt = (index: number): number =>
    focus === null
      ? RESTING_LENGTH
      : Math.max(RESTING_LENGTH, PEAK_LENGTH - TAPER_PER_TICK * Math.abs(index - focus));

  return (
    <nav className="minimap" aria-label="Thread outline" onMouseLeave={() => setHovered(null)}>
      {markers.map((marker, index) => (
        <button
          key={marker.id}
          type="button"
          className="minimap-tick"
          aria-label={`${marker.label}: ${marker.text}`}
          data-active={index === active}
          data-hovered={hovered === index}
          style={{ "--tick-length": `${lengthAt(index)}px` } as React.CSSProperties}
          onMouseEnter={() => setHovered(index)}
          onClick={() =>
            elementFor(marker.id)?.scrollIntoView({ block: "start", behavior: "smooth" })
          }
        />
      ))}
      {card !== undefined && hovered !== null && (
        <div className="minimap-card" style={{ top: hovered * TICK_SPACING }} role="tooltip">
          <div className="minimap-card-text">{card.text}</div>
          <div className="minimap-card-meta">
            {card.person !== null && (
              <span className="minimap-card-person">
                <Identicon seed={card.person.id} size={16} />
                {card.person.name}
              </span>
            )}
            <span className="minimap-card-time">
              {card.label === card.person?.name ? "" : `${card.label} · `}
              {formatRelativeTime(card.atMs, nowMs)}
            </span>
          </div>
          <div className="minimap-card-hints">
            <span>⌥ + scroll by marker</span>
          </div>
        </div>
      )}
    </nav>
  );
}
