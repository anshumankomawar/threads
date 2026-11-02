import { useEffect, useRef, useState } from "react";
import type { Bucket } from "model";

type Step = "name" | "describe";

// Making or editing an inbox bucket in two steps, like a new thread: its name, then in plain words what goes in it,
// which is what the model reads to sort threads into it. Backspace on an empty description goes back to the name.
export function BucketPalette({
  bucket,
  onSave,
  onClose,
}: {
  // The bucket being edited, or null for a new one.
  bucket: Bucket | null;
  onSave: (name: string, description: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState(bucket?.name ?? "");
  const [description, setDescription] = useState(bucket?.description ?? "");
  useEffect(() => inputRef.current?.focus(), [step]);

  const title = name.trim();
  const forward = (): void => {
    if (title === "") return inputRef.current?.focus();
    if (step === "name") setStep("describe");
    else onSave(title.slice(0, 40), description.trim().slice(0, 500));
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (step === "name") onClose();
      else setStep("name");
    } else if (event.key === "Enter") {
      event.preventDefault();
      forward();
    } else if (
      step === "describe" &&
      event.key === "Backspace" &&
      description === "" &&
      !event.repeat
    ) {
      event.preventDefault();
      setStep("name");
    }
  };

  const label =
    title === ""
      ? "Name the bucket to continue"
      : step === "name"
        ? "Continue to describe"
        : bucket === null
          ? "Create bucket"
          : "Save bucket";

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label={bucket === null ? "New bucket" : "Edit bucket"}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={
              step === "name"
                ? "Name the bucket… (Customer requests)"
                : "What goes in it? (anything a customer asked for or reported)"
            }
            spellCheck={false}
            maxLength={step === "name" ? 40 : 500}
            value={step === "name" ? name : description}
            onChange={(event) =>
              step === "name" ? setName(event.target.value) : setDescription(event.target.value)
            }
          />
          <span className="palette-step">Step {step === "name" ? 1 : 2} of 2</span>
        </div>
        <div className="palette-results">
          <div className="palette-section">
            <div className="palette-section-label palette-summary">
              {step === "name" ? (
                bucket === null ? (
                  "New bucket"
                ) : (
                  "Rename"
                )
              ) : (
                <>
                  Describe <span className="palette-summary-title">“{title}”</span> so threads are
                  sorted into it
                </>
              )}
            </div>
            <div
              className="palette-row"
              data-selected={title !== ""}
              data-disabled={title === ""}
              role="option"
              aria-selected={title !== ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={forward}
            >
              <span className="palette-row-label">{label}</span>
              <span className="palette-row-shortcut">↵</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
