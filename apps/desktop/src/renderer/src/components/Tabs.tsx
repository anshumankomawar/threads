import { createEffect, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { base } from "../styles/base";
import { tabLabel } from "../styles/markers.stylex";
import { sx } from "../styles/sx";
import { colors, motion } from "../styles/tokens.stylex";
import { Icon, type IconSvgElement } from "./Icon";

export type Tab = { label: string; icon: IconSvgElement; count?: () => number };

// One tab's look, for a button that sits beside the tabs (`on` while it's chosen).
// Sized as the macOS app's (in points there; here in CSS pixels at the 110% scale, so each is its points ÷ 1.1):
// 24pt tall, at least 26pt wide, 6pt in from its ends and rounded 6pt, its name at 12pt, 2pt from the next.
export const tab = stylex.create({
  tab: {
    display: "flex",
    alignItems: "center",
    height: 21.82,
    minWidth: 23.64,
    padding: "0 5.45px",
    // Tighter than a row's: segment tabs are small, and sit close together.
    borderRadius: 5.45,
    color: colors.iconTertiary,
    fontSize: 10.91,
    cursor: "pointer",
  },
  on: { color: colors.textPrimary, backgroundColor: colors.bgTertiary },
});

const s = stylex.create({
  tabs: { display: "flex", gap: 1.82 },
  // The chosen tab grows to its name's measured width (`--label-width`) as the old one shrinks.
  label: {
    width: 0,
    transitionProperty: { default: "width, margin-left", [motion.reduced]: "none" },
    transitionDuration: "280ms",
    transitionTimingFunction: "cubic-bezier(0.45, 0, 0.25, 1)",
  },
  labelShown: { width: tabLabel["--label-width"], marginLeft: 5.45 },
  count: {
    marginLeft: 4,
    color: colors.textSecondary,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
});

// Icon tabs; the chosen one opens out to show its name.
export function Tabs<T extends Tab>(props: {
  label: string;
  tabs: T[];
  chosen: T;
  onChoose: (tab: T) => void;
}): JSX.Element {
  const labels: HTMLElement[] = [];
  // Each name's own width, so the chosen tab grows to exactly fit it; again once the font has loaded.
  const measure = (): void => {
    for (const label of labels) label.style.setProperty("--label-width", `${label.scrollWidth}px`);
  };
  createEffect(() => props.chosen, measure);
  onSettled(() => void document.fonts.ready.then(measure));
  return (
    <div class={sx(s.tabs)} role="tablist" aria-label={props.label}>
      <For each={props.tabs}>
        {(t) => (
          <button
            class={sx(base.bare, base.hover, tab.tab, props.chosen === t && tab.on)}
            role="tab"
            aria-selected={props.chosen === t ? "true" : "false"}
            aria-label={t.label}
            title={t.label}
            onClick={() => props.onChoose(t)}
          >
            <Icon icon={t.icon} size={14} aria-hidden="true" />
            <span
              ref={(el) => labels.push(el)}
              class={sx(base.clip, s.label, props.chosen === t && s.labelShown)}
              aria-hidden="true"
            >
              {t.label}
            </span>
            <Show when={t.count?.()}>
              <span class={sx(s.count)}>{t.count?.()}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
