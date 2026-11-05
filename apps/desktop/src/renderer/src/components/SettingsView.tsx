import { createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { useApp } from "../app/state";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors, radii } from "../styles/tokens.stylex";

const SLIDE = { transitionProperty: "transform, background-color", transitionDuration: "150ms" };

const styles = stylex.create({
  setting: { display: "grid", gridTemplateColumns: "120px 1fr", gap: 20, alignItems: "center" },
  control: { minHeight: 32, color: colors.textPrimary },
  note: { marginLeft: 6 },
  boxed: {
    height: 26,
    borderRadius: radii.button,
    color: colors.textPrimary,
    font: "inherit",
    backgroundColor: colors.bgQuaternary,
  },
  input: {
    width: 260,
    padding: "0 8px",
    borderColor: { default: colors.strokeTertiary, ":focus": colors.strokeFocused },
    outline: "none",
  },
  button: { padding: "0 10px" },
  hoverBorder: { borderColor: { default: colors.strokeTertiary, ":hover": colors.strokeFocused } },
  segmented: { display: "inline-flex", padding: 2, borderRadius: radii.item },
  segment: { height: 22, padding: "0 10px", borderRadius: radii.control },
  text2: { color: colors.textSecondary },
  checked: { color: colors.textPrimary, backgroundColor: colors.bgTertiary },
  round: { width: 18, height: 18, borderRadius: "50%" },
  pressed: { boxShadow: `0 0 0 2px ${colors.chrome}, 0 0 0 3.5px ${colors.textSecondary}` },
  switch: { position: "relative", width: 30, borderRadius: 9, backgroundColor: colors.bgTertiary },
  slide: { ...SLIDE },
  knob: {
    "::after": {
      position: "absolute",
      top: 2,
      left: 2,
      width: 14,
      height: 14,
      borderRadius: "50%",
      backgroundColor: colors.textSecondary,
      content: '""',
      ...SLIDE,
    },
  },
  on: {
    backgroundColor: colors.accent,
    "::after": { backgroundColor: "#fff", transform: "translateX(12px)" },
  },
  kbd: { padding: "1px 6px", borderRadius: radii.control, font: "inherit" },
  footer: { marginTop: 32 },
});

const FIELD = sx(page.border, styles.boxed, styles.input);
const BUTTON = sx(page.border, page.pointer, styles.boxed, styles.button, styles.hoverBorder);

function Setting(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div class={sx(styles.setting)}>
      <span class={sx(page.muted)}>{props.label}</span>
      <span class={sx(page.row, styles.control)}>{props.children}</span>
    </div>
  );
}

function Toggle(props: { label: string; note: string; on?: boolean }): JSX.Element {
  const [on, setOn] = createSignal(untrack(() => props.on === true));
  return (
    <Setting label={props.label}>
      <button
        type="button"
        role="switch"
        class={sx(
          page.bare,
          page.pointer,
          styles.round,
          styles.switch,
          styles.slide,
          styles.knob,
          on() && styles.on,
        )}
        aria-checked={`${on()}`}
        aria-label={props.label}
        onClick={() => setOn((value) => !value)}
      />
      <span class={sx(page.small, styles.note)}>{props.note}</span>
    </Setting>
  );
}

// A preview: every control works on screen but nothing is saved or sent anywhere yet.
export function SettingsView(): JSX.Element {
  const app = useApp();
  const [theme, setTheme] = createSignal("Dark");
  const [accent, setAccent] = createSignal("#78aee7");
  const [connected, setConnected] = createSignal<Record<string, boolean>>({});
  const button = (label: string): JSX.Element => (
    <button type="button" class={BUTTON}>
      {label}
    </button>
  );

  return (
    <div class={sx(page.page, page.top)}>
      <h1 class={sx(page.title)}>Settings</h1>
      <p class={sx(page.summary)}>A preview: changes here aren't saved yet.</p>

      <h2 class={sx(page.heading)}>Account</h2>
      <Setting label="Name">
        <input class={FIELD} defaultValue={app.me().name} aria-label="Name" />
      </Setting>
      <Setting label="Email">
        <input class={FIELD} placeholder="you@company.com" aria-label="Email" />
      </Setting>
      <Setting label="Password">{button("Change password")}</Setting>

      <h2 class={sx(page.heading)}>Appearance</h2>
      <Setting label="Theme">
        <span class={sx(styles.boxed, styles.segmented)} role="radiogroup" aria-label="Theme">
          <For each={["Dark", "Light", "System"]}>
            {(option) => (
              <button
                type="button"
                role="radio"
                class={sx(
                  page.bare,
                  page.pointer,
                  styles.segment,
                  styles.text2,
                  theme() === option && styles.checked,
                )}
                aria-checked={`${theme() === option}`}
                onClick={() => setTheme(option)}
              >
                {option}
              </button>
            )}
          </For>
        </span>
      </Setting>
      <Setting label="Accent">
        <For each={["#78aee7", "#9d8cf2", "#5fc79a", "#e8a25c", "#e5737f"]}>
          {(color) => (
            <button
              type="button"
              class={sx(
                page.bare,
                page.pointer,
                styles.round,
                accent() === color && styles.pressed,
              )}
              aria-label={`Accent ${color}`}
              aria-pressed={`${accent() === color}`}
              style={{ "background-color": color }}
              onClick={() => setAccent(color)}
            />
          )}
        </For>
      </Setting>
      <Toggle label="Compact sidebar" note="Tighter rows in the inbox and lists" />

      <h2 class={sx(page.heading)}>Notifications</h2>
      <Toggle label="Mention toasts" note="A toast when someone mentions you" on />
      <Toggle label="Sounds" note="A soft chime when a question reaches you" />
      <Toggle label="Daily summary" note="An email each morning with your inbox" on />

      <h2 class={sx(page.heading)}>Integrations</h2>
      <For each={["Google Calendar", "Slack", "GitHub"]}>
        {(name) => (
          <Setting label={name}>
            <button
              type="button"
              class={BUTTON}
              onClick={() => setConnected((current) => ({ ...current, [name]: !current[name] }))}
            >
              {connected()[name] ? "Disconnect" : "Connect"}
            </button>
            <Show when={connected()[name]}>
              <span class={sx(page.small, styles.note)}>Connected</span>
            </Show>
          </Setting>
        )}
      </For>

      <h2 class={sx(page.heading)}>Workspace</h2>
      <Setting label="Members">
        {app.data.people().length} people
        {button("Invite people")}
      </Setting>

      <h2 class={sx(page.heading)}>Keyboard shortcuts</h2>
      <For
        each={[
          ["Search and commands", "⌘K or ⌘⇧F"],
          ["New thread", "⌘N"],
          ["View as someone else", "⌘U"],
          ["Text size", "⌘+  ⌘-  ⌘0"],
        ]}
      >
        {([label, keys]) => (
          <Setting label={label}>
            <kbd class={sx(page.border, page.small, styles.text2, styles.kbd)}>{keys}</kbd>
          </Setting>
        )}
      </For>
      <div class={sx(styles.footer)}>{button("Sign out")}</div>
    </div>
  );
}
