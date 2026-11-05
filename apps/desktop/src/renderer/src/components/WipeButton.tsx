import type { JSX } from "@solidjs/web";
import { createEffect, createSignal } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { useApp } from "../app/state";
import { topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes } from "../styles/tokens.stylex";
import { Icon } from "./Icon";

const styles = stylex.create({
  // Wipe all data: an icon, then an explicit question on the first click. After `topbar.button`.
  wipe: {
    gap: "6px",
    width: "auto",
    padding: "0 6px",
    fontSize: fontSizes.body,
  },
  confirm: {
    color: colors.urgent,
  },
});

// Wipes every thread in the current workspace, keeping people and the org: the first click asks, the
// second (within a few seconds) wipes.
export function WipeButton(): JSX.Element {
  const app = useApp();
  const [state, setState] = createSignal<"idle" | "confirm" | "wiping">("idle");
  createEffect(state, (current) => {
    if (current !== "confirm") return;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  });
  return (
    <button
      type="button"
      class={sx(topbar.button, styles.wipe, state() === "confirm" && styles.confirm)}
      aria-label="Wipe all threads"
      title="Wipe all threads (people and the org stay)"
      disabled={state() === "wiping"}
      onClick={() => {
        if (state() === "idle") {
          setState("confirm");
          return;
        }
        setState("wiping");
        void app
          .client()
          .wipe()
          .finally(() => setState("idle"));
      }}
    >
      <Icon icon={Delete02Icon} size={13} aria-hidden="true" />
      {state() === "confirm" && <span>Wipe all threads?</span>}
      {state() === "wiping" && <span>Wiping…</span>}
    </button>
  );
}
