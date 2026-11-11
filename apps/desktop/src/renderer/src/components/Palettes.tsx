import * as i from "@hugeicons/core-free-icons";
import { createEffect, createMemo, createSignal, For, Show, untrack, type Signal } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
  Bucket,
  Draft,
  Label,
  Message,
  Subspace,
  SubspaceMember,
  Thread,
  User,
  View,
} from "models";
import type { Filter } from "sync";
import {
  dialogBack,
  byName,
  dialog,
  me,
  memberIn,
  open,
  others,
  say,
  setDialog,
  store,
  toggled,
  switchTo,
  type Dialog,
  workspace,
  undoable,
} from "../session";
import { addresses, invite, invited, notAddresses, refreshInvites } from "../invites";
import { keepDisplay, saveBucket } from "../mail";
import { paletteSectionMarker } from "../styles/markers.stylex";
import { base } from "../styles/base";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { icon, type IconSvgElement } from "./Icon";
import { page } from "../styles/page";
import { Compose } from "./Compose";
import { moved, OptionButton, type Option } from "./Menus";
import { Search } from "./Search";

// A palette is its content: the window itself is Palettes' one <dialog>, kept open while one palette gives way to
// another (⌘K to New Bucket's form and back), so it reads as one continuous form rather than closing and opening again.

// A palette's field takes the focus as it appears, as `autofocus` only does when the window first opens.
export const focusOnShow = (el: HTMLElement): void => queueMicrotask(() => el.focus());

type Row = Option;

const styles = stylex.create({
  inputRow: { gap: 8 },
  // Back to the palette this one came from, before what's typed.
  backChip: {
    display: "flex",
    flexShrink: 0,
    gap: 3,
    alignItems: "center",
    height: 22,
    padding: "0 7px 0 5px",
    borderRadius: radii.control,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    backgroundColor: { default: colors.bgTertiary, ":hover": colors.bgQuaternary },
    cursor: "pointer",
  },
});

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
  // Back a step, or from the first, to the palette it came from (⌘K), else closed.
  const back = (): void => (props.onBack ?? dialogBack)();
  const onKeyDown = (event: KeyboardEvent): void => {
    const next = moved(event.key, index(), rows().length);
    const atStart =
      event.currentTarget instanceof HTMLInputElement && event.currentTarget.value === "";
    if (next !== undefined) setAt(next);
    else if (event.key === "Enter") rows()[index()]?.run();
    else if (event.key === "Escape" || (event.key === "Backspace" && atStart)) back();
    else if (event.key === "Tab" && props.onTab) props.onTab();
    else return;
    event.preventDefault();
  };
  return (
    <>
      <div class={sx(palette.inputRow, styles.inputRow)}>
        {/* Where Back goes once the steps run out: the palette this one was opened from. */}
        <Show when={dialog()?.back}>
          <button
            class={sx(base.bare, styles.backChip)}
            title="Back (Esc)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={dialogBack}
          >
            {icon(i.ArrowLeft01Icon, 11)}
            Search
          </button>
        </Show>
        <input
          ref={focusOnShow}
          autofocus
          class={sx(base.bare, palette.input)}
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
    </>
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
// their inbox (rules.ts), you only if you're one of them; otherwise it's in My Threads.
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
  // One undo step: a caller that does more with it (its first messages, new labels) wraps all of that in its own.
  let made!: Thread;
  undoable("New Thread", () => {
    made = store.create(Thread, {
      ...rest,
      state: "open",
      priority: "none",
      workspace: workspace(),
      owner: me(),
      labelIds,
      subspaceIds,
      assigneeIds: assignees.map((u) => u.id),
    });
  });
  return made;
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

// ⌘N: a thread as one short form. Each field is a row, the one you're on taking what you type and the rest showing
// what's set; Enter moves down a row (and on Assign To, picking someone makes it), Tab and ⇧Tab move between rows, a
// click goes back to one. ⌘↵ makes it as it stands from any row, ⌘S keeps it in Drafts, and Escape goes back a row (or
// closes). Started from a space, a label or someone (their page or list, or a view filtered to one), it's there already.
type Field = "title" | "description" | "assign" | "labels";
const FIELDS: Field[] = ["title", "description", "assign", "labels"];
const FIELD_NAMES: Record<Field, string> = {
  title: "Title",
  description: "Description",
  assign: "Assign To",
  labels: "Labels",
};
const FIELD_ICONS: Record<Field, IconSvgElement> = {
  title: i.TextFontIcon,
  description: i.TextAlignLeftIcon,
  assign: i.UserIcon,
  labels: i.Tag01Icon,
};
const PLACEHOLDERS: Record<Field, string> = {
  title: "What do you need?",
  description: "Add details (optional)",
  assign: "Find someone or a space",
  labels: "Find or make a label",
};

const form = stylex.create({
  fields: { display: "flex", flexDirection: "column", padding: "6px 0" },
  // A field: its name on the left (an icon and a word), what's set or being typed on the right.
  field: {
    display: "flex",
    flexShrink: 0,
    gap: 10,
    alignItems: "center",
    minHeight: 34,
    margin: "0 8px",
    padding: "0 6px",
    cursor: "default",
  },
  // No grounds, on the field you're on or under the pointer: the one you're on has its name brightened and the cursor.
  current: { cursor: "text" },
  currentName: { color: colors.textPrimary },
  name: {
    display: "flex",
    flexShrink: 0,
    gap: 6,
    alignItems: "center",
    width: 104,
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },
  value: { flex: 1, minWidth: 0, color: colors.textPrimary, fontSize: fontSizes.input },
  unset: { color: colors.textTertiary },
  // The title reads as the thread's: a little larger and heavier.
  titleValue: { fontWeight: 500 },
  input: {
    flex: 1,
    minWidth: 0,
    height: 34,
    color: { default: colors.textPrimary, "::placeholder": colors.textTertiary },
    fontSize: fontSizes.input,
    outline: "none",
  },
  clear: {
    display: "grid",
    flexShrink: 0,
    placeItems: "center",
    width: 20,
    height: 20,
    borderRadius: radii.control,
    color: colors.iconTertiary,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": colors.bgQuaternary },
  },
  options: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minHeight: 0,
    padding: "6px 0 8px",
    overflowY: "auto",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.panelBorder,
  },
  // What the keys do, quietly, along the bottom, with the two ways out on the right.
  footer: {
    display: "flex",
    flexShrink: 0,
    gap: 14,
    alignItems: "center",
    height: 32,
    padding: "0 14px",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.panelBorder,
    color: colors.textTertiary,
    fontSize: fontSizes.label,
  },
  end: { display: "flex", gap: 14, marginLeft: "auto" },
  key: { marginRight: 5, color: colors.textSecondary },
  hintButton: {
    cursor: "pointer",
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
  },
});

function NewThread(props: { labelId?: string; subspaceId?: string; to?: User }): JSX.Element {
  const [field, setField] = createSignal<Field>("title");
  const [typed, setTyped] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [assignees, setAssignees] = createSignal<User[]>(
    untrack(() => (props.to ? [props.to] : [])),
  );
  const [spaceId, setSpaceId] = createSignal<string | undefined>(untrack(() => props.subspaceId));
  // Labels by name, since one you make here doesn't exist until the thread does.
  const [names, setNames] = createSignal<string[]>(
    untrack(() => {
      const label = store.findById(Label, props.labelId ?? "");
      return label ? [label.name] : [];
    }),
  );
  const [at, setAt] = createSignal(0);
  let input!: HTMLInputElement;
  const space = (): Subspace | undefined => store.findById(Subspace, spaceId() ?? "");

  // What a text field holds: what's typed while you're on it, else what was kept when you left it.
  const titleNow = (): string => (field() === "title" ? typed() : title()).trim();
  const descriptionNow = (): string => (field() === "description" ? typed() : description()).trim();
  // Leaving a text field keeps what was typed in it; arriving at one puts its text back to edit.
  const go = (next: Field): void => {
    if (field() === "title") setTitle(typed());
    if (field() === "description") setDescription(typed());
    setField(next);
    setTyped(next === "title" ? title() : next === "description" ? description() : "");
    setAt(0);
    queueMicrotask(() => input?.focus());
  };
  const step = (by: number): void => {
    const next = FIELDS[FIELDS.indexOf(field()) + by];
    if (next) go(next);
  };

  // The thread's labels: the ones named that exist, the rest made with it.
  const labelIds = (): string[] => {
    const labels = store.all(Label);
    return names().map(
      (name) =>
        (
          labels.find((l) => l.name === name) ??
          store.create(Label, { name, workspace: workspace() })
        ).id,
    );
  };
  // Makes it as it stands (or with who was just picked); without a title it waits on the title.
  const create = (to = assignees(), inSpace = spaceId()): void => {
    if (!titleNow()) return go("title");
    const fields = { title: titleNow(), description: descriptionNow() || undefined };
    let made!: Thread;
    undoable("New Thread", () => {
      setDialog(null);
      made = createThread({
        ...fields,
        assignees: to,
        labelIds: labelIds(),
        subspaceIds: inSpace ? [inSpace] : [],
      });
    });
    open({ thread: made.id });
  };
  // Keeps it in Drafts, everything set so far with it, to finish and send later.
  const saveDraft = (): void => {
    const text = [titleNow(), descriptionNow()].filter(Boolean).join("\n\n");
    if (!text) return;
    undoable("Save Draft", () => {
      store.create(Draft, {
        user: me(),
        text,
        draft: {
          title: titleNow(),
          context: descriptionNow(),
          asks: [],
          assigneeIds: assignees().map((u) => u.id),
          subspaceIds: spaceId() ? [spaceId()!] : [],
          labelIds: labelIds(),
        },
      });
    });
    setDialog(null);
    say("Saved to Drafts");
  };

  const toggleLabel = (name: string): void => {
    setNames((all) => toggled(all, name));
    setTyped("");
  };
  // What the field you're on offers under the form: people and spaces to assign, or labels.
  const options = createMemo((): Row[] => {
    const text = typed().trim();
    if (field() === "assign") {
      const first = props.to?.id;
      return (
        [
          { label: "Unassigned", run: () => create([]) },
          ...people(text, (u) => create([u])),
          { label: "Me", seed: me().id, run: () => create([me()]) },
          ...store
            .all(Subspace)
            .filter((sub) => sub.members.length > 0)
            .map((sub) => ({
              label: sub.name,
              hint: `Space · ${sub.members.length}`,
              icon: sub.visibility === "private" ? i.SquareLock02Icon : i.Layers01Icon,
              run: () =>
                create(
                  sub.members.filter((m) => m.userId !== me().id).map((m) => m.user),
                  sub.id,
                ),
            })),
        ] as Row[]
      )
        .filter((row) => matches(row.label, text))
        .toSorted(
          (a, b) => Number(!!first && b.seed === first) - Number(!!first && a.seed === first),
        );
    }
    if (field() === "labels") {
      const all = byName(store.all(Label));
      const exists = [...all.map((l) => l.name), ...names()].some(
        (name) => name.toLowerCase() === text.toLowerCase(),
      );
      return [
        ...all
          .filter((l) => matches(l.name, text))
          .map((l) => ({
            label: l.name,
            icon: i.Tag01Icon,
            hint: names().includes(l.name) ? "✓" : undefined,
            run: () => toggleLabel(l.name),
          })),
        ...names()
          .filter((name) => !all.some((l) => l.name === name) && matches(name, text))
          .map((name) => ({
            label: name,
            icon: i.Tag01Icon,
            hint: "✓",
            run: () => toggleLabel(name),
          })),
        ...(text !== "" && !exists
          ? [{ label: `Make “${text}”`, icon: i.Add01Icon, run: () => toggleLabel(text) }]
          : []),
      ];
    }
    return [];
  });
  const index = (): number => Math.min(at(), options().length - 1);

  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key;
    const empty = input.value === "";
    const moveTo = moved(key, index(), options().length);
    if (event.metaKey && key === "Enter") create();
    else if (event.metaKey && key.toLowerCase() === "s") saveDraft();
    else if (moveTo !== undefined && options().length > 0) setAt(moveTo);
    else if (key === "Enter" && !event.isComposing) {
      if (field() === "title") {
        if (titleNow()) go("description");
      } else if (field() === "description") go("assign");
      else options()[index()]?.run();
    } else if (key === "Tab") step(event.shiftKey ? -1 : 1);
    else if (key === "Escape" || (key === "Backspace" && empty && field() !== "title")) {
      if (field() === "title") dialogBack();
      else step(-1);
    } else return;
    event.preventDefault();
  };

  // A field's row: its name, then the input while you're on it, else what's set (a click goes back to it).
  const value = (f: Field): JSX.Element => {
    if (f === "title") return title() || <span class={sx(form.unset)}>Untitled</span>;
    if (f === "description") return description() || <span class={sx(form.unset)}>None</span>;
    if (f === "assign")
      return (
        <span class={sx(page.inCell)}>
          <Show
            when={assignees().length > 0}
            fallback={<span class={sx(form.unset)}>Unassigned</span>}
          >
            {assignees()
              .map((u) => u.name)
              .join(", ")}
          </Show>
        </span>
      );
    return names().length > 0 ? names().join(", ") : <span class={sx(form.unset)}>None</span>;
  };
  const Row_ = (rowProps: { field: Field }): JSX.Element => {
    const f = rowProps.field;
    return (
      <div
        class={sx(form.field, field() === f && form.current)}
        onMouseDown={(event) => field() !== f && (event.preventDefault(), go(f))}
      >
        <span class={sx(form.name, field() === f && form.currentName)}>
          {icon(FIELD_ICONS[f], 13)}
          {FIELD_NAMES[f]}
        </span>
        <Show
          when={field() === f}
          fallback={
            <span class={sx(base.ellipsis, form.value, f === "title" && form.titleValue)}>
              {value(f)}
            </span>
          }
        >
          <input
            ref={(el) => ((input = el), focusOnShow(el))}
            class={sx(base.bare, form.input, f === "title" && form.titleValue)}
            placeholder={
              f === "title" && props.to
                ? `What do you need from ${props.to.name}?`
                : PLACEHOLDERS[f]
            }
            spellcheck={f !== "assign" && f !== "labels"}
            value={typed()}
            onInput={(event) => (setTyped(event.currentTarget.value), setAt(0))}
            onKeyDown={onKeyDown}
          />
        </Show>
        <Show when={f === "assign" && assignees().length > 0 && field() !== f}>
          <button
            class={sx(base.bare, form.clear)}
            aria-label="Unassign"
            onMouseDown={(event) => (
              event.preventDefault(),
              event.stopPropagation(),
              setAssignees([])
            )}
          >
            {icon(i.Cancel01Icon, 11)}
          </button>
        </Show>
      </div>
    );
  };

  return (
    <>
      <div class={sx(form.fields)}>
        <For each={FIELDS}>{(f) => <Row_ field={f} />}</For>
        {/* Where it goes: shown once it's in a space (started from one, or by assigning one). */}
        <Show when={space()}>
          {(sub) => (
            <div class={sx(form.field)}>
              <span class={sx(form.name)}>
                {icon(i.Layers01Icon, 13)}
                Space
              </span>
              <span class={sx(base.ellipsis, form.value)}>{sub().name}</span>
              <button
                class={sx(base.bare, form.clear)}
                aria-label="Take Out of Space"
                onMouseDown={(event) => (event.preventDefault(), setSpaceId(undefined))}
              >
                {icon(i.Cancel01Icon, 11)}
              </button>
            </div>
          )}
        </Show>
      </div>
      <Show when={options().length > 0}>
        <div class={sx(form.options)} role="listbox">
          <For each={options()}>
            {(row, n) => (
              <OptionButton
                option={row}
                selected={n() === index()}
                onHover={() => setAt(n())}
                inset
              />
            )}
          </For>
        </div>
      </Show>
      <div class={sx(form.footer)}>
        <span>
          <span class={sx(form.key)}>↵</span>
          {field() === "assign" ? "Assign and Create" : field() === "labels" ? "Add Label" : "Next"}
        </span>
        <span>
          <span class={sx(form.key)}>⇥</span>Next Field
        </span>
        <span class={sx(form.end)}>
          <button
            class={sx(base.bare, form.hintButton)}
            onMouseDown={(event) => (event.preventDefault(), saveDraft())}
          >
            <span class={sx(form.key)}>⌘S</span>Save Draft
          </button>
          <button
            class={sx(base.bare, form.hintButton)}
            onMouseDown={(event) => (event.preventDefault(), create())}
          >
            <span class={sx(form.key)}>⌘↵</span>Create
          </button>
        </span>
      </div>
    </>
  );
}

// From a thread's labels chip, the new label goes on that thread; otherwise its page opens.
function NewLabel(): JSX.Element {
  return (
    <Picker
      placeholder="Name the label"
      rows={(query) =>
        entry(query, "Create Label", (name) => {
          let id = "";
          undoable("New Label", () => {
            id = store.create(Label, { name, workspace: workspace() }).id;
          });
          open({ label: id });
        })
      }
    />
  );
}

// Inviting people to the workspace by email: one or several typed at once, and who's invited already.
function Invite(): JSX.Element {
  void refreshInvites();
  return (
    <Picker
      placeholder="Invite people by email"
      rows={(query) => {
        const emails = addresses(query);
        const wrong = notAddresses(query);
        return [
          // Typed, but not all of it addresses: say which, rather than invite the rest unmentioned.
          ...(wrong.length === 0
            ? []
            : [{ label: `“${wrong.join(", ")}” isn’t an email address`, run: () => {} }]),
          ...(emails.length === 0 || wrong.length > 0
            ? []
            : [
                {
                  label:
                    emails.length === 1 ? `Invite ${emails[0]}` : `Invite ${emails.length} People`,
                  hint: "↵",
                  run: done(() =>
                    invite(emails).then((ok) =>
                      say(
                        ok
                          ? `Invited. They'll see ${workspace().name} when they log in.`
                          : "Couldn't invite them",
                      ),
                    ),
                  ),
                },
              ]),
          ...invited()
            .filter((email) => matches(email, query))
            .map((email) => ({ label: email, hint: "Invited", section: "Invited", run: () => {} })),
        ];
      }}
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
    saveBucket(props.bucket, name(), description);
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
        } else dialogBack();
      }}
      rows={(text) =>
        naming()
          ? next(text, `Step 1 of 2 · ${props.bucket ? "Rename" : "New Bucket"}`, () => {
              setName(text);
              setNaming(false);
              setTyped(props.bucket?.description ?? "");
            })
          : [
              {
                label: props.bucket ? "Save Bucket" : "Create Bucket",
                hint: "↵",
                section: `Step 2 of 2 · Describe “${name()}” so threads are sorted into it`,
                run: () => save(text),
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
      rows={(query) => people(query, (u) => void switchTo({ viewer: u.id }))}
    />
  );
}

// Saving a list's filter as a view of your own, named (and pinned to the sidebar).
function NewView(props: { filter: Filter }): JSX.Element {
  return (
    <Picker
      placeholder="Name the view"
      rows={(query) =>
        entry(query, "Save View", (name) => {
          let id = "";
          undoable("Save View", () => {
            id = store.create(View, {
              name,
              filter: props.filter,
              shared: false,
              owner: me(),
              workspace: workspace(),
            }).id;
          });
          // Shown as the list it was saved from is: a timeline stays one.
          keepDisplay({ kind: "view", id });
          open({ view: id });
        })
      }
    />
  );
}

// A new subspace with you in it. It starts open; its page makes it private.
export function makeSubspace(name: string): Subspace {
  let made!: Subspace;
  undoable("New Space", () => {
    made = store.create(Subspace, { name, visibility: "open", workspace: workspace() });
    store.create(SubspaceMember, { subspace: made, user: me() });
  });
  return made;
}

function NewSubspace(): JSX.Element {
  return (
    <Picker
      placeholder="Name the space"
      rows={(query) =>
        entry(query, "Create Space", (name) => open({ subspace: makeSubspace(name).id }))
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
          done((user) =>
            undoable(
              "Add Member",
              () => void store.create(SubspaceMember, { subspace: props.subspace, user }),
            ),
          ),
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
  invite: Invite,
  bucket: BucketEditor,
  viewAs: ViewAs,
  compose: Compose,
};

// The palettes' one window: open while any palette is, its content the palette shown. One palette giving way to
// another (⌘K's New Bucket, and Back to ⌘K) swaps what's in it without closing it. A click outside or an Escape no
// palette uses closes it.
export function Palettes(): JSX.Element {
  return (
    <Show when={dialog() !== null}>
      <dialog
        ref={(el) => queueMicrotask(() => ((el.closedBy = "any"), el.showModal()))}
        onClose={() => setDialog(null)}
        class={sx(base.panel, palette.dialog, palette.open)}
      >
        <Show when={dialog()} keyed>
          {(shown: Dialog) => (
            <Dynamic
              component={PALETTES[shown.kind] as (props: Dialog) => JSX.Element}
              {...shown}
            />
          )}
        </Show>
      </dialog>
    </Show>
  );
}
