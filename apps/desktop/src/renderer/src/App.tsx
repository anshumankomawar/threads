import { Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { ArrowExpand01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { plainThreadLinks, splitThreadLinks, inboxReason, type Bucket } from "model";
import { SOURCE_LABELS } from "./api";
import { AppContext, createAppState } from "./app/state";
import { NewThreadPalette } from "./components/NewThreadPalette";
import { ComposePanel } from "./components/ComposePanel";
import { DraftView } from "./components/DraftView";
import { BucketPalette } from "./components/BucketPalette";
import { CommandPalette } from "./components/CommandPalette";
import { DetailsPanel } from "./components/DetailsPanel";
import { DetailsToggle, SearchButton, Sidebar, SidebarToggle } from "./components/Sidebar";
import { ThreadView } from "./components/ThreadView";
import { MovePalette } from "./components/MovePalette";
import { BlockedPalette } from "./components/BlockedPalette";
import { MentionToasts } from "./components/MentionToasts";
import { ContextMenu } from "./components/ContextMenu";
import { Icon } from "./components/Icon";
import { Identicon } from "./components/Identicon";
import { Keyed } from "./components/Keyed";
import { PersonView } from "./components/PersonView";
import { SprintView } from "./components/SprintView";
import { ProfileView } from "./components/ProfileView";
import { LabelView } from "./components/LabelView";
import { NewGroupPalette } from "./components/NewGroupPalette";
import { OrganizationPrompt } from "./components/OrganizationPrompt";
import { SettingsView } from "./components/SettingsView";
import { ViewAsPalette } from "./components/ViewAsPalette";
import { AppStatus } from "./components/AppStatus";
import { DragRegionResync, Titlebar } from "./components/DragRegionResync";
import { WipeButton } from "./components/WipeButton";
import { topbar } from "./styles/controls";
import { sx } from "./styles/sx";
import { colors, fontSizes, layers, radii, shadows } from "./styles/tokens.stylex";

const styles = stylex.create({
  // Cursor's main chat surface, darker than the sidebar.
  main: {
    position: "relative",
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
    backgroundColor: `color-mix(in srgb, ${colors.chrome} 72%, transparent)`,
  },
  // The main top bar beside the sidebar. After `topbar.bar`.
  topbarBesideSidebar: {
    paddingLeft: "12px",
  },
  // With the sidebar hidden, the toggle icon sits as far from the last traffic light (larger on macOS 26) as the top
  // bar's last icon sits from the sidebar's right edge, the sidebar inset (the sidebar's own top bar does the same, in
  // Sidebar.tsx).
  topbarAlone: {
    paddingLeft: "71.5px",
  },
  // Who you're viewing the app as; opens the View As palette.
  viewAs: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    height: "22px",
    marginRight: "4px",
    padding: "0 6px",
    borderStyle: "none",
    borderRadius: radii.control,
    color: {
      default: colors.textSecondary,
      ":hover": colors.textPrimary,
    },
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: "transparent",
    cursor: "pointer",
    WebkitAppRegion: "no-drag",
  },
  // Which data source you're on, ahead of who you're viewing as.
  viewAsSource: {
    marginRight: "4px",
    color: colors.textTertiary,
  },
  // A change the server refused, under the top bar until it's dismissed or the next change is made.
  saveError: {
    display: "flex",
    flexShrink: 0,
    gap: "8px",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 12px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
    color: colors.urgent,
  },
  saveErrorAction: {
    flexShrink: 0,
    padding: "2px 8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.strokeFocused,
    borderRadius: radii.control,
    color: colors.textPrimary,
    font: "inherit",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.bgTertiary,
    },
    cursor: "pointer",
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
  // The main thread and, when a thread link is open, the linked thread beside it.
  panes: {
    display: "flex",
    flex: 1,
    minHeight: 0,
  },
  splitPane: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.panelBorder,
  },
  splitPaneBar: {
    display: "flex",
    flexShrink: 0,
    gap: "2.5px",
    alignItems: "center",
    height: "34px",
    padding: "0 8px 0 12px",
  },
  splitPaneTitle: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: colors.textSecondary,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  undoToast: {
    position: "absolute",
    bottom: "20px",
    left: "50%",
    zIndex: layers.overlay,
    display: "flex",
    gap: "14px",
    alignItems: "center",
    padding: "8px 12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    backgroundColor: colors.panel,
    boxShadow: shadows.float,
    transform: "translateX(-50%)",
  },
  undoButton: {
    padding: 0,
    borderStyle: "none",
    color: colors.accent,
    font: "inherit",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
});

// The app's layout. Its state and actions are the app store (`app/state.ts`), provided to everything below as
// `AppContext`: components read what they need from it, so the layout only places them.
function App(): JSX.Element {
  const app = createAppState();
  const { data, nav, ui, threads, groups } = app;

  return (
    <AppContext value={app}>
      <Show when={app.client().status === "ready"} fallback={<AppStatus />}>
        <Titlebar />
        <DragRegionResync />
        <Show when={ui.sidebarOpen()}>
          <Sidebar />
        </Show>
        <main class={sx(styles.main)}>
          <div
            class={sx(
              topbar.bar,
              ui.sidebarOpen() ? styles.topbarBesideSidebar : styles.topbarAlone,
            )}
          >
            <Show when={!ui.sidebarOpen()}>
              <SidebarToggle />
              <SearchButton />
            </Show>
            <span class={sx(topbar.title)}>{nav.title()}</span>
            <span class={sx(topbar.end)}>
              <button
                type="button"
                class={sx(styles.viewAs)}
                aria-label={`Viewing as ${app.me().name}. Switch user`}
                onClick={() => ui.setViewAsOpen(true)}
              >
                <span class={sx(styles.viewAsSource)}>
                  {SOURCE_LABELS[app.source()]}
                  {app.client().connected ? "" : " · Offline"}
                </span>
                <Identicon seed={app.me().id} size={14} />
                <span>{app.me().name}</span>
              </button>
              <WipeButton />
              <DetailsToggle />
            </span>
          </div>
          {/* A change the server keeps failing on holds up everything after it: retry it, or give it up. */}
          <Show when={app.client().stuck !== null}>
            <div class={sx(styles.saveError)} role="alert">
              <span>
                A change couldn't be saved ({app.client().stuck}), and later changes are waiting
                behind it.
              </span>
              <button
                type="button"
                class={sx(styles.saveErrorAction)}
                onClick={() => app.client().retryStuck()}
              >
                Retry
              </button>
              <button
                type="button"
                class={sx(styles.saveErrorAction)}
                onClick={() => void app.client().discardStuck()}
              >
                Discard
              </button>
            </div>
          </Show>
          {/* A change the server refused has already been undone, so say so rather than letting it vanish. */}
          <Show when={app.client().error}>
            {(error) => (
              <div class={sx(styles.saveError)} role="alert">
                <span>
                  That change wasn't saved:{" "}
                  {error()
                    .split("\n")[0]
                    .replace(/^✖\s*/, "")}
                  .{app.source() === "cloudflare" && " The hosted API may need a deploy."}
                </span>
                <button
                  type="button"
                  class={sx(styles.saveErrorDismiss)}
                  aria-label="Dismiss"
                  onClick={() => app.client().dismissError()}
                >
                  <Icon icon={Cancel01Icon} size={12} aria-hidden="true" />
                </button>
              </div>
            )}
          </Show>
          {/* Each page is made anew for the person, sprint, label or draft it shows (keyed by its id). */}
          <Switch>
            <Match when={nav.profileOpen()}>
              <ProfileView />
            </Match>
            <Match when={nav.page() === "settings"}>
              <SettingsView />
            </Match>
            <Match when={nav.shownPerson()}>
              <Keyed value={nav.shownPerson()} by={(person) => person.id}>
                {(person) => <PersonView person={person()} />}
              </Keyed>
            </Match>
            <Match when={nav.sprintGroup() !== undefined && nav.shownSprint()}>
              <Keyed value={nav.shownSprint()} by={(sprint) => sprint.id}>
                {(sprint) => <SprintView sprint={sprint()} />}
              </Keyed>
            </Match>
            <Match
              when={
                (nav.page() === "all" || nav.shownLabel() !== undefined) &&
                (nav.shownLabel()?.id ?? "all")
              }
              keyed
            >
              {() => <LabelView />}
            </Match>
            <Match when={nav.shownDraft()}>
              <Keyed value={nav.shownDraft()} by={(draft) => draft.id}>
                {(shown) => <DraftView saved={shown()} />}
              </Keyed>
            </Match>
            <Match when={nav.activeThread() !== undefined}>
              {/* `thread-panes` stays: the store's R key finds the reply with `.thread-panes > .thread-view …`. */}
              <div class={[sx(styles.panes), "thread-panes"]}>
                <Keyed value={nav.activeThread()} by={(thread) => thread.id}>
                  {(thread) => (
                    <ThreadView
                      thread={thread()}
                      autoFocusReply={inboxReason(thread(), app.me().id, app.now()) === null}
                    />
                  )}
                </Keyed>
                <Show when={nav.splitThread()}>
                  {(split) => (
                    <section class={sx(styles.splitPane)} aria-label={split().title}>
                      <div class={sx(styles.splitPaneBar)}>
                        <span class={sx(styles.splitPaneTitle)}>{split().title}</span>
                        <button
                          type="button"
                          class={sx(topbar.button)}
                          aria-label="Open as the main thread"
                          onClick={() => nav.openThread(split().id)}
                        >
                          <Icon icon={ArrowExpand01Icon} size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          class={sx(topbar.button)}
                          aria-label="Close"
                          onClick={nav.closeSplit}
                        >
                          <Icon icon={Cancel01Icon} size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <Keyed value={split()} by={(thread) => thread.id}>
                        {(thread) => <ThreadView thread={thread()} />}
                      </Keyed>
                    </section>
                  )}
                </Show>
              </div>
            </Match>
          </Switch>
          <Show when={app.undo.current()}>
            {(current) => (
              <div class={sx(styles.undoToast)} role="status">
                <span>{current().text}</span>
                <button type="button" class={sx(styles.undoButton)} onClick={app.undo.run}>
                  Undo
                </button>
              </div>
            )}
          </Show>
        </main>
        <Show when={ui.detailsOpen()}>
          <DetailsPanel />
        </Show>
        <Show when={ui.composeOpen() && (ui.composing()?.id ?? "new")} keyed>
          {(_key) => (
            <ComposePanel initial={ui.composing()} onClose={() => ui.setComposeOpen(false)} />
          )}
        </Show>
        <Show when={ui.newThreadOpen()}>
          <NewThreadPalette
            initialLabels={(() => {
              const label = nav.pageLabel();
              return label === undefined ? [] : [label];
            })()}
            initialAssignee={nav.shownPerson() ?? null}
            onCreate={threads.create}
            onClose={() => ui.setNewThreadOpen(false)}
          />
        </Show>
        <Show when={ui.editingBucket()}>
          {(editing) => (
            <BucketPalette
              bucket={editing() === "new" ? null : (editing() as Bucket)}
              onSave={app.buckets.save}
              onClose={() => ui.setEditingBucket(null)}
            />
          )}
        </Show>
        <Show when={ui.newGroupOpen()}>
          <NewGroupPalette onCreate={groups.create} onClose={() => ui.setNewGroupOpen(false)} />
        </Show>
        <Show when={data.organization()?.name === "" || ui.renamingOrganization()}>
          <OrganizationPrompt
            current={data.organization()?.name ?? ""}
            onSave={groups.renameOrganization}
            onClose={() => ui.setRenamingOrganization(false)}
          />
        </Show>
        <Show when={ui.blocking()}>
          {(thread) => (
            <BlockedPalette
              blockedTitle={thread().title}
              onCreate={(person, title, description) =>
                threads.createBlocker(thread(), person, title, description)
              }
              onClose={() => ui.setBlocking(null)}
            />
          )}
        </Show>
        <Show when={ui.moving()}>
          {(current) => (
            <MovePalette
              count={current().messages.length}
              fromThreadId={current().from.id}
              linkedThreadIds={current().messages.flatMap((message) =>
                splitThreadLinks(message.text).flatMap((part) =>
                  "threadId" in part ? [part.threadId] : [],
                ),
              )}
              suggestedTitle={plainThreadLinks(
                current().messages[0].text.split("\n")[0],
                app.links.titleOf,
                app.links.nameOf,
              ).slice(0, 80)}
              onMove={threads.moveTo}
              onClose={() => ui.setMoving(null)}
            />
          )}
        </Show>
        <Show when={ui.searchOpen()}>
          <CommandPalette onClose={() => ui.setSearchOpen(false)} />
        </Show>
        <Show when={ui.viewAsOpen()}>
          <ViewAsPalette onPick={app.viewAs} onClose={() => ui.setViewAsOpen(false)} />
        </Show>
        <MentionToasts />
        <Show when={ui.threadMenu()}>
          {(menu) => (
            <ContextMenu
              x={menu().x}
              y={menu().y}
              items={threads.menuItems(menu().thread)}
              onClose={() => ui.setThreadMenu(null)}
            />
          )}
        </Show>
      </Show>
    </AppContext>
  );
}

export default App;
