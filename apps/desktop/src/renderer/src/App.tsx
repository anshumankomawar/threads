import * as i from "@hugeicons/core-free-icons";
import { For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Draft, Label, Subspace, Thread, User, View } from "models";
import {
  active,
  itemFor,
  open,
  server,
  peek,
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
  allThreads,
  view,
  otherSources,
  shown,
} from "./session";
import { base } from "./styles/base";
import { chip, toast, topbar } from "./styles/controls";
import { sx } from "./styles/sx";
import { colors, fontSizes } from "./styles/tokens.stylex";
import { ThreadView } from "./components/ThreadView";
import { DragRegionResync, Titlebar } from "./components/DragRegionResync";
import { Icon } from "./components/Icon";
import { ContextMenu } from "./components/Menus";
import { Palettes } from "./components/Palettes";
import { MentionToasts } from "./components/MentionToasts";
import {
  BucketView,
  LabelView,
  PersonView,
  SavedView,
  SettingsView,
  SubspaceView,
} from "./components/Pages";
import { HistoryButtons } from "./components/TopButtons";
import { DraftView } from "./components/DraftView";
import { Peek } from "./components/Peek";
import { MailSidebar, MessageList, NothingOpen, ThreadActions } from "./components/Mail";
import { display, mailbox } from "./mail";

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
  // Beside the list, which has the window's buttons when the sidebar's hidden.
  topbarBesideList: { paddingLeft: 8 },
  // Only when the connection's down: viewing as someone else and the data source are in ⌘K (and ⌘U).
  offline: { color: colors.textTertiary, fontSize: fontSizes.body },
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
      <Show when={store.connection() === "offline"} fallback="Loading">
        <div>
          Waiting for the {SOURCES[source]} API at {server.url}
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
  // With no thread open, the chosen mailbox's own page: a space's, a view's or a label's settings.
  const chosenId = (kind: "subspace" | "view" | "label" | "bucket"): string | undefined => {
    const shownNow = view();
    const box = mailbox();
    return "thread" in shownNow && shownNow.thread === null && box.kind === kind
      ? box.id
      : undefined;
  };
  const bucket = () => store.findById(Bucket, shown("bucket") ?? chosenId("bucket") ?? "");
  const label = () => store.findById(Label, shown("label") ?? chosenId("label") ?? "");
  const subspace = () => store.findById(Subspace, shown("subspace") ?? chosenId("subspace") ?? "");
  const savedView = () => store.findById(View, shown("view") ?? chosenId("view") ?? "");
  const person = () => store.findById(User, shown("person") ?? "");
  const timelineAlone = (): boolean => {
    const shownNow = view();
    return display().layout !== "list" && "thread" in shownNow && shownNow.thread === null;
  };
  // Nothing to read beside the list (no thread, page or draft open): the reading pane closes and the list takes
  // the room, as a timeline does.
  const nothingOpen = (): boolean =>
    !active() &&
    !subspace() &&
    !savedView() &&
    !bucket() &&
    !label() &&
    !person() &&
    !store.findById(Draft, shown("draft") ?? "") &&
    !("settings" in view());
  const alone = (): boolean => timelineAlone() || nothingOpen();
  return (
    <>
      <Titlebar />
      <DragRegionResync />
      <Show when={signedIn()} fallback={<Waiting />}>
        {/* Mail's columns: the mailboxes, the chosen one's threads, and the thread you're reading. */}
        <Show when={sidebarOpen()}>
          <MailSidebar />
        </Show>
        <MessageList alone={alone()} />
        {/* A timeline has the room to itself until something's opened beside it. */}
        <Show when={!alone()}>
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
            <div data-bar class={sx(topbar.bar, styles.topbarBesideList)}>
              <HistoryButtons />
              <span class={sx(base.ellipsis, topbar.title)}>
                {active()?.title ??
                  label()?.name ??
                  bucket()?.name ??
                  subspace()?.name ??
                  savedView()?.name ??
                  (allThreads() ? "Workspace" : undefined) ??
                  (shown("draft") !== undefined ? "Draft" : undefined) ??
                  ("settings" in view() ? "Settings" : undefined) ??
                  person()?.name}
              </span>
              <span class={sx(topbar.end)}>
                <Show when={active()} keyed>
                  {(thread) => <ThreadActions thread={thread} />}
                </Show>
                <Show when={store.connection() === "offline"}>
                  <span class={sx(styles.offline)}>Offline</span>
                </Show>
                {/* Closes what's open, and the reading pane with it (as Esc does). */}
                <button
                  class={sx(topbar.button)}
                  aria-label="Close"
                  title="Close (Esc)"
                  onClick={() => open({ thread: null })}
                >
                  <Icon icon={i.Cancel01Icon} size={14} aria-hidden="true" />
                </button>
              </span>
            </div>
            <Switch fallback={<NothingOpen />}>
              <Match when={subspace()} keyed>
                {(subspace) => <SubspaceView subspace={subspace} />}
              </Match>
              <Match when={savedView()} keyed>
                {(saved) => <SavedView view={saved} />}
              </Match>
              <Match when={bucket()} keyed>
                {(chosenBucket) => <BucketView bucket={chosenBucket} />}
              </Match>
              <Match when={label()} keyed>
                {(chosenLabel) => <LabelView label={chosenLabel} />}
              </Match>
              <Match when={store.findById(Draft, shown("draft") ?? "")} keyed>
                {(draft) => <DraftView draft={draft} />}
              </Match>
              <Match when={"settings" in view()}>
                <SettingsView />
              </Match>
              <Match when={person()} keyed>
                {(user) => <PersonView user={user} />}
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
                              aria-label="Pop out"
                              title="Pop out"
                              onClick={() => (setSplit(null), peek({ thread: beside.id }))}
                            >
                              <Icon icon={i.SquareArrowUpRightIcon} size={13} aria-hidden="true" />
                            </button>
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
                <div class={sx(base.panel, toast.undo)} role="status">
                  <span>{offered().text}</span>
                  <Show when={offered().run}>
                    {(run) => (
                      <button
                        class={sx(base.bare, toast.action)}
                        onClick={() => (run()(), setUndo(null))}
                      >
                        Undo
                      </button>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </main>
        </Show>
        <Palettes />
        <MentionToasts />
        <ContextMenu />
        <Peek />
      </Show>
    </>
  );
}
