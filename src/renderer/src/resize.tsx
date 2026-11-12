import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

export function useResize(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => Number(localStorage.getItem(key)) || initial);
  useEffect(() => localStorage.setItem(key, String(width)), [key, width]);

  const drag = (event: ReactPointerEvent<HTMLHRElement>) => {
    const edge = event.currentTarget;
    const from = width - event.clientX;
    const move = (moved: PointerEvent) =>
      setWidth(Math.min(max, Math.max(min, from + moved.clientX)));
    edge.setPointerCapture(event.pointerId);
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", () => edge.removeEventListener("pointermove", move), {
      once: true,
    });
  };
  const edge = <hr className="edge" onPointerDown={drag} onDoubleClick={() => setWidth(initial)} />;
  return { width, edge };
}
