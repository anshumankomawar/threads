import type { ComposeDraft } from "model";
import { plainDraft } from "../compose";
import type { SavedDraft } from "../drafts";
import { createMemo, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { formatRelativeTime } from "../format";
import { useApp } from "../app/state";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { thread } from "../styles/thread";
import { threadLineMarker } from "../styles/markers.stylex";
import { button } from "../styles/controls";
import { colors, fontSizes } from "../styles/tokens.stylex";
import { Identicon } from "./Identicon";

const styles = stylex.create({
  label: { fontWeight: 500, letterSpacing: "0.4px", textTransform: "uppercase" },
  small: { fontSize: fontSizes.small },
  // Fields that look like the text they hold: after the text's own style.
  field: {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    padding: 0,
    borderStyle: "none",
    borderRadius: 0,
    fontFamily: "inherit",
    backgroundColor: "transparent",
    outline: "none",
    resize: "none",
    fieldSizing: "content",
    "::placeholder": { color: colors.textTertiary },
  },
  ask: { display: "flex", flexWrap: "wrap", gap: "0 4px", alignItems: "baseline" },
  askText: { flex: 1, width: "auto", minWidth: 160 },
  // Carries the default marker, so its remove button shows on hover.
  mention: { display: "inline-flex", gap: 2, alignItems: "baseline", color: colors.accent },
  remove: { opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1 } },
  empty: { margin: "0 0 0 37px" },
  actions: { display: "flex", gap: 6, paddingLeft: 37 },
});

// A draft, laid out as the thread will look once sent, editing in place and kept as you type.
export function DraftView(props: { saved: SavedDraft }): JSX.Element {
  const app = useApp();
  const me = app.me;
  const targets = app.data.targets;
  // Saved before the model drafted it: start from the plain reading of what was written.
  const draft = createMemo(() => props.saved.draft ?? plainDraft(props.saved.text, targets()));
  const change = (next: Partial<ComposeDraft>): void =>
    app.drafts.save({ ...props.saved, draft: { ...draft(), ...next } });
  const changeAsk = (index: number, next: ComposeDraft["asks"][number]): void =>
    change({
      asks: draft().asks.flatMap((ask, at) =>
        at !== index ? [ask] : next.personIds.length === 0 ? [] : [next],
      ),
    });
  const send = (): void =>
    app.threads.compose(
      {
        ...draft(),
        title:
          draft().title.trim() || plainDraft(props.saved.text, targets()).title || "New thread",
      },
      props.saved.id,
    );

  return (
    <div class={[sx(thread.view), "thread-view"]}>
      <div
        class={sx(thread.scroll)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            send();
          }
        }}
      >
        <article class={sx(thread.doc)}>
          <header class={sx(thread.header)}>
            <div {...stylex.attrs(thread.byline, threadLineMarker)}>
              <span class={sx(page.muted, styles.small, styles.label)}>Draft</span>
              <span>saved {formatRelativeTime(props.saved.savedAtMs, app.now())}</span>
            </div>
            <input
              class={sx(thread.title, thread.headerTitle, styles.field)}
              aria-label="Title"
              placeholder="Untitled"
              spellcheck={false}
              value={draft().title}
              onInput={(event) => change({ title: event.currentTarget.value })}
            />
            <textarea
              class={sx(thread.text, thread.description, thread.headerDescription, styles.field)}
              aria-label="Context"
              placeholder="Add context…"
              rows={1}
              value={draft().context}
              onInput={(event) => change({ context: event.currentTarget.value })}
            />
          </header>
          <Show when={draft().asks.length === 0}>
            <p class={sx(page.muted, styles.empty)}>
              Nobody's asked yet. Sending it makes a thread for you alone.
            </p>
          </Show>
          {/* By position, as each edit replaces the ask; keeps the field you're typing in. */}
          <For each={draft().asks} keyed={false}>
            {(ask, index) => (
              <div class={sx(thread.block)}>
                <span class={sx(thread.avatar)}>
                  <Identicon seed={me().id} size={20} />
                </span>
                <div class={sx(thread.body)}>
                  <div class={sx(thread.meta)}>
                    <span class={sx(thread.author)}>{me().name}</span>
                  </div>
                  <div class={sx(styles.ask)}>
                    <For
                      each={ask().personIds.flatMap(
                        (id) => targets().find((t) => t.id === id) ?? [],
                      )}
                    >
                      {(person) => (
                        <span {...stylex.attrs(styles.mention, stylex.defaultMarker())}>
                          @{person.handle}
                          <button
                            type="button"
                            class={sx(
                              page.bare,
                              page.pointer,
                              page.muted,
                              styles.small,
                              styles.remove,
                            )}
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
                      class={sx(thread.text, styles.field, styles.askText)}
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
          <div class={sx(styles.actions)}>
            <button type="button" class={sx(button.button, button.primary)} onClick={send}>
              Send <kbd class={sx(button.kbd)}>⌘↵</kbd>
            </button>
            <button
              type="button"
              class={sx(button.button)}
              onClick={() => app.drafts.remove(props.saved.id)}
            >
              Delete draft
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
