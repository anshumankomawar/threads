import { createUniqueId, For } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { sx } from "../styles/sx";
import { colors } from "../styles/tokens.stylex";

// An edge so the pale background doesn't melt into a light page; half the stroke is clipped.
const styles = stylex.create({ ring: { stroke: colors.avatarRing, strokeWidth: "0.5" } });

// FNV-1a: a small, stable string hash.
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// A mirrored 5×5 grid in one seeded colour, clipped to a circle.
export function Identicon(props: { seed: string; size?: number; class?: string }): JSX.Element {
  const clipId = createUniqueId();
  const cells = (): { x: number; y: number }[] => {
    const h = hash(props.seed);
    const cells: { x: number; y: number }[] = [];
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 3; col++)
        if ((h >>> (row * 3 + col + 9)) & 1) {
          cells.push({ x: col, y: row });
          if (col < 2) cells.push({ x: 4 - col, y: row });
        }
    return cells;
  };
  return (
    <svg
      class={props.class}
      width={props.size ?? 22}
      height={props.size ?? 22}
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
              fill={`hsl(${hash(props.seed) % 360} 55% 52%)`}
            />
          )}
        </For>
        <circle class={sx(styles.ring)} cx="2.5" cy="2.5" r="3" fill="none" />
      </g>
    </svg>
  );
}
