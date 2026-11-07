import * as i from "@hugeicons/core-free-icons";
import { createSignal, For, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { mention, User, type ComposeDraft, type Draft } from "models";
import { firstName, me, open, store, summary } from "../session";
import { base } from "../styles/base";
import { button, chip, chipTone } from "../styles/controls";
import { sx } from "../styles/sx";
import { thread } from "../styles/thread";
import { colors, fontSizes, motion, radii } from "../styles/tokens.stylex";
import { mentioned, plainDraft } from "./Compose";
import { icon } from "./Icon";
import { Identicon } from "./Identicon";
import { createThread, send } from "./Palettes";
import { ago } from "./ThreadView";

// A kept draft, laid out exactly as the thread it will be (ThreadView's header, messages and reply), only not sent: its
// title, context and each ask are edited in place, and a bar at the bottom sends it or throws it away.

type Ask = ComposeDraft["asks"][number];

const styles = stylex.create({
  // The thread's own text styles, as fields: no box of their own, growing with what's in them.
  field: {
    display: "block",
    width: "100%",
    padding: 0,
    borderStyle: "none",
    outline: "none",
    color: "inherit",
    font: "inherit",
    lineHeight: "inherit",
    backgroundColor: "transparent",
    resize: "none",
    fieldSizing: "content",
    "::placeholder": { color: colors.textTertiary },
  },
  quiet: { color: colors.textTertiary, fontSize: fontSizes.body },
  // Its own line under the title, a little apart from it, rather than tucked up as a thread's description is.
  description: { marginTop: 2 },
  properties: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 8 },
  // Not a menu: a draft's status and who it asks follow from what's written.
  staticChip: { cursor: "default" },
  // Floating at the bottom of the pane, the width of the document: that it isn't sent, and sending it.
  bar: {
    position: "absolute",
    right: 32,
    bottom: 14,
    // On the document's left edge, as the thread view sets it.
    left: 52,
    display: "flex",
    gap: 10,
    alignItems: "center",
    maxWidth: 689,
    padding: "8px 8px 8px 14px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    backgroundColor: colors.panel,
    boxShadow: colors.shadowFloat,
  },
  barText: { display: "flex", flex: 1, gap: 6, alignItems: "center", color: colors.textSecondary },
  delete: {
    color: { default: colors.textTertiary, ":hover": colors.urgent },
    transitionProperty: "color",
    transitionDuration: { default: "120ms", [motion.reduced]: "0s" },
  },
  // Room to scroll the last message clear of the bar.
  overscroll: { height: 96 },
});

const people = (ids: string[]): User[] => ids.flatMap((id) => store.findById(User, id) ?? []);

export function DraftView(props: { draft: Draft }): JSX.Element {
  const d = (): Draft => props.draft;
  // What's on the page, edited in place; a draft the model never filled in starts from what was typed.
  const [doc, setDoc] = createSignal<ComposeDraft>(
    untrack(() => {
      const drafted = d().draft ?? plainDraft(d().text);
      // Asking no one it knows, what was typed is still the message: a note until someone's @mentioned.
      return drafted.asks.length > 0 || !d().text.trim()
        ? drafted
        : { ...drafted, asks: [{ personIds: [], text: d().text.trim() }] };
    }),
  );
  const keep = (next: ComposeDraft): void => {
    setDoc(next);
    d().draft = next;
    d().save();
  };
  const change = (fields: Partial<ComposeDraft>): void => keep({ ...doc(), ...fields });
  const changeAsk = (index: number, fields: Partial<Ask>): void =>
    change({ asks: doc().asks.map((a, at) => (at === index ? { ...a, ...fields } : a)) });
  const asked = (): User[] => people([...new Set(doc().asks.flatMap((a) => a.personIds))]);

  // The next message, as the reply box is: Enter adds it, and whoever it @mentions is who it asks.
  const [next, setNext] = createSignal("");
  const add = (): void => {
    const text = next().trim();
    if (!text) return;
    const to = mentioned(text);
    const body = text.replaceAll(/@[\p{L}\p{N}_-]+\s*/gu, "").trim() || text;
    change({ asks: [...doc().asks, { personIds: to.map((u) => u.id), text: body }] });
    setNext("");
  };

  // Sending makes the thread it shows, as Compose does, and opens it.
  const publish = (): void => {
    add();
    const made = doc();
    const title = made.title.trim() || plainDraft(d().text).title || "New thread";
    const created = createThread({ title, description: made.context.trim() || undefined });
    for (const { personIds, text } of made.asks)
      send(created, [...personIds.map(mention), text].join(" "));
    void d().delete();
    open({ thread: created.id });
  };
  const discard = (): void => {
    void d().delete();
    open({ thread: null });
  };

  return (
    <div class={sx(thread.view)}>
      <div class={sx(thread.scroll)}>
        <article class={sx(thread.doc)}>
          <header class={sx(thread.block, thread.header)}>
            <span class={sx(thread.avatar)}>
              <Identicon seed={me().id} size={20} />
            </span>
            <div class={sx(thread.body, thread.headerBody)}>
              <div class={sx(thread.meta)}>
                <span class={sx(thread.author)}>{me().name}</span>
                <span class={sx(styles.quiet)}>Draft · edited {ago(d().updatedAt)}</span>
              </div>
              <textarea
                class={sx(thread.title, thread.headerTitle, styles.field)}
                rows={1}
                aria-label="Title"
                placeholder="Title"
                value={doc().title}
                onInput={(e) => change({ title: e.currentTarget.value.replaceAll("\n", " ") })}
              />
              <textarea
                class={sx(thread.text, thread.description, styles.field, styles.description)}
                rows={1}
                aria-label="Description"
                placeholder="Add a description…"
                value={doc().context}
                onInput={(e) => change({ context: e.currentTarget.value })}
              />
              <div class={sx(styles.properties)}>
                <span class={sx(chip.chip, chipTone.muted, styles.staticChip)}>
                  {icon(i.NoteEditIcon, 13)}
                  Draft
                </span>
                <span
                  class={sx(chip.chip, asked().length === 0 && chipTone.muted, styles.staticChip)}
                  title="Who it asks: whoever its messages @mention"
                >
                  {icon(i.UserMultipleIcon, 13)}
                  {summary(
                    asked().map((u) => firstName(u)),
                    "No one yet",
                  )}
                </span>
              </div>
            </div>
          </header>
          {/* By position, so editing a message keeps its field (and your cursor) rather than making a new one. */}
          <For each={doc().asks} keyed={false}>
            {(ask, index) => (
              <div class={sx(thread.block)}>
                <span class={sx(thread.avatar)}>
                  <Identicon seed={me().id} size={20} />
                </span>
                <div class={sx(thread.body)}>
                  <div class={sx(thread.meta)}>
                    <span class={sx(thread.author)}>{me().name}</span>
                    <span class={sx(styles.quiet)}>
                      {ask().personIds.length > 0
                        ? `to ${people(ask().personIds)
                            .map((u) => u.name)
                            .join(", ")}`
                        : "a note"}
                    </span>
                  </div>
                  <textarea
                    class={sx(thread.text, styles.field)}
                    rows={1}
                    aria-label="Message"
                    value={ask().text}
                    onInput={(e) => changeAsk(index, { text: e.currentTarget.value })}
                    onKeyDown={(e) => {
                      // An emptied message goes, as deleting a thread's message does.
                      if (e.key === "Backspace" && e.currentTarget.value === "")
                        change({ asks: doc().asks.filter((_, at) => at !== index) });
                    }}
                  />
                </div>
              </div>
            )}
          </For>
          <div class={sx(thread.block)}>
            <span class={sx(thread.avatar)}>
              <Identicon seed={me().id} size={20} />
            </span>
            <div class={sx(thread.body)}>
              <div class={sx(thread.meta)}>
                <span class={sx(thread.author)}>{me().name}</span>
              </div>
              <textarea
                class={sx(thread.text, styles.field)}
                rows={1}
                aria-label="Message"
                placeholder={
                  doc().asks.length === 0
                    ? "Write it… @mention someone to ask them"
                    : "Another message… @mention someone to bring them in"
                }
                value={next()}
                onInput={(e) => setNext(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
                  e.preventDefault();
                  if (e.metaKey) publish();
                  else add();
                }}
              />
            </div>
          </div>
        </article>
        <div class={sx(styles.overscroll)} aria-hidden="true" />
      </div>
      <div class={sx(styles.bar)} role="region" aria-label="Draft">
        <span class={sx(styles.barText)}>
          {icon(i.NoteEditIcon, 13)}
          <span>Draft · Not sent</span>
        </span>
        <button class={sx(base.bare, styles.delete)} onClick={discard}>
          Delete draft
        </button>
        <button class={sx(base.bare, button.solid)} title="Send (⌘↵)" onClick={publish}>
          Send
        </button>
      </div>
    </div>
  );
}
