import type { Bucket } from "model";
import { createEffect, createSignal, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";

type Step = "name" | "describe";

// Making or editing an inbox bucket in two steps, like a new thread: its name, then in plain words what goes in it,
// which is what the model reads to sort threads into it. Backspace on an empty description goes back to the name.
export function BucketPalette(props: {
  // The bucket being edited, or null for a new one.
  bucket: Bucket | null;
  onSave: (name: string, description: string) => void;
  onClose: () => void;
}): JSX.Element {
  let input!: HTMLInputElement;
  const [step, setStep] = createSignal<Step>("name");
  const [name, setName] = createSignal(untrack(() => props.bucket?.name ?? ""));
  const [description, setDescription] = createSignal(
    untrack(() => props.bucket?.description ?? ""),
  );
  createEffect(
    () => step(),
    () => input.focus(),
  );

  const title = (): string => name().trim();
  const forward = (): void => {
    if (title() === "") return input.focus();
    if (step() === "name") setStep("describe");
    else props.onSave(title().slice(0, 40), description().trim().slice(0, 500));
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (step() === "name") props.onClose();
      else setStep("name");
    } else if (event.key === "Enter") {
      event.preventDefault();
      forward();
    } else if (
      step() === "describe" &&
      event.key === "Backspace" &&
      description() === "" &&
      !event.repeat
    ) {
      event.preventDefault();
      setStep("name");
    }
  };

  const label = (): string =>
    title() === ""
      ? "Name the bucket to continue"
      : step() === "name"
        ? "Continue to describe"
        : props.bucket === null
          ? "Create bucket"
          : "Save bucket";

  return (
    <div class="palette-overlay" onMouseDown={() => props.onClose()}>
      <div
        class="palette"
        role="dialog"
        aria-label={props.bucket === null ? "New bucket" : "Edit bucket"}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class="palette-input-row">
          <input
            ref={input}
            class="palette-input"
            placeholder={
              step() === "name"
                ? "Name the bucket… (Follow-ups)"
                : "What goes in it? (anything a customer asked for or reported)"
            }
            spellcheck="false"
            maxlength={step() === "name" ? 40 : 500}
            value={step() === "name" ? name() : description()}
            onInput={(event) =>
              step() === "name"
                ? setName(event.currentTarget.value)
                : setDescription(event.currentTarget.value)
            }
          />
          <span class="palette-step">Step {step() === "name" ? 1 : 2} of 2</span>
        </div>
        <div class="palette-results">
          <div class="palette-section">
            <div class="palette-section-label palette-summary">
              {step() === "name" ? (
                props.bucket === null ? (
                  "New bucket"
                ) : (
                  "Rename"
                )
              ) : (
                <>
                  Describe <span class="palette-summary-title">“{title()}”</span> so threads are
                  sorted into it
                </>
              )}
            </div>
            <div
              class="palette-row"
              data-selected={String(title() !== "")}
              data-disabled={String(title() === "")}
              role="option"
              aria-selected={title() !== "" ? "true" : "false"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={forward}
            >
              <span class="palette-row-label">{label()}</span>
              <span class="palette-row-shortcut">↵</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
