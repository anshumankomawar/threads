import type { ComposeDraft, ComposeRequest, Person } from "model";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
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
export function ComposePanel(props: {
  // Who and which groups can be @mentioned (`targetsFor`).
  targets: Target[];
  me: Person;
  // A saved draft to carry on with.
  initial: SavedDraft | null;
  draftWith: (request: ComposeRequest, signal: AbortSignal) => Promise<ComposeDraft>;
  onCreate: (draft: ComposeDraft) => void;
  onSaveDraft: (saved: SavedDraft) => void;
  onClose: () => void;
}): JSX.Element {
  let input!: HTMLTextAreaElement;
  const initial = untrack(() => props.initial);
  const draftId = initial?.id ?? crypto.randomUUID();
  const [text, setText] = createSignal(initial?.text ?? "");
  const [caret, setCaret] = createSignal(0);
  const [selected, setSelected] = createSignal(0);
  // Escape hides the @ menu until you type again.
  const [menuHidden, setMenuHidden] = createSignal(false);
  // The model's latest draft and the text it was made from; a draft for older text still shows, faded.
  const [drafted, setDrafted] = createSignal<{ text: string; draft: ComposeDraft } | null>(null);
  // The preview as you've edited it, which the model no longer changes. A saved draft opens as it was left.
  const [edited, setEdited] = createSignal<ComposeDraft | null>(initial?.draft ?? null);
  const [failed, setFailed] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);

  onSettled(() => {
    input.focus();
  });

  const request = (body: string): ComposeRequest => ({
    author: { id: props.me.id, name: props.me.name },
    // Only who's @mentioned, so the model can't hand an ask to anyone else. A group is asked as one.
    people: mentionedTargets(body, props.targets).map((target) => ({
      id: target.id,
      name: target.group === null ? target.name : `${target.name} (group)`,
    })),
    text: body,
  });

  // Ask the model again once typing pauses. The latest props, read without restarting the wait.
  const trimmed = createMemo(() => text().trim());
  createEffect(
    () => trimmed(),
    (body) => {
      if (body === "") return;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        props.draftWith(request(body), controller.signal).then(
          (draft) => {
            setDrafted({ text: body, draft });
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
    },
  );

  // The model's draft of exactly this text, if it has one.
  const currentDraft = (): ComposeDraft | null => {
    const latest = drafted();
    return latest !== null && latest.text === trimmed() ? latest.draft : null;
  };
  const current = (): boolean => currentDraft() !== null;
  const shown = createMemo(
    (): ComposeDraft | null =>
      edited() ??
      (trimmed() === "" ? null : (drafted()?.draft ?? plainDraft(trimmed(), props.targets))),
  );
  const change = (next: Partial<ComposeDraft>): void => {
    const draft = shown();
    if (draft !== null) setEdited({ ...draft, ...next });
  };
  const changeAsk = (index: number, next: ComposeDraft["asks"][number] | null): void =>
    change({
      asks: (shown()?.asks ?? []).flatMap((ask, at) =>
        at !== index ? [ask] : next === null || next.personIds.length === 0 ? [] : [next],
      ),
    });

  const mention = createMemo(() => mentionQuery(text(), caret()));
  const matches = createMemo((): Target[] => {
    const typed = mention();
    if (typed === null || menuHidden()) return [];
    const query = typed.query.toLowerCase();
    return props.targets
      .filter(
        (target) =>
          target.name.toLowerCase().startsWith(query) ||
          target.handle.toLowerCase().startsWith(query),
      )
      .slice(0, MENTION_MATCHES);
  });
  const selectedIndex = (): number => Math.min(selected(), Math.max(0, matches().length - 1));

  const pick = (target: Target): void => {
    const typed = mention();
    if (typed === null) return;
    const inserted = `@${target.handle} `;
    const next = text().slice(0, typed.start) + inserted + text().slice(caret());
    const at = typed.start + inserted.length;
    setText(next);
    setCaret(at);
    setSelected(0);
    requestAnimationFrame(() => input.setSelectionRange(at, at));
  };

  // Sends it as you edited it, or the model's draft of exactly this text, asking for one first if needed, or the plain
  // draft if the model can't be reached.
  const submit = (): void => {
    const body = trimmed();
    const draft = edited();
    if ((body === "" && draft === null) || submitting()) return;
    const create = (made: ComposeDraft): void =>
      props.onCreate({
        ...made,
        title: made.title.trim() || plainDraft(body, props.targets).title || "New thread",
      });
    if (draft !== null) return create(draft);
    const ready = currentDraft();
    if (ready !== null) return create(ready);
    setSubmitting(true);
    props
      .draftWith(request(body), new AbortController().signal)
      .then(create, () => create(plainDraft(body, props.targets)));
  };

  // Keeps it for later, as you left it.
  const saveDraft = (): void => {
    if (trimmed() === "" && edited() === null) return props.onClose();
    props.onSaveDraft({
      id: draftId,
      text: text(),
      draft: edited() ?? currentDraft(),
      savedAtMs: Date.now(),
    });
  };

  const onPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && matches().length === 0) {
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

  const onKeyDown = (event: KeyboardEvent): void => {
    const options = matches();
    if (options.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelected((selectedIndex() + delta + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(options[selectedIndex()]);
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
      !event.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  const byId = createMemo(() => new Map(props.targets.map((target) => [target.id, target])));

  return (
    <div class="palette-overlay" onMouseDown={saveDraft}>
      <div
        class="palette compose"
        role="dialog"
        aria-label="New message"
        onKeyDown={onPanelKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <textarea
          ref={input}
          class="compose-input"
          rows={3}
          placeholder="Write it as you'd say it… @mention who it's for"
          spellcheck={false}
          value={text()}
          onInput={(event) => {
            setText(event.currentTarget.value);
            setCaret(event.currentTarget.selectionStart);
            setSelected(0);
            setMenuHidden(false);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <Show when={matches().length > 0}>
          <div class="compose-mentions" role="listbox" aria-label="Mention someone">
            <For each={matches()}>
              {(person, index) => (
                <div
                  class="palette-row"
                  role="option"
                  aria-selected={`${index() === selectedIndex()}`}
                  data-selected={String(index() === selectedIndex())}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSelected(index())}
                  onClick={() => pick(person)}
                >
                  <Identicon seed={person.id} size={14} />
                  <span class="palette-row-label">{person.name}</span>
                  <Show when={person.group}>
                    {(group) => (
                      <span class="palette-row-shortcut">Group · {group().memberIds.length}</span>
                    )}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={shown()}>
          {(draft) => (
            <div class="compose-preview" data-current={String(edited() !== null || current())}>
              <div class="palette-section-label compose-preview-label">
                {submitting()
                  ? "Making the thread…"
                  : edited() !== null
                    ? "Preview, edited"
                    : current()
                      ? "Preview · click to edit"
                      : failed()
                        ? "Preview (the model couldn't be reached)"
                        : "Drafting…"}
                <Show when={edited() !== null && trimmed() !== ""}>
                  <button type="button" class="compose-redraft" onClick={() => setEdited(null)}>
                    Redraft
                  </button>
                </Show>
              </div>
              <input
                class="compose-title"
                aria-label="Title"
                placeholder="Untitled"
                spellcheck={false}
                value={draft().title}
                onInput={(event) => change({ title: event.currentTarget.value })}
              />
              <textarea
                class="compose-context"
                aria-label="Context"
                placeholder="Add context…"
                rows={draft().context === "" ? 1 : 2}
                value={draft().context}
                onInput={(event) => change({ context: event.currentTarget.value })}
              />
              <Show
                when={draft().asks.length > 0}
                fallback={
                  <p class="compose-empty">
                    Nobody's asked yet: @mention who it's for, or it's a note to yourself.
                  </p>
                }
              >
                <ul class="compose-asks">
                  {/* By position, as each edit replaces the ask; keeps the field you're typing in. */}
                  <For each={draft().asks} keyed={false}>
                    {(ask, index) => (
                      <li class="compose-ask">
                        <span class="compose-ask-people">
                          <For each={ask().personIds.flatMap((id) => byId().get(id) ?? [])}>
                            {(person) => (
                              <span class="compose-ask-person">
                                <Identicon seed={person.id} size={14} />
                                {person.group === null ? person.handle : `@${person.handle}`}
                                <button
                                  type="button"
                                  class="compose-ask-remove"
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
                        </span>
                        <textarea
                          class="compose-ask-text"
                          aria-label="Ask"
                          rows={1}
                          value={ask().text}
                          onInput={(event) =>
                            changeAsk(index, { ...ask(), text: event.currentTarget.value })
                          }
                        />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          )}
        </Show>
        <div class="compose-footer">
          <span>
            <kbd>⇧↵</kbd> new line · <kbd>esc</kbd> keeps a draft
          </span>
          <span class="compose-actions">
            <button type="button" class="compose-button" onClick={saveDraft}>
              Save draft <kbd>⌘S</kbd>
            </button>
            <button
              type="button"
              class="compose-button"
              data-primary
              disabled={shown() === null || submitting()}
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
