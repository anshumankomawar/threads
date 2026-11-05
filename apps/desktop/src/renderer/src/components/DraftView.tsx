import type { ComposeDraft } from "model";
import { plainDraft, type Target } from "../compose";
import type { SavedDraft } from "../drafts";
import { createMemo, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { formatRelativeTime } from "../format";
import { useMe } from "../me";
import { Identicon } from "./Identicon";

// A draft from the sidebar, laid out where a thread would be and as it will look once sent: its title and context,
// then each ask as your message to its people. Everything edits in place and is kept as you type. Send makes the
// thread (and drops the draft); Delete throws it away.
export function DraftView(props: {
  saved: SavedDraft;
  // Who and which groups can be @mentioned (`targetsFor`).
  targets: Target[];
  nowMs: number;
  onChange: (saved: SavedDraft) => void;
  onSend: (draft: ComposeDraft) => void;
  onDelete: () => void;
}): JSX.Element {
  const me = useMe();
  // Saved before the model had drafted it: start from the plain reading of what was written.
  const draft = createMemo(() => props.saved.draft ?? plainDraft(props.saved.text, props.targets));
  const byId = createMemo(() => new Map(props.targets.map((target) => [target.id, target])));
  const change = (next: Partial<ComposeDraft>): void =>
    props.onChange({ ...props.saved, draft: { ...draft(), ...next } });
  const changeAsk = (index: number, next: ComposeDraft["asks"][number]): void =>
    change({
      asks: draft().asks.flatMap((ask, at) =>
        at !== index ? [ask] : next.personIds.length === 0 ? [] : [next],
      ),
    });
  const send = (): void =>
    props.onSend({
      ...draft(),
      title:
        draft().title.trim() || plainDraft(props.saved.text, props.targets).title || "New thread",
    });

  return (
    <div class="thread-view">
      <div
        class="thread-scroll"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            send();
          }
        }}
      >
        <article class="thread-doc draft-doc">
          <header class="thread-header">
            <div class="thread-byline">
              <span class="draft-label">Draft</span>
              <span>saved {formatRelativeTime(props.saved.savedAtMs, props.nowMs)}</span>
            </div>
            <input
              class="thread-title draft-field"
              aria-label="Title"
              placeholder="Untitled"
              spellcheck={false}
              value={draft().title}
              onInput={(event) => change({ title: event.currentTarget.value })}
            />
            <textarea
              class="thread-text thread-description draft-field"
              aria-label="Context"
              placeholder="Add context…"
              rows={1}
              value={draft().context}
              onInput={(event) => change({ context: event.currentTarget.value })}
            />
          </header>
          <Show when={draft().asks.length === 0}>
            <p class="draft-empty">Nobody's asked yet. Sending it makes a thread for you alone.</p>
          </Show>
          {/* By position, as each edit replaces the ask; keeps the field you're typing in. */}
          <For each={draft().asks} keyed={false}>
            {(ask, index) => (
              <div class="thread-block">
                <span class="thread-avatar">
                  <Identicon seed={me().id} size={20} />
                </span>
                <div class="thread-body">
                  <div class="thread-meta">
                    <span class="thread-author">{me().name}</span>
                  </div>
                  <div class="draft-ask">
                    <For each={ask().personIds.flatMap((id) => byId().get(id) ?? [])}>
                      {(person) => (
                        <span class="draft-mention">
                          @{person.handle}
                          <button
                            type="button"
                            class="draft-mention-remove"
                            aria-label={`Don't ask ${person.name}`}
                            onClick={() =>
                              changeAsk(index, {
                                ...ask(),
                                personIds: ask().personIds.filter((id) => id !== person.id),
                              })
                            }
                          >
                            ×
                          </button>
                        </span>
                      )}
                    </For>
                    <textarea
                      class="thread-text draft-field draft-ask-text"
                      aria-label="Ask"
                      rows={1}
                      value={ask().text}
                      onInput={(event) =>
                        changeAsk(index, { ...ask(), text: event.currentTarget.value })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </For>
          <div class="draft-actions">
            <button type="button" class="compose-button" data-primary onClick={send}>
              Send <kbd>⌘↵</kbd>
            </button>
            <button type="button" class="compose-button" onClick={() => props.onDelete()}>
              Delete draft
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
