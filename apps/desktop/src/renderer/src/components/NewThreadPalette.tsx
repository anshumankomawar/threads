import { Tick02Icon } from "@hugeicons/core-free-icons";
import { labelSlug, type Label, type Person } from "model";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { selectableLabels } from "../groups";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { colors } from "../styles/tokens.stylex";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

export type NewThreadDraft = {
  title: string;
  // Empty for none.
  description: string;
  // Who it's assigned to: someone, or nobody (then it's your own to-do until you @mention someone).
  assignees: Person[];
  // Its labels by name; any that don't exist yet are made with it.
  labelNames: string[];
};

// `labels` is a detour from the last step, for filing it.
type Step = "write" | "describe" | "pick" | "labels";

// A title, then an optional description, then who it's for.
const STEPS: Step[] = ["write", "describe", "pick"];

type Option = { id: string; label: string; hint?: string; person?: Person; value: Person | null };

// Starting a thread step by step: write its title, describe it if you like, then choose who it's assigned to. On that
// step, Tab picks its labels. You own it; it lands in their inbox, sorted into one of their buckets.
export function NewThreadPalette(props: {
  // What it starts with, such as the group you're making it in.
  initialLabels: Label[];
  // Who it's for, first in the list, such as whoever's profile you're making it from.
  initialAssignee?: Person | null;
  onCreate: (draft: NewThreadDraft) => void;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  let input!: HTMLInputElement;
  const [step, setStep] = createSignal<Step>("write");
  const [text, setText] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [chosenLabels, setChosenLabels] = createSignal<{ id: string; name: string }[]>(
    untrack(() => props.initialLabels),
  );

  onSettled(() => input.focus());

  // The labels on offer: all but archived groups'.
  const labels = createMemo(() => selectableLabels(app.data.labels(), app.data.groups()));
  const query = (): string => filter().trim().toLowerCase();
  const matches = (label: string): boolean => label.toLowerCase().includes(query());
  const pickOptions = createMemo((): Option[] => {
    const me = app.me();
    const everyone: Option[] = app.data
      .people()
      .filter((person) => person.id !== me.id)
      .map((person) => ({ id: person.id, label: person.name, person, value: person }));
    const first = props.initialAssignee?.id;
    return [
      { id: "unassigned", label: "Unassigned", value: null },
      ...everyone,
      { id: me.id, label: "Me", person: me, value: me },
    ].toSorted((a, b) => Number(b.id === first) - Number(a.id === first));
  });
  const labelOptions = createMemo((): Option[] => {
    const newLabel = labelSlug(filter());
    return [
      ...labels()
        .filter((label) => matches(label.name))
        .map((label) => ({ id: label.id, label: label.name, value: null })),
      ...(newLabel !== "" &&
      !labels().some((label) => label.id === newLabel || labelSlug(label.name) === newLabel)
        ? [{ id: newLabel, label: `Make “${filter().trim()}”`, hint: filter().trim(), value: null }]
        : []),
    ];
  });
  const options = createMemo(() =>
    step() === "labels" ? labelOptions() : pickOptions().filter((option) => matches(option.label)),
  );
  const selectedIndex = (): number => Math.min(selected(), Math.max(0, options().length - 1));
  const title = (): string => text().trim();

  const focusInput = (): void => input.focus();

  const goTo = (next: Step): void => {
    setStep(next);
    setFilter("");
    setSelected(0);
    focusInput();
  };

  const forward = (): void => {
    if (title().length === 0) return focusInput();
    goTo(STEPS[STEPS.indexOf(step()) + 1] ?? step());
  };

  const back = (): void =>
    goTo(step() === "labels" ? "pick" : (STEPS[STEPS.indexOf(step()) - 1] ?? "write"));

  const hasLabel = (id: string): boolean => chosenLabels().some((label) => label.id === id);
  // Adds or removes a label, including one that doesn't exist yet, which is made along with the thread.
  const toggleLabel = (option: Option | undefined): void => {
    if (option === undefined) return;
    const name = option.hint ?? option.label;
    setChosenLabels((current) =>
      current.some((label) => label.id === option.id)
        ? current.filter((label) => label.id !== option.id)
        : [...current, { id: option.id, name }],
    );
    setFilter("");
    setSelected(0);
    focusInput();
  };

  const create = (option: Option | undefined): void => {
    if (option === undefined) return;
    props.onCreate({
      title: title(),
      description: description().trim(),
      assignees: option.value === null ? [] : [option.value],
      labelNames: chosenLabels().map((label) => label.name),
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const current = step();
    if (event.key === "Escape") {
      event.preventDefault();
      if (current === "write") props.onClose();
      else back();
      return;
    }
    if (current === "write" || current === "describe") {
      if (event.key === "Enter") {
        event.preventDefault();
        forward();
      } else if (
        current === "describe" &&
        event.key === "Backspace" &&
        description() === "" &&
        !event.repeat
      ) {
        event.preventDefault();
        back();
      }
      return;
    }
    const count = options().length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex() + delta + count) % count);
    } else if (event.key === "Backspace" && filter().length === 0) {
      // Holding Backspace clears the filter and stops there; a fresh press on the empty field steps back.
      event.preventDefault();
      if (!event.repeat) back();
    } else if (current === "labels") {
      if (event.key === "Enter") {
        event.preventDefault();
        toggleLabel(options()[selectedIndex()]);
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
      goTo("labels");
    } else if (event.key === "Enter") {
      event.preventDefault();
      create(options()[selectedIndex()]);
    }
  };

  const placeholder = (): string =>
    step() === "write"
      ? "What do you need?"
      : step() === "describe"
        ? "Add a description… (optional)"
        : step() === "labels"
          ? "Find or make a label…"
          : "Assign to…";
  const summary = (): string =>
    step() === "describe" ? "Describe" : step() === "labels" ? "Label" : "Assign";
  const nextLabel = (): string =>
    title().length === 0
      ? "Write what you need to continue"
      : step() === "write"
        ? "Continue to describe"
        : "Continue to assign";

  return (
    <div class={sx(palette.overlay)} onMouseDown={() => props.onClose()}>
      <div
        class={sx(palette.panel)}
        role="dialog"
        aria-label="New thread"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class={sx(palette.inputRow)}>
          <input
            ref={input}
            class={sx(palette.input)}
            placeholder={placeholder()}
            spellcheck="false"
            value={step() === "write" ? text() : step() === "describe" ? description() : filter()}
            onInput={(event) => {
              const value = event.currentTarget.value;
              if (step() === "write") setText(value);
              else if (step() === "describe") setDescription(value);
              else {
                setFilter(value);
                setSelected(0);
              }
            }}
          />
          <span class={sx(palette.step)}>
            Step {STEPS.indexOf(step() === "labels" ? "pick" : step()) + 1} of {STEPS.length}
          </span>
        </div>
        <div class={sx(palette.results)}>
          {step() === "write" || step() === "describe" ? (
            <div class={sx(palette.section)}>
              <div class={sx(palette.sectionLabel, palette.summary)}>
                {step() === "write" ? (
                  "Next"
                ) : (
                  <>
                    {summary()} <span class={sx(palette.summaryTitle)}>“{title()}”</span>
                  </>
                )}
              </div>
              <div
                class={sx(
                  palette.row,
                  title().length > 0 && palette.rowSelected,
                  title().length === 0 && palette.rowDisabled,
                )}
                role="option"
                aria-selected={title().length > 0 ? "true" : "false"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={forward}
              >
                <span class={sx(palette.rowLabel)}>{nextLabel()}</span>
                <span class={sx(palette.rowShortcut)}>↵</span>
              </div>
            </div>
          ) : (
            <div class={sx(palette.section)}>
              <div class={sx(palette.sectionLabel, palette.summary)}>
                {summary()} <span class={sx(palette.summaryTitle)}>“{title()}”</span>
                {step() === "pick" ? " to" : ""}
                <Show when={step() === "pick"}>
                  <button
                    type="button"
                    class={sx(styles.side)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => goTo("labels")}
                  >
                    {chosenLabels().length === 0
                      ? "No labels"
                      : chosenLabels().length === 1
                        ? chosenLabels()[0].name
                        : `${chosenLabels()[0].name} +${chosenLabels().length - 1}`}
                    <span class={sx(palette.rowShortcut)}>⇥</span>
                  </button>
                </Show>
              </div>
              <Show when={options().length === 0}>
                <div class={sx(palette.empty)}>No matches</div>
              </Show>
              <For each={options()}>
                {(option, index) => {
                  const checked = (): boolean => step() === "labels" && hasLabel(option.id);
                  return (
                    <div
                      class={sx(palette.row, index() === selectedIndex() && palette.rowSelected)}
                      role="option"
                      aria-selected={
                        (step() === "labels" ? checked() : index() === selectedIndex())
                          ? "true"
                          : "false"
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setSelected(index())}
                      onClick={() => (step() === "labels" ? toggleLabel(option) : create(option))}
                    >
                      <Show when={option.person}>
                        {(person) => <Identicon seed={person().id} size={16} />}
                      </Show>
                      <span class={sx(palette.rowLabel)}>{option.label}</span>
                      <Show when={step() === "labels"}>
                        <span
                          class={sx(palette.check, checked() && palette.checkChecked)}
                          aria-hidden="true"
                        >
                          <Show when={checked()}>
                            <Icon icon={Tick02Icon} size={12} />
                          </Show>
                        </span>
                      </Show>
                    </div>
                  );
                }}
              </For>
              <Show when={step() === "labels"}>
                <div
                  class={sx(palette.row, palette.continue)}
                  role="option"
                  aria-selected="false"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={back}
                >
                  <span class={sx(palette.rowLabel)}>Done</span>
                  <span class={sx(palette.rowShortcut)}>esc</span>
                </div>
              </Show>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = stylex.create({
  // .palette-side — the labels, beside the assign step's summary.
  side: {
    display: "inline-flex",
    flexShrink: 0,
    gap: "6px",
    alignItems: "center",
    marginLeft: "auto",
    padding: 0,
    borderStyle: "none",
    color: {
      default: colors.textSecondary,
      ":hover": colors.textPrimary,
    },
    font: "inherit",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
});
