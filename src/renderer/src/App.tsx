import { useEffect, useRef } from "react";
import { sections, useBuckets, useMark, useMe, useThreads, type Id } from "./data";
import { Icon, type IconName } from "./Icon";
import { List } from "./List";
import { Menu } from "./Menu";
import { NewMessage, Search } from "./Palette";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { back, currentView, forward, go, setDialog, toggleSidebar, useUI, useView } from "./state";
import { Thread } from "./Thread";

function useHotkeys() {
  const rows = useThreads();
  const buckets = useBuckets();
  const mark = useMark();
  const live = useRef({ rows, buckets, mark });
  live.current = { rows, buckets, mark };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey) return;
      const { rows, buckets, mark } = live.current;
      const view = currentView();
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

      const target = event.target as HTMLElement;
      const typing = target.closest("input, textarea, [contenteditable=true]");
      const key = event.key.toLowerCase();
      if (!event.metaKey && document.querySelector("dialog[open], .mentions")) return;
      const bucket = event.metaKey && buckets[Number(key) - 1];
      const command = event.metaKey
        ? {
            k: () => setDialog({ kind: "search" }),
            f: () => setDialog({ kind: "find" }),
            n: () => setDialog({ kind: "new" }),
            ",": () => go({ settings: true }),
            "[": back,
            "]": forward,
            "\\": toggleSidebar,
            e: done,
          }[key]
        : !typing
          ? {
              j: () => open(at + 1),
              arrowdown: () => open(at + 1),
              k: () => open(at - 1),
              arrowup: () => open(at - 1),
              e: done,
              u: unread,
              r: () => document.querySelector<HTMLElement>(".thread .editor")?.focus(),
              escape: () => go({ thread: undefined, settings: false }),
            }[key]
          : key === "escape" && (() => target.blur());
      const run = bucket ? () => go({ box: bucket._id, thread: undefined }) : command;
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

const TopButton = (props: {
  label: string;
  icon: IconName;
  disabled?: boolean;
  run: () => void;
}) => (
  <button
    title={props.label}
    aria-label={props.label}
    disabled={props.disabled}
    onClick={props.run}
  >
    <Icon name={props.icon} />
  </button>
);

export function App() {
  const me = useMe();
  const view = useView();
  const { at, history, sidebar, dialog } = useUI();
  useHotkeys();
  if (!me) return null;

  return (
    <>
      <header className="topbar">
        <div>
          <TopButton label="Sidebar (⌘\)" icon="layout" run={toggleSidebar} />
          <TopButton label="Back (⌘[)" icon="nav-back" disabled={at === 0} run={back} />
          <TopButton
            label="Forward (⌘])"
            icon="nav-forward"
            disabled={at === history.length - 1}
            run={forward}
          />
        </div>
        <button
          data-search
          className="search"
          style={{ visibility: dialog && dialog.kind !== "new" ? "hidden" : undefined }}
          onClick={() => setDialog({ kind: "search" })}
        >
          <Icon name="search" />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <div>
          <TopButton label="Settings (⌘,)" icon="settings" run={() => go({ settings: true })} />
        </div>
      </header>
      <div className="columns">
        {view.settings ? (
          <Settings />
        ) : (
          <>
            {sidebar && <Sidebar />}
            <List alone={!view.thread} />
            {view.thread && <Thread threadId={view.thread as Id<"threads">} />}
          </>
        )}
      </div>
      {dialog?.kind === "new" && <NewMessage draft={dialog.draft} />}
      {dialog && dialog.kind !== "new" && <Search threadsOnly={dialog.kind === "find"} />}
      <Menu />
    </>
  );
}
