import { useRef, useState } from "react";
import { ResizeHandle, type PanelSize } from "./ResizeHandle";

function readWidth({ storageKey, defaultWidth, minWidth, maxWidth }: PanelSize): number {
  try {
    const stored = Number(localStorage.getItem(storageKey));
    return stored > 0 ? Math.min(maxWidth, Math.max(minWidth, stored)) : defaultWidth;
  } catch {
    return defaultWidth;
  }
}

// A side panel whose width you drag from one edge. The width is clamped, remembered across launches,
// and reset to the default with a double-click on the handle.
export function useResizablePanel(size: PanelSize): {
  panelRef: React.RefObject<HTMLElement | null>;
  width: number;
  handle: React.JSX.Element;
} {
  const panelRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => readWidth(size));
  const clamp = (value: number): number =>
    Math.min(size.maxWidth, Math.max(size.minWidth, Math.round(value)));

  const commit = (value: number): void => {
    setWidth(value);
    try {
      localStorage.setItem(size.storageKey, String(value));
    } catch {
      // Width just won't persist.
    }
  };

  return {
    panelRef,
    width,
    handle: (
      <ResizeHandle panelRef={panelRef} width={width} size={size} clamp={clamp} onCommit={commit} />
    ),
  };
}
