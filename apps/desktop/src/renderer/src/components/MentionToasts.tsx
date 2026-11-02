import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { mentionsIn, plainThreadLinks, type Person, type Schedule, type Thread } from "model";
import { useEffect, useState } from "react";
import { useThreadLinks } from "../threadLinks";
import { Identicon } from "./Identicon";

// How long a toast stays up.
const SHOW_MS = 6000;

type Mention = { id: string; thread: Thread; author: Person; text: string; atMs: number };

// Someone mentioning you, as a short toast in the top right: who, in which thread, and what they said. Clicking it
// opens the thread to answer; it goes away on its own after a few seconds. Mentions showing at the same time share
// one toast. Only mentions that arrive while the app is
// open show, never ones from before it loaded. While you're in a meeting or focus block they wait, and show when it
// ends.
export function MentionToasts({
  threads,
  me,
  sinceMs,
  quiet,
  onOpen,
}: {
  threads: Thread[];
  me: Person;
  // When the app finished loading; older mentions aren't news.
  sinceMs: number;
  // Your meetings and focus blocks, when nothing should interrupt you.
  quiet: Schedule[];
  onOpen: (threadId: string) => void;
}): React.JSX.Element | null {
  const { titleOf, nameOf } = useThreadLinks();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  // When a mention shows: as it arrives, or at the end of the meeting or focus block it arrived in.
  const releaseAt = (atMs: number): number =>
    quiet.find((block) => block.startMs <= atMs && atMs < block.endMs)?.endMs ?? atMs;
  const toasts: Mention[] = threads
    .flatMap((thread) =>
      thread.entries.flatMap((entry) =>
        entry.kind === "message" &&
        entry.author.id !== me.id &&
        entry.createdAtMs >= sinceMs &&
        releaseAt(entry.createdAtMs) <= nowMs &&
        nowMs - releaseAt(entry.createdAtMs) < SHOW_MS &&
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

  // A steady clock, so toasts come and go on time, including ones held until a block ends.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (toasts.length === 0) return null;
  // Several at once (most often, the ones held through a meeting) become one toast, so a break starts with a single
  // summary rather than a stack. It opens the newest.
  const [latest] = toasts;
  const authors = [...new Map(toasts.map((toast) => [toast.author.id, toast.author])).values()];
  const dismissAll = (): void =>
    setDismissed((current) => new Set([...current, ...toasts.map((toast) => toast.id)]));
  const open = (): void => {
    dismissAll();
    onOpen(latest.thread.id);
  };
  return (
    <div className="toasts" role="status" aria-live="polite">
      <div
        key={latest.id}
        className="toast"
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => event.key === "Enter" && open()}
      >
        <Identicon seed={latest.author.id} size={18} />
        <div className="toast-body">
          <div className="toast-title">
            {toasts.length === 1 ? (
              <>
                <span className="toast-author">{latest.author.name}</span> asked you in{" "}
                <span className="toast-thread">{latest.thread.title}</span>
              </>
            ) : (
              <>
                <span className="toast-author">{toasts.length} questions</span> from{" "}
                <span className="toast-author">{namesList(authors)}</span>
              </>
            )}
          </div>
          <div className="toast-text">
            {plainThreadLinks(latest.text, titleOf, nameOf).replace(/^@\S+\s*/, "")}
          </div>
        </div>
        <button
          type="button"
          className="toast-close"
          aria-label="Dismiss"
          onClick={(event) => {
            event.stopPropagation();
            dismissAll();
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}

// First names, as "Arjun", "Arjun and KK" or "Arjun, KK and 2 others".
function namesList(people: Person[]): string {
  const names = people.map((person) => person.name.split(" ")[0]);
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}
