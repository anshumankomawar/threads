import { mergeAttributes, Node } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { exitSuggestion, Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import { threadLink } from "model";

// Typing `#` in a reply opens the thread menu. The node announces the menu on the editor's DOM, so the reply
// component can render it: THREAD_MENU_EVENT carries the menu's state (or null when it closes), and THREAD_MENU_KEY
// offers each key press to the menu first, which calls preventDefault on keys it handles.
export const THREAD_MENU_EVENT = "thread-menu";
export const THREAD_MENU_KEY = "thread-menu-key";

export type ThreadLinkAttrs = { id: string; title: string };

export type ThreadMenuState = {
  query: string;
  rect: DOMRect | null;
  // Replaces `#query` with a link to the thread.
  pick: (link: ThreadLinkAttrs) => void;
} | null;

const menuKey = new PluginKey("threadMenu");

// Closes the menu, leaving `#query` as typed.
export function closeThreadMenu(view: EditorView): void {
  exitSuggestion(view, menuKey);
}

// A link to another thread inside a message being written: a chip with the thread's title, sent as
// `[[thread:<id>]]`. The title is only for the chip; sent messages resolve titles when they render.
export const ThreadLinkNode = Node.create({
  name: "threadLink",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return { id: { default: null }, title: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "span[data-thread-link]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-thread-link": String(node.attrs.id),
        class: "thread-link",
      }),
      `# ${String(node.attrs.title) || "thread"}`,
    ];
  },

  renderText({ node }) {
    return threadLink(String(node.attrs.id));
  },

  // `#`, at the start or after a space, opens the thread menu; titles have spaces, so the query may too.
  addProseMirrorPlugins() {
    const { editor, name } = this;
    const announce = (props: SuggestionProps<never, ThreadLinkAttrs> | null): void => {
      const state: ThreadMenuState =
        props === null
          ? null
          : {
              query: props.query,
              rect: props.clientRect?.() ?? null,
              pick: (link) => props.command(link),
            };
      editor.view.dom.dispatchEvent(new CustomEvent(THREAD_MENU_EVENT, { detail: state }));
    };
    return [
      Suggestion<never, ThreadLinkAttrs>({
        editor,
        pluginKey: menuKey,
        char: "#",
        allowSpaces: true,
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

// Gives the open menu a key press; true when it took it.
export function offerKey(dom: HTMLElement, event: KeyboardEvent): boolean {
  return !dom.dispatchEvent(new CustomEvent(THREAD_MENU_KEY, { cancelable: true, detail: event }));
}
