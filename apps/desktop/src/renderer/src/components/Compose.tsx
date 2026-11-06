import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Draft, mention, Subspace, User, type ComposeDraft } from "models";
import { draftWith, me, open, setDialog, store } from "../session";
import { button, menu } from "../styles/controls";
import { compose, palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Identicon } from "./Identicon";
import { createThread, Modal, send } from "./Palettes";

type Ask = ComposeDraft["asks"][number];

const MENTION = /@([\p{L}\p{N}_-]+)/gu;
const firstName = (u: User): string => u.name.split(" ")[0];
const others = (): User[] => store.all(User).filter((u) => u.id !== me().id);

const compact = (name: string): string => name.replaceAll(/\s+/g, "");
const subspaces = (): Subspace[] => store.all(Subspace).filter((sub) => sub.members.length > 0);
const namesIn = (text: string): string[] =>
  [...text.matchAll(MENTION)].map(([, name]) => name.toLowerCase());
const mentionedSubspaces = (text: string): Subspace[] =>
  subspaces().filter((sub) => namesIn(text).includes(compact(sub.name).toLowerCase()));

// Everyone @mentioned, by first name or full name without spaces, and everyone in a subspace that is, in order.
const mentioned = (text: string): User[] => {
  const found = namesIn(text).flatMap((name) =>
    others().filter((u) =>
      [firstName(u), compact(u.name)].some((key) => key.toLowerCase() === name),
    ),
  );
  const members = mentionedSubspaces(text).flatMap((sub) => [...sub.members].map((m) => m.userId));
  return [...new Set([...found, ...others().filter((u) => members.includes(u.id))])];
};

// Without the model: the first sentence as the title, and one ask for everyone mentioned.
const plainDraft = (text: string): ComposeDraft => {
  const rest = text.replaceAll(MENTION, "").replaceAll(/\s+/g, " ").trim();
  const asked = mentioned(text);
  return {
    title: (rest.split(/(?<=[.?!])\s/)[0] ?? "").replace(/[.?!]+$/, "").slice(0, 80),
    context: "",
    asks: asked.length === 0 ? [] : [{ personIds: asked.map((u) => u.id), text: rest }],
  };
};

// A thread written as one message (⌘⇧N): the model drafts its title, context and each person's ask while you type.
// Edits in the preview stick until Redraft. Enter sends it; ⌘S, or closing with something written, keeps it as a draft.
export function Compose(props: { draftId?: string }): JSX.Element {
  const saved = untrack(() => store.findById(Draft, props.draftId ?? ""));
  let input!: HTMLTextAreaElement;
  const [text, setText] = createSignal(saved?.text ?? "");
  const [caret, setCaret] = createSignal(0);
  // Escape hides the @ menu until you type again.
  const [menuHidden, setMenuHidden] = createSignal(false);
  const [at, setAt] = createSignal(0);
  // The model's latest draft and the text it was made from; a draft for older text still shows, faded.
  const [drafted, setDrafted] = createSignal<{ text: string; draft: ComposeDraft } | null>(null);
  // Once edited, the model no longer changes it.
  const [edited, setEdited] = createSignal<ComposeDraft | null>(saved?.draft ?? null);
  const [failed, setFailed] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  let sent = false;

  const ask = (body: string, signal: AbortSignal): Promise<ComposeDraft> =>
    draftWith(
      {
        author: { id: me().id, name: me().name },
        people: mentioned(body).map((u) => ({ id: u.id, name: u.name })),
        text: body,
      },
      signal,
    );

  // Ask the model again once typing pauses.
  const trimmed = createMemo(() => text().trim());
  createEffect(trimmed, (body) => {
    if (body === "") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      ask(body, controller.signal).then(
        (draft) => {
          setDrafted({ text: body, draft });
          setFailed(false);
        },
        () => void (controller.signal.aborted || setFailed(true)),
      );
    }, 500);
    return () => (clearTimeout(timer), controller.abort());
  });

  const current = (): ComposeDraft | null =>
    drafted()?.text === trimmed() ? drafted()!.draft : null;
  const shown = createMemo(
    (): ComposeDraft | null =>
      edited() ?? (trimmed() === "" ? null : (drafted()?.draft ?? plainDraft(trimmed()))),
  );
  const change = (next: Partial<ComposeDraft>): void => {
    const draft = shown();
    if (draft) setEdited({ ...draft, ...next });
  };
  const changeAsk = (index: number, next: Ask): void =>
    change({
      asks: (shown()?.asks ?? []).flatMap((old, i) =>
        i !== index ? [old] : next.personIds.length === 0 ? [] : [next],
      ),
    });

  // The `@name` being typed just before the cursor, if any.
  const typing = createMemo(() => {
    const match = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text().slice(0, caret()));
    return match ? { start: caret() - match[2].length - 1, query: match[2].toLowerCase() } : null;
  });
  const matches = createMemo((): (User | Subspace)[] => {
    const query = typing()?.query;
    if (query === undefined || menuHidden()) return [];
    return [...others(), ...subspaces()]
      .filter((target) => target.name.toLowerCase().startsWith(query))
      .slice(0, 6);
  });
  const pick = (target: User | Subspace): void => {
    const start = typing()?.start;
    if (start === undefined) return;
    const inserted = `@${target instanceof User ? firstName(target) : compact(target.name)} `;
    const end = start + inserted.length;
    setText(text().slice(0, start) + inserted + text().slice(caret()));
    setCaret(end);
    setAt(0);
    requestAnimationFrame(() => input.setSelectionRange(end, end));
  };

  // Sends it as edited, or the model's draft of exactly this text (asking for one if needed), or the plain draft.
  const submit = (): void => {
    const draft = edited() ?? current();
    if ((trimmed() === "" && !draft) || submitting()) return;
    const create = (made: ComposeDraft): void => {
      sent = true;
      saved?.delete();
      setDialog(null);
      const title = made.title.trim() || plainDraft(trimmed()).title || "New thread";
      const thread = createThread({ title, description: made.context });
      for (const { personIds, text: body } of made.asks)
        send(thread, [...personIds.map(mention), body].join(" "));
      open({ thread: thread.id });
    };
    if (draft) return create(draft);
    sent = true;
    setSubmitting(true);
    const body = trimmed();
    ask(body, new AbortController().signal).then(create, () => create(plainDraft(body)));
  };

  const keep = (): void => {
    if (sent || (trimmed() === "" && !edited())) return;
    const draft = edited() ?? current() ?? undefined;
    if (!saved) return void store.create(Draft, { user: me(), text: text(), draft });
    saved.text = text();
    saved.draft = draft;
    saved.save();
  };
  // However it closes: Escape, a click outside, Save draft, or another palette replacing it.
  onCleanup(keep);

  const onKeyDown = (event: KeyboardEvent): void => {
    const { key } = event;
    const inInput = event.target === input;
    const person = inInput ? matches()[Math.min(at(), matches().length - 1)] : undefined;
    if (person && (key === "ArrowDown" || key === "ArrowUp"))
      setAt((at() + (key === "ArrowDown" ? 1 : -1) + matches().length) % matches().length);
    else if (person && (key === "Tab" || key === "Enter")) pick(person);
    else if (person && key === "Escape") setMenuHidden(true);
    else if (event.metaKey && key.toLowerCase() === "s") setDialog(null);
    else if (
      key === "Enter" &&
      (event.metaKey || (inInput && !event.shiftKey && !event.isComposing))
    )
      submit();
    else return;
    event.preventDefault();
  };

  const status = (): string =>
    submitting()
      ? "Making the thread…"
      : edited()
        ? "Preview, edited"
        : current()
          ? "Preview · click to edit"
          : failed()
            ? "Preview (the model couldn't be reached)"
            : "Drafting…";
  const kbd = (key: string): JSX.Element => <kbd class={sx(compose.kbd, button.kbd)}>{key}</kbd>;

  return (
    <Modal>
      <div class={sx(compose.keys)} onKeyDown={onKeyDown}>
        <textarea
          ref={input}
          autofocus
          class={sx(compose.input)}
          placeholder="Write it as you'd say it… @mention who it's for"
          spellcheck={false}
          value={text()}
          onInput={(event) => {
            setText(event.currentTarget.value);
            setCaret(event.currentTarget.selectionStart);
            setAt(0);
            setMenuHidden(false);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        />
        <Show when={matches().length > 0}>
          <div class={sx(compose.mentions)} role="listbox" aria-label="Mention someone">
            <For each={matches()}>
              {(u, index) => (
                <button
                  class={sx(menu.item, index() === at() && menu.itemSelected)}
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setAt(index())}
                  onClick={() => pick(u)}
                >
                  <Identicon seed={u.id} size={16} />
                  <span class={sx(palette.rowLabel)}>{u.name}</span>
                  <Show when={u instanceof Subspace}>
                    <span class={sx(palette.shortcut)}>
                      Subspace · {(u as Subspace).members.length}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={shown()}>
          {(draft) => (
            <div class={sx(compose.preview, !edited() && !current() && compose.stale)}>
              <div class={sx(palette.sectionLabel, palette.labelText, compose.label)}>
                {status()}
                <Show when={edited() && trimmed() !== ""}>
                  <button class={sx(compose.redraft)} onClick={() => setEdited(null)}>
                    Redraft
                  </button>
                </Show>
              </div>
              <input
                class={sx(compose.field, compose.title)}
                aria-label="Title"
                placeholder="Untitled"
                spellcheck={false}
                value={draft().title}
                onInput={(event) => change({ title: event.currentTarget.value })}
              />
              <textarea
                class={sx(compose.field, compose.context)}
                aria-label="Context"
                placeholder="Add context…"
                rows={draft().context === "" ? 1 : 2}
                value={draft().context}
                onInput={(event) => change({ context: event.currentTarget.value })}
              />
              <Show
                when={draft().asks.length > 0}
                fallback={
                  <p class={sx(compose.empty)}>
                    Nobody's asked yet: @mention who it's for, or it's a note to yourself.
                  </p>
                }
              >
                <div class={sx(compose.asks)}>
                  {/* By position, as each edit replaces the ask; keeps the field you're typing in. */}
                  <For each={draft().asks} keyed={false}>
                    {(ask, index) => (
                      <div class={sx(compose.ask)}>
                        <span class={sx(compose.people)}>
                          <For
                            each={ask().personIds.flatMap((id) => store.findById(User, id) ?? [])}
                          >
                            {(person) => (
                              <span class={sx(compose.person)}>
                                <Identicon seed={person.id} size={14} />
                                {firstName(person)}
                                <button
                                  class={sx(compose.remove)}
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
                          class={sx(compose.field)}
                          aria-label="Ask"
                          rows={1}
                          value={ask().text}
                          onInput={(event) =>
                            changeAsk(index, { ...ask(), text: event.currentTarget.value })
                          }
                        />
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </Show>
        <div class={sx(compose.footer)}>
          <span>
            {kbd("⇧↵")} new line · {kbd("esc")} keeps a draft
          </span>
          <span class={sx(compose.actions)}>
            <button class={sx(button.button)} onClick={() => setDialog(null)}>
              Save draft {kbd("⌘S")}
            </button>
            <button
              class={sx(button.button, button.primary)}
              disabled={!shown() || submitting()}
              onClick={submit}
            >
              Send {kbd("↵")}
            </button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
