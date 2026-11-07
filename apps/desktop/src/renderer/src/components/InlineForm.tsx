import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { base } from "../styles/base";
import { menu as look } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes } from "../styles/tokens.stylex";
import { Icon, type IconSvgElement } from "./Icon";

// A small form grown out of what asked for it, the size of a context menu, its icon carried in exactly where it was
// and the fields beside it: from a sidebar +, laid over the +; from a context menu's entry, in the menu's place, the
// entry ("New Bucket") still where it was and its fields under it. Enter
// moves to the next field and, on the last, submits; Escape or a click elsewhere closes it. Until then it keeps the
// focus and the keys (Tab goes round its fields), so nothing behind it moves while you type.

// Keys stay in a form (the app's hotkeys skip anything in a `data-holds-keys` panel) and Tab goes round its fields; the
// focus, leaving for anything but a click elsewhere (which closes it), comes back.
export function holdFocus(panel: HTMLElement): void {
  panel.dataset.holdsKeys = "";
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const fields = [...panel.querySelectorAll<HTMLInputElement>("input")];
    const at = fields.indexOf(document.activeElement as HTMLInputElement);
    event.preventDefault();
    fields[(at + (event.shiftKey ? -1 : 1) + fields.length) % fields.length]?.focus();
  });
  panel.addEventListener("focusout", (event) => {
    const to = event.relatedTarget as Node | null;
    if (to && panel.contains(to)) return;
    queueMicrotask(() => {
      if (panel.matches(":popover-open") && !panel.contains(document.activeElement))
        (event.target as HTMLElement).focus();
    });
  });
}

export type InlineAsk = {
  // The icon it grows out of (or where it was, from a menu that's gone), whose place the panel's own icon takes.
  at: Element | DOMRect;
  // What it makes, as the menu entry it came from said, over its fields.
  title?: string;
  icon: IconSvgElement;
  fields: { label: string; placeholder: string; value?: string }[];
  submit: (values: string[]) => void;
};

const [asked, setAsked] = createSignal<InlineAsk | null>(null);
export const askInline = (ask: InlineAsk): void => void setAsked(ask);

// The panel's 1px border and its padding, before the icon; and from its top edge to the middle of the first row.
const LEAD = 10;
const TO_FIRST_ROW = 1 + 3.6 + 21.8 / 2;

const styles = stylex.create({
  panel: {
    position: "fixed",
    display: { default: "none", ":popover-open": "flex" },
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-start",
    width: 240,
    margin: 0,
    padding: "3.6px 4.5px 3.6px 9px",
    borderRadius: 11,
  },
  // On the panel, not in a field: what it grew out of.
  lead: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    height: 21.8,
    color: colors.textPrimary,
  },
  fields: { display: "flex", flex: 1, flexDirection: "column", gap: 2, minWidth: 0 },
  // The field you're in is the highlighted row.
  row: {
    display: "flex",
    alignItems: "center",
    height: 21.8,
    padding: "0 7px",
    borderRadius: 5,
    backgroundColor: { default: "transparent", ":focus-within": colors.panelSelected },
    cursor: "text",
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    outline: "none",
    "::placeholder": { color: colors.textTertiary },
  },
  hint: { flexShrink: 0, color: colors.textTertiary, fontSize: fontSizes.small },
  // The entry it came from, where its label was: the icon's gap after it, as a menu entry has.
  title: {
    display: "flex",
    alignItems: "center",
    height: 21.8,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
  },
  // Under a title, what's typed starts where the title does.
  rowUnderTitle: { marginLeft: -7 },
});

export function InlineForm(): JSX.Element {
  return (
    <Show when={asked()} keyed>
      {(ask) => {
        const inputs: HTMLInputElement[] = [];
        const rect = (): DOMRect =>
          ask.at instanceof Element ? ask.at.getBoundingClientRect() : ask.at;
        const size = Math.round(rect().width) || 13;
        const open = (panel: HTMLDivElement): void => {
          holdFocus(panel);
          queueMicrotask(() => {
            const at = rect();
            panel.style.left = `${at.left - LEAD}px`;
            panel.style.top = `${at.top + at.height / 2 - TO_FIRST_ROW}px`;
            panel.showPopover();
            inputs[0]?.focus();
            inputs[0]?.select();
          });
        };
        const enter = (n: number): void => {
          if (n < inputs.length - 1) return inputs[n + 1].focus();
          const values = inputs.map((input) => input.value.trim());
          if (!values[0]) return inputs[0].focus();
          setAsked(null);
          ask.submit(values);
        };
        return (
          <div
            ref={open}
            popover="auto"
            class={sx(base.panel, look.menu, look.popover, styles.panel)}
            role="dialog"
            onToggle={(event) => event.newState === "closed" && asked() === ask && setAsked(null)}
          >
            <span class={sx(styles.lead)} style={{ width: `${size}px` }}>
              <Icon icon={ask.icon} size={size} aria-hidden="true" />
            </span>
            <div class={sx(styles.fields)}>
              <Show when={ask.title}>
                <span class={sx(styles.title)}>{ask.title}</span>
              </Show>
              <For each={ask.fields}>
                {(field, n) => (
                  <label class={sx(styles.row, !!ask.title && styles.rowUnderTitle)}>
                    <input
                      ref={(el) => (inputs[n()] = el)}
                      class={sx(base.bare, styles.input)}
                      aria-label={field.label}
                      placeholder={field.placeholder}
                      value={field.value ?? ""}
                      spellcheck={false}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || e.isComposing) return;
                        e.preventDefault();
                        enter(n());
                      }}
                    />
                    <span class={sx(styles.hint)}>↵</span>
                  </label>
                )}
              </For>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
