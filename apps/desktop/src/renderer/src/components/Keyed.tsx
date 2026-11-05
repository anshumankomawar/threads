import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

// Shows its child for a value, made anew when the value's key changes (React's `key`) and kept, with the value updating
// in place, while it stays. The child gets the value as an accessor, always the current one: a keyed `<Show>` keyed on
// an id would leave the child reading the value through another accessor, which can lag the id it was made for.
export function Keyed<T>(props: {
  value: T | undefined | null | false;
  by: (value: T) => string;
  children: (value: () => T) => JSX.Element;
}): JSX.Element {
  return (
    <For each={props.value ? [props.value] : []} keyed={props.by}>
      {(value) => props.children(value)}
    </For>
  );
}
