import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { sx } from "../styles/sx";
import { layers } from "../styles/tokens.stylex";

const styles = stylex.create({
  titlebar: {
    position: "fixed",
    top: 0,
    right: 0,
    left: 0,
    zIndex: layers.titlebar,
    height: 34,
    pointerEvents: "none",
    WebkitAppRegion: "drag",
  },
  resync: {
    position: "fixed",
    bottom: 0,
    left: 0,
    width: 1,
    height: 1,
    pointerEvents: "none",
    WebkitAppRegion: "no-drag",
  },
});

// The window's drag strip along the top.
export function Titlebar(): JSX.Element {
  return <div aria-hidden="true" class={sx(styles.titlebar)} />;
}

// Chromium can keep stale app-region bounds; moving a 1px no-drag element near the top forces a recompute.
export function DragRegionResync(): JSX.Element {
  let element!: HTMLDivElement;
  onSettled(() => {
    const onMouseMove = (event: MouseEvent): void => {
      if (event.clientY <= 96) element.style.left = element.style.left === "1px" ? "0px" : "1px";
    };
    window.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove, { capture: true });
  });
  return <div aria-hidden="true" ref={element} class={sx(styles.resync)} />;
}
