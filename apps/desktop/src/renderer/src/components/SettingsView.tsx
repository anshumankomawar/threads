import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { useApp } from "../app/state";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { profile } from "./ProfileView.styles";

// A bordered field or button on the settings page.
const BOXED = {
  height: "26px",
  borderWidth: "1px",
  borderStyle: "solid",
  borderRadius: radii.button,
  color: colors.textPrimary,
  font: "inherit",
  backgroundColor: colors.bgQuaternary,
} as const;

// Settings: the profile page's layout, with a few controls of its own.
const styles = stylex.create({
  // A setting: label on the left like the profile's facts, the control beside it.
  setting: {
    display: "grid",
    gridTemplateColumns: "120px 1fr",
    gap: "20px",
    alignItems: "center",
    minHeight: "32px",
  },
  label: {
    color: colors.textTertiary,
  },
  control: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
    color: colors.textPrimary,
  },
  note: {
    marginLeft: "6px",
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },
  input: {
    ...BOXED,
    width: "260px",
    padding: "0 8px",
    borderColor: {
      default: colors.strokeTertiary,
      ":focus": colors.strokeFocused,
    },
    outline: "none",
  },
  button: {
    ...BOXED,
    padding: "0 10px",
    borderColor: {
      default: colors.strokeTertiary,
      ":hover": colors.strokeFocused,
    },
    cursor: "pointer",
  },
  segmented: {
    display: "inline-flex",
    padding: "2px",
    borderRadius: radii.item,
    backgroundColor: colors.bgQuaternary,
  },
  segment: {
    height: "22px",
    padding: "0 10px",
    borderStyle: "none",
    borderRadius: radii.control,
    color: colors.textSecondary,
    font: "inherit",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  segmentChecked: {
    color: colors.textPrimary,
    backgroundColor: colors.bgTertiary,
  },
  swatch: {
    width: "18px",
    height: "18px",
    padding: 0,
    borderStyle: "none",
    borderRadius: "50%",
    cursor: "pointer",
  },
  swatchPressed: {
    boxShadow: `0 0 0 2px ${colors.chrome}, 0 0 0 3.5px ${colors.textSecondary}`,
  },
  // An on/off switch: a pill with a knob that slides right when on.
  switch: {
    position: "relative",
    width: "30px",
    height: "18px",
    padding: 0,
    borderStyle: "none",
    borderRadius: "9px",
    backgroundColor: colors.bgTertiary,
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "150ms",
    "::after": {
      position: "absolute",
      top: "2px",
      left: "2px",
      width: "14px",
      height: "14px",
      borderRadius: "50%",
      backgroundColor: colors.textSecondary,
      content: '""',
      transitionProperty: "transform, background-color",
      transitionDuration: "150ms",
    },
  },
  switchOn: {
    backgroundColor: colors.accent,
    "::after": {
      backgroundColor: "#fff",
      transform: "translateX(12px)",
    },
  },
  kbd: {
    padding: "1px 6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.control,
    color: colors.textSecondary,
    font: "inherit",
    fontSize: fontSizes.body,
  },
  footer: {
    marginTop: "32px",
  },
});

// A setting's row: its label, then its control.
function Setting(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div class={sx(styles.setting)}>
      <span class={sx(styles.label)}>{props.label}</span>
      <span class={sx(styles.control)}>{props.children}</span>
    </div>
  );
}

// Settings, laid out like the profile page. A preview: every control works on screen but nothing is saved or sent
// anywhere yet; each one gets wired up when its feature exists.
export function SettingsView(): JSX.Element {
  const app = useApp();
  const [theme, setTheme] = createSignal<"dark" | "light" | "system">("dark");
  const [accent, setAccent] = createSignal("#78aee7");
  const [toggles, setToggles] = createSignal({
    compactSidebar: false,
    questionToasts: true,
    sounds: false,
    dailySummary: true,
  });
  const [connected, setConnected] = createSignal<Record<string, boolean>>({});
  const flip = (key: keyof ReturnType<typeof toggles>): void => {
    setToggles((current) => ({ ...current, [key]: !current[key] }));
  };

  const toggle = (
    key: keyof ReturnType<typeof toggles>,
    label: string,
    note: string,
  ): JSX.Element => (
    <Setting label={label}>
      <button
        type="button"
        role="switch"
        class={sx(styles.switch, toggles()[key] && styles.switchOn)}
        aria-checked={`${toggles()[key]}`}
        aria-label={label}
        onClick={() => flip(key)}
      />
      <span class={sx(styles.note)}>{note}</span>
    </Setting>
  );

  return (
    <div class={sx(profile.page)}>
      <h1 class={sx(page.title)}>Settings</h1>
      <p class={sx(page.summary)}>A preview: changes here aren't saved yet.</p>

      <h2 class={sx(page.heading)}>Account</h2>
      <Setting label="Name">
        <input class={sx(styles.input)} defaultValue={app.me().name} aria-label="Name" />
      </Setting>
      <Setting label="Email">
        <input class={sx(styles.input)} placeholder="you@company.com" aria-label="Email" />
      </Setting>
      <Setting label="Password">
        <button type="button" class={sx(styles.button)}>
          Change password
        </button>
      </Setting>

      <h2 class={sx(page.heading)}>Appearance</h2>
      <Setting label="Theme">
        <span class={sx(styles.segmented)} role="radiogroup" aria-label="Theme">
          <For each={["dark", "light", "system"] as const}>
            {(option) => (
              <button
                type="button"
                role="radio"
                class={sx(styles.segment, theme() === option && styles.segmentChecked)}
                aria-checked={`${theme() === option}`}
                onClick={() => setTheme(option)}
              >
                {option[0].toUpperCase() + option.slice(1)}
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
              class={sx(styles.swatch, accent() === color && styles.swatchPressed)}
              aria-label={`Accent ${color}`}
              aria-pressed={`${accent() === color}`}
              style={{ "background-color": color }}
              onClick={() => setAccent(color)}
            />
          )}
        </For>
      </Setting>
      {toggle("compactSidebar", "Compact sidebar", "Tighter rows in the inbox and lists")}

      <h2 class={sx(page.heading)}>Notifications</h2>
      {toggle("questionToasts", "Mention toasts", "A toast when someone mentions you")}
      {toggle("sounds", "Sounds", "A soft chime when a question reaches you")}
      {toggle("dailySummary", "Daily summary", "An email each morning with your inbox")}

      <h2 class={sx(page.heading)}>Integrations</h2>
      <For each={["Google Calendar", "Slack", "GitHub"]}>
        {(name) => (
          <Setting label={name}>
            <button
              type="button"
              class={sx(styles.button)}
              onClick={() => setConnected((current) => ({ ...current, [name]: !current[name] }))}
            >
              {connected()[name] ? "Disconnect" : "Connect"}
            </button>
            <Show when={connected()[name]}>
              <span class={sx(styles.note)}>Connected</span>
            </Show>
          </Setting>
        )}
      </For>

      <h2 class={sx(page.heading)}>Workspace</h2>
      <Setting label="Members">
        {app.data.people().length} people
        <button type="button" class={sx(styles.button)}>
          Invite people
        </button>
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
            <kbd class={sx(styles.kbd)}>{keys}</kbd>
          </Setting>
        )}
      </For>

      <div class={sx(styles.footer)}>
        <button type="button" class={sx(styles.button)}>
          Sign out
        </button>
      </div>
    </div>
  );
}
