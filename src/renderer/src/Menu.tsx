import { useEffect } from "react";
import { hideMenu, useUI } from "./state";

const WIDTH = 300;
const ROW = 24;

export function Menu() {
  const menu = useUI((ui) => ui.menu);
  useEffect(() => {
    if (!menu) return;
    const events = ["pointerdown", "keydown", "blur", "resize"];
    for (const event of events) window.addEventListener(event, hideMenu);
    return () => {
      for (const event of events) window.removeEventListener(event, hideMenu);
    };
  }, [menu]);
  if (!menu) return null;

  const left = Math.min(menu.x, innerWidth - WIDTH - 8);
  const top = Math.min(menu.y, innerHeight - menu.items.length * ROW - 16);
  return (
    <div
      className="panel menu"
      role="menu"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menu.items.map((item, index) =>
        item === "separator" ? (
          <hr key={index} />
        ) : (
          <button key={index} role="menuitem" onClick={() => (hideMenu(), item.run())}>
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
