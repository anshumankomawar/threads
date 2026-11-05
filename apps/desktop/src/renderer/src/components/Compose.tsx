import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Draft, mention, User, type ComposeDraft } from "models";
import { draftWith, me, setDialog, store } from "../session";
import { button, link } from "../styles/controls";
import { compose, palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Identicon } from "./Identicon";
import { Modal, send, startThread } from "./Palettes";

const MENTION = /@([\p{L}\p{N}_-]+)/gu;

// Everyone @mentioned by first name, in order.
const mentioned = (text: string): User[] => {
  const users = store.all(User).filter((u) => u.id !== me().id);
  const found = [...text.matchAll(MENTION)].flatMap(([, name]) =>
    users.filter((u) => u.name.split(" ")[0].toLowerCase() === name.toLowerCase()),
  );
  return [...new Set(found)];
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

// A thread written as one message (⌘⇧N): the model drafts its title, context and each person's ask while you
// type. Enter sends it; ⌘S, or closing with something written, keeps it as a draft.
export function Compose(props: { draftId?: string }): JSX.Element {
  const saved = untrack(() => store.findById(Draft, props.draftId ?? ""));
  const [text, setText] = createSignal(saved?.text ?? "");
  const [drafted, setDrafted] = createSignal<{ text: string; draft: ComposeDraft } | null>(
    saved?.draft ? { text: saved.text, draft: saved.draft } : null,
  );
  let sending = false;

  // Ask the model again once typing pauses.
  createEffect(
    () => text().trim(),
    (body) => {
      if (body === "") return;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        const people = mentioned(body).map((u) => ({ id: u.id, name: u.name }));
        draftWith(
          { author: { id: me().id, name: me().name }, people, text: body },
          controller.signal,
        ).then(
          (draft) => setDrafted({ text: body, draft }),
          () => {},
        );
      }, 500);
      return () => (clearTimeout(timer), controller.abort());
    },
  );
  const shown = (): ComposeDraft | null =>
    text().trim() === "" ? null : (drafted()?.draft ?? plainDraft(text()));

  const submit = (): void => {
    const draft = drafted()?.text === text().trim() ? drafted()!.draft : plainDraft(text());
    sending = true;
    saved?.delete();
    setDialog(null);
    const thread = startThread(draft.title || "New thread");
    if (draft.context) send(thread, draft.context);
    for (const ask of draft.asks)
      send(
        thread,
        [...ask.personIds.map(mention), ask.text].join(" "),
        ask.personIds.flatMap((id) => store.findById(User, id) ?? []),
      );
  };
  const keep = (): void => {
    if (sending || text().trim() === "") return;
    const draft = drafted()?.draft;
    if (!saved) return void store.create(Draft, { user: me(), text: text(), draft });
    saved.text = text();
    saved.draft = draft;
    saved.save();
  };

  return (
    <Modal onClose={keep}>
      <textarea
        autofocus
        class={sx(compose.input)}
        placeholder="Write it as you'd say it… @mention who it's for"
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing && shown()) submit();
          else if (event.key === "s" && event.metaKey) setDialog(null);
          else return;
          event.preventDefault();
        }}
      />
      <Show when={shown()}>
        {(draft) => (
          <div class={sx(compose.preview, drafted()?.text !== text().trim() && compose.stale)}>
            <div class={sx(palette.sectionLabel, palette.labelText, compose.label)}>
              {drafted()?.text === text().trim() ? "Draft" : "Drafting…"}
            </div>
            <div class={sx(compose.title)}>{draft().title || "Untitled"}</div>
            <Show when={draft().context}>
              <div class={sx(compose.context)}>{draft().context}</div>
            </Show>
            <div class={sx(compose.asks)}>
              <For
                each={draft().asks}
                fallback={
                  <div class={sx(compose.people)}>
                    Nobody's asked yet: @mention who it's for, or it's a note to yourself.
                  </div>
                }
              >
                {(ask) => (
                  <div class={sx(compose.ask)}>
                    <div class={sx(compose.people)}>
                      <For each={ask.personIds}>
                        {(id) => (
                          <span class={sx(compose.person)}>
                            <Identicon seed={id} size={14} />
                            <span class={sx(link.mention)}>
                              {store.findById(User, id)?.name ?? "someone"}
                            </span>
                          </span>
                        )}
                      </For>
                    </div>
                    <div>{ask.text}</div>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
      <div class={sx(compose.footer)}>
        <span>⇧↵ new line · esc keeps a draft</span>
        <span class={sx(compose.actions)}>
          <button class={sx(button.button)} onClick={() => setDialog(null)}>
            Save draft <kbd class={sx(compose.kbd, button.kbd)}>⌘S</kbd>
          </button>
          <button
            class={sx(button.button, button.primary)}
            disabled={!shown()}
            onClick={() => submit()}
          >
            Send <kbd class={sx(compose.kbd)}>↵</kbd>
          </button>
        </span>
      </div>
    </Modal>
  );
}
