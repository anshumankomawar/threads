import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, useBuckets, useNames, useThreads } from "./data";
import { Icon } from "./Icon";
import { MessageBox } from "./MessageBox";
import { go, removeDraft, reset, saveDraft, setDialog, setTheme, type Draft } from "./state";

const GROW = { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };

function Modal(props: { grow?: boolean; onClose?: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const field = props.grow && document.querySelector("[data-search]")?.getBoundingClientRect();
    if (field) {
      dialog.style.left = `${field.left}px`;
      dialog.style.top = `${field.top}px`;
      dialog.style.width = `${field.width}px`;
    }
    dialog.setAttribute("closedby", "any");
    dialog.showModal();
    if (!field || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const below = dialog.getBoundingClientRect().height - field.height;
    dialog.animate({ clipPath: [`inset(0 0 ${below}px 0)`, "inset(0 0 0 0)"] }, GROW);
  }, [props.grow]);
  const close = () => {
    props.onClose?.();
    setDialog(null);
  };
  return (
    <dialog
      ref={ref}
      className={props.grow ? "panel palette grow" : "panel palette"}
      onClose={close}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.currentTarget.querySelector(".mentions"))
          event.currentTarget.close();
      }}
    >
      {props.children}
    </dialog>
  );
}

type Item = { section: string; label: string; hint?: string; run: () => void };

export function Search({ threadsOnly }: { threadsOnly?: boolean }) {
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  const rows = useThreads();
  const buckets = useBuckets();
  const names = useNames();
  const { signOut } = useAuthActions();
  const query = text.trim().toLowerCase();
  const hits = useQuery(api.threads.search, query.length > 1 ? { text: query } : "skip") ?? [];

  const commands: Item[] = [
    {
      section: "Quick actions",
      label: "New Message",
      hint: "⌘N",
      run: () => setDialog({ kind: "new" }),
    },
    { section: "Views", label: "Buckets", run: () => go({ box: "inbox", thread: undefined }) },
    ...buckets.map((bucket, index) => ({
      section: "Views",
      label: bucket.name,
      hint: index < 9 ? `⌘${index + 1}` : undefined,
      run: () => go({ box: bucket._id, thread: undefined }),
    })),
    { section: "Views", label: "All Threads", run: () => go({ box: "all", thread: undefined }) },
    { section: "Views", label: "Drafts", run: () => go({ box: "drafts", thread: undefined }) },
    { section: "Views", label: "Settings", hint: "⌘,", run: () => go({ settings: true }) },
    { section: "Theme", label: "Dark", run: () => setTheme("dark") },
    { section: "Theme", label: "Light", run: () => setTheme("light") },
    { section: "Account", label: "Sign Out", run: () => void signOut().then(reset) },
  ];
  const threads: Item[] = rows.map((row) => ({
    section: "Threads",
    label: row.title,
    hint: names.text(row.lastBody),
    run: () => go({ thread: row.threadId }),
  }));
  const messages: Item[] = hits.map((hit) => ({
    section: "Messages",
    label: names.text(hit.body),
    hint: rows.find((row) => row.threadId === hit.threadId)?.title,
    run: () => go({ thread: hit.threadId }),
  }));
  const items = [
    ...[...(threadsOnly ? [] : commands), ...threads].filter((item) =>
      item.label.toLowerCase().includes(query),
    ),
    ...messages,
  ];
  const run = (item?: Item) => {
    if (!item) return;
    setDialog(null);
    item.run();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") setAt((at + 1) % items.length);
    else if (event.key === "ArrowUp") setAt((at - 1 + items.length) % items.length);
    else if (event.key === "Enter") run(items[at]);
    else return;
    event.preventDefault();
  };

  return (
    <Modal grow>
      <label className="field">
        <Icon name="search" />
        <input
          autoFocus
          placeholder="Search"
          value={text}
          onChange={(event) => (setText(event.target.value), setAt(0))}
          onKeyDown={onKeyDown}
        />
        <kbd>{threadsOnly ? "⌘F" : "⌘K"}</kbd>
      </label>
      <div className="options" role="listbox">
        {items.map((item, index) => (
          <Fragment key={index}>
            {item.section !== items[index - 1]?.section && <h2>{item.section}</h2>}
            <button
              role="option"
              aria-selected={index === at}
              ref={(button) => {
                if (index === at) void button?.scrollIntoView({ block: "nearest" });
              }}
              onMouseMove={() => setAt(index)}
              onClick={() => run(item)}
            >
              <span className="label clip">{item.label}</span>
              <span className="detail clip">{item.hint}</span>
            </button>
          </Fragment>
        ))}
      </div>
    </Modal>
  );
}

export function NewMessage({ draft }: { draft?: Draft }) {
  const start = useMutation(api.threads.start);
  const [id] = useState(() => draft?.id ?? crypto.randomUUID());
  const written = useRef(draft);

  const keep = () => {
    if (written.current?.text.trim()) saveDraft(written.current);
    else removeDraft(id);
  };
  const send = async (body: string) => {
    removeDraft(id);
    setDialog(null);
    go({ thread: await start({ body }) });
  };

  return (
    <Modal onClose={keep}>
      <div
        onKeyDown={(event) => {
          if (!event.metaKey || event.key !== "s") return;
          event.preventDefault();
          event.currentTarget.closest("dialog")!.close();
        }}
      >
        <MessageBox
          autoFocus
          content={draft?.content}
          placeholder="What do you need?"
          hint="@mention who it's for, ⌘↵ to send"
          onSend={(body) => void send(body)}
          onChange={(editor) =>
            (written.current = {
              id,
              content: editor.getJSON(),
              text: editor
                .getText({ blockSeparator: "\n" })
                .replace(/\[\[\w+:\w+\]\]/g, "")
                .trim(),
              at: Date.now(),
            })
          }
        />
      </div>
    </Modal>
  );
}
