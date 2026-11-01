import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// An action, or a line between groups of them.
export type ContextMenuItem = { label: string; shortcut?: string; run: () => void } | "separator";

// A right-click menu at the pointer, kept on screen. Closes on picking an item, clicking elsewhere, scrolling or
// Escape.
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const menu = ref.current;
    if (menu === null) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.min(x, window.innerWidth - width - 4),
      top: y + height > window.innerHeight - 4 ? Math.max(4, y - height) : y,
    });
  }, [x, y]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("mousedown", onClose);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onClose);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={position}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item === "separator" ? (
          <div key={`separator-${index}`} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut !== undefined && (
              <span className="context-menu-shortcut">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
