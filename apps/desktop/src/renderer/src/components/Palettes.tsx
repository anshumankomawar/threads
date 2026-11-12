import { createEffect, createMemo, createSignal, For, Show, untrack, type Signal } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Label, Message, Subspace, SubspaceMember, Thread, User, View } from "models";
import type { Filter } from "sync";
import {
  account,
  applyTheme,
  byName,
  dialog,
  edit,
  myBuckets,
  me,
  membersHint,
  subspacesWithMembers,
  summary,
  memberIn,
  open,
  otherSources,
  others,
  chooseMailbox,
  mailboxTitle,
  sidebarMailboxes,
  bucketMailboxes,
  sameMailbox,
  setDialog,
  setSettingsStart,
  signOut,
  SOURCES,
  store,
  toggled,
  switchTo,
  theme,
  type Dialog,
  workspace,
} from "../session";
import { paletteSectionMarker } from "../styles/markers.stylex";
import { base } from "../styles/base";
import { palette } from "../styles/palette";
import { keysFor, type HotkeyId } from "../hotkeys";
import {
  ask,
  clearRecents,
  find,
  fuse,
  hasRecents,
  picked,
  related,
  warm,
  type Answered,
  type Found,
} from "../search";
import { sx } from "../styles/sx";
import { Compose } from "./Compose";
import { Icon } from "./Icon";
import { moved, OptionButton, type Option } from "./Menus";

// A modal palette: a click outside or Escape closes it.
// `grow`: ⌘K (and ⌘F) as the toolbar's search field ([data-search-anchor]) itself. It opens exactly over the field, the
// same place, width, corners and colours, its icon, text and keys on the field's own pixels; only its bottom edge moves,
// sliding down to its results. That's a clip on the compositor (Web Animations), so nothing is laid out again while it
// opens. Nothing dims behind it.
const GROW = { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };
export function Modal(props: { children: JSX.Element; grow?: boolean }): JSX.Element {
  const open = (el: HTMLDialogElement): void => {
    el.closedBy = "any";
    const field =
      props.grow && document.querySelector("[data-search-anchor]")?.getBoundingClientRect();
    if (!field) return el.showModal();
    Object.assign(el.style, {
      margin: "0",
      right: "auto",
      bottom: "auto",
      left: `${field.left}px`,
      top: `${field.top}px`,
      width: `${field.width}px`,
    });
    el.showModal();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const below = el.getBoundingClientRect().height - field.height;
    el.animate({ clipPath: [`inset(0px 0px ${below}px 0px)`, "inset(0px 0px 0px 0px)"] }, GROW);
  };
  return (
    <dialog
      ref={(el) => queueMicrotask(() => open(el))}
      onClose={() => setDialog(null)}
      class={sx(base.panel, palette.dialog, palette.open, props.grow && palette.grow)}
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
  // A Clear button on the right of one section's title.
  clear?: { section: string; run: () => void };
  // Text over the rows (⌘F's answer).
  note?: JSX.Element;
  // Grown out of the toolbar's search field (Modal's `grow`), its own field in the same place and shape, showing these
  // keys at its end as the field shows ⌘K.
  grow?: boolean;
  keys?: string;
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
    <Modal grow={props.grow}>
      <div class={sx(palette.inputRow, props.grow && palette.growInputRow)}>
        <Show when={props.grow}>
          <span class={sx(palette.growIcon)}>
            <Icon icon="search" aria-hidden="true" />
          </span>
        </Show>
        <input
          autofocus
          class={sx(base.bare, palette.input, props.grow && palette.growInput)}
          placeholder={props.placeholder}
          spellcheck={false}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <Show when={props.grow && props.keys}>
          <span class={sx(palette.growKeys)}>{props.keys}</span>
        </Show>
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
      <Show when={props.note}>
        <div class={sx(palette.note)}>{props.note}</div>
      </Show>
      <Show when={rows().length > 0}>
        <div class={sx(palette.results)} role="listbox">
          <For each={sections()}>
            {(section) => (
              <div {...stylex.attrs(palette.section, palette.divided, paletteSectionMarker)}>
                <Show when={section.title}>
                  <div class={sx(base.ellipsis, palette.sectionLabel, palette.labelText)}>
                    {section.title}
                    <Show when={props.clear?.section === section.title && props.clear}>
                      {(clear) => (
                        <button
                          class={sx(base.bare, palette.sectionAction)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => clear().run()}
                        >
                          Clear
                        </button>
                      )}
                    </Show>
                  </div>
                </Show>
                <For each={section.rows}>
                  {({ row, at }) => (
                    <OptionButton
                      option={row}
                      selected={at === index()}
                      onHover={() => setAt(at)}
                      selectedLook={props.grow && palette.growSelected}
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

function Search(): JSX.Element {
  const commands = (): Row[] => [
    {
      label: "New thread",
      hint: keysFor("newThread"),
      section: "Quick actions",
      run: () => setDialog({ kind: "newThread" }),
    },
    {
      label: "New Group",
      section: "Quick actions",
      run: () => setDialog({ kind: "newSubspace" }),
    },
    {
      label: "Groups",
      section: "Views",
      run: done(() => (setSettingsStart("Groups"), open({ settings: null }))),
    },
    // The sidebar's rows; each bucket with the ⌘1–⌘9 that chooses it.
    ...sidebarMailboxes().map((box) => ({
      label: mailboxTitle(box),
      hint: ((at) => (at >= 0 && at < 9 ? keysFor(`mailbox${at + 1}` as HotkeyId) : undefined))(
        bucketMailboxes().findIndex((b) => sameMailbox(b, box)),
      ),
      section: "Views",
      run: done(() => chooseMailbox(box)),
    })),
    {
      label: "Settings",
      hint: keysFor("settings"),
      section: "Views",
      run: done(() => open({ settings: null })),
    },
    ...(
      [
        ["dark", "Use Dark Theme"],
        ["light", "Use Light Theme"],
        ["slack", "Use Slack Theme"],
      ] as const
    )
      .filter(([name]) => name !== theme())
      .map(([name, label]) => ({
        label,
        section: "Views",
        run: done(() => applyTheme(name)),
      })),
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
            hint: keysFor("viewAs"),
            section: "Data",
            run: () => setDialog({ kind: "viewAs" }),
          },
        ]),
    ...otherSources.map((s) => ({
      label: `Use ${SOURCES[s]} data`,
      section: "Data",
      run: () => switchTo({ source: s }),
    })),
  ];
  return (
    <Picker
      grow
      keys={keysFor("search")}
      placeholder="Search…"
      filters={["All", "Threads", "People"]}
      rows={(query, filter) =>
        [
          ...(filter === 0 ? commands() : []),
          ...(filter === 0 || filter === 2 ? store.all(User) : []).map((u) => ({
            label: u.name,
            section: "People",
            seed: u.id,
            run: done(() => open({ person: u.id })),
          })),
          ...(filter === 0 || filter === 1 ? store.all(Thread) : []).map((t) => ({
            label: t.title,
            section: "Threads",
            run: done(() => open({ thread: t.id })),
          })),
        ].filter((row) => matches(row.label, query))
      }
    />
  );
}

// A question, as opposed to words to find (it starts like one, ends in "?", or is a sentence): Ask Arc comes first, and
// meaning outweighs words.
const QUESTION = /\?$|^(what|why|how|who|when|where|which|did|does|do|is|are|was|can|should)\b/i;
const isQuestion = (q: string): boolean => QUESTION.test(q) || q.split(/\s+/).length >= 6;
// How many threads show before "Show more".
const SHOWN = 8;

// ⌘F: threads by anything in them, each with where it matched (search.ts); before you type, the ones you've opened
// from here (which you can clear), else the latest. Once typing pauses, threads near it in meaning join them, the two
// rankings fused; and Ask Arc answers a question from the threads, listing the ones it used.
function Find(): JSX.Element {
  const typed = createSignal("");
  const query = createMemo(() => typed[0]().trim());
  const [near, setNear] = createSignal<{ query: string; found: Found[] }>({ query: "", found: [] });
  const [more, setMore] = createSignal(false);
  const [asked, setAsked] = createSignal<{
    question: string;
    answer?: Answered;
    failed?: boolean;
  }>();
  warm();
  createEffect(query, (q) => {
    if (asked() && asked()!.question !== q) setAsked(undefined);
    setMore(false);
    if (q.length < 3) return;
    const timer = setTimeout(
      () =>
        void related(q).then(
          (found) => setNear({ query: q, found }),
          () => {},
        ),
      250,
    );
    return () => clearTimeout(timer);
  });
  const askArc = (question: string): void => {
    setAsked({ question });
    ask(question).then(
      (answer) => asked()?.question === question && setAsked({ question, answer }),
      () => asked()?.question === question && setAsked({ question, failed: true }),
    );
  };
  const row = ({ thread, snippet, terms }: Found, q: string, section?: string): Row => ({
    label: thread.title,
    detail: snippet,
    marks: terms,
    section,
    run: done(() => {
      picked(q, thread);
      open({ thread: thread.id });
    }),
  });
  const rows = (q: string): Row[] => {
    const answered = asked();
    if (answered)
      return (answered.answer?.threads ?? []).map((f) =>
        row({ thread: f, terms: [] }, q, "Sources"),
      );
    const words = find(q);
    if (q === "") return words.map((f) => row(f, q, hasRecents() ? "Recent" : "Latest"));
    const question = isQuestion(q);
    const meant = near().query === q ? near().found : [];
    const ranked = fuse([
      [words, question ? 0.5 : 1],
      [meant, question ? 2 : 1],
    ]);
    const shown = more() ? ranked : ranked.slice(0, SHOWN);
    const rest: Row[] =
      ranked.length > shown.length
        ? [{ label: `Show ${ranked.length - shown.length} more`, run: () => setMore(true) }]
        : [];
    const askRow: Row[] =
      q.length < 3
        ? []
        : [
            {
              label: `Ask Arc “${q}”`,
              icon: "star",
              section: "Ask Arc",
              run: () => askArc(q),
            },
          ];
    return [
      ...(question ? askRow : []),
      ...shown.map((f) => row(f, q)),
      ...rest,
      ...(question ? [] : askRow),
    ];
  };
  return (
    <Picker
      grow
      keys={keysFor("find")}
      placeholder="Search threads, or ask a question…"
      query={typed}
      clear={{ section: "Recent", run: clearRecents }}
      onBack={asked() ? () => setAsked(undefined) : undefined}
      note={
        asked() &&
        (asked()!.answer?.answer ??
          (asked()!.failed ? "Arc couldn't answer that just now." : "Thinking…"))
      }
      rows={rows}
    />
  );
}

type Step = "write" | "describe" | "pick" | "labels";

// Starting a thread: its title, an optional description, then who it's for, who gets it in their inbox (you're its
// requester, so it's not in yours). Started from a label's, a subspace's or a person's page, it's in that label or
// subspace, or that person is first in the list.
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
  // Who it's for: people and groups, as `person:<id>` and `group:<id>`; a group brings in everyone in it.
  const [picked, setPicked] = createSignal<string[]>(
    untrack(() => (props.to ? [`person:${props.to.id}`] : [])),
  );
  const pickedNames = (): string[] =>
    picked().flatMap((key) => {
      const [kind, id] = key.split(":");
      const name =
        kind === "person"
          ? store.findById(User, id)?.name
          : `@${store.findById(Subspace, id)?.name ?? "group"}`;
      return name ? [name] : [];
    });
  const pickedUsers = (): User[] =>
    [
      ...new Set(
        picked().flatMap((key) => {
          const [kind, id] = key.split(":");
          if (kind === "person") return store.findById(User, id) ?? [];
          const group = store.findById(Subspace, id);
          return group ? [...group.members].flatMap((m) => m.user ?? []) : [];
        }),
      ),
    ].filter((u) => u.id !== me().id);
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
      "Who's it for?",
      (text) => {
        const section = `Step 3 of 3 · ${title()}`;
        const has = (key: string): boolean => picked().includes(key);
        const pick = (key: string): void => {
          setPicked((all) => toggled(all, key));
          setTyped("");
        };
        const choices: Row[] = [
          ...people(text, (u) => pick(`person:${u.id}`)).map((row) => ({
            ...row,
            hint: has(`person:${row.seed}`) ? "✓" : undefined,
          })),
          ...subspacesWithMembers()
            .filter((group) => matches(group.name, text))
            .map((group) => ({
              label: `@${group.name}`,
              icon: "user-list-alt" as const,
              hint: has(`group:${group.id}`) ? "✓" : membersHint(group),
              run: () => pick(`group:${group.id}`),
            })),
        ].map((row) => ({ ...row, section }));
        const start: Row =
          picked().length > 0
            ? {
                label: `Start it with ${summary(pickedNames(), "")}`,
                hint: "↵",
                accent: true,
                section,
                run: () => create(pickedUsers()),
              }
            : { label: "No one yet", hint: "@mention them later", section, run: () => create([]) };
        // Typing looks for someone; with nothing typed, Enter starts it with who's picked.
        return text === "" ? [start, ...choices] : [...choices, start];
      },
    ],
    labels: [
      "Find or make a label…",
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
      placeholder="View as…"
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

// A new group (a subspace, underneath) with you in it, open to the workspace.
export function makeSubspace(name: string): Subspace {
  const made = store.create(Subspace, { name, visibility: "open", workspace: workspace() });
  store.create(SubspaceMember, { subspace: made, user: me() });
  return made;
}

function NewSubspace(): JSX.Element {
  return (
    <Picker
      placeholder="Name the group, as you'll @mention it"
      rows={(query) =>
        entry(query, "Make group", (name) =>
          // Then straight on to who's in it.
          queueMicrotask(() => setDialog({ kind: "addMember", subspace: makeSubspace(name) })),
        )
      }
    />
  );
}

// Someone to add to a group. Each one picked stays in the list, so several go in at once; Escape is done.
function AddMember(props: { subspace: Subspace }): JSX.Element {
  return (
    <Picker
      placeholder={`Add people to @${props.subspace.name}`}
      rows={(query) =>
        people(
          query,
          (user) => void store.create(SubspaceMember, { subspace: props.subspace, user }),
          store.all(User).filter((u) => !memberIn(props.subspace, u.id)),
        )
      }
    />
  );
}

const PALETTES = {
  search: Search,
  find: Find,
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
