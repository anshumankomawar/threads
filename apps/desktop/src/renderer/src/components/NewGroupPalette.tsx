import { Tick02Icon } from "@hugeicons/core-free-icons";
import { labelSlug, type Person } from "model";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

// Making a group: name it, then pick anyone in the organization to include. You're in it either way, and more people
// can join later.
export function NewGroupPalette(props: {
  onCreate: (name: string, members: Person[]) => void;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  let input!: HTMLInputElement;
  const [step, setStep] = createSignal<"name" | "members">("name");
  const [name, setName] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [members, setMembers] = createSignal<Person[]>([]);

  onSettled(() => input.focus());

  const title = (): string => name().trim();
  const slug = (): string => labelSlug(title());
  const taken = createMemo(() =>
    app.data.labels().some((label) => label.id === slug() || labelSlug(label.name) === slug()),
  );
  const canContinue = (): boolean => slug() !== "" && !taken();
  const options = createMemo(() => {
    const query = filter().trim().toLowerCase();
    const me = app.me();
    return app.data
      .people()
      .filter((person) => person.id !== me.id && person.name.toLowerCase().includes(query));
  });
  const selectedIndex = (): number => Math.min(selected(), Math.max(0, options().length - 1));
  const isIn = (person: Person): boolean => members().some((member) => member.id === person.id);
  const toggle = (person: Person): void => {
    setMembers((current) =>
      current.some((member) => member.id === person.id)
        ? current.filter((member) => member.id !== person.id)
        : [...current, person],
    );
  };
  const toMembers = (): void => {
    if (!canContinue()) return;
    setStep("members");
    setFilter("");
    setSelected(0);
    input.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (step() === "name") props.onClose();
      else setStep("name");
      return;
    }
    if (step() === "name") {
      if (event.key === "Enter") {
        event.preventDefault();
        toMembers();
      }
      return;
    }
    const count = options().length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex() + delta + count) % count);
    } else if (event.key === " ") {
      event.preventDefault();
      const person = options()[selectedIndex()];
      if (person !== undefined) toggle(person);
    } else if (event.key === "Enter") {
      event.preventDefault();
      props.onCreate(title(), members());
    } else if (event.key === "Backspace" && filter() === "" && !event.repeat) {
      event.preventDefault();
      setStep("name");
    }
  };

  return (
    <div class={sx(palette.overlay)} onMouseDown={() => props.onClose()}>
      <div
        class={sx(palette.panel)}
        role="dialog"
        aria-label="New group"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class={sx(palette.inputRow)}>
          <input
            ref={input}
            class={sx(palette.input)}
            placeholder={
              step() === "name" ? "Name the group: a project, program or team" : "Add people…"
            }
            spellcheck="false"
            maxlength={80}
            value={step() === "name" ? name() : filter()}
            onInput={(event) => {
              if (step() === "name") setName(event.currentTarget.value);
              else {
                setFilter(event.currentTarget.value);
                setSelected(0);
              }
            }}
          />
          <span class={sx(palette.step)}>Step {step() === "name" ? 1 : 2} of 2</span>
        </div>
        <div class={sx(palette.results)}>
          {step() === "name" ? (
            <div class={sx(palette.section)}>
              <div class={sx(palette.sectionLabel)}>Next</div>
              <div
                class={sx(
                  palette.row,
                  canContinue() && palette.rowSelected,
                  !canContinue() && palette.rowDisabled,
                )}
                role="option"
                aria-selected={canContinue() ? "true" : "false"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={toMembers}
              >
                <span class={sx(palette.rowLabel)}>
                  {taken()
                    ? `“${title()}” is taken in your organization`
                    : slug() === ""
                      ? "Type a name to continue"
                      : "Continue to add people"}
                </span>
                <Show when={canContinue()}>
                  <span class={sx(palette.rowShortcut)}>↵</span>
                </Show>
              </div>
            </div>
          ) : (
            <div class={sx(palette.section)}>
              <div class={sx(palette.sectionLabel, palette.summary)}>
                Add people to <span class={sx(palette.summaryTitle)}>“{title()}”</span>
                <span class={sx(palette.summaryCount)}>
                  {members().length === 0 ? "Just you so far" : `You + ${members().length}`}
                </span>
              </div>
              <Show when={options().length === 0}>
                <div class={sx(palette.empty)}>No matches</div>
              </Show>
              <For each={options()}>
                {(person, index) => (
                  <div
                    class={sx(palette.row, index() === selectedIndex() && palette.rowSelected)}
                    role="option"
                    aria-selected={isIn(person) ? "true" : "false"}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setSelected(index())}
                    onClick={() => toggle(person)}
                  >
                    <Identicon seed={person.id} size={16} />
                    <span class={sx(palette.rowLabel)}>{person.name}</span>
                    <span
                      class={sx(palette.check, isIn(person) && palette.checkChecked)}
                      aria-hidden="true"
                    >
                      <Show when={isIn(person)}>
                        <Icon icon={Tick02Icon} size={12} />
                      </Show>
                    </span>
                  </div>
                )}
              </For>
              <div
                class={sx(palette.row, palette.continue)}
                role="option"
                aria-selected="false"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => props.onCreate(title(), members())}
              >
                <span class={sx(palette.rowLabel)}>Create the group</span>
                <span class={sx(palette.rowShortcut)}>↵</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
