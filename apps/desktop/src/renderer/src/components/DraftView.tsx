import type { ComposeDraft } from "model";
import { plainDraft, type Target } from "../compose";
import type { SavedDraft } from "../drafts";
import { formatRelativeTime } from "../format";
import { useMe } from "../me";
import { Identicon } from "./Identicon";

// A draft from the sidebar, laid out where a thread would be and as it will look once sent: its title and context,
// then each ask as your message to its people. Everything edits in place and is kept as you type. Send makes the
// thread (and drops the draft); Delete throws it away.
export function DraftView({
  saved,
  targets,
  nowMs,
  onChange,
  onSend,
  onDelete,
}: {
  saved: SavedDraft;
  // Who and which groups can be @mentioned (`targetsFor`).
  targets: Target[];
  nowMs: number;
  onChange: (saved: SavedDraft) => void;
  onSend: (draft: ComposeDraft) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const me = useMe();
  // Saved before the model had drafted it: start from the plain reading of what was written.
  const draft = saved.draft ?? plainDraft(saved.text, targets);
  const byId = new Map(targets.map((target) => [target.id, target]));
  const change = (next: Partial<ComposeDraft>): void =>
    onChange({ ...saved, draft: { ...draft, ...next } });
  const changeAsk = (index: number, next: ComposeDraft["asks"][number]): void =>
    change({
      asks: draft.asks.flatMap((ask, at) =>
        at !== index ? [ask] : next.personIds.length === 0 ? [] : [next],
      ),
    });
  const send = (): void =>
    onSend({
      ...draft,
      title: draft.title.trim() || plainDraft(saved.text, targets).title || "New thread",
    });

  return (
    <div className="thread-view">
      <div
        className="thread-scroll"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            send();
          }
        }}
      >
        <article className="thread-doc draft-doc">
          <header className="thread-header">
            <div className="thread-byline">
              <span className="draft-label">Draft</span>
              <span>saved {formatRelativeTime(saved.savedAtMs, nowMs)}</span>
            </div>
            <input
              className="thread-title draft-field"
              aria-label="Title"
              placeholder="Untitled"
              spellCheck={false}
              value={draft.title}
              onChange={(event) => change({ title: event.target.value })}
            />
            <textarea
              className="thread-text thread-description draft-field"
              aria-label="Context"
              placeholder="Add context…"
              rows={1}
              value={draft.context}
              onChange={(event) => change({ context: event.target.value })}
            />
          </header>
          {draft.asks.length === 0 && (
            <p className="draft-empty">
              Nobody's asked yet. Sending it makes a thread for you alone.
            </p>
          )}
          {draft.asks.map((ask, index) => (
            <div key={index} className="thread-block">
              <span className="thread-avatar">
                <Identicon seed={me.id} size={20} />
              </span>
              <div className="thread-body">
                <div className="thread-meta">
                  <span className="thread-author">{me.name}</span>
                </div>
                <div className="draft-ask">
                  {ask.personIds
                    .flatMap((id) => byId.get(id) ?? [])
                    .map((person) => (
                      <span key={person.id} className="draft-mention">
                        @{person.handle}
                        <button
                          type="button"
                          className="draft-mention-remove"
                          aria-label={`Don't ask ${person.name}`}
                          onClick={() =>
                            changeAsk(index, {
                              ...ask,
                              personIds: ask.personIds.filter((id) => id !== person.id),
                            })
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  <textarea
                    className="thread-text draft-field draft-ask-text"
                    aria-label="Ask"
                    rows={1}
                    value={ask.text}
                    onChange={(event) => changeAsk(index, { ...ask, text: event.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
          <div className="draft-actions">
            <button type="button" className="compose-button" data-primary onClick={send}>
              Send <kbd>⌘↵</kbd>
            </button>
            <button type="button" className="compose-button" onClick={onDelete}>
              Delete draft
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
