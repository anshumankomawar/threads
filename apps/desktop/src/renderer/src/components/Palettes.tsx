import { createMemo, createSignal, For, Show } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Label, Message, Thread, User } from "models";
import {
  account,
  applyTheme,
  dialog,
  me,
  open,
  setDialog,
  signOut,
  source,
  SOURCES,
  store,
  switchTo,
  theme,
  type Dialog,
  workspace,
  type Source,
} from "../session";
import { menu } from "../styles/controls";
import { paletteSectionMarker } from "../styles/markers.stylex";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Compose } from "./Compose";
import { Identicon } from "./Identicon";

// A modal palette: a click outside or Escape closes it.
export function Modal(props: { onClose?: () => void; children: JSX.Element }): JSX.Element {
  return (
    <dialog
      ref={(el) => queueMicrotask(() => ((el.closedBy = "any"), el.showModal()))}
      onClose={() => (props.onClose?.(), setDialog(null))}
      class={sx(palette.dialog, palette.open)}
    >
      {props.children}
    </dialog>
  );
}

// `section` heads a run of rows; `hint` sits on the right, like a shortcut.
type Row = { label: string; hint?: string; seed?: string; section?: string; run: () => void };

// An input over rows that match it, in sections; arrows choose, Enter or a click runs the row.
function Picker(props: { placeholder: string; rows: (query: string) => Row[] }): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [at, setAt] = createSignal(0);
  const rows = createMemo(() => props.rows(query().trim()));
  const index = (): number => Math.min(at(), rows().length - 1);
  const sections = createMemo(() =>
    rows().reduce<{ title?: string; rows: { row: Row; at: number }[] }[]>((out, row, at) => {
      if (out.length === 0 || out.at(-1)!.title !== row.section)
        out.push({ title: row.section, rows: [] });
      out.at(-1)!.rows.push({ row, at });
      return out;
    }, []),
  );
  const onKeyDown = (event: KeyboardEvent): void => {
    const by = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (by) setAt((index() + by + rows().length) % rows().length);
    else if (event.key === "Enter") rows()[index()]?.run();
    else return;
    event.preventDefault();
  };
  return (
    <Modal>
      <div class={sx(palette.inputRow)}>
        <input
          autofocus
          class={sx(palette.input)}
          placeholder={props.placeholder}
          spellcheck={false}
          value={query()}
          onInput={(event) => (setQuery(event.currentTarget.value), setAt(0))}
          onKeyDown={onKeyDown}
        />
      </div>
      <Show when={rows().length > 0}>
        <div class={sx(palette.results)} role="listbox">
          <For each={sections()}>
            {(section) => (
              <div {...stylex.attrs(palette.section, palette.divided, paletteSectionMarker)}>
                <Show when={section.title}>
                  <div class={sx(palette.sectionLabel, palette.labelText)}>{section.title}</div>
                </Show>
                <For each={section.rows}>
                  {({ row, at }) => (
                    <button
                      class={sx(menu.item, at === index() && menu.itemSelected)}
                      role="option"
                      aria-selected={at === index() ? "true" : "false"}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setAt(at)}
                      onClick={() => row.run()}
                    >
                      <Show when={row.seed}>{(seed) => <Identicon seed={seed()} size={16} />}</Show>
                      <span class={sx(palette.rowLabel)}>{row.label}</span>
                      <Show when={row.hint}>
                        <span class={sx(palette.shortcut)}>{row.hint}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Modal>
  );
}

const matches = (text: string, query: string): boolean =>
  text.toLowerCase().includes(query.toLowerCase());
const done = (run: () => void) => () => (setDialog(null), run());
// The one row a text step has: Enter takes what you typed.
const entry = (query: string, label: string, run: (text: string) => void): Row[] =>
  query === "" ? [] : [{ label: `${label} “${query}”`, hint: "↵", run: done(() => run(query)) }];
const people = (query: string, run: (user: User) => void): Row[] =>
  store
    .all(User)
    .filter((u) => u.id !== me().id && matches(u.name, query))
    .map((u) => ({ label: u.name, seed: u.id, run: () => run(u) }));

export function startThread(title: string, extra: Partial<Thread> = {}): Thread {
  const thread = store.create(Thread, {
    title,
    state: "open",
    priority: "none",
    workspace: workspace(),
    owner: me(),
    labelIds: [],
    ...extra,
  });
  open({ thread: thread.id });
  return thread;
}

export function send(thread: Thread, body: string, to: User[] = []): void {
  store.create(Message, {
    thread,
    author: me(),
    body,
    toIds: to.map((u) => u.id),
    workspaceId: thread.workspaceId,
  });
}

function Search(): JSX.Element {
  const commands = (): Row[] => [
    {
      label: "New thread",
      hint: "⌘ N",
      section: "Quick actions",
      run: () => setDialog({ kind: "newThread" }),
    },
    { label: "New label", section: "Quick actions", run: () => setDialog({ kind: "newLabel" }) },
    {
      label: theme() === "dark" ? "Switch to light mode" : "Switch to dark mode",
      section: "Views",
      run: done(() => applyTheme(theme() === "dark" ? "light" : "dark")),
    },
    // Signed in, you're who you signed in as; only Sample is viewed as anyone.
    ...(account
      ? [
          {
            label: `Sign out (${account.email})`,
            section: "Account",
            run: done(() => void signOut()),
          },
        ]
      : []),
    ...(account
      ? []
      : [
          {
            label: "View as…",
            hint: "⌘ U",
            section: "Data",
            run: () => setDialog({ kind: "viewAs" }),
          },
        ]),
    ...(Object.keys(SOURCES) as Source[])
      .filter((s) => s !== source)
      .map((s) => ({
        label: `Use ${SOURCES[s]} data`,
        section: "Data",
        run: () => switchTo({ source: s }),
      })),
  ];
  return (
    <Picker
      placeholder="Search…"
      rows={(query) =>
        [
          ...commands(),
          ...store.all(User).map((u) => ({
            label: u.name,
            section: "People",
            seed: u.id,
            run: done(() => open({ person: u.id })),
          })),
          ...store.all(Label).map((l) => ({
            label: l.name,
            section: "Labels",
            run: done(() => open({ label: l.id })),
          })),
          ...store.all(Thread).map((t) => ({
            label: t.title,
            section: "Threads",
            run: done(() => open({ thread: t.id })),
          })),
        ].filter((row) => matches(row.label, query))
      }
    />
  );
}

function NewThread(props: { labelId?: string; to?: User }): JSX.Element {
  const label = (): Label | undefined => store.findById(Label, props.labelId ?? "");
  return (
    <Picker
      placeholder={
        props.to
          ? `What do you need from ${props.to.name}?`
          : label()
            ? `New thread in ${label()!.name}`
            : "New thread"
      }
      rows={(query) =>
        entry(query, "Start", (title) => {
          const thread = startThread(title, label() ? { labelIds: [label()!.id] } : {});
          if (props.to) send(thread, title, [props.to]);
        })
      }
    />
  );
}

// From a thread's labels chip, the new label goes on that thread; otherwise its page opens.
function NewLabel(props: { thread?: Thread }): JSX.Element {
  return (
    <Picker
      placeholder="Name the label"
      rows={(query) =>
        entry(query, "Make label", (name) => {
          const label = store.create(Label, { name, workspace: workspace() });
          if (!props.thread) return open({ label: label.id });
          props.thread.labelIds = [...props.thread.labelIds, label.id];
          props.thread.save();
        })
      }
    />
  );
}

// `/blocked`: ask someone for what this needs, in a thread that keeps this one blocked until it's resolved.
function Blocked(props: { thread: Thread }): JSX.Element {
  const [person, setPerson] = createSignal<User | null>(null);
  return (
    <Show
      when={person()}
      keyed
      fallback={
        <Picker placeholder="Who are you waiting on?" rows={(query) => people(query, setPerson)} />
      }
    >
      {(who) => (
        <Picker
          placeholder={`What do you need from ${who.name}?`}
          rows={(query) =>
            entry(query, "Ask", (title) => {
              const asked = startThread(title, { blocks: props.thread });
              send(asked, title, [who]);
            })
          }
        />
      )}
    </Show>
  );
}

// A bucket's name, then what goes in it (which the model reads).
function BucketEditor(props: { bucket?: Bucket }): JSX.Element {
  const [name, setName] = createSignal<string | null>(null);
  return (
    <Show
      when={name()}
      keyed
      fallback={
        <Picker
          placeholder={props.bucket?.name ?? "Name the bucket"}
          rows={(query) => entry(query || (props.bucket?.name ?? ""), "Name it", setName)}
        />
      }
    >
      {(named) => (
        <Picker
          placeholder={props.bucket?.description ?? `What goes in ${named}?`}
          rows={(query) =>
            entry(query || (props.bucket?.description ?? ""), "Describe it as", (description) => {
              if (!props.bucket) {
                store.create(Bucket, {
                  user: me(),
                  name: named,
                  description,
                  position: store.all(Bucket).length,
                });
                return;
              }
              props.bucket.name = named;
              props.bucket.description = description;
              props.bucket.save();
            })
          }
        />
      )}
    </Show>
  );
}

function ViewAs(): JSX.Element {
  return (
    <Picker
      placeholder="View as…"
      rows={(query) => people(query, (u) => switchTo({ viewer: u.id }))}
    />
  );
}

// Signing in happens in the browser, which sends you back here on a `com.threads.arc://` link. When the link doesn't open the
// app, the sign-in page shows a code to paste here instead.
const PALETTES = {
  search: Search,
  newThread: NewThread,
  newLabel: NewLabel,
  blocked: Blocked,
  bucket: BucketEditor,
  viewAs: ViewAs,
  compose: Compose,
};

export function Palettes(): JSX.Element {
  return (
    <Show when={dialog()} keyed>
      {(shown: Dialog) => (
        <Dynamic component={PALETTES[shown.kind] as (props: Dialog) => JSX.Element} {...shown} />
      )}
    </Show>
  );
}
