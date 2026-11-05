import type { Person } from "model";
import { createSignal, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { createList, matching, Palette } from "./Palette";

// For local testing: pick who to view the app as.
export function ViewAsPalette(props: {
  onPick: (person: Person) => void;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  const [filter, setFilter] = createSignal("");
  const people = (): Person[] => app.data.people();
  const list = createList(
    () => people().filter((person) => matching(person.name, filter())),
    untrack(() =>
      Math.max(
        0,
        people().findIndex((person) => person.id === app.me().id),
      ),
    ),
  );
  return (
    <Palette
      label="View as"
      placeholder="View as…"
      value={filter()}
      onInput={setFilter}
      onClose={props.onClose}
      list={list}
      onPick={props.onPick}
      section="People"
      row={(p) => ({ seed: p.id, label: p.name, tick: p.id === app.me().id })}
    />
  );
}
