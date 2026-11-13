import { useAuthActions } from "@convex-dev/auth/react";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/react/command";
import { Dialog, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { useShortcut } from "@ui-sdk/react/shortcuts";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, useBuckets, useNames, useThreads } from "./data";
import { Icon } from "./Icon";
import { MessageBox } from "./MessageBox";
import { go, removeDraft, reset, saveDraft, setDialog, theme, type Draft } from "./state";

const GROW = { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };

function Modal(props: {
  title: string;
  grow?: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const close = () => {
    props.onClose?.();
    setDialog(null);
  };
  useShortcut(props.onClose ? "mod+s" : null, close, { layer: content, description: "Save draft" });
  useLayoutEffect(() => {
    const panel = content.current;
    const field = props.grow && document.querySelector("[data-search]")?.getBoundingClientRect();
    if (!panel || !field) return;
    panel.style.left = `${field.left}px`;
    panel.style.top = `${field.top}px`;
    panel.style.width = `${field.width}px`;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const below = panel.getBoundingClientRect().height - field.height;
    panel.animate({ clipPath: [`inset(0 0 ${below}px 0)`, "inset(0 0 0 0)"] }, GROW);
  }, [props.grow]);

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        ref={content}
        className={props.grow ? "panel palette grow" : "panel palette"}
        initialFocus="input, [contenteditable]"
      >
        <DialogTitle className="hidden">{props.title}</DialogTitle>
        {props.children}
      </DialogContent>
    </Dialog>
  );
}

type Item = { section: string; value: string; label: string; hint?: string; run: () => void };

export function Search({ threadsOnly }: { threadsOnly?: boolean }) {
  const [text, setText] = useState("");
  const rows = useThreads();
  const buckets = useBuckets();
  const names = useNames();
  const { signOut } = useAuthActions();
  const query = text.trim();
  const hits = useQuery(api.threads.search, query.length > 1 ? { text: query } : "skip") ?? [];

  const command = (section: string, label: string, run: () => void, hint?: string): Item => ({
    section,
    value: label,
    label,
    hint,
    run,
  });
  const commands = [
    command("Quick actions", "New Message", () => setDialog({ kind: "new" }), "⌘N"),
    command("Views", "Buckets", () => go({ box: "inbox", thread: undefined })),
    ...buckets.map((bucket, index) =>
      command(
        "Views",
        bucket.name,
        () => go({ box: bucket._id, thread: undefined }),
        index < 9 ? `⌘${index + 1}` : undefined,
      ),
    ),
    command("Views", "All Threads", () => go({ box: "all", thread: undefined })),
    command("Views", "Drafts", () => go({ box: "drafts", thread: undefined })),
    command("Views", "Settings", () => go({ settings: true }), "⌘,"),
    command("Theme", "Dark", () => theme.set("dark")),
    command("Theme", "Light", () => theme.set("light")),
    command("Account", "Sign Out", () => void signOut().then(reset)),
  ];
  const threads = rows.map((row) => ({
    section: "Threads",
    value: row.threadId,
    label: row.title,
    hint: names.text(row.lastBody),
    run: () => go({ thread: row.threadId }),
  }));
  const messages = hits.map((hit) => ({
    section: "Messages",
    value: hit._id,
    label: names.text(hit.body),
    hint: rows.find((row) => row.threadId === hit.threadId)?.title,
    run: () => go({ thread: hit.threadId }),
  }));
  const items: Item[] = [...(threadsOnly ? [] : commands), ...threads, ...messages];
  const groups = Map.groupBy(items, (item) => item.section);

  return (
    <Modal grow title="Search">
      <Command
        filter="contains"
        onQueryChange={(next, details) =>
          details.reason === "escape-key" ? setDialog(null) : setText(next)
        }
        onAction={(value) => {
          setDialog(null);
          items.find((item) => item.value === value)?.run();
        }}
      >
        <label className="field">
          <Icon name="search" />
          <CommandInput aria-label="Search" placeholder="Search" />
          <kbd>{threadsOnly ? "⌘F" : "⌘K"}</kbd>
        </label>
        <CommandList className="options">
          {[...groups].map(([section, group]) => (
            <CommandGroup key={section}>
              <CommandGroupLabel>{section}</CommandGroupLabel>
              {group.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.value}
                  label={item.label}
                  keywords={section === "Messages" ? [query] : undefined}
                >
                  <span className="label clip">{item.label}</span>
                  <span className="detail clip">{item.hint}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </Modal>
  );
}

export function NewMessage({ draft }: { draft?: Draft }) {
  const start = useMutation(api.threads.start);
  const [id] = useState(() => draft?.id ?? crypto.randomUUID());
  const written = useRef(draft?.text ?? "");

  const keep = () => {
    if (written.current.trim()) saveDraft({ id, text: written.current, at: Date.now() });
    else removeDraft(id);
  };
  const send = async (body: string) => {
    removeDraft(id);
    setDialog(null);
    go({ thread: await start({ body }) });
  };

  return (
    <Modal title="New Message" onClose={keep}>
      <MessageBox
        label="New Message"
        placeholder="What do you need? @mention who it's for, ⌘↵ to send"
        defaultText={draft?.text}
        onSend={(body) => void send(body)}
        onChange={(text) => (written.current = text)}
      />
    </Modal>
  );
}
