import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { createList, Palette, Quoted } from "./Palette";

export type MoveTarget = { kind: "thread"; threadId: string } | { kind: "new"; title: string };

// Where selected messages go: a new thread (titled by what you type, or by the first message) or an existing one.
// With nothing typed a new thread comes first; once you type, matching threads do.
export function MovePalette(props: {
  count: number;
  fromThreadId: string;
  // Threads the messages link to stay put: the messages are the way into them from here.
  linkedThreadIds: string[];
  suggestedTitle: string;
  onMove: (target: MoveTarget) => void;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  const [query, setQuery] = createSignal("");
  const list = createList((): { label: string; target: MoveTarget }[] => {
    const typed = query().trim();
    const threads = app.links
      .search(typed)
      .filter((t) => t.id !== props.fromThreadId && !props.linkedThreadIds.includes(t.id))
      .slice(0, 8)
      .map((t) => ({ label: t.title, target: { kind: "thread", threadId: t.id } as const }));
    const title = typed || props.suggestedTitle;
    const create = { label: title, target: { kind: "new", title } as const };
    if (typed === "") return [create, ...threads];
    return threads.some((t) => t.label.toLowerCase() === typed.toLowerCase())
      ? threads
      : [...threads, create];
  });
  return (
    <Palette
      label="Move messages"
      placeholder={`Move ${props.count === 1 ? "message" : `${props.count} messages`} to…`}
      value={query()}
      onInput={setQuery}
      onClose={props.onClose}
      list={list}
      onPick={(item) => props.onMove(item.target)}
      row={(item) => ({
        label:
          item.target.kind === "thread" ? (
            item.label
          ) : (
            <>
              New thread <Quoted>{item.label}</Quoted>
            </>
          ),
      })}
    />
  );
}
