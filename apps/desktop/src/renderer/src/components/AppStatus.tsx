import type { JSX } from "@solidjs/web";
import { For, Match, Switch } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { CLOUDFLARE_AVAILABLE, serverFor, SOURCE_LABELS, type DataSource } from "../api";
import { useApp } from "../app/state";
import { sx } from "../styles/sx";
import { colors, radii } from "../styles/tokens.stylex";
import { Titlebar } from "./DragRegionResync";

const styles = stylex.create({
  status: {
    display: "grid",
    flex: 1,
    placeItems: "center",
    padding: "0 32px",
    color: colors.textTertiary,
    textAlign: "center",
  },
  body: { display: "flex", flexDirection: "column", gap: 12, alignItems: "center" },
  actions: { display: "flex", gap: 8 },
  button: {
    height: 26,
    padding: "0 10px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.button,
    color: {
      default: colors.textSecondary,
      ":hover": colors.textPrimary,
      ":focus-visible": colors.textPrimary,
    },
    font: "inherit",
    backgroundColor: colors.panel,
    cursor: "pointer",
    outline: "none",
  },
});

// Until the sync client is ready: loading, out of date, or waiting for the API with a way to another data source.
export function AppStatus(): JSX.Element {
  const app = useApp();
  const others = (): DataSource[] =>
    (["cloudflare", "local", "sample"] as const).filter(
      (option) => option !== app.source() && (option !== "cloudflare" || CLOUDFLARE_AVAILABLE),
    );
  return (
    <>
      <Titlebar />
      <div class={sx(styles.status)}>
        <Switch fallback="Loading…">
          <Match when={app.client().status === "outdated"}>
            This version of Threads is out of date. Pull the latest code and restart to keep
            syncing.
          </Match>
          <Match when={app.client().status === "waiting"}>
            <div class={sx(styles.body)}>
              <div>
                Waiting for the {SOURCE_LABELS[app.source()]} API at {serverFor(app.source()).url}
                {app.source() === "cloudflare" ? "" : " (vp run api#dev)"}…{" "}
                {app.client().error ?? ""}
              </div>
              <div
                class={sx(styles.actions)}
                ref={(el) => queueMicrotask(() => el.querySelector("button")?.focus())}
              >
                <For each={others()}>
                  {(option) => (
                    <button
                      type="button"
                      class={sx(styles.button)}
                      onClick={() => app.switchSource(option)}
                    >
                      Use {SOURCE_LABELS[option]} Data
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Match>
        </Switch>
      </div>
    </>
  );
}
