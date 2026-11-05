import { createSignal, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";

// Naming the organization: the first time anyone opens a workspace, when it can't be skipped, or renaming it later.
export function OrganizationPrompt(props: {
  current: string;
  onSave: (name: string) => void;
  onClose: () => void;
}): JSX.Element {
  let input!: HTMLInputElement;
  const [name, setName] = createSignal(props.current);
  const renaming = (): boolean => props.current !== "";
  const trimmed = (): string => name().trim();

  onSettled(() => input.select());

  const save = (): void => {
    if (trimmed() !== "") props.onSave(trimmed());
  };

  return (
    <div
      class="palette-overlay"
      onMouseDown={() => {
        if (renaming()) props.onClose();
      }}
    >
      <div
        class="palette"
        role="dialog"
        aria-label={renaming() ? "Rename the organization" : "Name your organization"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class="palette-input-row">
          <input
            ref={input}
            class="palette-input"
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
        <div class="palette-results">
          <div class="palette-section">
            <div class="palette-section-label">
              {renaming() ? "Rename the organization" : "Welcome. What's your organization called?"}
            </div>
            <div
              class="palette-row"
              data-selected={String(trimmed() !== "")}
              data-disabled={String(trimmed() === "")}
              role="option"
              aria-selected={trimmed() !== "" ? "true" : "false"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={save}
            >
              <span class="palette-row-label">
                {trimmed() === "" ? "Type a name to continue" : renaming() ? "Save" : "Get started"}
              </span>
              <span class="palette-row-shortcut">↵</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
