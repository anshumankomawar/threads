import type { ComposeDraft, ComposeRequest, Person } from "model";
import { useEffect, useRef, useState } from "react";
import { Identicon } from "./Identicon";

const DRAFT_DELAY_MS = 500;
const MENTION_MATCHES = 6;

// The `@name` being typed just before the cursor, if any.
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret));
  return match === null ? null : { start: caret - match[2].length - 1, query: match[2] };
}

// How a person is written after `@`: their first name.
const handle = (person: Person): string => person.name.split(" ")[0];

// Everyone `@`mentioned in the text, by first name or full name without spaces, in order.
function mentionedPeople(text: string, people: Person[]): Person[] {
  const found: Person[] = [];
  for (const [, name] of text.matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
    const key = name.toLowerCase();
    const person = people.find(
      (candidate) =>
        handle(candidate).toLowerCase() === key ||
        candidate.name.replaceAll(" ", "").toLowerCase() === key ||
        candidate.id === key,
    );
    if (person !== undefined && !found.includes(person)) found.push(person);
  }
  return found;
}

// Without the model: the first sentence, mentions taken out, as the title, and one ask for everyone mentioned.
function plainDraft(text: string, people: Person[], me: Person): ComposeDraft {
  const withoutMentions = text
    .replaceAll(/@[\p{L}\p{N}_-]+/gu, "")
    .replaceAll(/\s+/g, " ")
    .trim();
  const title = (withoutMentions.split(/(?<=[.?!])\s/)[0] ?? "")
    .replace(/[.?!]+$/, "")
    .slice(0, 80);
  const asked = mentionedPeople(text, people).filter((person) => person.id !== me.id);
  return {
    title,
    context: "",
    asks:
      asked.length === 0
        ? []
        : [{ personIds: asked.map((person) => person.id), text: withoutMentions }],
  };
}

// A new thread in one message (⌘⇧N): write it as you'd say it, "@Anshu @Arjun can you review this CR. @Ganesh can
// you also track this", and the model drafts the thread while you type: its title, any shared context, and each
// person's own ask. Enter makes it. Each ask is sent to its people, so the thread is in each of their inboxes, sorted
// by what was asked of them.
export function ComposePanel({
  people,
  me,
  draftWith,
  onCreate,
  onClose,
}: {
  people: Person[];
  me: Person;
  draftWith: (request: ComposeRequest, signal: AbortSignal) => Promise<ComposeDraft>;
  onCreate: (draft: ComposeDraft) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [selected, setSelected] = useState(0);
  // The model's latest draft and the text it was made from; a draft for older text still shows, faded.
  const [drafted, setDrafted] = useState<{ text: string; draft: ComposeDraft } | null>(null);
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => inputRef.current?.focus(), []);

  const others = people.filter((person) => person.id !== me.id);
  const request = (body: string): ComposeRequest => ({
    author: { id: me.id, name: me.name },
    people: people.map((person) => ({ id: person.id, name: person.name })),
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
    trimmed === "" ? null : (drafted?.draft ?? plainDraft(trimmed, people, me));

  const mention = mentionQuery(text, caret);
  const matches =
    mention === null
      ? []
      : others
          .filter(
            (person) =>
              person.name.toLowerCase().startsWith(mention.query.toLowerCase()) ||
              handle(person).toLowerCase().startsWith(mention.query.toLowerCase()),
          )
          .slice(0, MENTION_MATCHES);
  const selectedIndex = Math.min(selected, Math.max(0, matches.length - 1));

  const pick = (person: Person): void => {
    if (mention === null) return;
    const inserted = `@${handle(person)} `;
    const next = text.slice(0, mention.start) + inserted + text.slice(caret);
    const at = mention.start + inserted.length;
    setText(next);
    setCaret(at);
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(at, at));
  };

  // Makes the thread from the model's draft of exactly this text, asking for one first if needed, or from the plain
  // draft if the model can't be reached.
  const submit = (): void => {
    if (trimmed === "" || submitting) return;
    const create = (draft: ComposeDraft): void =>
      onCreate({
        ...draft,
        title: draft.title || plainDraft(trimmed, people, me).title || "New thread",
      });
    if (drafted !== null && drafted.text === trimmed) return create(drafted.draft);
    setSubmitting(true);
    draftWith(request(trimmed), new AbortController().signal).then(create, () =>
      create(plainDraft(trimmed, people, me)),
    );
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
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const byId = new Map(people.map((person) => [person.id, person]));

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette compose"
        role="dialog"
        aria-label="New message"
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
              </div>
            ))}
          </div>
        )}
        {shown !== null && (
          <div className="compose-preview" data-current={current}>
            <div className="palette-section-label">
              {submitting
                ? "Making the thread…"
                : current
                  ? "Preview"
                  : failed
                    ? "Preview (the model couldn't be reached)"
                    : "Drafting…"}
            </div>
            <div className="compose-title">{shown.title || "Untitled"}</div>
            {shown.context !== "" && <p className="compose-context">{shown.context}</p>}
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
                            {handle(person)}
                          </span>
                        ))}
                    </span>
                    <span className="compose-ask-text">{ask.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="compose-footer">
          <span>
            <kbd>↵</kbd> create · <kbd>⇧↵</kbd> new line · <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
