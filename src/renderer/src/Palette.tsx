import { useAuthActions } from "@convex-dev/auth/react";
import { useAsyncOptions } from "@ui-sdk/react/async-options";
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
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, useBuckets, useCopyInvite, useNames, useThreads, type Doc } from "./data";
import { Icon } from "./Icon";
import { MessageBox } from "./MessageBox";
import { addDraft, go, reset, setDialog, theme } from "./state";

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

type Item = { section: string; value: string; label: string; hint?: string; run: () => unknown };

export function Search({ threadsOnly }: { threadsOnly?: boolean }) {
  const [text, setText] = useState("");
  const rows = useThreads();
  const buckets = useBuckets();
  const names = useNames();
  const { signOut } = useAuthActions();
  const copyInvite = useCopyInvite();
  const query = text.trim();
  const worded = useQuery(api.threads.search, query.length > 1 ? { text: query } : "skip") ?? [];
  const related = useAction(api.search.related);
  const near = useAsyncOptions<Doc<"messages">>(async (text) =>
    text.length > 1 ? related({ text }) : [],
  );
  const ask = useAction(api.search.ask);
  const [answer, setAnswer] = useState<{ answer: string; threadIds: string[] }>();
  const asked = useRef("");

  const consult = async () => {
    asked.current = query;
    setAnswer({ answer: "Asking Arc", threadIds: [] });
    const reply = await ask({ question: query }).catch(() => null);
    if (asked.current === query)
      setAnswer(reply ?? { answer: "Arc couldn't answer that.", threadIds: [] });
  };

  const command = (section: string, label: string, run: () => void, hint?: string): Item => ({
    section,
    value: label,
    label,
    hint,
    run,
  });
  const commands = [
    command("Quick actions", "New Message", () => setDialog("new"), "⌘N"),
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
    command("Account", "Copy Invite Link", copyInvite),
    command("Account", "Sign Out", () => void signOut().then(reset)),
  ];
  const threads = rows.map((row) => ({
    section: "Threads",
    value: row.threadId,
    label: row.title,
    hint: names.text(row.lastBody),
    run: () => go({ thread: row.threadId }),
  }));
  const hits = new Map([...worded, ...near.items].map((hit) => [hit._id, hit]));
  const messages = [...hits.values()].map((hit) => ({
    section: "Messages",
    value: hit._id,
    label: names.text(hit.body),
    hint: rows.find((row) => row.threadId === hit.threadId)?.title,
    run: () => go({ thread: hit.threadId }),
  }));
  const found = [...(threadsOnly ? [] : commands), ...threads]
    .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    .concat(messages);
  const items: Item[] = answer
    ? threads
        .filter((thread) => answer.threadIds.includes(thread.value))
        .map((thread) => ({ ...thread, section: "From these threads" }))
    : found.length > 0 || !query || near.status === "loading"
      ? found
      : [{ section: "No matches", value: "ask", label: "Ask Arc", hint: "↵", run: consult }];
  const groups = Map.groupBy(items, (item) => item.section);

  return (
    <Modal grow title="Search">
      <Command
        filter={false}
        onQueryChange={(next, details) => {
          if (details.reason === "escape-key") return setDialog(null);
          asked.current = "";
          setAnswer(undefined);
          setText(next);
          near.setQuery(next.trim());
        }}
        onAction={(value) => {
          if (value !== "ask") setDialog(null);
          void items.find((item) => item.value === value)?.run();
        }}
      >
        <label className="field">
          <Icon name="search" />
          <CommandInput aria-label="Search" placeholder="Search" />
          <kbd>{threadsOnly ? "⌘F" : "⌘K"}</kbd>
        </label>
        {answer && <p className="answer">{answer.answer}</p>}
        <CommandList className="options">
          {[...groups].map(([section, group]) => (
            <CommandGroup key={section}>
              <CommandGroupLabel>{section}</CommandGroupLabel>
              {group.map((item) => (
                <CommandItem key={item.value} value={item.value} label={item.label}>
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

export function NewMessage() {
  const start = useMutation(api.threads.start);
  const written = useRef("");

  const keep = () => {
    if (written.current.trim()) addDraft(written.current);
  };
  const send = async (body: string) => {
    setDialog(null);
    go({ thread: await start({ body }) });
  };

  return (
    <Modal title="New Message" onClose={keep}>
      <MessageBox
        label="New Message"
        placeholder="Write a message, @mention who it's for, ⌘↵ to send"
        onSend={(body) => void send(body)}
        onChange={(text) => (written.current = text)}
      />
    </Modal>
  );
}
