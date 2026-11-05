import { Extension, mergeAttributes, Node, type Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { exitSuggestion, Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import { groupMention, mention, threadLink } from "models";
import { editorClass } from "../styles/controls";

// Typing `#`, `@` or `/` in a reply opens a menu at the caret, which the reply renders from what `announce` hands it
// (null when it closes). Picking replaces `<char>query` with a chip (thread link or mention), or removes it (command).
export type CaretKind = "thread" | "mention" | "command";
type CaretAttrs = { id: string; title?: string; name?: string };
export type CaretMenu = { query: string; rect: DOMRect | null; pick: (attrs?: CaretAttrs) => void };
type Announce = (kind: CaretKind, menu: CaretMenu | null) => void;

const keys: Record<CaretKind, PluginKey> = {
  thread: new PluginKey("threadMenu"),
  mention: new PluginKey("mentionMenu"),
  command: new PluginKey("commandMenu"),
};

export const closeCaretMenu = (view: EditorView, kind: CaretKind): void =>
  exitSuggestion(view, keys[kind]);

function caretMenu(
  editor: Editor,
  kind: CaretKind,
  char: string,
  announce: Announce,
  node?: string,
) {
  const show = (props: SuggestionProps<never, CaretAttrs> | null): void =>
    announce(
      kind,
      props && {
        query: props.query,
        rect: props.clientRect?.() ?? null,
        pick: (attrs?: CaretAttrs) => props.command(attrs as CaretAttrs),
      },
    );
  return Suggestion<never, CaretAttrs>({
    editor,
    pluginKey: keys[kind],
    char,
    // Thread titles have spaces, so the `#` query may too.
    allowSpaces: kind === "thread",
    items: () => [],
    command: ({ editor: target, range, props }) => {
      const chain = target.chain().focus();
      if (node === undefined) chain.deleteRange(range).run();
      else chain.insertContentAt(range, { type: node, attrs: props }).insertContent(" ").run();
    },
    render: () => ({ onStart: show, onUpdate: show, onExit: () => show(null) }),
  });
}

// An atom chip in a draft: `# <title>` for a thread link, `@<name>` for a mention, sent as its token.
function chipNode(char: "#" | "@", announce: Announce) {
  const isLink = char === "#";
  const [name, label, attr] = isLink
    ? ["threadLink", "title", "data-thread-link"]
    : ["mention", "name", "data-mention"];
  const text = (attrs: Record<string, unknown>): string =>
    isLink ? `# ${String(attrs.title) || "thread"}` : `@${String(attrs.name) || "someone"}`;
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    addAttributes: () => ({ id: { default: null }, [label]: { default: "" } }),
    parseHTML: () => [{ tag: `span[${attr}]` }],
    renderHTML: ({ node, HTMLAttributes }) => {
      const cls = isLink ? editorClass.threadLink : editorClass.mention;
      return [
        "span",
        mergeAttributes(HTMLAttributes, { [attr]: String(node.attrs.id), class: cls }),
        text(node.attrs),
      ];
    },
    renderText: ({ node }) => {
      const id = String(node.attrs.id);
      if (isLink) return threadLink(id);
      return id.startsWith("label:") ? groupMention(id.slice("label:".length)) : mention(id);
    },
    addProseMirrorPlugins() {
      return [caretMenu(this.editor, isLink ? "thread" : "mention", char, announce, name)];
    },
  });
}

export const caretExtensions = (announce: Announce) => [
  chipNode("#", announce),
  chipNode("@", announce),
  Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      return [caretMenu(this.editor, "command", "/", announce)];
    },
  }),
];
