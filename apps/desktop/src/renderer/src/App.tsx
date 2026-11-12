import * as i from "@hugeicons/core-free-icons";
import { For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Draft, Label, Subspace, Thread, User, View } from "models";
import {
  active,
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
import { chip, toast } from "./styles/controls";
import { sx } from "./styles/sx";
import { z } from "./styles/zotero";
import { colors, fontSizes, sidebarSpace, zotero } from "./styles/tokens.stylex";
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
import { MessageList, resizable, Sidebar } from "./components/Sidebar";
import { keysFor } from "./hotkeys";

// The item pane: $min-width-item-pane (320px) and the side navigation's 37px, ÷ 1.1, at the least.
const itemPane = resizable("zotero-item-pane-width", { initial: 400, min: 325, max: 800 }, "left");

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
  // Zotero's window: the tab bar over the library view.
  window: { display: "flex", flex: 1, flexDirection: "column", minWidth: 0 },
  // #zotero-title-bar: --material-tabbar over a pane divider, its tabs after the window's buttons (the safe area).
  tabbar: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    height: zotero.tabbar,
    paddingLeft: sidebarSpace.afterLights,
    backgroundColor: colors.zTabbar,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.zPanedivider,
  },
  // .tabs: 4px over and under, 4px apart.
  tabs: {
    display: "flex",
    flex: 1,
    gap: zotero.min,
    minWidth: 0,
    paddingBlock: zotero.min,
    paddingInline: 1,
  },
  // .tab.selected, not closable: 28px, 100–200px wide, 6px in, rounded 5px, --material-button with its shadow.
  tab: {
    display: "flex",
    flex: "1 1 181.82px",
    alignItems: "center",
    minWidth: "90.91px",
    maxWidth: "181.82px",
    height: zotero.button,
    padding: "5.45px",
    borderRadius: zotero.radius,
    color: colors.zFillPrimary,
    fontSize: fontSizes.body,
    backgroundColor: colors.zButton,
    boxShadow: colors.zTabShadow,
    cursor: "default",
    WebkitAppRegion: "no-drag",
  },
  tabIcon: { display: "flex", flexShrink: 0, color: colors.zFillSecondary },
  // .tab-name: 4px after the icon.
  tabName: { flex: 1, marginLeft: zotero.min },
  // #zotero-tabs-toolbar.
  tabsToolbar: { display: "flex", flexShrink: 0, alignItems: "center", paddingRight: zotero.xs },
  main: {
    position: "relative",
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
    backgroundColor: colors.chrome,
  },
  // Beside the items pane, as Zotero's item pane: as wide as you make it.
  mainItem: { flex: "0 1 auto", backgroundColor: colors.zSidepane },
  // A page that isn't a thread: its title in an item-pane-header-like bar.
  pageBar: {
    gap: zotero.min,
    color: colors.zFillPrimary,
    fontWeight: 600,
    backgroundColor: colors.zSidepane,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.zFillQuinary,
  },
  pageTitle: { flex: 1, paddingInline: "4.55px" },
  // A toolbarbutton with a label: View As.
  viewAs: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: zotero.button,
    padding: "0 5.45px",
    borderStyle: "none",
    borderRadius: zotero.radius,
    color: colors.zFillSecondary,
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": colors.zFillQuinary,
      ":active:not(:disabled)": colors.zFillQuarternary,
    },
    cursor: "default",
    WebkitAppRegion: "no-drag",
  },
  viewAsSource: { marginRight: 4, color: colors.zFillTertiary },
  panes: { display: "flex", flex: 1, minHeight: 0 },
  // Another thread beside it: a second item pane, a pane divider between.
  splitPane: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: colors.zPanedivider,
  },
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
          <div data-bar class={sx(styles.tabbar)}>
            {/* The library's tab, chosen: Zotero opens it first and keeps it open. */}
            <div class={sx(styles.tabs)} role="tablist">
              <div class={sx(styles.tab)} role="tab" aria-selected="true">
                <span class={sx(styles.tabIcon)}>
                  <Icon icon={i.LibraryIcon} size={14.55} aria-hidden="true" />
                </span>
                <span class={sx(base.ellipsis, styles.tabName)}>My Library</span>
              </div>
            </div>
            {/* #zotero-tabs-toolbar, where Zotero's sync button is: who you're viewing as, and your settings. */}
            <div class={sx(styles.tabsToolbar)}>
              <button
                class={sx(styles.viewAs)}
                disabled={account !== null}
                aria-label={`Viewing as ${me().name}. Switch user`}
                title={`View As (${keysFor("viewAs")})`}
                onClick={() => setDialog({ kind: "viewAs" })}
              >
                <span class={sx(styles.viewAsSource)}>
                  {SOURCES[source]}
                  {store.connection() === "offline" && " · Offline"}
                </span>
                <Identicon seed={me().id} size={14} />
                <span>{me().name}</span>
              </button>
              <span class={sx(z.separator)} />
              <button
                class={sx(z.button)}
                aria-label="Profile and Settings"
                title={`Profile and Settings (${keysFor("settings")})`}
                onClick={() => open({ settings: null })}
              >
                <Icon icon={i.Settings02Icon} size={18.18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div class={sx(styles.panes)}>
            <Show when={sidebarOpen()}>
              <Sidebar />
            </Show>
            {/* Zotero's panes: the collections (mailboxes), the items (the chosen one's threads), and the item
                pane (the thread you're reading). */}
            <MessageList alone={nothingOpen()} fill={active() !== undefined} />
            <Show when={!nothingOpen()}>
              <main
                class={sx(styles.main, active() !== undefined && styles.mainItem)}
                style={{
                  width:
                    active() !== undefined
                      ? `${itemPane.width() * (split() ? 2 : 1)}px`
                      : undefined,
                }}
              >
                <Show when={active() !== undefined}>
                  <itemPane.Edge label="Resize Item Pane" />
                </Show>
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
                {/* A thread has its own header (ThreadView); any other page, a bar with its title. */}
                <Show when={active() === undefined}>
                  <div data-bar class={sx(z.toolbar, styles.pageBar)}>
                    <span class={sx(base.ellipsis, styles.pageTitle)}>
                      {label()?.name ??
                        subspace()?.name ??
                        savedView()?.name ??
                        (workspaceShown() ? "Workspace" : undefined) ??
                        (shown("draft") !== undefined ? "Draft" : undefined) ??
                        ("settings" in view() ? "Settings" : undefined) ??
                        ("personal" in view() ? "Personal" : undefined) ??
                        person()?.name}
                    </span>
                    {/* Closes what's open, and the pane with it. */}
                    <button
                      class={sx(z.button)}
                      aria-label="Close"
                      title="Close"
                      onClick={() => open({ thread: null })}
                    >
                      <Icon icon={i.Cancel01Icon} size={14.55} aria-hidden="true" />
                    </button>
                  </div>
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
                        <ThreadView
                          thread={thread}
                          autofocus={!itemFor(thread)}
                          onClose={() => open({ thread: null })}
                        />
                        <Show when={store.findById(Thread, split() ?? "")} keyed>
                          {(beside) => (
                            <section class={sx(styles.splitPane)} aria-label={beside.title}>
                              <ThreadView
                                thread={beside}
                                onExpand={() => open({ thread: beside.id })}
                                onClose={() => setSplit(null)}
                              />
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
