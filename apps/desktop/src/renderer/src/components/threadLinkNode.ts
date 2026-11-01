import { InputRule, mergeAttributes, Node } from "@tiptap/react";
import { threadLink } from "model";

// Fired on the editor's DOM when `/thread` is typed: start a branch, then `insert` its link where `/thread` was,
// or `cancel` to put the text back.
export const THREAD_SLASH_EVENT = "thread-slash";

export type ThreadSlashDetail = {
  insert: (threadId: string, title: string) => void;
  cancel: () => void;
};

const SLASH = "/thread";

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

  // `/thread`, at the start or after a space, starts a branch in place.
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|\s)\/thread$/,
        handler: ({ range, match, chain }) => {
          // The match may start with the space before `/thread`; keep that.
          const from = range.from + (match[0].length - SLASH.length);
          chain().deleteRange({ from, to: range.to }).run();
          const detail: ThreadSlashDetail = {
            insert: (threadId, title) =>
              this.editor
                .chain()
                .focus()
                .insertContentAt(from, [
                  { type: this.name, attrs: { id: threadId, title } },
                  { type: "text", text: " " },
                ])
                .run(),
            cancel: () => this.editor.chain().focus().insertContentAt(from, SLASH).run(),
          };
          this.editor.view.dom.dispatchEvent(new CustomEvent(THREAD_SLASH_EVENT, { detail }));
        },
      }),
    ];
  },
});
