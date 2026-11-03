import { Extension } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { exitSuggestion, Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import { offerKey } from "./threadLinkNode";

// Typing `/` in a reply opens the command menu, announced on the editor's DOM like the `#` menu: COMMAND_MENU_EVENT
// carries the menu's state (or null when it closes). Keys go through the same channel as the `#` menu (`offerKey`).
export const COMMAND_MENU_EVENT = "command-menu";

export type CommandMenuState = {
  query: string;
  rect: DOMRect | null;
  // Removes `/query` from the reply; the caller then runs the command.
  take: () => void;
} | null;

// What `/` offers, in order.
export const COMMANDS = [
  { name: "blocked", label: "Blocked", hint: "Ask someone for what you need in a new thread" },
  { name: "task", label: "Task", hint: "Turn what you were asked into a task of your own" },
  { name: "close", label: "Close", hint: "Close this thread for everyone" },
] as const;

export type CommandName = (typeof COMMANDS)[number]["name"];

const commandKey = new PluginKey("commandMenu");

// Closes the menu, leaving `/query` as typed.
export function closeCommandMenu(view: EditorView): void {
  exitSuggestion(view, commandKey);
}

export const SlashCommands = Extension.create({
  name: "slashCommands",

  addProseMirrorPlugins() {
    const { editor } = this;
    const announce = (props: SuggestionProps<never> | null): void => {
      const state: CommandMenuState =
        props === null
          ? null
          : {
              query: props.query,
              rect: props.clientRect?.() ?? null,
              take: () => props.command(undefined as never),
            };
      editor.view.dom.dispatchEvent(new CustomEvent(COMMAND_MENU_EVENT, { detail: state }));
    };
    return [
      Suggestion<never>({
        editor,
        pluginKey: commandKey,
        char: "/",
        items: () => [],
        command: ({ editor: target, range }) => target.chain().focus().deleteRange(range).run(),
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
