import { usePreference } from "@ui-sdk/react/preferences";
import { Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable";
import { useShortcut } from "@ui-sdk/react/shortcuts";
import { Toolbar, ToolbarButton, ToolbarGroup } from "@ui-sdk/react/toolbar";
import { useEffect } from "react";
import { sections, useBuckets, useMark, useMe, useThreads, type Id } from "./data";
import { Icon } from "./Icon";
import { List } from "./List";
import { NewMessage, Search } from "./Palette";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { back, forward, go, setDialog, theme, toggleSidebar, useUI, useView } from "./state";
import { DraftView, Thread } from "./Thread";

const BUCKET_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function useShortcuts() {
  const view = useView();
  const rows = useThreads();
  const buckets = useBuckets();
  const mark = useMark();
  const threadId = view.thread as Id<"threads"> | undefined;
  const order = sections(rows, view.box, buckets).flatMap((section) => section.rows);
  const at = order.findIndex((row) => row.threadId === threadId);

  const open = (index: number) => {
    const row = order[Math.max(0, Math.min(order.length - 1, index))];
    if (row) go({ thread: row.threadId });
  };
  const done = () => {
    if (!threadId) return;
    void mark({ threadId, inbox: false });
    go({ thread: (order[at + 1] ?? order[at - 1])?.threadId });
  };
  const unread = () => {
    if (!threadId) return;
    go({ thread: undefined });
    void mark({ threadId, unread: true });
  };
  const leave = () => {
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.isContentEditable) focused.blur();
    else go({ thread: undefined, settings: false });
  };

  useShortcut("mod+k", () => setDialog("search"), { description: "Search" });
  useShortcut("mod+f", () => setDialog("find"), { description: "Search threads" });
  useShortcut("mod+n", () => setDialog("new"), { description: "New message" });
  useShortcut("mod+,", () => go({ settings: true }), { description: "Settings" });
  useShortcut("mod+[", back, { description: "Back" });
  useShortcut("mod+]", forward, { description: "Forward" });
  useShortcut("mod+\\", toggleSidebar, { description: "Show or hide the sidebar" });
  useShortcut("mod+e", done, { description: "Mark done" });
  useShortcut("e", done, { description: "Mark done" });
  useShortcut("u", unread, { description: "Mark unread" });
  useShortcut("j", () => open(at + 1), { description: "Next thread" });
  useShortcut("k", () => open(at - 1), { description: "Previous thread" });
  useShortcut("escape", leave, { allowInInput: true, description: "Close" });
  for (const key of BUCKET_KEYS)
    useShortcut(
      buckets[key - 1] ? `mod+${key}` : null,
      () => go({ box: buckets[key - 1]._id, thread: undefined }),
      { description: `Bucket ${key}` },
    );
}

export function App() {
  const me = useMe();
  const view = useView();
  const { at, history, sidebar, dialog, drafts } = useUI();
  const draft = drafts.find(({ id }) => id === view.draft);
  const { value } = usePreference(theme);
  useEffect(() => window.desktop.setTheme(value), [value]);
  useShortcuts();
  if (!me) return null;

  return (
    <>
      <Toolbar className="topbar" aria-label="Window">
        <ToolbarGroup>
          <ToolbarButton aria-label="Sidebar" onClick={toggleSidebar}>
            <Icon name="layout" />
          </ToolbarButton>
          <ToolbarButton aria-label="Back" disabled={at === 0} onClick={back}>
            <Icon name="nav-back" />
          </ToolbarButton>
          <ToolbarButton
            aria-label="Forward"
            disabled={at === history.length - 1}
            onClick={forward}
          >
            <Icon name="nav-forward" />
          </ToolbarButton>
        </ToolbarGroup>
        <ToolbarButton
          data-search
          className="search"
          style={{ visibility: dialog && dialog !== "new" ? "hidden" : undefined }}
          onClick={() => setDialog("search")}
        >
          <Icon name="search" />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </ToolbarButton>
        <ToolbarGroup>
          <ToolbarButton aria-label="Settings" onClick={() => go({ settings: true })}>
            <Icon name="settings" />
          </ToolbarButton>
        </ToolbarGroup>
      </Toolbar>
      {view.settings ? (
        <Settings />
      ) : (
        <Resizable className="columns" autoSaveId="sidebar">
          {sidebar && (
            <>
              <ResizablePanel id="sidebar" defaultSize="242px" minSize="200px" maxSize="350px">
                <Sidebar />
              </ResizablePanel>
              <ResizableHandle aria-label="Resize sidebar" />
            </>
          )}
          <ResizablePanel id="main">
            {view.thread || draft ? (
              <Resizable className="columns" autoSaveId="list">
                <ResizablePanel id="list" defaultSize="374px" minSize="310px" maxSize="660px">
                  <List />
                </ResizablePanel>
                <ResizableHandle aria-label="Resize list" />
                <ResizablePanel id="thread">
                  {draft ? (
                    <DraftView draft={draft} />
                  ) : (
                    <Thread threadId={view.thread as Id<"threads">} />
                  )}
                </ResizablePanel>
              </Resizable>
            ) : (
              <List />
            )}
          </ResizablePanel>
        </Resizable>
      )}
      {dialog === "new" && <NewMessage />}
      {dialog && dialog !== "new" && <Search threadsOnly={dialog === "find"} />}
    </>
  );
}
