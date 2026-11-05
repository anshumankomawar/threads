import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { CLOUDFLARE_AVAILABLE, serverFor, SOURCE_LABELS } from "../api";
import * as stylex from "@stylexjs/stylex";
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
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    alignItems: "center",
  },
  actions: {
    display: "flex",
    gap: "8px",
  },
  button: {
    height: "26px",
    padding: "0 10px",
    borderWidth: "1px",
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
    outline: {
      default: null,
      ":hover": "none",
      ":focus-visible": "none",
    },
  },
});

// What shows until the sync client is ready: loading, waiting for the API (with a way to another data source), or
// out of date.
export function AppStatus(): JSX.Element {
  const app = useApp();
  return (
    <>
      <Titlebar />
      <div class={sx(styles.status)}>
        {app.client().status === "outdated" ? (
          <div class={sx(styles.body)}>
            {/* The server runs a newer schema; nothing syncs until the app is updated. */}
            <div>
              This version of Threads is out of date. Pull the latest code and restart to keep
              syncing.
            </div>
          </div>
        ) : app.client().status === "waiting" ? (
          <div class={sx(styles.body)}>
            <div>
              Waiting for the {SOURCE_LABELS[app.source()]} API at {serverFor(app.source()).url}
              {app.source() === "cloudflare" ? "" : " (vp run api#dev)"}… {app.client().error ?? ""}
            </div>
            {/* A way out while that server can't be reached. The first is focused. */}
            <div
              class={sx(styles.actions)}
              ref={(element) => queueMicrotask(() => element.querySelector("button")?.focus())}
            >
              <For
                each={(["cloudflare", "local", "sample"] as const).filter(
                  (option) =>
                    option !== app.source() && (option !== "cloudflare" || CLOUDFLARE_AVAILABLE),
                )}
              >
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
        ) : (
          "Loading…"
        )}
      </div>
    </>
  );
}
