import { createSignal, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { sx } from "../styles/sx";
import { colors, layers } from "../styles/tokens.stylex";

// The 1px line shown on hover and drag, drawn exactly over the panel's own 1px border.
const LINE = `linear-gradient(to right, transparent 2px, ${colors.strokeFocused} 2px, ${colors.strokeFocused} 3px, transparent 3px)`;
const LINE_ON = { default: null, ":hover": LINE, ":is([data-resizing])": LINE } as const;
const edge = colors.strokeTertiary;

const styles = stylex.create({
  panel: { position: "relative", display: "flex", flexDirection: "column", flexShrink: 0 },
  ground: { height: "100%", minWidth: 0, backgroundColor: colors.sidebarSolid },
  right: { borderRightWidth: 1, borderRightStyle: "solid", borderRightColor: edge },
  left: { borderLeftWidth: 1, borderLeftStyle: "solid", borderLeftColor: edge },
  handle: { position: "absolute", top: 0, bottom: 0, zIndex: layers.titlebar, width: 4, margin: 0 },
  grab: { borderStyle: "none", cursor: "col-resize", backgroundImage: LINE_ON },
  handleRight: { right: -2 },
  handleLeft: { left: -3 },
});

// localStorage, which can throw; what isn't remembered still applies for the session.
export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

type Size = { name: string; initial: number; min: number; max: number; edge: "left" | "right" };

// A side panel you resize by dragging its inner edge (`edge`: "right" for a panel on the left), remembered across
// launches; a double-click on the edge resets it.
export function SidePanel(props: { size: Size; children: JSX.Element }): JSX.Element {
  const size = untrack(() => props.size);
  let panel!: HTMLElement;
  const clamp = (value: number): number =>
    Math.min(size.max, Math.max(size.min, Math.round(value)));
  const saved = Number(stored(size.name));
  const [width, setWidth] = createSignal(saved > 0 ? clamp(saved) : size.initial);
  const commit = (value: number): void => {
    setWidth(value);
    store(size.name, String(value));
  };
  const onPointerDown = (event: PointerEvent & { currentTarget: HTMLHRElement }): void => {
    event.preventDefault();
    const handle = event.currentTarget;
    const [startX, startWidth] = [event.clientX, panel.getBoundingClientRect().width];
    const widthAt = (x: number): number =>
      clamp(startWidth + (size.edge === "left" ? startX - x : x - startX));
    handle.setPointerCapture(event.pointerId);
    handle.dataset.resizing = "true";
    // The width goes straight to the DOM while dragging and to state on release.
    const onMove = (move: PointerEvent): void => {
      panel.style.width = `${widthAt(move.clientX)}px`;
    };
    const onEnd = (end: PointerEvent): void => {
      for (const name of ["pointerup", "pointercancel"] as const)
        handle.removeEventListener(name, onEnd);
      handle.removeEventListener("pointermove", onMove);
      delete handle.dataset.resizing;
      commit(widthAt(end.clientX));
    };
    handle.addEventListener("pointermove", onMove);
    for (const name of ["pointerup", "pointercancel"] as const)
      handle.addEventListener(name, onEnd);
  };
  const left = size.edge === "left";
  return (
    <aside
      ref={panel}
      class={sx(styles.panel, styles.ground, left ? styles.left : styles.right)}
      style={{ width: `${width()}px` }}
    >
      {props.children}
      <hr
        class={sx(styles.handle, styles.grab, left ? styles.handleLeft : styles.handleRight)}
        aria-label="Resize panel"
        aria-orientation="vertical"
        aria-valuemax={size.max}
        aria-valuemin={size.min}
        aria-valuenow={width()}
        onDblClick={() => commit(size.initial)}
        onPointerDown={onPointerDown}
      />
    </aside>
  );
}
