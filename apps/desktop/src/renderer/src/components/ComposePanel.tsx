import type { ComposeDraft, ComposeRequest } from "model";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { mentionedTargets, plainDraft, type Target } from "../compose";
import type { SavedDraft } from "../drafts";
import { button } from "../styles/controls";
import { compose as styles, palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Identicon } from "./Identicon";
import { createList, Rows, Shell } from "./Palette";

type Ask = ComposeDraft["asks"][number];

// A new thread in one message (⌘⇧N): write it as you'd say it, and the model drafts the thread while you type (its
// title, shared context, and each person's ask). Edits in the preview stick until Redraft. Enter sends it; ⌘S, or
// closing with something written, keeps it as a draft.
export function ComposePanel(props: {
  initial: SavedDraft | null;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  const targets = (): Target[] => app.data.targets();
  let input!: HTMLTextAreaElement;
  const initial = untrack(() => props.initial);
  const draftId = initial?.id ?? crypto.randomUUID();
  const [text, setText] = createSignal(initial?.text ?? "");
  const [caret, setCaret] = createSignal(0);
  // Escape hides the @ menu until you type again.
  const [menuHidden, setMenuHidden] = createSignal(false);
  // The model's latest draft and the text it was made from; a draft for older text still shows, faded.
  const [drafted, setDrafted] = createSignal<{ text: string; draft: ComposeDraft } | null>(null);
  // Once edited, the model no longer changes it.
  const [edited, setEdited] = createSignal<ComposeDraft | null>(initial?.draft ?? null);
  const [failed, setFailed] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  onSettled(() => input.focus());

  // Only who's @mentioned, so the model can't hand an ask to anyone else. A group is asked as one.
  const request = (body: string): ComposeRequest => ({
    author: { id: app.me().id, name: app.me().name },
    people: mentionedTargets(body, targets()).map(({ id, name, group }) => ({
      id,
      name: group === null ? name : `${name} (group)`,
    })),
    text: body,
  });
  const ask = (body: string, signal: AbortSignal): Promise<ComposeDraft> =>
    app.threads.draftWith(request(body), signal);

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
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  const current = (): ComposeDraft | null => {
    const latest = drafted();
    return latest?.text === trimmed() ? latest.draft : null;
  };
  const plain = (): ComposeDraft => plainDraft(trimmed(), targets());
  const shown = createMemo(
    (): ComposeDraft | null =>
      edited() ?? (trimmed() === "" ? null : (drafted()?.draft ?? plain())),
  );
  const change = (next: Partial<ComposeDraft>): void => {
    const draft = shown();
    if (draft !== null) setEdited({ ...draft, ...next });
  };
  const changeAsk = (index: number, next: Ask): void =>
    change({
      asks: (shown()?.asks ?? []).flatMap((old, at) =>
        at !== index ? [old] : next.personIds.length === 0 ? [] : [next],
      ),
    });

  // The `@name` being typed just before the cursor, if any.
  const mention = createMemo(() => {
    const match = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text().slice(0, caret()));
    return match === null ? null : { start: caret() - match[2].length - 1, query: match[2] };
  });
  const list = createList((): Target[] => {
    const query = mention()?.query.toLowerCase();
    if (query === undefined || menuHidden()) return [];
    const starts = (name: string): boolean => name.toLowerCase().startsWith(query);
    return targets()
      .filter((target) => starts(target.name) || starts(target.handle))
      .slice(0, 6);
  });
  const pick = (target: Target): void => {
    const start = mention()?.start;
    if (start === undefined) return;
    const inserted = `@${target.handle} `;
    const at = start + inserted.length;
    setText(text().slice(0, start) + inserted + text().slice(caret()));
    setCaret(at);
    list.set(0);
    requestAnimationFrame(() => input.setSelectionRange(at, at));
  };

  // Sends it as edited, or the model's draft of exactly this text (asking for one if needed), or the plain draft.
  const submit = (): void => {
    const body = trimmed();
    const draft = edited() ?? current();
    if ((body === "" && draft === null) || submitting()) return;
    const create = (made: ComposeDraft): void => {
      const title = made.title.trim() || plain().title || "New thread";
      app.threads.compose({ ...made, title }, initial?.id ?? null);
    };
    if (draft !== null) return create(draft);
    setSubmitting(true);
    ask(body, new AbortController().signal).then(create, () => create(plain()));
  };

  const saveDraft = (): void => {
    if (trimmed() === "" && edited() === null) return props.onClose();
    const draft = edited() ?? current();
    app.drafts.saveAndClose({ id: draftId, text: text(), draft, savedAtMs: Date.now() });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const { key } = event;
    const mod = event.metaKey || event.ctrlKey;
    const typing = event.target === input;
    const target = list.current();
    const menuKey = typing && target !== undefined;
    if (menuKey && ["ArrowDown", "ArrowUp", "Tab", "Enter"].includes(key)) {
      if (key === "ArrowDown" || key === "ArrowUp") list.move(key === "ArrowDown" ? 1 : -1);
      else pick(target);
    } else if (menuKey && key === "Escape") setMenuHidden(true);
    else if (key === "Escape" || (mod && key.toLowerCase() === "s")) saveDraft();
    else if (key === "Enter" && (mod || (typing && !event.shiftKey && !event.isComposing)))
      submit();
    else return;
    event.preventDefault();
  };

  const byId = createMemo(() => new Map(targets().map((target) => [target.id, target])));
  const kbd = (key: string): JSX.Element => <kbd class={sx(styles.kbd, button.kbd)}>{key}</kbd>;
  const status = (): string =>
    submitting()
      ? "Making the thread…"
      : edited() !== null
        ? "Preview, edited"
        : current() !== null
          ? "Preview · click to edit"
          : failed()
            ? "Preview (the model couldn't be reached)"
            : "Drafting…";

  return (
    <Shell label="New message" onClose={saveDraft} onKeyDown={onKeyDown} style={styles.panel}>
      <textarea
        ref={input}
        class={sx(styles.input, styles.inputText)}
        rows={3}
        placeholder="Write it as you'd say it… @mention who it's for"
        spellcheck={false}
        value={text()}
        onInput={(event) => {
          setText(event.currentTarget.value);
          setCaret(event.currentTarget.selectionStart);
          list.set(0);
          setMenuHidden(false);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
      />
      <Show when={list.items().length > 0}>
        <div class={sx(styles.mentions)} role="listbox" aria-label="Mention someone">
          <Rows
            list={list}
            onPick={pick}
            row={(t) => ({
              seed: t.id,
              label: t.name,
              shortcut: t.group === null ? undefined : `Group · ${t.group.memberIds.length}`,
            })}
          />
        </div>
      </Show>
      <Show when={shown()}>
        {(draft) => (
          <div class={sx(styles.preview, edited() === null && current() === null && styles.stale)}>
            <div class={sx(palette.sectionLabel, palette.labelText, styles.label)}>
              {status()}
              <Show when={edited() !== null && trimmed() !== ""}>
                <button type="button" class={sx(styles.redraft)} onClick={() => setEdited(null)}>
                  Redraft
                </button>
              </Show>
            </div>
            <input
              class={sx(styles.field, styles.title)}
              aria-label="Title"
              placeholder="Untitled"
              spellcheck={false}
              value={draft().title}
              onInput={(event) => change({ title: event.currentTarget.value })}
            />
            <textarea
              class={sx(styles.field, styles.context)}
              aria-label="Context"
              placeholder="Add context…"
              rows={draft().context === "" ? 1 : 2}
              value={draft().context}
              onInput={(event) => change({ context: event.currentTarget.value })}
            />
            <Show
              when={draft().asks.length > 0}
              fallback={
                <p class={sx(styles.empty)}>
                  Nobody's asked yet: @mention who it's for, or it's a note to yourself.
                </p>
              }
            >
              <ul class={sx(styles.asks)}>
                {/* By position, as each edit replaces the ask; keeps the field you're typing in. */}
                <For each={draft().asks} keyed={false}>
                  {(ask, index) => (
                    <li class={sx(styles.ask)}>
                      <span class={sx(styles.people)}>
                        <For each={ask().personIds.flatMap((id) => byId().get(id) ?? [])}>
                          {(person) => (
                            <span class={sx(styles.person)}>
                              <Identicon seed={person.id} size={14} />
                              {person.group === null ? person.handle : `@${person.handle}`}
                              <button
                                type="button"
                                class={sx(styles.remove)}
                                aria-label={`Don't ask ${person.name}`}
                                onClick={() => {
                                  const personIds = ask().personIds.filter(
                                    (id) => id !== person.id,
                                  );
                                  changeAsk(index, { ...ask(), personIds });
                                }}
                              >
                                ×
                              </button>
                            </span>
                          )}
                        </For>
                      </span>
                      <textarea
                        class={sx(styles.field)}
                        aria-label="Ask"
                        rows={1}
                        value={ask().text}
                        onInput={(e) => changeAsk(index, { ...ask(), text: e.currentTarget.value })}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        )}
      </Show>
      <div class={sx(styles.footer)}>
        <span>
          {kbd("⇧↵")} new line · {kbd("esc")} keeps a draft
        </span>
        <span class={sx(styles.actions)}>
          <button type="button" class={sx(button.button)} onClick={saveDraft}>
            Save draft {kbd("⌘S")}
          </button>
          <button
            type="button"
            class={sx(button.button, button.primary)}
            disabled={shown() === null || submitting()}
            onClick={submit}
          >
            Send {kbd("↵")}
          </button>
        </span>
      </div>
    </Shell>
  );
}
