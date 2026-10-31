import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../format";
import type { Entry, Person } from "model";
import { Identicon } from "./Identicon";

const TICK_SPACING = 10;
// The focused tick is longest and its neighbors taper back to their resting length. Focus is the tick under the
// cursor while hovering, otherwise the entry you're reading (the topmost one on screen).
const PEAK_LENGTH = 24;
const TAPER_PER_TICK = 5;
// Gap between ⌥ + scroll jumps, so one flick moves one marker.
const JUMP_THROTTLE_MS = 180;

type Marker = {
  id: string;
  label: string;
  text: string;
  person: Person | null;
  atMs: number;
  decision: boolean;
  bookmarkable: boolean;
  // Tick length hints at the kind of entry: messages longest, activity shortest.
  length: number;
};

function toMarker(entry: Entry): Marker {
  const base = { id: entry.id, atMs: entry.createdAtMs, decision: false, bookmarkable: false };
  switch (entry.kind) {
    case "message":
      return {
        ...base,
        label: entry.author.name,
        text: entry.text,
        person: entry.author,
        decision: entry.decision,
        bookmarkable: true,
        length: 14,
      };
    case "event":
      return {
        ...base,
        label: "Activity",
        text: `${entry.actor.name} ${entry.text}`,
        person: entry.actor,
        length: 6,
      };
    case "resolution":
      return { ...base, label: "Done", text: entry.text, person: entry.author, length: 10 };
    case "call":
      return {
        ...base,
        label: "Video call",
        text: `Video call · ${entry.link}`,
        person: null,
        length: 10,
      };
    case "notes":
      return { ...base, label: "Meeting notes", text: entry.summary, person: null, length: 10 };
  }
}

function elementFor(id: string): HTMLElement | null {
  return document.getElementById(`entry-${id}`);
}

// A strip of ticks along the thread's right edge, one per entry, for seeing its shape and jumping around.
// The entry you're reading is raised and bright, decisions are blue. Hovering a tick previews the entry; clicking scrolls to it,
// ⌘-click bookmarks it as a decision, and ⌥ + scroll steps from marker to marker.
export function ThreadMinimap({
  entries,
  scrollRef,
  nowMs,
  onToggleDecision,
}: {
  entries: Entry[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  nowMs: number;
  onToggleDecision: (entryId: string) => void;
}): React.JSX.Element | null {
  const markers = entries.map(toMarker);
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
  const focus = hovered ?? (active === -1 ? null : active);
  const lengthAt = (index: number, resting: number): number =>
    focus === null
      ? resting
      : Math.max(resting, PEAK_LENGTH - TAPER_PER_TICK * Math.abs(index - focus));

  return (
    <nav className="minimap" aria-label="Thread outline" onMouseLeave={() => setHovered(null)}>
      {markers.map((marker, index) => (
        <button
          key={marker.id}
          type="button"
          className="minimap-tick"
          aria-label={`${marker.label}: ${marker.text}`}
          data-active={index === active}
          data-decision={marker.decision}
          data-hovered={hovered === index}
          style={{ "--tick-length": `${lengthAt(index, marker.length)}px` } as React.CSSProperties}
          onMouseEnter={() => setHovered(index)}
          onClick={(event) => {
            if (event.metaKey) {
              if (marker.bookmarkable) onToggleDecision(marker.id);
              return;
            }
            elementFor(marker.id)?.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
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
            {card.decision && <span className="decision-tag">Decision</span>}
          </div>
          <div className="minimap-card-hints">
            {card.bookmarkable && (
              <span>⌘ + click to {card.decision ? "remove bookmark" : "bookmark"}</span>
            )}
            <span>⌥ + scroll by marker</span>
          </div>
        </div>
      )}
    </nav>
  );
}
