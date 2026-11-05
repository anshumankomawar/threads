import { createSignal, onSettled, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";

// Naming the organization: the first time anyone opens a workspace, when it can't be skipped, or renaming it later.
export function OrganizationPrompt(props: {
  current: string;
  onSave: (name: string) => void;
  onClose: () => void;
}): JSX.Element {
  let input!: HTMLInputElement;
  const [name, setName] = createSignal(untrack(() => props.current));
  const renaming = (): boolean => props.current !== "";
  const trimmed = (): string => name().trim();

  onSettled(() => input.select());

  const save = (): void => {
    if (trimmed() !== "") props.onSave(trimmed());
  };

  return (
    <div
      class={sx(palette.overlay)}
      onMouseDown={() => {
        if (renaming()) props.onClose();
      }}
    >
      <div
        class={sx(palette.panel)}
        role="dialog"
        aria-label={renaming() ? "Rename the organization" : "Name your organization"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class={sx(palette.inputRow)}>
          <input
            ref={input}
            class={sx(palette.input)}
            placeholder="Your organization's name"
            spellcheck={false}
            maxlength={100}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              } else if (event.key === "Escape" && renaming()) {
                event.preventDefault();
                props.onClose();
              }
            }}
          />
        </div>
        <div class={sx(palette.results)}>
          <div class={sx(palette.section)}>
            <div class={sx(palette.sectionLabel)}>
              {renaming() ? "Rename the organization" : "Welcome. What's your organization called?"}
            </div>
            <div
              class={sx(
                palette.row,
                trimmed() !== "" && palette.rowSelected,
                trimmed() === "" && palette.rowDisabled,
              )}
              role="option"
              aria-selected={trimmed() !== "" ? "true" : "false"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={save}
            >
              <span class={sx(palette.rowLabel)}>
                {trimmed() === "" ? "Type a name to continue" : renaming() ? "Save" : "Get started"}
              </span>
              <span class={sx(palette.rowShortcut)}>↵</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
