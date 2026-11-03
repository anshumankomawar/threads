import { mergeAttributes, Node } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { exitSuggestion, Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import { mentionToken } from "model";
import { offerKey } from "./threadLinkNode";

// Typing `@` in a reply opens the people menu, announced on the editor's DOM like the `#` menu: MENTION_MENU_EVENT
// carries the menu's state (or null when it closes). Keys go through the same channel (`offerKey`).
export const MENTION_MENU_EVENT = "mention-menu";

export type MentionAttrs = { id: string; name: string };

export type MentionMenuState = {
  query: string;
  rect: DOMRect | null;
  // Replaces `@query` with a mention of the person.
  pick: (person: MentionAttrs) => void;
} | null;

const mentionKey = new PluginKey("mentionMenu");

// Closes the menu, leaving `@query` as typed.
export function closeMentionMenu(view: EditorView): void {
  exitSuggestion(view, mentionKey);
}

// A mention inside a message being written: a chip with the person's or group's name, sent as `[[person:<id>]]` or
// `[[group:<id>]]` (its id is `group:<id>`). It puts them, or the group's members, on the reply's To line.
export const MentionNode = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return { id: { default: null }, name: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-mention": String(node.attrs.id), class: "mention" }),
      `@${String(node.attrs.name) || "someone"}`,
    ];
  },

  renderText({ node }) {
    return mentionToken(String(node.attrs.id));
  },

  addProseMirrorPlugins() {
    const { editor, name } = this;
    const announce = (props: SuggestionProps<never, MentionAttrs> | null): void => {
      const state: MentionMenuState =
        props === null
          ? null
          : {
              query: props.query,
              rect: props.clientRect?.() ?? null,
              pick: (person) => props.command(person),
            };
      editor.view.dom.dispatchEvent(new CustomEvent(MENTION_MENU_EVENT, { detail: state }));
    };
    return [
      Suggestion<never, MentionAttrs>({
        editor,
        pluginKey: mentionKey,
        char: "@",
        items: () => [],
        command: ({ editor: target, range, props }) =>
          target
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: name, attrs: props },
              { type: "text", text: " " },
            ])
            .run(),
        render: () => ({
          onStart: announce,
          onUpdate: announce,
          onExit: () => announce(null),
          onKeyDown: ({ event }) => offerKey(editor.view.dom, event),
        }),
      }),
    ];
  },
});
