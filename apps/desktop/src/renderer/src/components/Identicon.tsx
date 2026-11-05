import { createMemo, createUniqueId, For, merge } from "solid-js";
import type { JSX } from "@solidjs/web";

// FNV-1a: a small, stable string hash.
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// GitHub-style identicon: a mirrored 5x5 grid in one seeded color, clipped to a circle like Delta's avatars.
export function Identicon(props: { seed: string; size?: number }): JSX.Element {
  const merged = merge({ size: 22 }, props);
  const clipId = createUniqueId();
  const h = createMemo(() => hash(merged.seed));
  const cells = createMemo(() => {
    const cells: { x: number; y: number }[] = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if ((h() >>> (row * 3 + col + 9)) & 1) {
          cells.push({ x: col, y: row });
          if (col < 2) cells.push({ x: 4 - col, y: row });
        }
      }
    }
    return cells;
  });

  return (
    <svg
      class="identicon"
      width={merged.size}
      height={merged.size}
      viewBox="-0.5 -0.5 6 6"
      aria-hidden="true"
    >
      <clipPath id={clipId}>
        <circle cx="2.5" cy="2.5" r="3" />
      </clipPath>
      <g clip-path={`url(#${clipId})`}>
        <rect x="-0.5" y="-0.5" width="6" height="6" fill="#f2f2f2" />
        <For each={cells()}>
          {(cell) => (
            <rect
              x={cell.x}
              y={cell.y}
              width="1.02"
              height="1.02"
              fill={`hsl(${h() % 360} 55% 52%)`}
            />
          )}
        </For>
        {/* An edge, so the pale background doesn't melt into a light page; clipped to its inner half. */}
        <circle class="identicon-ring" cx="2.5" cy="2.5" r="3" fill="none" />
      </g>
    </svg>
  );
}
