import { useState } from "react";
import type { Person } from "model";

// Settings, laid out like the profile page. A preview: every control works on screen but nothing is saved or sent
// anywhere yet; each one gets wired up when its feature exists.
export function SettingsView({ me, people }: { me: Person; people: Person[] }): React.JSX.Element {
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [accent, setAccent] = useState("#78aee7");
  const [toggles, setToggles] = useState({
    compactSidebar: false,
    questionToasts: true,
    sounds: false,
    dailySummary: true,
    quietInFocus: true,
  });
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const flip = (key: keyof typeof toggles): void =>
    setToggles((current) => ({ ...current, [key]: !current[key] }));

  const toggle = (key: keyof typeof toggles, label: string, note: string): React.JSX.Element => (
    <div className="profile-setting">
      <span className="profile-setting-label">{label}</span>
      <span className="profile-setting-control">
        <button
          type="button"
          role="switch"
          className="settings-switch"
          aria-checked={toggles[key]}
          aria-label={label}
          onClick={() => flip(key)}
        />
        <span className="settings-note">{note}</span>
      </span>
    </div>
  );

  return (
    <div className="org settings">
      <h1 className="org-title">Settings</h1>
      <p className="org-summary">A preview: changes here aren't saved yet.</p>

      <h2 className="profile-heading">Account</h2>
      <div className="profile-setting">
        <span className="profile-setting-label">Name</span>
        <span className="profile-setting-control">
          <input className="settings-input" defaultValue={me.name} aria-label="Name" />
        </span>
      </div>
      <div className="profile-setting">
        <span className="profile-setting-label">Email</span>
        <span className="profile-setting-control">
          <input className="settings-input" placeholder="you@company.com" aria-label="Email" />
        </span>
      </div>
      <div className="profile-setting">
        <span className="profile-setting-label">Password</span>
        <span className="profile-setting-control">
          <button type="button" className="settings-button">
            Change password
          </button>
        </span>
      </div>

      <h2 className="profile-heading">Appearance</h2>
      <div className="profile-setting">
        <span className="profile-setting-label">Theme</span>
        <span className="profile-setting-control">
          <span className="settings-segmented" role="radiogroup" aria-label="Theme">
            {(["dark", "light", "system"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={theme === option}
                onClick={() => setTheme(option)}
              >
                {option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </span>
        </span>
      </div>
      <div className="profile-setting">
        <span className="profile-setting-label">Accent</span>
        <span className="profile-setting-control">
          {["#78aee7", "#9d8cf2", "#5fc79a", "#e8a25c", "#e5737f"].map((color) => (
            <button
              key={color}
              type="button"
              className="settings-swatch"
              aria-label={`Accent ${color}`}
              aria-pressed={accent === color}
              style={{ backgroundColor: color }}
              onClick={() => setAccent(color)}
            />
          ))}
        </span>
      </div>
      {toggle("compactSidebar", "Compact sidebar", "Tighter rows in the schedule and lists")}

      <h2 className="profile-heading">Notifications</h2>
      {toggle("questionToasts", "Question toasts", "Held while you're in a meeting or focus block")}
      {toggle("sounds", "Sounds", "A soft chime when a question reaches you")}
      {toggle("dailySummary", "Daily summary", "An email each morning with your day")}
      {toggle(
        "quietInFocus",
        "Quiet in focus",
        "Hold everything, not just questions, during focus",
      )}

      <h2 className="profile-heading">Integrations</h2>
      {["Google Calendar", "Slack", "GitHub"].map((name) => (
        <div key={name} className="profile-setting">
          <span className="profile-setting-label">{name}</span>
          <span className="profile-setting-control">
            <button
              type="button"
              className="settings-button"
              onClick={() => setConnected((current) => ({ ...current, [name]: !current[name] }))}
            >
              {connected[name] ? "Disconnect" : "Connect"}
            </button>
            {connected[name] && <span className="settings-note">Connected</span>}
          </span>
        </div>
      ))}

      <h2 className="profile-heading">Workspace</h2>
      <div className="profile-setting">
        <span className="profile-setting-label">Members</span>
        <span className="profile-setting-control">
          {people.length} people
          <button type="button" className="settings-button">
            Invite people
          </button>
        </span>
      </div>

      <h2 className="profile-heading">Keyboard shortcuts</h2>
      {[
        ["Search and commands", "⌘K or ⌘⇧F"],
        ["New thread", "⌘N"],
        ["View as someone else", "⌘U"],
        ["Text size", "⌘+  ⌘-  ⌘0"],
      ].map(([label, keys]) => (
        <div key={label} className="profile-setting">
          <span className="profile-setting-label">{label}</span>
          <span className="profile-setting-control">
            <kbd className="settings-kbd">{keys}</kbd>
          </span>
        </div>
      ))}

      <div className="settings-footer">
        <button type="button" className="settings-button">
          Sign out
        </button>
      </div>
    </div>
  );
}
