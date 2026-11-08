import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import horizon from "../assets/horizon.png";
import { sx } from "../styles/sx";
import { motion } from "../styles/tokens.stylex";

// The reading pane's welcome with nothing open: Earth's limb from orbit, dithered into dots (scripts/horizon). It lies
// under the whole pane, its top bar too, fading in (settling from a little closer) as the pane empties and out as
// something opens. App puts it behind the pane, and nowhere else.

const settle = stylex.keyframes({ from: { transform: "translate(-50%, -50%) scale(1.06)" } });

const s = stylex.create({
  // The scene's own ground: it's a picture, not the app's colour.
  backdrop: {
    position: "absolute",
    inset: 0,
    zIndex: -1,
    overflow: "hidden",
    backgroundColor: "rgb(10 10 11)",
    pointerEvents: "none",
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: { default: "500ms", [motion.reduced]: "0s" },
    transitionTimingFunction: "ease",
  },
  shown: { opacity: 1 },
  // Drawn at exactly half its pixel size, so each dot lands on whole pixels, its edges fading into the dark.
  scene: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 1200,
    height: 900,
    transform: "translate(-50%, -50%)",
    backgroundSize: "1200px 900px",
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
    maskImage: "radial-gradient(closest-side, #000 72%, transparent)",
  },
  sceneShown: {
    animationName: { default: settle, [motion.reduced]: "none" },
    animationDuration: "1.4s",
    animationTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
});

export const SceneBackdrop = (props: { shown: boolean }): JSX.Element => (
  <div class={sx(s.backdrop, props.shown && s.shown)} aria-hidden="true">
    <span
      class={sx(s.scene, props.shown && s.sceneShown)}
      style={{ "background-image": `url(${horizon})` }}
    />
  </div>
);
