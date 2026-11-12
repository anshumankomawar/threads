import { For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Draft, Label, Subspace, Thread, User, View } from "models";
import {
  active,
  dialog,
  itemFor,
  account,
  me,
  open,
  server,
  setDialog,
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
  workspaceShown,
  view,
  otherSources,
  shown,
} from "./session";
import { base } from "./styles/base";
import { chip, toast, topbar } from "./styles/controls";
import { sx } from "./styles/sx";
import { colors, fontSizes, radii, sidebarSpace } from "./styles/tokens.stylex";
import { ThreadView } from "./components/ThreadView";
import { Compose } from "./components/Compose";
import { DragRegionResync, Titlebar } from "./components/DragRegionResync";
import { Icon } from "./components/Icon";
import { Identicon } from "./components/Identicon";
import { ContextMenu } from "./components/Menus";
import { Palettes } from "./components/Palettes";
import { MentionToasts } from "./components/MentionToasts";
import {
  WorkspaceView,
  LabelView,
  PersonalView,
  PersonView,
  SavedView,
  SettingsView,
  SubspaceView,
} from "./components/Pages";
import { AppButtons, HistoryButtons, MessageList, Sidebar, TopButton } from "./components/Sidebar";
import { keysFor } from "./hotkeys";

const styles = stylex.create({
  // Over the window's drag strip, so it's no-drag or its buttons can't be clicked.
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
  saveErrorDismiss: { display: "flex", flexShrink: 0, cursor: "pointer" },
  main: {
    position: "relative",
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
    backgroundColor: colors.chrome,
  },
  // Beside the list: the reading pane's title 16px in, as the list's is.
  window: { display: "flex", flex: 1, flexDirection: "column", minWidth: 0 },
  columns: { display: "flex", flex: 1, minHeight: 0 },
  // The toolbar: clear of the traffic lights, its three parts on a grid so search sits in the window's middle.
  unified: {
    display: "grid",
    gridTemplateColumns: "1fr minmax(200px, 420px) 1fr",
    gap: 8,
    paddingLeft: sidebarSpace.afterLights,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
    backgroundColor: colors.chrome,
  },
  unifiedStart: { display: "flex", gap: 6, alignItems: "center", minWidth: 0 },
  unifiedEnd: { display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" },
  search: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 24,
    padding: "0 8px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.item,
    color: colors.textTertiary,
    // Solid, the same as ⌘K's panel that grows out of it, and steady under the pointer.
    backgroundColor: `color-mix(in srgb, ${colors.textPrimary} 5%, ${colors.chrome})`,
    fontSize: fontSizes.body,
    cursor: "text",
    WebkitAppRegion: "no-drag",
  },
  // While ⌘K is open it has grown out of this field, so the field itself steps aside.
  searchOpen: { visibility: "hidden" },
  searchText: { flex: 1, textAlign: "left" },
  searchKeys: { fontSize: fontSizes.small },
  viewAs: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 22,
    padding: "0 6px",
    borderStyle: "none",
    borderRadius: radii.row,
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
  // A top bar of its own (after `topbar.bar`), inset as the main one is.
  splitPaneBar: { padding: "0 8px" },
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
            <For each={otherSources}>
              {(s) => (
                <button class={sx(base.hover, chip.chip)} onClick={() => switchTo({ source: s })}>
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
  const label = () => store.findById(Label, shown("label") ?? "");
  const subspace = () => store.findById(Subspace, shown("subspace") ?? "");
  const savedView = () => store.findById(View, shown("view") ?? "");
  const person = () => store.findById(User, shown("person") ?? "");
  // Nothing to read: the list takes the window.
  const nothingOpen = (): boolean =>
    !active() &&
    !label() &&
    !subspace() &&
    !savedView() &&
    !workspaceShown() &&
    !person() &&
    !store.findById(Draft, shown("draft") ?? "") &&
    !("settings" in view()) &&
    !("personal" in view());
  return (
    <>
      <Titlebar />
      <DragRegionResync />
      <Show when={signedIn()} fallback={<Waiting />}>
        <div class={sx(styles.window)}>
          {/* One toolbar across the window, as Thunderbird's: the sidebar's toggle with back and forward, search in the
            middle, who you are and Settings at the end. The columns under it have no bars of their own. */}
          <header data-bar class={sx(topbar.bar, styles.unified)}>
            <div class={sx(styles.unifiedStart)}>
              <AppButtons />
              <HistoryButtons />
            </div>
            <button
              data-search-anchor
              class={sx(
                base.bare,
                styles.search,
                (dialog()?.kind === "search" || dialog()?.kind === "find") && styles.searchOpen,
              )}
              title={`Search (${keysFor("search")})`}
              onClick={() => setDialog({ kind: "search" })}
            >
              <Icon icon="search" aria-hidden="true" />
              <span class={sx(styles.searchText)}>Search…</span>
              <span class={sx(styles.searchKeys)}>{keysFor("search")}</span>
            </button>
            <div class={sx(styles.unifiedEnd)}>
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
              <TopButton
                label={`Settings (${keysFor("settings")})`}
                icon="settings"
                onClick={() => open({ settings: null })}
              />
            </div>
          </header>
          <div class={sx(styles.columns)}>
            {/* Settings takes the whole window under the toolbar: no sidebar or list beside it. */}
            <Show when={sidebarOpen() && !("settings" in view())}>
              <Sidebar />
            </Show>
            {/* Mail's columns: the mailboxes, the chosen one's threads, and the thread you're reading. */}
            <Show when={!("settings" in view())}>
              <MessageList alone={nothingOpen()} />
            </Show>
            <Show when={!nothingOpen()}>
              <main class={sx(styles.main)}>
                {/* A change the server refused has already been undone, so say so rather than letting it vanish. */}
                <Show when={store.rejection()}>
                  {(reason) => (
                    <div class={sx(styles.saveError)} role="alert">
                      <span>That change wasn't saved: {reason()}.</span>
                      <button
                        class={sx(base.bare, styles.saveErrorDismiss)}
                        aria-label="Dismiss"
                        onClick={() => store.dismissRejection()}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </Show>

                <Switch>
                  <Match when={label()} keyed>
                    {(label) => <LabelView label={label} />}
                  </Match>
                  <Match when={subspace()} keyed>
                    {(subspace) => <SubspaceView subspace={subspace} />}
                  </Match>
                  <Match when={savedView()} keyed>
                    {(saved) => <SavedView view={saved} />}
                  </Match>
                  <Match when={workspaceShown()}>
                    <WorkspaceView />
                  </Match>
                  <Match when={person()} keyed>
                    {(user) => <PersonView user={user} />}
                  </Match>
                  <Match when={"settings" in view()}>
                    <SettingsView />
                  </Match>
                  <Match when={"personal" in view()}>
                    <PersonalView />
                  </Match>
                  <Match when={store.findById(Draft, shown("draft") ?? "")} keyed>
                    {(draft) => <Compose draftId={draft.id} page />}
                  </Match>
                  <Match when={active()} keyed>
                    {(thread) => (
                      <div class={sx(styles.panes)}>
                        <ThreadView thread={thread} autofocus={!itemFor(thread)} />
                        <Show when={store.findById(Thread, split() ?? "")} keyed>
                          {(beside) => (
                            <section class={sx(styles.splitPane)} aria-label={beside.title}>
                              <div data-bar class={sx(topbar.bar, styles.splitPaneBar)}>
                                <span class={sx(base.ellipsis, topbar.title, styles.splitTitle)}>
                                  {beside.title}
                                </span>
                                <button
                                  class={sx(topbar.button)}
                                  aria-label="Open as the main thread"
                                  onClick={() => open({ thread: beside.id })}
                                >
                                  <Icon icon={"layout"} size={13} aria-hidden="true" />
                                </button>
                                <button
                                  class={sx(topbar.button)}
                                  aria-label="Close"
                                  onClick={() => setSplit(null)}
                                >
                                  <Icon icon={"close"} size={14} aria-hidden="true" />
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
                    <div class={sx(base.panel, toast.undo)} role="status">
                      <span>{offered().text}</span>
                      <button
                        class={sx(base.bare, toast.action)}
                        onClick={() => (offered().run(), setUndo(null))}
                      >
                        Undo
                      </button>
                    </div>
                  )}
                </Show>
              </main>
            </Show>
          </div>
        </div>
        <Palettes />
        <MentionToasts />
        <ContextMenu />
      </Show>
    </>
  );
}
