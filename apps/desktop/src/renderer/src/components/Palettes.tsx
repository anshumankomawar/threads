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
import { icon } from "./Icon";
import { Identicon } from "./Identicon";
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

// ⌘N: a thread in one input, a field at a time: its title, details, who it's for, its labels. What's set sits above
// the input, a line each as it was filled in (a click goes back to one, ✕ takes it off). ⌘↵ moves on a field, and only the last makes it.
// Enter goes on from the title, is a new line in the details, and on a list toggles the highlighted choice (several
// people, a space, labels). Tab and ⇧Tab move between fields, ⌘S keeps it in Drafts, and Escape goes back a field (or
// closes). Started from a space, a label or someone (their page or list, or a view filtered to one), that's set
// already.
type Field = "title" | "description" | "assign" | "labels";
const FIELDS: Field[] = ["title", "description", "assign", "labels"];
const PLACEHOLDERS: Record<Field, string> = {
  title: "Thread title",
  description: "Add details",
  assign: "Assign to people or a space",
  labels: "Add labels",
};

const form = stylex.create({
  // What's set, in a line that wraps, over the input.
  // What's set, a line each, in the input's own type and on its edge: the form as it was filled in, above where it goes
  // on.
  filled: { display: "flex", flexDirection: "column", gap: 6, padding: "11px 14px 0" },
  line: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    minWidth: 0,
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    fontSize: fontSizes.input,
    lineHeight: "16px",
    cursor: "pointer",
  },
  titleLine: { color: colors.textPrimary, fontWeight: 500 },
  lineIcon: { display: "flex", flexShrink: 0, color: colors.iconTertiary },
  lineText: { flex: 1, minWidth: 0 },
  // ✕ at the end of a line under the pointer, to take it off.
  remove: {
    display: "grid",
    flexShrink: 0,
    placeItems: "center",
    color: { default: colors.iconTertiary, ":hover": colors.textPrimary },
    cursor: "pointer",
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1 },
  },
  // The input's row: one line, growing to five as the details run on.
  inputRow: { display: "flex", flexShrink: 0, gap: 8, alignItems: "flex-start", padding: "0 14px" },
  // Its space above and below is outside it, so text scrolled out of it is cut off clear of the lines above it and the footer.
  input: {
    display: "block",
    marginBlock: 11,
    padding: 0,
    lineHeight: "16px",
    resize: "none",
    fieldSizing: "content",
    boxSizing: "border-box",
    // Five lines, then it scrolls.
    maxHeight: 16 * 5,
    overflowY: "auto",
  },
  // The details start two lines tall, so they read as room to write in.
  details: { minHeight: 16 * 2 },
  // What the keys do, quietly, along the bottom, with the two ways out on the right.
  footer: {
    display: "flex",
    flexShrink: 0,
    gap: 14,
    alignItems: "center",
    height: 30,
    padding: "0 14px",
    color: colors.textTertiary,
    fontSize: fontSizes.label,
  },
  end: { display: "flex", gap: 14, marginLeft: "auto" },
  key: { marginRight: 5, color: colors.textSecondary },
  primary: { color: { default: colors.textSecondary, ":hover": colors.textPrimary } },
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
  let input!: HTMLTextAreaElement;
  const space = (): Subspace | undefined => store.findById(Subspace, spaceId() ?? "");

  // What a text field holds: what's typed while you're on it, else what was kept when you left it.
  // A title is one line (Enter goes on from it), however it got its text.
  const titleNow = (): string =>
    (field() === "title" ? typed() : title()).replace(/\s*\n\s*/g, " ").trim();
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
  // Makes it as it stands; without a title it waits on the title.
  const create = (): void => {
    if (!titleNow()) return go("title");
    const fields = { title: titleNow(), description: descriptionNow() || undefined };
    let made!: Thread;
    undoable("New Thread", () => {
      setDialog(null);
      made = createThread({
        ...fields,
        assignees: assignees(),
        labelIds: labelIds(),
        subspaceIds: spaceId() ? [spaceId()!] : [],
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

  const toggleAssignee = (user: User): void => {
    setAssignees((all) => (all.includes(user) ? all.filter((u) => u !== user) : [...all, user]));
    setTyped("");
  };
  const toggleSpace = (id: string): void => {
    setSpaceId((now) => (now === id ? undefined : id));
    setTyped("");
  };
  const toggleLabel = (name: string): void => {
    setNames((all) => toggled(all, name));
    setTyped("");
  };
  const tick = (on: boolean): string | undefined => (on ? "✓" : undefined);
  // What the field you're on offers: people (you first) and spaces, or labels; Enter or a click toggles one.
  const options = createMemo((): Row[] => {
    const text = typed().trim();
    if (field() === "assign") {
      const first = props.to?.id;
      return (
        [
          {
            label: "Me",
            seed: me().id,
            hint: tick(assignees().includes(me())),
            run: () => toggleAssignee(me()),
          },
          ...people(text, toggleAssignee).map((row) => ({
            ...row,
            hint: tick(assignees().some((u) => u.id === row.seed)),
          })),
          ...store.all(Subspace).map((sub) => ({
            label: sub.name,
            hint: spaceId() === sub.id ? "✓" : "Space",
            icon: sub.visibility === "private" ? i.SquareLock02Icon : i.Layers01Icon,
            run: () => toggleSpace(sub.id),
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
            hint: tick(names().includes(l.name)),
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

  const text = (): boolean => field() === "title" || field() === "description";
  const last = (): boolean => field() === FIELDS.at(-1);
  // On to the next field (not past an empty title), and from the last, made.
  const next = (): void => {
    if (last()) create();
    else if (field() !== "title" || titleNow()) step(1);
  };
  // ⌘↵ goes on to the next field, and from the last makes it. Enter goes on from the title, is a new line in the
  // details (which grow to five lines), and toggles the highlighted choice in a list.
  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key;
    const moveTo = text() ? undefined : moved(key, index(), options().length);
    if (event.metaKey && key === "Enter") next();
    else if (event.metaKey && key.toLowerCase() === "s") saveDraft();
    else if (moveTo !== undefined && options().length > 0) setAt(moveTo);
    else if (key === "Enter" && field() === "title" && !event.isComposing) next();
    else if (key === "Enter" && !text() && !event.isComposing) options()[index()]?.run();
    else if (key === "Tab") step(event.shiftKey ? -1 : 1);
    else if (key === "Escape") {
      if (field() === "title") dialogBack();
      else step(-1);
    } else return;
    event.preventDefault();
  };

  // A line for what's set: a click goes back to its field, ✕ (if it has one) takes it off.
  const Line = (line: {
    field: Field;
    children: JSX.Element;
    icon?: JSX.Element;
    title?: boolean;
    remove?: () => void;
  }): JSX.Element => (
    <div
      class={sx(form.line, line.title && form.titleLine, stylex.defaultMarker())}
      onMouseDown={(event) => (event.preventDefault(), go(line.field))}
    >
      <Show when={line.icon}>
        <span class={sx(form.lineIcon)}>{line.icon}</span>
      </Show>
      <span class={sx(base.ellipsis, form.lineText)}>{line.children}</span>
      <Show when={line.remove}>
        {(remove) => (
          <span
            class={sx(form.remove)}
            role="button"
            aria-label="Remove"
            onMouseDown={(event) => (event.preventDefault(), event.stopPropagation(), remove()())}
          >
            {icon(i.Cancel01Icon, 11)}
          </span>
        )}
      </Show>
    </div>
  );
  const anySet = (): boolean =>
    (field() !== "title" && !!title()) ||
    (field() !== "description" && !!description()) ||
    assignees().length > 0 ||
    !!space() ||
    names().length > 0;

  return (
    <>
      <Show when={anySet()}>
        <div class={sx(form.filled)}>
          <Show when={field() !== "title" && title()}>
            <Line field="title" title>
              {title()}
            </Line>
          </Show>
          <Show when={field() !== "description" && description()}>
            <Line field="description" icon={icon(i.TextAlignLeftIcon, 13)}>
              {description().replace(/\s*\n\s*/g, " ")}
            </Line>
          </Show>
          <Show when={assignees().length > 0}>
            <Line
              field="assign"
              icon={<Identicon seed={assignees()[0].id} size={13} />}
              remove={() => setAssignees([])}
            >
              {assignees()
                .map((u) => u.name)
                .join(", ")}
            </Line>
          </Show>
          <Show when={space()}>
            {(sub) => (
              <Line
                field="assign"
                icon={icon(
                  sub().visibility === "private" ? i.SquareLock02Icon : i.Layers01Icon,
                  13,
                )}
                remove={() => setSpaceId(undefined)}
              >
                {sub().name}
              </Line>
            )}
          </Show>
          <Show when={names().length > 0}>
            <Line field="labels" icon={icon(i.Tag01Icon, 13)} remove={() => setNames([])}>
              {names().join(", ")}
            </Line>
          </Show>
        </div>
      </Show>
      <div class={sx(form.inputRow)}>
        <textarea
          ref={(el) => ((input = el), focusOnShow(el))}
          rows={1}
          class={sx(
            base.bare,
            palette.input,
            form.input,
            field() === "description" && form.details,
          )}
          placeholder={
            field() === "title" && props.to
              ? `Thread title for ${props.to.name}`
              : PLACEHOLDERS[field()]
          }
          spellcheck={field() === "title" || field() === "description"}
          value={typed()}
          onInput={(event) => {
            // A title is one line: a pasted line break is a space.
            const value = event.currentTarget.value;
            setTyped(field() === "title" ? value.replace(/\n/g, " ") : value);
            setAt(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <Show when={options().length > 0}>
        <div class={sx(palette.results)} role="listbox">
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
      {/* Keeping it for later, and the one way on: Next, until the last field makes it. */}
      <div class={sx(form.footer)}>
        <span class={sx(form.end)}>
          <button
            class={sx(base.bare, form.hintButton)}
            onMouseDown={(event) => (event.preventDefault(), saveDraft())}
          >
            <span class={sx(form.key)}>⌘S</span>Save Draft
          </button>
          <button
            class={sx(base.bare, form.hintButton, form.primary)}
            onMouseDown={(event) => (event.preventDefault(), next())}
          >
            <span class={sx(form.key)}>⌘↵</span>
            {last() ? "Create" : "Next"}
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
