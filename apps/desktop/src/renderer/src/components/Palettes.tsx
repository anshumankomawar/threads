import { createEffect, createMemo, createSignal, For, Show, untrack, type Signal } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Label, Message, Subspace, SubspaceMember, Thread, User, View } from "models";
import type { Filter } from "sync";
import {
  byName,
  dialog,
  edit,
  myBuckets,
  me,
  memberIn,
  open,
  others,
  setDialog,
  store,
  summary,
  toggled,
  switchTo,
  type Dialog,
  workspace,
} from "../session";
import { paletteSectionMarker } from "../styles/markers.stylex";
import { base } from "../styles/base";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Compose } from "./Compose";
import { moved, OptionButton, type Option } from "./Menus";
import { Search } from "./Search";

// A modal palette: a click outside or Escape closes it.
export function Modal(props: { children: JSX.Element }): JSX.Element {
  return (
    <dialog
      ref={(el) => queueMicrotask(() => ((el.closedBy = "any"), el.showModal()))}
      onClose={() => setDialog(null)}
      class={sx(base.panel, palette.dialog, palette.open)}
    >
      {props.children}
    </dialog>
  );
}

type Row = Option;

// An input over rows that match it, in sections; arrows choose, Enter or a click runs the row.
function Picker(props: {
  placeholder: string;
  rows: (query: string, filter: number) => Row[];
  // Tabs under the input that narrow the rows (⌘1, ⌘2…); `rows` gets the chosen one's index.
  filters?: string[];
  // A form's steps share the one input, so the form holds what's typed.
  query?: Signal<string>;
  // Escape goes back a step instead of closing; Tab does whatever a step wants.
  onBack?: () => void;
  onTab?: () => void;
}): JSX.Element {
  const [query, setQuery] = untrack(() => props.query) ?? createSignal("");
  const [at, setAt] = createSignal(0);
  const [filter, setFilter] = createSignal(0);
  const rows = createMemo(() => props.rows(query().trim(), filter()));
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
    const next = moved(event.key, index(), rows().length);
    if (next !== undefined) setAt(next);
    else if (event.key === "Enter") rows()[index()]?.run();
    else if (event.key === "Escape" && props.onBack) props.onBack();
    else if (event.key === "Tab" && props.onTab) props.onTab();
    else if (event.metaKey && props.filters?.[Number(event.key) - 1])
      setFilter(Number(event.key) - 1);
    else return;
    event.preventDefault();
  };
  return (
    <Modal>
      <div class={sx(palette.inputRow)}>
        <input
          autofocus
          class={sx(base.bare, palette.input)}
          placeholder={props.placeholder}
          spellcheck={false}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <Show when={props.filters}>
        {(filters) => (
          <div class={sx(palette.filters)} role="tablist">
            <For each={filters()}>
              {(label, i) => (
                <button
                  class={sx(base.bare, palette.filter, filter() === i() && palette.filterChosen)}
                  role="tab"
                  aria-selected={filter() === i() ? "true" : "false"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setFilter(i())}
                >
                  {label}
                  <span class={sx(palette.filterKey)}>⌘ {i() + 1}</span>
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={rows().length > 0}>
        <div class={sx(palette.results)} role="listbox">
          <For each={sections()}>
            {(section) => (
              <div {...stylex.attrs(palette.section, palette.divided, paletteSectionMarker)}>
                <Show when={section.title}>
                  <div class={sx(base.ellipsis, palette.sectionLabel, palette.labelText)}>
                    {section.title}
                  </div>
                </Show>
                <For each={section.rows}>
                  {({ row, at }) => (
                    <OptionButton
                      option={row}
                      selected={at === index()}
                      onHover={() => setAt(at)}
                      inset
                    />
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
// Closes the palette, then runs.
const done =
  <A extends unknown[]>(run: (...args: A) => unknown) =>
  (...args: A): void => {
    setDialog(null);
    run(...args);
  };
// The one row a text step has: Enter takes what you typed.
const entry = (query: string, label: string, run: (text: string) => void): Row[] =>
  query === "" ? [] : [{ label: `${label} “${query}”`, hint: "↵", run: done(() => run(query)) }];
// A form's step: Enter takes what you typed on to the next one.
const next = (query: string, section: string, run: (text: string) => void): Row[] =>
  query === "" ? [] : [{ label: `Next “${query}”`, hint: "↵", section, run: () => run(query) }];
const people = (query: string, run: (user: User) => void, from = others()): Row[] =>
  from
    .filter((u) => matches(u.name, query))
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
    setNames((all) => toggled(all, name));
    setTyped("");
  };
  const steps: Record<Step, [string, (query: string) => Row[]]> = {
    write: [
      untrack(() => (props.to ? `What do you need from ${props.to.name}?` : "What do you need?")),
      (text) =>
        next(text, "Step 1 of 3", () => {
          setTitle(text);
          go("describe", description());
        }),
    ],
    describe: [
      "Add a description (optional)",
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
      "Assign to",
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
            .toSorted(
              (a, b) => Number(!!first && b.seed === first) - Number(!!first && a.seed === first),
            )
            .map((row) => ({ ...row, section })),
          {
            label: summary(names(), "No labels"),
            hint: "⇥",
            section: "Labels",
            run: () => go("labels"),
          },
        ];
      },
    ],
    labels: [
      "Find or make a label",
      (text) => {
        const all = byName(store.all(Label));
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
          edit(props.thread, { labelIds: [...props.thread.labelIds, label.id] });
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
    if (props.bucket) return edit(props.bucket, { name: name(), description });
    const mine = myBuckets();
    const position = Math.max(-1, ...mine.map((bucket) => bucket.position)) + 1;
    store.create(Bucket, { user: me(), name: name(), description, position });
  };
  return (
    <Picker
      placeholder={
        naming()
          ? "Name the bucket (Follow-ups)"
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
          ? next(text, `Step 1 of 2 · ${props.bucket ? "Rename" : "New bucket"}`, () => {
              setName(text.slice(0, 40));
              setNaming(false);
              setTyped(props.bucket?.description ?? "");
            })
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
      placeholder="View as"
      rows={(query) => people(query, (u) => switchTo({ viewer: u.id }))}
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
  return (
    <Picker
      placeholder={`Add to ${props.subspace.name}`}
      rows={(query) =>
        people(
          query,
          done((user) => store.create(SubspaceMember, { subspace: props.subspace, user })),
          store.all(User).filter((u) => !memberIn(props.subspace, u.id)),
        )
      }
    />
  );
}

const PALETTES = {
  search: Search,
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
