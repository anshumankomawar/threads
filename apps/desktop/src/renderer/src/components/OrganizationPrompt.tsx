import { useEffect, useRef, useState } from "react";

// Naming the organization: the first time anyone opens a workspace, when it can't be skipped, or renaming it later.
export function OrganizationPrompt({
  current,
  onSave,
  onClose,
}: {
  current: string;
  onSave: (name: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(current);
  const renaming = current !== "";
  const trimmed = name.trim();

  useEffect(() => inputRef.current?.select(), []);

  const save = (): void => {
    if (trimmed !== "") onSave(trimmed);
  };

  return (
    <div className="palette-overlay" onMouseDown={renaming ? onClose : undefined}>
      <div
        className="palette"
        role="dialog"
        aria-label={renaming ? "Rename the organization" : "Name your organization"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Your organization's name"
            spellCheck={false}
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              } else if (event.key === "Escape" && renaming) {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <div className="palette-results">
          <div className="palette-section">
            <div className="palette-section-label">
              {renaming ? "Rename the organization" : "Welcome. What's your organization called?"}
            </div>
            <div
              className="palette-row"
              data-selected={trimmed !== ""}
              data-disabled={trimmed === ""}
              role="option"
              aria-selected={trimmed !== ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={save}
            >
              <span className="palette-row-label">
                {trimmed === "" ? "Type a name to continue" : renaming ? "Save" : "Get started"}
              </span>
              <span className="palette-row-shortcut">↵</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
