import type { Person } from "model";
import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";

// Settings, laid out like the profile page. A preview: every control works on screen but nothing is saved or sent
// anywhere yet; each one gets wired up when its feature exists.
export function SettingsView(props: { me: Person; people: Person[] }): JSX.Element {
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
    <div class="profile-setting">
      <span class="profile-setting-label">{label}</span>
      <span class="profile-setting-control">
        <button
          type="button"
          role="switch"
          class="settings-switch"
          aria-checked={`${toggles()[key]}`}
          aria-label={label}
          onClick={() => flip(key)}
        />
        <span class="settings-note">{note}</span>
      </span>
    </div>
  );

  return (
    <div class="org settings">
      <h1 class="org-title">Settings</h1>
      <p class="org-summary">A preview: changes here aren't saved yet.</p>

      <h2 class="profile-heading">Account</h2>
      <div class="profile-setting">
        <span class="profile-setting-label">Name</span>
        <span class="profile-setting-control">
          <input class="settings-input" defaultValue={props.me.name} aria-label="Name" />
        </span>
      </div>
      <div class="profile-setting">
        <span class="profile-setting-label">Email</span>
        <span class="profile-setting-control">
          <input class="settings-input" placeholder="you@company.com" aria-label="Email" />
        </span>
      </div>
      <div class="profile-setting">
        <span class="profile-setting-label">Password</span>
        <span class="profile-setting-control">
          <button type="button" class="settings-button">
            Change password
          </button>
        </span>
      </div>

      <h2 class="profile-heading">Appearance</h2>
      <div class="profile-setting">
        <span class="profile-setting-label">Theme</span>
        <span class="profile-setting-control">
          <span class="settings-segmented" role="radiogroup" aria-label="Theme">
            <For each={["dark", "light", "system"] as const}>
              {(option) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={`${theme() === option}`}
                  onClick={() => setTheme(option)}
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </button>
              )}
            </For>
          </span>
        </span>
      </div>
      <div class="profile-setting">
        <span class="profile-setting-label">Accent</span>
        <span class="profile-setting-control">
          <For each={["#78aee7", "#9d8cf2", "#5fc79a", "#e8a25c", "#e5737f"]}>
            {(color) => (
              <button
                type="button"
                class="settings-swatch"
                aria-label={`Accent ${color}`}
                aria-pressed={`${accent() === color}`}
                style={{ "background-color": color }}
                onClick={() => setAccent(color)}
              />
            )}
          </For>
        </span>
      </div>
      {toggle("compactSidebar", "Compact sidebar", "Tighter rows in the inbox and lists")}

      <h2 class="profile-heading">Notifications</h2>
      {toggle("questionToasts", "Mention toasts", "A toast when someone mentions you")}
      {toggle("sounds", "Sounds", "A soft chime when a question reaches you")}
      {toggle("dailySummary", "Daily summary", "An email each morning with your inbox")}

      <h2 class="profile-heading">Integrations</h2>
      <For each={["Google Calendar", "Slack", "GitHub"]}>
        {(name) => (
          <div class="profile-setting">
            <span class="profile-setting-label">{name}</span>
            <span class="profile-setting-control">
              <button
                type="button"
                class="settings-button"
                onClick={() => setConnected((current) => ({ ...current, [name]: !current[name] }))}
              >
                {connected()[name] ? "Disconnect" : "Connect"}
              </button>
              <Show when={connected()[name]}>
                <span class="settings-note">Connected</span>
              </Show>
            </span>
          </div>
        )}
      </For>

      <h2 class="profile-heading">Workspace</h2>
      <div class="profile-setting">
        <span class="profile-setting-label">Members</span>
        <span class="profile-setting-control">
          {props.people.length} people
          <button type="button" class="settings-button">
            Invite people
          </button>
        </span>
      </div>

      <h2 class="profile-heading">Keyboard shortcuts</h2>
      <For
        each={[
          ["Search and commands", "⌘K or ⌘⇧F"],
          ["New thread", "⌘N"],
          ["View as someone else", "⌘U"],
          ["Text size", "⌘+  ⌘-  ⌘0"],
        ]}
      >
        {([label, keys]) => (
          <div class="profile-setting">
            <span class="profile-setting-label">{label}</span>
            <span class="profile-setting-control">
              <kbd class="settings-kbd">{keys}</kbd>
            </span>
          </div>
        )}
      </For>

      <div class="settings-footer">
        <button type="button" class="settings-button">
          Sign out
        </button>
      </div>
    </div>
  );
}
