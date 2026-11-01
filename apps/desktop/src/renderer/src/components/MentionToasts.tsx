import { X } from "lucide-react";
import { mentionsIn, plainThreadLinks, type Person, type Thread } from "model";
import { useEffect, useState } from "react";
import { useThreadLinks } from "../threadLinks";
import { Identicon } from "./Identicon";

// How long a toast stays up.
const SHOW_MS = 6000;

type Mention = { id: string; thread: Thread; author: Person; text: string; atMs: number };

// Someone mentioning you, as a short toast in the top right: who, in which thread, and what they said. Clicking it
// opens the thread to answer; it goes away on its own after a few seconds. Only mentions that arrive while the app is
// open show, never ones from before it loaded.
export function MentionToasts({
  threads,
  me,
  sinceMs,
  onOpen,
}: {
  threads: Thread[];
  me: Person;
  // When the app finished loading; older mentions aren't news.
  sinceMs: number;
  onOpen: (threadId: string) => void;
}): React.JSX.Element | null {
  const { titleOf, nameOf } = useThreadLinks();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const toasts: Mention[] = threads
    .flatMap((thread) =>
      thread.entries.flatMap((entry) =>
        entry.kind === "message" &&
        entry.author.id !== me.id &&
        entry.createdAtMs >= sinceMs &&
        nowMs - entry.createdAtMs < SHOW_MS &&
        !dismissed.has(entry.id) &&
        mentionsIn(entry.text).includes(me.id)
          ? [
              {
                id: entry.id,
                thread,
                author: entry.author,
                text: entry.text,
                atMs: entry.createdAtMs,
              },
            ]
          : [],
      ),
    )
    .sort((a, b) => b.atMs - a.atMs);

  // Ticks while any toast is up, so each one leaves when its time is over. (While none is up the clock can be stale,
  // which only means a new mention counts as just arrived.)
  const showing = toasts.length > 0;
  useEffect(() => {
    if (!showing) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [showing]);

  if (!showing) return null;
  const dismiss = (id: string): void => setDismissed((current) => new Set(current).add(id));
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          role="button"
          tabIndex={0}
          onClick={() => {
            dismiss(toast.id);
            onOpen(toast.thread.id);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            dismiss(toast.id);
            onOpen(toast.thread.id);
          }}
        >
          <Identicon seed={toast.author.id} size={18} />
          <div className="toast-body">
            <div className="toast-title">
              <span className="toast-author">{toast.author.name}</span> asked you in{" "}
              <span className="toast-thread">{toast.thread.title}</span>
            </div>
            <div className="toast-text">{plainThreadLinks(toast.text, titleOf, nameOf)}</div>
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={(event) => {
              event.stopPropagation();
              dismiss(toast.id);
            }}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
