import * as i from "@hugeicons/core-free-icons";
import { For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Label, Thread, User } from "models";
import {
  active,
  itemFor,
  account,
  me,
  open,
  server,
  setDialog,
  setSidebarOpen,
  setSplit,
  sidebarOpen,
  signedIn,
  source,
  SOURCES,
  split,
  store,
  switchTo,
  undo,
  setUndo,
  view,
  type Source,
} from "./session";
import { chip, toast, topbar } from "./styles/controls";
import { sx } from "./styles/sx";
import { colors, fontSizes, radii } from "./styles/tokens.stylex";
import { ThreadView } from "./components/ThreadView";
import { DragRegionResync, Titlebar } from "./components/DragRegionResync";
import { Icon } from "./components/Icon";
import { Identicon } from "./components/Identicon";
import { ContextMenu } from "./components/Menus";
import { Palettes } from "./components/Palettes";
import { MentionToasts } from "./components/MentionToasts";
import { LabelView, PersonView } from "./components/Pages";
import { Sidebar, sidebarIcon, TopButton } from "./components/Sidebar";

const styles = stylex.create({
  saveError: {
    display: "flex",
    flexShrink: 0,
    gap: 8,
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 12px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
    color: colors.urgent,
  },
  saveErrorDismiss: {
    display: "flex",
    flexShrink: 0,
    padding: 0,
    borderStyle: "none",
    color: "inherit",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  main: {
    position: "relative",
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
    backgroundColor: `color-mix(in srgb, ${colors.chrome} 72%, transparent)`,
  },
  // Beside the sidebar, or clear of the traffic lights without it.
  topbarBesideSidebar: { paddingLeft: 12 },
  topbarAlone: { paddingLeft: 71.5 },
  viewAs: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 22,
    marginRight: 4,
    padding: "0 6px",
    borderStyle: "none",
    borderRadius: radii.control,
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: "transparent",
    cursor: "pointer",
    WebkitAppRegion: "no-drag",
  },
  viewAsSource: { marginRight: 4, color: colors.textTertiary },
  panes: { display: "flex", flex: 1, minHeight: 0 },
  splitPane: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: colors.panelBorder,
  },
  splitPaneBar: {
    display: "flex",
    flexShrink: 0,
    gap: 2.5,
    alignItems: "center",
    height: 34,
    padding: "0 8px 0 12px",
  },
  splitTitle: { flex: 1 },
  status: {
    display: "grid",
    flex: 1,
    placeItems: "center",
    color: colors.textTertiary,
    textAlign: "center",
  },
  sources: { display: "flex", gap: 6, justifyContent: "center", marginTop: 14 },
});

// Until you're signed in: loading, or waiting for the API, with a way to another data source.
function Waiting(): JSX.Element {
  return (
    <div class={sx(styles.status)}>
      <Show when={store.connection() === "offline"} fallback="Loading…">
        <div>
          Waiting for the {SOURCES[source]} API at {server.url}…
          <div class={sx(styles.sources)}>
            <For each={(Object.keys(SOURCES) as Source[]).filter((s) => s !== source)}>
              {(s) => (
                <button class={sx(chip.chip)} onClick={() => switchTo({ source: s })}>
                  Use {SOURCES[s]} data
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default function App(): JSX.Element {
  const shown = (key: "label" | "person"): string | undefined =>
    (view() as Record<string, string | undefined>)[key];
  return (
    <>
      <Titlebar />
      <DragRegionResync />
      <Show when={signedIn()} fallback={<Waiting />}>
        <Show when={sidebarOpen()}>
          <Sidebar />
        </Show>
        <main class={sx(styles.main)}>
          {/* A change the server refused has already been undone, so say so rather than letting it vanish. */}
          <Show when={store.rejection()}>
            {(reason) => (
              <div class={sx(styles.saveError)} role="alert">
                <span>That change wasn't saved: {reason()}.</span>
                <button
                  class={sx(styles.saveErrorDismiss)}
                  aria-label="Dismiss"
                  onClick={() => store.dismissRejection()}
                >
                  ×
                </button>
              </div>
            )}
          </Show>
          <div
            class={sx(topbar.bar, sidebarOpen() ? styles.topbarBesideSidebar : styles.topbarAlone)}
          >
            <Show when={!sidebarOpen()}>
              <TopButton
                label="Show sidebar"
                icon={sidebarIcon(false)}
                onClick={() => setSidebarOpen(true)}
              />
              <TopButton
                label="Search"
                icon={i.Search01Icon}
                onClick={() => setDialog({ kind: "search" })}
              />
            </Show>
            <span class={sx(topbar.title)}>
              {active()?.title ??
                store.findById(Label, shown("label") ?? "")?.name ??
                store.findById(User, shown("person") ?? "")?.name}
            </span>
            <span class={sx(topbar.end)}>
              <button
                class={sx(styles.viewAs)}
                disabled={account !== null}
                aria-label={`Viewing as ${me().name}. Switch user`}
                onClick={() => setDialog({ kind: "viewAs" })}
              >
                <span class={sx(styles.viewAsSource)}>
                  {SOURCES[source]}
                  {store.connection() === "offline" && " · Offline"}
                </span>
                <Identicon seed={me().id} size={14} />
                <span>{me().name}</span>
              </button>
            </span>
          </div>
          <Switch>
            <Match when={store.findById(Label, shown("label") ?? "")} keyed>
              {(label) => <LabelView label={label} />}
            </Match>
            <Match when={store.findById(User, shown("person") ?? "")} keyed>
              {(user) => <PersonView user={user} />}
            </Match>
            <Match when={active()} keyed>
              {(thread) => (
                <div class={sx(styles.panes)}>
                  <ThreadView thread={thread} autofocus={!itemFor(thread)} />
                  <Show when={store.findById(Thread, split() ?? "")} keyed>
                    {(beside) => (
                      <section class={sx(styles.splitPane)} aria-label={beside.title}>
                        <div class={sx(styles.splitPaneBar)}>
                          <span class={sx(topbar.title, styles.splitTitle)}>{beside.title}</span>
                          <button
                            class={sx(topbar.button)}
                            aria-label="Open as the main thread"
                            onClick={() => open({ thread: beside.id })}
                          >
                            <Icon icon={i.ArrowExpand01Icon} size={13} aria-hidden="true" />
                          </button>
                          <button
                            class={sx(topbar.button)}
                            aria-label="Close"
                            onClick={() => setSplit(null)}
                          >
                            <Icon icon={i.Cancel01Icon} size={14} aria-hidden="true" />
                          </button>
                        </div>
                        <ThreadView thread={beside} />
                      </section>
                    )}
                  </Show>
                </div>
              )}
            </Match>
          </Switch>
          <Show when={undo()}>
            {(offered) => (
              <div class={sx(toast.undo)} role="status">
                <span>{offered().text}</span>
                <button class={sx(toast.action)} onClick={() => (offered().run(), setUndo(null))}>
                  Undo
                </button>
              </div>
            )}
          </Show>
        </main>
        <Palettes />
        <MentionToasts />
        <ContextMenu />
      </Show>
    </>
  );
}
