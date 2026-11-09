import * as i from "@hugeicons/core-free-icons";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Draft, mention, Subspace, User, type ComposeDraft } from "models";
import {
  draftWith,
  firstName,
  goBack,
  me,
  membersHint,
  open,
  others,
  setDialog,
  store,
  subspacesWithMembers,
} from "../session";
import { base } from "../styles/base";
import { button, link } from "../styles/controls";
import { page } from "../styles/page";
import { thread } from "../styles/thread";
import { compose } from "../styles/palette";
import { sx } from "../styles/sx";
import { icon } from "./Icon";
import { Identicon } from "./Identicon";
import { dot } from "./ThreadView";
import { moved, OptionButton } from "./Menus";
import { createThread, focusOnShow, send } from "./Palettes";

type Ask = ComposeDraft["asks"][number];

const MENTION = /@([\p{L}\p{N}_-]+)/gu;

const compact = (name: string): string => name.replaceAll(/\s+/g, "");
const namesIn = (text: string): string[] =>
  [...text.matchAll(MENTION)].map(([, name]) => name.toLowerCase());
const mentionedSubspaces = (text: string): Subspace[] =>
  subspacesWithMembers().filter((sub) => namesIn(text).includes(compact(sub.name).toLowerCase()));

// Everyone @mentioned, by first name or full name without spaces, and everyone in a subspace that is, in order.
export const mentioned = (text: string): User[] => {
  const found = namesIn(text).flatMap((name) =>
    others().filter((u) =>
      [firstName(u), compact(u.name)].some((key) => key.toLowerCase() === name),
    ),
  );
  const members = mentionedSubspaces(text).flatMap((sub) => [...sub.members].map((m) => m.userId));
  return [...new Set([...found, ...others().filter((u) => members.includes(u.id))])];
};

// Without the model: the first sentence as the title, and one ask for everyone mentioned.
export const plainDraft = (text: string): ComposeDraft => {
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
// A kept draft opens as a page (`page`), like the thread it will be, marked Draft: its preview, to edit, send or delete.
export function Compose(props: { draftId?: string; page?: boolean }): JSX.Element {
  const saved = untrack(() => store.findById(Draft, props.draftId ?? ""));
  let input!: HTMLTextAreaElement;
  const [text, setText] = createSignal(saved?.text ?? "");
  const [caret, setCaret] = createSignal(0);
  // Escape hides the @ menu until you type again.
  const [menuHidden, setMenuHidden] = createSignal(false);
  const [at, setAt] = createSignal(0);
  // The model's latest draft and the text it was made from; a draft for older text still shows, faded.
  const [drafted, setDrafted] = createSignal<{ text: string; draft: ComposeDraft } | null>(null);
  // Once edited, the model no longer changes it. A kept draft's page shows what was kept, and the model leaves it be.
  const [edited, setEdited] = createSignal<ComposeDraft | null>(
    saved?.draft ?? (props.page && saved ? plainDraft(saved.text) : null),
  );
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
    if (body === "" || props.page) return;
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
    return [...others(), ...subspacesWithMembers()]
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
    if (person && moved(key, at(), matches().length) !== undefined)
      setAt(moved(key, at(), matches().length)!);
    else if (person && (key === "Tab" || key === "Enter")) pick(person);
    else if (person && key === "Escape") setMenuHidden(true);
    else if (event.metaKey && key.toLowerCase() === "s")
      (props.page ? keep : () => setDialog(null))();
    else if (
      key === "Enter" &&
      (event.metaKey || (inInput && !event.shiftKey && !event.isComposing))
    )
      submit();
    else return;
    event.preventDefault();
  };

  // Beside "New thread": what the model's doing, or that you've taken over.
  const status = (): string =>
    submitting()
      ? "Making it"
      : edited()
        ? "Edited"
        : current()
          ? ""
          : failed()
            ? "Couldn't reach the model"
            : "Drafting";
  // Everyone the thread asks, once each: who it's assigned to.
  const asked = (draft: ComposeDraft): User[] =>
    [...new Set(draft.asks.flatMap((a) => a.personIds))].flatMap(
      (id) => store.findById(User, id) ?? [],
    );
  const kbd = (key: string): JSX.Element => <kbd class={sx(compose.kbd)}>{key}</kbd>;

  const discard = (): void => {
    sent = true;
    saved?.delete();
    goBack();
  };
  const Frame = (frame: { children: JSX.Element }): JSX.Element =>
    props.page ? (
      <article class={sx(compose.page)}>{frame.children}</article>
    ) : (
      <>{frame.children}</>
    );

  return (
    <Frame>
      <div class={sx(compose.keys)} onKeyDown={onKeyDown}>
        <Show when={!props.page}>
          <textarea
            ref={(el) => {
              input = el;
              focusOnShow(el);
            }}
            autofocus
            class={sx(base.bare, compose.input)}
            placeholder="Write it as you'd say it, @mention who it's for"
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
        </Show>
        <Show when={matches().length > 0}>
          <div class={sx(compose.mentions)} role="listbox" aria-label="Mention Someone">
            <For each={matches()}>
              {(u, index) => (
                <OptionButton
                  option={{
                    label: u.name,
                    seed: u.id,
                    hint: u instanceof Subspace ? membersHint(u) : undefined,
                    run: () => pick(u),
                  }}
                  selected={index() === at()}
                  onHover={() => setAt(index())}
                />
              )}
            </For>
          </div>
        </Show>
        <Show when={shown()}>
          {(draft) => (
            <div
              class={sx(compose.preview, !props.page && !edited() && !current() && compose.stale)}
            >
              <div class={sx(compose.head)}>
                <Show when={props.page} fallback="New thread">
                  <span class={sx(page.pill)}>{icon(i.NoteEditIcon, 12)} Draft</span>
                </Show>
                <Show when={!props.page}>
                  <span class={sx(compose.status)}>
                    {status()}
                    <Show when={edited() && trimmed() !== ""}>
                      <button
                        class={sx(base.bare, compose.redraft)}
                        onClick={() => setEdited(null)}
                      >
                        Redraft
                      </button>
                    </Show>
                  </span>
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
                placeholder="Add context"
                rows={1}
                value={draft().context}
                onInput={(event) => change({ context: event.currentTarget.value })}
              />
              {/* What the thread page will show: its status, owner and who's asked. */}
              <div class={sx(compose.properties)}>
                <span class={sx(page.pill)}>
                  {dot("open")}
                  Open
                </span>
                <span class={sx(page.inCell)}>
                  <Identicon seed={me().id} size={16} />
                  {firstName(me())}
                </span>
                <Show when={asked(draft()).length > 0}>
                  <span
                    class={sx(page.avatars)}
                    title={asked(draft())
                      .map((u) => u.name)
                      .join(", ")}
                  >
                    <For each={asked(draft())}>
                      {(u) => <Identicon seed={u.id} size={16} class={sx(page.avatar)} />}
                    </For>
                  </span>
                </Show>
              </div>
              <Show
                when={draft().asks.length > 0}
                fallback={
                  <p class={sx(compose.empty)}>
                    Nobody's asked yet: @mention who it's for, or it's a note to yourself.
                  </p>
                }
              >
                {/* Each ask is a message from you, as the thread will show it. By position, as each edit replaces the
                    ask; keeps the field you're typing in. */}
                <For each={draft().asks} keyed={false}>
                  {(ask, index) => (
                    <div class={sx(thread.block, compose.message)}>
                      <span class={sx(thread.avatar)}>
                        <Identicon seed={me().id} size={15} />
                      </span>
                      <div class={sx(thread.body)}>
                        <span class={sx(thread.meta, thread.author)}>{me().name}</span>
                        <div class={sx(compose.line)}>
                          <For
                            each={ask().personIds.flatMap((id) => store.findById(User, id) ?? [])}
                          >
                            {(person) => (
                              <span class={sx(link.mention, compose.mention)}>
                                @{firstName(person)}
                              </span>
                            )}
                          </For>
                          <textarea
                            class={sx(compose.field, compose.askText)}
                            aria-label="Ask"
                            rows={1}
                            value={ask().text}
                            onInput={(event) =>
                              changeAsk(index, { ...ask(), text: event.currentTarget.value })
                            }
                            // Backspace at the very start deletes the mention before it, as in a token field.
                            onKeyDown={(event) => {
                              const { selectionStart, selectionEnd } = event.currentTarget;
                              if (event.key !== "Backspace" || selectionStart + selectionEnd > 0)
                                return;
                              event.preventDefault();
                              changeAsk(index, {
                                ...ask(),
                                personIds: ask().personIds.slice(0, -1),
                              });
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          )}
        </Show>
        <div class={sx(compose.footer)}>
          <Show
            when={props.page}
            fallback={
              <button
                class={sx(base.bare, base.hover, base.dim, compose.quiet)}
                onClick={() => setDialog(null)}
              >
                Save draft {kbd("⌘S")}
              </button>
            }
          >
            <button class={sx(base.bare, base.hover, base.dim, compose.quiet)} onClick={discard}>
              Delete draft
            </button>
          </Show>
          <button
            class={sx(base.bare, button.solid)}
            disabled={!shown() || submitting()}
            onClick={submit}
          >
            Send {kbd("↵")}
          </button>
        </div>
      </div>
    </Frame>
  );
}
