import Mention from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { SuggestionProps } from "@tiptap/suggestion";
import { useRef, useState } from "react";
import { useGroups, useMe, usePeople } from "./data";
import { Identicon } from "./Identicon";

type Option = { id: string; label: string; hint?: string };

export function MessageBox(props: {
  placeholder: string;
  hint?: string;
  autoFocus?: boolean;
  content?: JSONContent;
  onSend: (body: string) => void;
  onChange?: (editor: Editor) => void;
}) {
  const me = useMe();
  const people = usePeople();
  const groups = useGroups();
  const options: Option[] = [
    ...people
      .filter((person) => person._id !== me?._id)
      .map((person) => ({ id: `person:${person._id}`, label: person.name })),
    ...groups.map((group) => ({
      id: `group:${group._id}`,
      label: group.name,
      hint: `${group.userIds.length} people`,
    })),
  ];
  const [menu, setMenu] = useState<SuggestionProps<Option> | null>(null);
  const [at, setAt] = useState(0);
  const live = useRef({ options, menu, at, props });
  live.current = { options, menu, at, props };
  const open = (next: SuggestionProps<Option>) => (setMenu(next), setAt(0));

  const editor = useEditor({
    autofocus: props.autoFocus ? "end" : false,
    content: props.content,
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: props.placeholder }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        renderText: ({ node }) => `[[${node.attrs.id}]]`,
        suggestion: {
          items: ({ query }) =>
            live.current.options
              .filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 8),
          render: () => ({
            onStart: open,
            onUpdate: open,
            onExit: () => setMenu(null),
            onKeyDown: ({ event }) => {
              const { menu, at } = live.current;
              const count = menu?.items.length ?? 0;
              if (!menu || count === 0) return false;
              if (event.key === "ArrowDown") setAt((at + 1) % count);
              else if (event.key === "ArrowUp") setAt((at - 1 + count) % count);
              else if (event.key === "Enter" || event.key === "Tab") menu.command(menu.items[at]);
              else return false;
              return true;
            },
          }),
        },
      }),
    ],
    editorProps: {
      attributes: { class: "editor" },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Enter" || !event.metaKey || !editor) return false;
        const body = editor.getText({ blockSeparator: "\n" }).trim();
        if (!body) return true;
        live.current.props.onSend(body);
        editor.commands.clearContent(true);
        return true;
      },
    },
    onUpdate: ({ editor }) => live.current.props.onChange?.(editor),
  });

  const rect = menu?.items.length ? menu.clientRect?.() : null;
  return (
    <div className="message-box" onClick={() => editor?.commands.focus()}>
      <EditorContent editor={editor} />
      {props.hint && <span className="hint">{props.hint}</span>}
      {menu && rect && (
        <div
          className="panel options mentions"
          role="listbox"
          style={{ left: rect.left, top: rect.bottom + 6 }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {menu.items.map((option, index) => (
            <button
              key={option.id}
              role="option"
              aria-selected={index === at}
              onMouseMove={() => setAt(index)}
              onClick={() => menu.command(option)}
            >
              <Identicon seed={option.id.split(":")[1]} size={18} />
              <span className="label">{option.label}</span>
              <span className="detail">{option.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
