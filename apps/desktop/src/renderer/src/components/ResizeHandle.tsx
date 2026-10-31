export type PanelSize = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  // Which edge of the panel you drag: "right" for a panel on the left of the window, "left" for one on the right.
  edge: "left" | "right";
};

// The 4px drag area on the panel's inner edge: right edge for a left panel, left edge for a right one.
export function ResizeHandle({
  panelRef,
  width,
  size,
  clamp,
  onCommit,
}: {
  panelRef: React.RefObject<HTMLElement | null>;
  width: number;
  size: PanelSize;
  clamp: (value: number) => number;
  onCommit: (value: number) => void;
}): React.JSX.Element {
  const onPointerDown = (event: React.PointerEvent<HTMLHRElement>): void => {
    const panel = panelRef.current;
    if (panel === null) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    // A right-hand panel grows as you drag left.
    const direction = size.edge === "left" ? -1 : 1;
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
      onCommit(widthAt(endEvent.clientX));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  };

  return (
    <hr
      className="resize-handle"
      data-edge={size.edge}
      aria-label="Resize panel"
      aria-orientation="vertical"
      aria-valuemax={size.maxWidth}
      aria-valuemin={size.minWidth}
      aria-valuenow={width}
      onDoubleClick={() => onCommit(size.defaultWidth)}
      onPointerDown={onPointerDown}
    />
  );
}
