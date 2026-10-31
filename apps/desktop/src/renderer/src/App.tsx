import { useEffect, useRef, useState } from "react";
import { Sidebar, type Thread } from "./components/Sidebar";

// Mouse moves within this many pixels of the top nudge the drag-region resync element.
const DRAG_RESYNC_ZONE_PX = 96;

// Chromium can keep stale app-region bounds; moving a 1px no-drag element forces a recompute.
function DragRegionResync(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent): void => {
      const element = ref.current;
      if (element === null || event.clientY > DRAG_RESYNC_ZONE_PX) return;
      element.style.left = element.style.left === "1px" ? "0px" : "1px";
    };
    window.addEventListener("mousemove", onMouseMove, { capture: true, passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove, { capture: true });
  }, []);

  return <div aria-hidden ref={ref} className="drag-region-resync" />;
}

function App(): React.JSX.Element {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const newThread = (): void => {
    const thread = { id: crypto.randomUUID(), title: "New Thread", updatedAtMs: Date.now() };
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
  };

  return (
    <>
      <div aria-hidden className="titlebar" />
      <DragRegionResync />
      <Sidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onNewThread={newThread}
        onOpenThread={setActiveThreadId}
      />
      <main className="main" />
    </>
  );
}

export default App;
