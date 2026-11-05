import { labelSlug, type Person } from "model";
import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { createList, matching, others, Palette, Quoted, Row } from "./Palette";

// Making a group: name it, then pick anyone in the organization to include. You're in it either way.
export function NewGroupPalette(props: {
  onCreate: (name: string, members: Person[]) => void;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  const [naming, setNaming] = createSignal(true);
  const [name, setName] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [members, setMembers] = createSignal<Person[]>([]);
  const list = createList(() =>
    others(app.data.people(), app.me()).filter((p) => matching(p.name, filter())),
  );
  const title = (): string => name().trim();
  const slug = (): string => labelSlug(title());
  const taken = (): boolean =>
    app.data.labels().some((l) => l.id === slug() || labelSlug(l.name) === slug());
  const isIn = (person: Person): boolean => members().some((member) => member.id === person.id);
  const toggle = (person: Person): void => {
    setMembers((all) => (isIn(person) ? all.filter((m) => m.id !== person.id) : [...all, person]));
  };
  const create = (): void => props.onCreate(title(), members());
  return (
    <Palette
      label="New group"
      placeholder={naming() ? "Name the group: a project, program or team" : "Add people…"}
      value={naming() ? name() : filter()}
      onInput={naming() ? setName : setFilter}
      maxlength={80}
      step={`Step ${naming() ? 1 : 2} of 2`}
      onClose={props.onClose}
      onBack={naming() ? undefined : () => setNaming(true)}
      onEnter={() => {
        if (slug() === "" || taken()) return;
        setNaming(false);
        setFilter("");
        list.set(0);
      }}
      onKey={(event) => {
        const person = list.current();
        if (naming() || (event.key !== " " && event.key !== "Enter")) return false;
        if (event.key === "Enter") create();
        else if (person !== undefined) toggle(person);
        return true;
      }}
      ready={slug() !== "" && !taken()}
      next={
        taken()
          ? `“${title()}” is taken in your organization`
          : slug() === ""
            ? "Type a name to continue"
            : "Continue to add people"
      }
      list={naming() ? undefined : list}
      row={(p) => ({ seed: p.id, label: p.name, checked: isIn(p) })}
      onPick={toggle}
      section={
        naming() ? (
          "Next"
        ) : (
          <>
            Add people to <Quoted>{title()}</Quoted>
            <span class={sx(palette.count)}>
              {members().length === 0 ? "Just you so far" : `You + ${members().length}`}
            </span>
          </>
        )
      }
    >
      <Show when={!naming()}>
        <Row
          more
          selected={false}
          spec={{ label: "Create the group", shortcut: "↵" }}
          onClick={create}
        />
      </Show>
    </Palette>
  );
}
