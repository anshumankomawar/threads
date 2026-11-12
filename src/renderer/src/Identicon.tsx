import { useId } from "react";

function hash(value: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function Identicon({ seed, size = 22 }: { seed: string; size?: number }) {
  const clip = useId();
  const h = hash(seed);
  const cells = [0, 1, 2, 3, 4].flatMap((row) =>
    [0, 1, 2].flatMap((col) =>
      (h >>> (row * 3 + col + 9)) & 1
        ? [...new Set([col, 4 - col])].map((x) => ({ x, y: row }))
        : [],
    ),
  );
  return (
    <svg className="identicon" width={size} height={size} viewBox="-0.5 -0.5 6 6" aria-hidden>
      <clipPath id={clip}>
        <circle cx="2.5" cy="2.5" r="3" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x="-0.5" y="-0.5" width="6" height="6" fill="#f2f2f2" />
        {cells.map(({ x, y }) => (
          <rect
            key={`${x},${y}`}
            x={x}
            y={y}
            width="1.02"
            height="1.02"
            fill={`hsl(${h % 360} 55% 52%)`}
          />
        ))}
        <circle className="ring" cx="2.5" cy="2.5" r="3" fill="none" />
      </g>
    </svg>
  );
}
