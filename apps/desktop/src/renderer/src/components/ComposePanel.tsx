import type { ComposeDraft, ComposeRequest, Person } from "model";
import { useEffect, useRef, useState } from "react";
import { mentionedTargets, plainDraft, type Target } from "../compose";
import type { SavedDraft } from "../drafts";
import { Identicon } from "./Identicon";

const DRAFT_DELAY_MS = 500;
const MENTION_MATCHES = 6;

// The `@name` being typed just before the cursor, if any.
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret));
  return match === null ? null : { start: caret - match[2].length - 1, query: match[2] };
}

// A new thread in one message (⌘⇧N): write it as you'd say it, "@Anshu @Arjun can you review this CR. @Ganesh can
// you also track this", and the model drafts the thread while you type: its title, any shared context, and each
// person's own ask. Anything it got wrong can be edited in the preview, which then stays as you left it (Redraft hands
// it back to the model). Enter sends it: each ask goes to its people (a group's members as they are now), so the
// thread is in each of their inboxes,
// sorted by what was asked of them. ⌘S, or closing with something written, keeps it as a draft for later instead.
export function ComposePanel({
  targets,
  me,
  initial,
  draftWith,
  onCreate,
  onSaveDraft,
  onClose,
}: {
  // Who and which groups can be @mentioned (`targetsFor`).
  targets: Target[];
  me: Person;
  // A saved draft to carry on with.
  initial: SavedDraft | null;
  draftWith: (request: ComposeRequest, signal: AbortSignal) => Promise<ComposeDraft>;
  onCreate: (draft: ComposeDraft) => void;
  onSaveDraft: (saved: SavedDraft) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draftId] = useState(() => initial?.id ?? crypto.randomUUID());
  const [text, setText] = useState(initial?.text ?? "");
  const [caret, setCaret] = useState(0);
  const [selected, setSelected] = useState(0);
  // Escape hides the @ menu until you type again.
  const [menuHidden, setMenuHidden] = useState(false);
  // The model's latest draft and the text it was made from; a draft for older text still shows, faded.
  const [drafted, setDrafted] = useState<{ text: string; draft: ComposeDraft } | null>(null);
  // The preview as you've edited it, which the model no longer changes. A saved draft opens as it was left.
  const [edited, setEdited] = useState<ComposeDraft | null>(initial?.draft ?? null);
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => inputRef.current?.focus(), []);

  const request = (body: string): ComposeRequest => ({
    author: { id: me.id, name: me.name },
    // Only who's @mentioned, so the model can't hand an ask to anyone else. A group is asked as one.
    people: mentionedTargets(body, targets).map((target) => ({
      id: target.id,
      name: target.group === null ? target.name : `${target.name} (group)`,
    })),
    text: body,
  });

  // Ask the model again once typing pauses. The latest props, read without restarting the wait.
  const trimmed = text.trim();
  const latestRef = useRef({ draftWith, request });
  useEffect(() => {
    latestRef.current = { draftWith, request };
  });
  useEffect(() => {
    if (trimmed === "") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const { draftWith, request } = latestRef.current;
      draftWith(request(trimmed), controller.signal).then(
        (draft) => {
          setDrafted({ text: trimmed, draft });
          setFailed(false);
        },
        () => {
          if (!controller.signal.aborted) setFailed(true);
        },
      );
    }, DRAFT_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  const current = drafted !== null && drafted.text === trimmed;
  const shown: ComposeDraft | null =
    edited ?? (trimmed === "" ? null : (drafted?.draft ?? plainDraft(trimmed, targets)));
  const change = (next: Partial<ComposeDraft>): void => {
    if (shown !== null) setEdited({ ...shown, ...next });
  };
  const changeAsk = (index: number, next: ComposeDraft["asks"][number] | null): void =>
    change({
      asks: (shown?.asks ?? []).flatMap((ask, at) =>
        at !== index ? [ask] : next === null || next.personIds.length === 0 ? [] : [next],
      ),
    });

  const mention = mentionQuery(text, caret);
  const matches =
    mention === null || menuHidden
      ? []
      : targets
          .filter(
            (target) =>
              target.name.toLowerCase().startsWith(mention.query.toLowerCase()) ||
              target.handle.toLowerCase().startsWith(mention.query.toLowerCase()),
          )
          .slice(0, MENTION_MATCHES);
  const selectedIndex = Math.min(selected, Math.max(0, matches.length - 1));

  const pick = (target: Target): void => {
    if (mention === null) return;
    const inserted = `@${target.handle} `;
    const next = text.slice(0, mention.start) + inserted + text.slice(caret);
    const at = mention.start + inserted.length;
    setText(next);
    setCaret(at);
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(at, at));
  };

  // Sends it as you edited it, or the model's draft of exactly this text, asking for one first if needed, or the plain
  // draft if the model can't be reached.
  const submit = (): void => {
    if ((trimmed === "" && edited === null) || submitting) return;
    const create = (draft: ComposeDraft): void =>
      onCreate({
        ...draft,
        title: draft.title.trim() || plainDraft(trimmed, targets).title || "New thread",
      });
    if (edited !== null) return create(edited);
    if (current) return create(drafted.draft);
    setSubmitting(true);
    draftWith(request(trimmed), new AbortController().signal).then(create, () =>
      create(plainDraft(trimmed, targets)),
    );
  };

  // Keeps it for later, as you left it.
  const saveDraft = (): void => {
    if (trimmed === "" && edited === null) return onClose();
    onSaveDraft({
      id: draftId,
      text,
      draft: edited ?? (current ? drafted.draft : null),
      savedAtMs: Date.now(),
    });
  };

  const onPanelKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape" && matches.length === 0) {
      // Closing with something written keeps it, as an email client does.
      event.preventDefault();
      saveDraft();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveDraft();
    } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (matches.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelected((selectedIndex + delta + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(matches[selectedIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuHidden(true);
        return;
      }
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  const byId = new Map(targets.map((target) => [target.id, target]));

  return (
    <div className="palette-overlay" onMouseDown={saveDraft}>
      <div
        className="palette compose"
        role="dialog"
        aria-label="New message"
        onKeyDown={onPanelKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <textarea
          ref={inputRef}
          className="compose-input"
          rows={3}
          placeholder="Write it as you'd say it… @mention who it's for"
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart);
            setSelected(0);
            setMenuHidden(false);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        {matches.length > 0 && (
          <div className="compose-mentions" role="listbox" aria-label="Mention someone">
            {matches.map((person, index) => (
              <div
                key={person.id}
                className="palette-row"
                role="option"
                aria-selected={index === selectedIndex}
                data-selected={index === selectedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSelected(index)}
                onClick={() => pick(person)}
              >
                <Identicon seed={person.id} size={14} />
                <span className="palette-row-label">{person.name}</span>
                {person.group !== null && (
                  <span className="palette-row-shortcut">
                    Group · {person.group.memberIds.length}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {shown !== null && (
          <div className="compose-preview" data-current={edited !== null || current}>
            <div className="palette-section-label compose-preview-label">
              {submitting
                ? "Making the thread…"
                : edited !== null
                  ? "Preview, edited"
                  : current
                    ? "Preview · click to edit"
                    : failed
                      ? "Preview (the model couldn't be reached)"
                      : "Drafting…"}
              {edited !== null && trimmed !== "" && (
                <button type="button" className="compose-redraft" onClick={() => setEdited(null)}>
                  Redraft
                </button>
              )}
            </div>
            <input
              className="compose-title"
              aria-label="Title"
              placeholder="Untitled"
              spellCheck={false}
              value={shown.title}
              onChange={(event) => change({ title: event.target.value })}
            />
            <textarea
              className="compose-context"
              aria-label="Context"
              placeholder="Add context…"
              rows={shown.context === "" ? 1 : 2}
              value={shown.context}
              onChange={(event) => change({ context: event.target.value })}
            />
            {shown.asks.length === 0 ? (
              <p className="compose-empty">
                Nobody's asked yet: @mention who it's for, or it's a note to yourself.
              </p>
            ) : (
              <ul className="compose-asks">
                {shown.asks.map((ask, index) => (
                  <li key={index} className="compose-ask">
                    <span className="compose-ask-people">
                      {ask.personIds
                        .flatMap((id) => byId.get(id) ?? [])
                        .map((person) => (
                          <span key={person.id} className="compose-ask-person">
                            <Identicon seed={person.id} size={14} />
                            {person.group === null ? person.handle : `@${person.handle}`}
                            <button
                              type="button"
                              className="compose-ask-remove"
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
                    </span>
                    <textarea
                      className="compose-ask-text"
                      aria-label="Ask"
                      rows={1}
                      value={ask.text}
                      onChange={(event) => changeAsk(index, { ...ask, text: event.target.value })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="compose-footer">
          <span>
            <kbd>⇧↵</kbd> new line · <kbd>esc</kbd> keeps a draft
          </span>
          <span className="compose-actions">
            <button type="button" className="compose-button" onClick={saveDraft}>
              Save draft <kbd>⌘S</kbd>
            </button>
            <button
              type="button"
              className="compose-button"
              data-primary
              disabled={shown === null || submitting}
              onClick={submit}
            >
              Send <kbd>↵</kbd>
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
