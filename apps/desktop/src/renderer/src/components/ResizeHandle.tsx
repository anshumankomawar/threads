import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { sx } from "../styles/sx";
import { colors, layers } from "../styles/tokens.stylex";

// The 1px line the handle shows while hovered or dragged, 2px into the handle: exactly on the panel's 1px border, so
// hover and drag only recolor it.
const LINE = `linear-gradient(to right, transparent 2px, ${colors.strokeFocused} 2px, ${colors.strokeFocused} 3px, transparent 3px)`;

const styles = stylex.create({
  // A 4px hit area straddling the panel's right border.
  handle: {
    position: "absolute",
    top: 0,
    right: "-2px",
    bottom: 0,
    zIndex: layers.titlebar,
    width: "4px",
    margin: 0,
    borderStyle: "none",
    cursor: "col-resize",
    // `data-resizing` is set by the drag code below, not by Solid.
    backgroundImage: {
      default: null,
      ":hover": LINE,
      ":is([data-resizing])": LINE,
    },
  },
  // On a right-hand panel the handle straddles its left border instead.
  left: {
    right: "auto",
    left: "-3px",
  },
});

export type PanelSize = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  // Which edge of the panel you drag: "right" for a panel on the left of the window, "left" for one on the right.
  edge: "left" | "right";
};

// The 4px drag area on the panel's inner edge: right edge for a left panel, left edge for a right one.
// `panel` is a getter for the panel element, read when a drag starts.
export function ResizeHandle(props: {
  panel: () => HTMLElement | undefined;
  width: number;
  size: PanelSize;
  clamp: (value: number) => number;
  onCommit: (value: number) => void;
}): JSX.Element {
  const onPointerDown = (event: PointerEvent & { currentTarget: HTMLHRElement }): void => {
    const panel = props.panel();
    if (panel === undefined) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    // A right-hand panel grows as you drag left.
    const direction = props.size.edge === "left" ? -1 : 1;
    const clamp = props.clamp;
    const widthAt = (clientX: number): number => clamp(startWidth + direction * (clientX - startX));
    handle.setPointerCapture(event.pointerId);
    handle.dataset.resizing = "true";

    // Write the width straight to the DOM while dragging; commit to state on release.
    const onMove = (moveEvent: PointerEvent): void => {
      const next = widthAt(moveEvent.clientX);
      panel.style.width = `${next}px`;
      handle.setAttribute("aria-valuenow", String(next));
    };
    const onEnd = (endEvent: PointerEvent): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      delete handle.dataset.resizing;
      props.onCommit(widthAt(endEvent.clientX));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  };

  return (
    <hr
      class={sx(styles.handle, props.size.edge === "left" && styles.left)}
      aria-label="Resize panel"
      aria-orientation="vertical"
      aria-valuemax={props.size.maxWidth}
      aria-valuemin={props.size.minWidth}
      aria-valuenow={props.width}
      onDblClick={() => props.onCommit(props.size.defaultWidth)}
      onPointerDown={onPointerDown}
    />
  );
}
