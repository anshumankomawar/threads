// Returns { ref, width, handle }:
//   ref: (el: HTMLElement) => void  — put on the panel: `<aside ref={ref} style={{ width: `${width()}px` }}>`
//   width: () => number             — the committed width in px, an accessor
//   handle: JSX.Element             — the drag handle, rendered inside the panel
import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
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
  ref: (el: HTMLElement) => void;
  width: () => number;
  handle: JSX.Element;
} {
  let panel: HTMLElement | undefined;
  const [width, setWidth] = createSignal(readWidth(size));
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
    ref: (el) => {
      panel = el;
    },
    width,
    handle: (
      <ResizeHandle
        panel={() => panel}
        width={width()}
        size={size}
        clamp={clamp}
        onCommit={commit}
      />
    ),
  };
}
