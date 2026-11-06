import { createEffect, createMemo, createSignal, For, Show, untrack, type Signal } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Label, Message, Subspace, SubspaceMember, Thread, User, View } from "models";
import type { Filter } from "sync";
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
import { FIELDS } from "./Pages";
import { Identicon } from "./Identicon";

// A modal palette: a click outside or Escape closes it.
export function Modal(props: { children: JSX.Element }): JSX.Element {
  return (
    <dialog
      ref={(el) => queueMicrotask(() => ((el.closedBy = "any"), el.showModal()))}
      onClose={() => setDialog(null)}
      class={sx(palette.dialog, palette.open)}
    >
      {props.children}
    </dialog>
  );
}

// `section` heads a run of rows; `hint` sits on the right, like a shortcut.
type Row = { label: string; hint?: string; seed?: string; section?: string; run: () => void };

// An input over rows that match it, in sections; arrows choose, Enter or a click runs the row.
function Picker(props: {
  placeholder: string;
  rows: (query: string) => Row[];
  // A form's steps share the one input, so the form holds what's typed.
  query?: Signal<string>;
  // Escape goes back a step instead of closing; Tab does whatever a step wants.
  onBack?: () => void;
  onTab?: () => void;
}): JSX.Element {
  const [query, setQuery] = untrack(() => props.query) ?? createSignal("");
  const [at, setAt] = createSignal(0);
  const rows = createMemo(() => props.rows(query().trim()));
  createEffect(rows, () => {
    setAt(0);
  });
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
    else if (event.key === "Escape" && props.onBack) props.onBack();
    else if (event.key === "Tab" && props.onTab) props.onTab();
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
          onInput={(event) => setQuery(event.currentTarget.value)}
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

// The one way a thread is made: ⌘N, ⌘⇧N, /blocked and a # branch all come here. Anyone in `assignees` gets it in
// their inbox (rules.ts); with nobody else, it's in yours.
export function createThread(fields: {
  title: string;
  description?: string;
  assignees?: User[];
  labelIds?: string[];
  subspaceIds?: string[];
  blocks?: Thread;
  branchedFrom?: Thread;
}): Thread {
  const { assignees = [], labelIds = [], subspaceIds = [], ...rest } = fields;
  return store.create(Thread, {
    ...rest,
    state: "open",
    priority: "none",
    workspace: workspace(),
    owner: me(),
    labelIds,
    subspaceIds,
    assigneeIds: assignees.map((u) => u.id),
  });
}

export function send(thread: Thread, body: string): void {
  store.create(Message, {
    thread,
    author: me(),
    body,
    workspaceId: thread.workspaceId,
    subspaceIds: thread.subspaceIds,
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
      label: "New subspace",
      section: "Quick actions",
      run: () => setDialog({ kind: "newSubspace" }),
    },
    { label: "All threads", section: "Views", run: done(() => open({ view: null })) },
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
          ...store.all(Subspace).map((sub) => ({
            label: sub.name,
            section: "Subspaces",
            run: done(() => open({ subspace: sub.id })),
          })),
          ...store.all(View).map((v) => ({
            label: v.name,
            section: "Views",
            run: done(() => open({ view: v.id })),
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

type Step = "write" | "describe" | "pick" | "labels";

// Starting a thread: its title, an optional description, then who it's assigned to (a person, or everyone in a
// subspace, which it then goes in); there Tab picks labels. Started from a label's, a subspace's or a person's page, it's
// in that label or subspace, or that person is first in the list.
function NewThread(props: { labelId?: string; subspaceId?: string; to?: User }): JSX.Element {
  const [step, setStep] = createSignal<Step>("write");
  const query = createSignal("");
  const setTyped = query[1];
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  // Labels by name, since one you make here doesn't exist until the thread does.
  const [names, setNames] = createSignal<string[]>(
    untrack(() => {
      const label = store.findById(Label, props.labelId ?? "");
      return label ? [label.name] : [];
    }),
  );
  const go = (next: Step, text = ""): void => {
    setStep(next);
    setTyped(text);
  };
  const back = (): void => {
    if (step() === "describe") go("write", title());
    else if (step() === "pick") go("describe", description());
    else if (step() === "labels") go("pick");
    else setDialog(null);
  };
  const create = (assignees: User[], subspace?: Subspace): void => {
    const labels = store.all(Label);
    const labelIds = names().map(
      (name) =>
        (
          labels.find((l) => l.name === name) ??
          store.create(Label, { name, workspace: workspace() })
        ).id,
    );
    const subspaceIds = [
      ...new Set([
        ...(props.subspaceId ? [props.subspaceId] : []),
        ...(subspace ? [subspace.id] : []),
      ]),
    ];
    setDialog(null);
    const made = createThread({
      title: title(),
      description: description(),
      assignees,
      labelIds,
      subspaceIds,
    });
    open({ thread: made.id });
  };
  const toggle = (name: string): void => {
    setNames((all) => (all.includes(name) ? all.filter((n) => n !== name) : [...all, name]));
    setTyped("");
  };
  const labelsText = (): string => {
    const [first, ...rest] = names();
    if (!first) return "No labels";
    return rest.length ? `${first} +${rest.length}` : first;
  };
  const steps: Record<Step, [string, (query: string) => Row[]]> = {
    write: [
      untrack(() => (props.to ? `What do you need from ${props.to.name}?` : "What do you need?")),
      (text) =>
        text === ""
          ? []
          : [
              {
                label: `Next “${text}”`,
                hint: "↵",
                section: "Step 1 of 3",
                run: () => {
                  setTitle(text);
                  go("describe", description());
                },
              },
            ],
    ],
    describe: [
      "Add a description… (optional)",
      (text) => [
        {
          label: text === "" ? "Skip the description" : "Next",
          hint: "↵",
          section: `Step 2 of 3 · ${title()}`,
          run: () => {
            setDescription(text);
            go("pick");
          },
        },
      ],
    ],
    pick: [
      "Assign to…",
      (text) => {
        const section = `Step 3 of 3 · ${title()}`;
        const first = props.to?.id;
        return [
          ...(
            [
              { label: "Unassigned", run: () => create([]) },
              ...people(text, (u) => create([u])),
              { label: "Me", seed: me().id, run: () => create([me()]) },
              ...store
                .all(Subspace)
                .filter((sub) => sub.members.length > 0)
                .map((sub) => ({
                  label: sub.name,
                  hint: `Subspace · ${sub.members.length}`,
                  run: () =>
                    create(
                      sub.members.filter((m) => m.userId !== me().id).map((m) => m.user),
                      sub,
                    ),
                })),
            ] as Row[]
          )
            .filter((row) => matches(row.label, text))
            .toSorted((a, b) => Number(b.seed === first) - Number(a.seed === first))
            .map((row) => ({ ...row, section })),
          {
            label: labelsText(),
            hint: "⇥",
            section: "Labels",
            run: () => go("labels"),
          },
        ];
      },
    ],
    labels: [
      "Find or make a label…",
      (text) => {
        const all = store.all(Label).sort((a, b) => a.name.localeCompare(b.name));
        const exists = [...all.map((l) => l.name), ...names()].some(
          (name) => name.toLowerCase() === text.toLowerCase(),
        );
        return [
          ...all
            .filter((l) => matches(l.name, text))
            .map((l) => ({
              label: l.name,
              hint: names().includes(l.name) ? "✓" : undefined,
              run: () => toggle(l.name),
            })),
          ...names()
            .filter((name) => !all.some((l) => l.name === name) && matches(name, text))
            .map((name) => ({ label: name, hint: "✓", run: () => toggle(name) })),
          ...(text !== "" && !exists ? [{ label: `Make “${text}”`, run: () => toggle(text) }] : []),
          { label: "Done", hint: "esc", section: "Labels", run: () => go("pick") },
        ];
      },
    ],
  };
  return (
    <Picker
      placeholder={steps[step()][0]}
      rows={(text) => steps[step()][1](text)}
      query={query}
      onBack={back}
      onTab={() => step() === "pick" && go("labels")}
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
              createThread({
                title,
                assignees: [who],
                blocks: props.thread,
                branchedFrom: props.thread,
                labelIds: props.thread.labelIds,
              });
            })
          }
        />
      )}
    </Show>
  );
}

// Making or editing a bucket: its name, then in plain words what goes in it, which the model reads to sort threads.
function BucketEditor(props: { bucket?: Bucket }): JSX.Element {
  const [naming, setNaming] = createSignal(true);
  const query = createSignal(untrack(() => props.bucket?.name ?? ""));
  const [, setTyped] = query;
  const [name, setName] = createSignal(untrack(() => props.bucket?.name ?? ""));
  const save = (description: string): void => {
    setDialog(null);
    if (props.bucket) {
      props.bucket.name = name();
      props.bucket.description = description;
      props.bucket.save();
      return;
    }
    const mine = store.where(Bucket, "userId", me().id);
    const position = Math.max(-1, ...mine.map((bucket) => bucket.position)) + 1;
    store.create(Bucket, { user: me(), name: name(), description, position });
  };
  return (
    <Picker
      placeholder={
        naming()
          ? "Name the bucket… (Follow-ups)"
          : "What goes in it? (anything a customer asked for or reported)"
      }
      query={query}
      onBack={() => {
        if (!naming()) {
          setNaming(true);
          setTyped(name());
        } else setDialog(null);
      }}
      rows={(text) =>
        naming()
          ? text === ""
            ? []
            : [
                {
                  label: `Next “${text}”`,
                  hint: "↵",
                  section: `Step 1 of 2 · ${props.bucket ? "Rename" : "New bucket"}`,
                  run: () => {
                    setName(text.slice(0, 40));
                    setNaming(false);
                    setTyped(props.bucket?.description ?? "");
                  },
                },
              ]
          : [
              {
                label: props.bucket ? "Save bucket" : "Create bucket",
                hint: "↵",
                section: `Step 2 of 2 · Describe “${name()}” so threads are sorted into it`,
                run: () => save(text.slice(0, 500)),
              },
            ]
      }
    />
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
// A condition for a view's filter: a field, then one of its values.
function FilterPicker(props: { add: (condition: Filter) => void }): JSX.Element {
  const [field, setField] = createSignal<string | null>(null);
  const query = createSignal("");
  return (
    <Picker
      placeholder={field() ? `${FIELDS[field()!].label} is…` : "Filter by…"}
      query={query}
      onBack={() => (field() ? (setField(null), query[1]("")) : setDialog(null))}
      rows={(text) => {
        const chosen = field();
        if (!chosen)
          return Object.entries(FIELDS)
            .filter(([, f]) => matches(f.label, text))
            .map(([key, f]) => ({ label: f.label, run: () => (setField(key), query[1]("")) }));
        const { compare, values } = FIELDS[chosen];
        return values()
          .filter(([, name]) => matches(name, text))
          .map(([value, name]) => ({
            label: name,
            run: done(() => props.add({ [chosen]: { [compare]: value } })),
          }));
      }}
    />
  );
}

// Saving a filter as a view of your own.
function NewView(props: { filter: Filter }): JSX.Element {
  return (
    <Picker
      placeholder="Name the view"
      rows={(query) =>
        entry(query, "Save view", (name) => {
          const made = store.create(View, {
            name,
            filter: props.filter,
            shared: false,
            owner: me(),
            workspace: workspace(),
          });
          open({ view: made.id });
        })
      }
    />
  );
}

// A new subspace with you in it. It starts open; its page makes it private.
export function makeSubspace(name: string): Subspace {
  const made = store.create(Subspace, { name, visibility: "open", workspace: workspace() });
  store.create(SubspaceMember, { subspace: made, user: me() });
  return made;
}

function NewSubspace(): JSX.Element {
  return (
    <Picker
      placeholder="Name the subspace"
      rows={(query) =>
        entry(query, "Make subspace", (name) => open({ subspace: makeSubspace(name).id }))
      }
    />
  );
}

// Someone to add to a subspace.
function AddMember(props: { subspace: Subspace }): JSX.Element {
  const isIn = (user: User): boolean =>
    props.subspace.members.filter((m) => m.userId === user.id).length > 0;
  return (
    <Picker
      placeholder={`Add to ${props.subspace.name}…`}
      rows={(query) =>
        store
          .all(User)
          .filter((u) => !isIn(u) && matches(u.name, query))
          .map((u) => ({
            label: u.name,
            seed: u.id,
            run: done(() => store.create(SubspaceMember, { subspace: props.subspace, user: u })),
          }))
      }
    />
  );
}

const PALETTES = {
  search: Search,
  filter: FilterPicker,
  newView: NewView,
  newSubspace: NewSubspace,
  addMember: AddMember,
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
