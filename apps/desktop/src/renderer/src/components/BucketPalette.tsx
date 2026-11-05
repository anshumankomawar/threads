import type { Bucket } from "model";
import { createSignal, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Palette, Quoted } from "./Palette";

// Making or editing an inbox bucket: its name, then in plain words what goes in it, which the model reads to sort
// threads into it.
export function BucketPalette(props: {
  // Null for a new one.
  bucket: Bucket | null;
  onSave: (name: string, description: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [naming, setNaming] = createSignal(true);
  const [name, setName] = createSignal(untrack(() => props.bucket?.name ?? ""));
  const [description, setDescription] = createSignal(
    untrack(() => props.bucket?.description ?? ""),
  );
  const title = (): string => name().trim();
  const isNew = (): boolean => props.bucket === null;
  return (
    <Palette
      label={isNew() ? "New bucket" : "Edit bucket"}
      placeholder={
        naming()
          ? "Name the bucket… (Follow-ups)"
          : "What goes in it? (anything a customer asked for or reported)"
      }
      value={naming() ? name() : description()}
      onInput={naming() ? setName : setDescription}
      maxlength={naming() ? 40 : 500}
      step={`Step ${naming() ? 1 : 2} of 2`}
      onClose={props.onClose}
      onBack={naming() ? undefined : () => setNaming(true)}
      onEnter={() => {
        if (title() === "") return;
        if (naming()) setNaming(false);
        else props.onSave(title().slice(0, 40), description().trim().slice(0, 500));
      }}
      section={
        naming() ? (
          isNew() ? (
            "New bucket"
          ) : (
            "Rename"
          )
        ) : (
          <>
            Describe <Quoted>{title()}</Quoted> so threads are sorted into it
          </>
        )
      }
      ready={title() !== ""}
      next={
        title() === ""
          ? "Name the bucket to continue"
          : naming()
            ? "Continue to describe"
            : isNew()
              ? "Create bucket"
              : "Save bucket"
      }
    />
  );
}
