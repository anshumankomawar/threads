import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { sx } from "../styles/sx";
import { layers } from "../styles/tokens.stylex";

// Mouse moves within this many pixels of the top nudge the drag-region resync element.
const DRAG_RESYNC_ZONE_PX = 96;

const styles = stylex.create({
  // Window drag strip: a fixed overlay over the 34px top bar, so it adds no layout height.
  titlebar: {
    position: "fixed",
    top: 0,
    right: 0,
    left: 0,
    zIndex: layers.titlebar,
    height: "34px",
    pointerEvents: "none",
    WebkitAppRegion: "drag",
  },
  resync: {
    position: "fixed",
    bottom: 0,
    left: 0,
    width: "1px",
    height: "1px",
    pointerEvents: "none",
    WebkitAppRegion: "no-drag",
  },
});

// The window's drag strip along the top (App and the loading screen both draw it).
export function Titlebar(): JSX.Element {
  return <div aria-hidden="true" class={sx(styles.titlebar)} />;
}

// Chromium can keep stale app-region bounds; moving a 1px no-drag element forces a recompute.
export function DragRegionResync(): JSX.Element {
  let element!: HTMLDivElement;

  onSettled(() => {
    const onMouseMove = (event: MouseEvent): void => {
      if (event.clientY > DRAG_RESYNC_ZONE_PX) return;
      element.style.left = element.style.left === "1px" ? "0px" : "1px";
    };
    window.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove, { capture: true });
  });

  return <div aria-hidden="true" ref={element} class={sx(styles.resync)} />;
}
