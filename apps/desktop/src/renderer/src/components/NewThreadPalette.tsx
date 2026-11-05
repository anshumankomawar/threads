import { labelSlug, type Label, type Person } from "model";
import { createSignal, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { selectableLabels } from "../groups";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { createList, matching, others, Palette, Quoted, Row } from "./Palette";

export type NewThreadDraft = {
  title: string;
  // Empty for none.
  description: string;
  // Nobody makes it your own to-do until you @mention someone.
  assignees: Person[];
  // Any that don't exist yet are made with it.
  labelNames: string[];
};

// `labels` is a detour from the last step, for filing it.
type Step = "write" | "describe" | "pick" | "labels";
const STEPS: Step[] = ["write", "describe", "pick"];
const TEXT: Record<Step, [placeholder: string, verb: string]> = {
  write: ["What do you need?", "Next"],
  describe: ["Add a description… (optional)", "Describe"],
  pick: ["Assign to…", "Assign"],
  labels: ["Find or make a label…", "Label"],
};

type Option = { id: string; label: string; name?: string; person?: Person };

// Starting a thread: its title, an optional description, then who it's assigned to; there Tab picks labels.
export function NewThreadPalette(props: {
  initialLabels: Label[];
  // First in the list, such as whoever's profile you're making it from.
  initialAssignee?: Person | null;
  onCreate: (draft: NewThreadDraft) => void;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  const [step, setStep] = createSignal<Step>("write");
  const [text, setText] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [chosen, setChosen] = createSignal<{ id: string; name: string }[]>(
    untrack(() => props.initialLabels),
  );
  const labelling = (): boolean => step() === "labels";
  const listing = (): boolean => step() === "pick" || labelling();
  const people = (): Option[] => {
    const me = app.me();
    const first = props.initialAssignee?.id;
    return [
      { id: "unassigned", label: "Unassigned" },
      ...others(app.data.people(), me).map((p) => ({ id: p.id, label: p.name, person: p })),
      { id: me.id, label: "Me", person: me },
    ].toSorted((a, b) => Number(b.id === first) - Number(a.id === first));
  };
  const labels = (): Option[] => {
    const all = selectableLabels(app.data.labels(), app.data.groups());
    const [slug, typed] = [labelSlug(filter()), filter().trim()];
    const made = slug !== "" && !all.some((l) => l.id === slug || labelSlug(l.name) === slug);
    return [
      ...all.map((l) => ({ id: l.id, label: l.name })),
      ...(made ? [{ id: slug, label: `Make “${typed}”`, name: typed }] : []),
    ];
  };
  const list = createList(() =>
    (labelling() ? labels() : people()).filter(
      (o) => o.name !== undefined || matching(o.label, filter()),
    ),
  );
  const title = (): string => text().trim();
  const hasLabel = (id: string): boolean => chosen().some((label) => label.id === id);
  const goTo = (next: Step): void => {
    setStep(next);
    setFilter("");
    list.set(0);
  };
  const back = (): void => goTo(labelling() ? "pick" : STEPS[STEPS.indexOf(step()) - 1]);
  const pick = (option: Option): void => {
    if (!labelling()) {
      const assignees = option.person === undefined ? [] : [option.person];
      const labelNames = chosen().map((label) => label.name);
      return props.onCreate({
        title: title(),
        description: description().trim(),
        assignees,
        labelNames,
      });
    }
    setChosen((all) =>
      hasLabel(option.id)
        ? all.filter((label) => label.id !== option.id)
        : [...all, { id: option.id, name: option.name ?? option.label }],
    );
    goTo("labels");
  };
  const labelsText = (): string => {
    const [first, ...rest] = chosen();
    if (first === undefined) return "No labels";
    return rest.length === 0 ? first.name : `${first.name} +${rest.length}`;
  };
  return (
    <Palette
      label="New thread"
      placeholder={TEXT[step()][0]}
      value={step() === "write" ? text() : step() === "describe" ? description() : filter()}
      onInput={step() === "write" ? setText : step() === "describe" ? setDescription : setFilter}
      step={`Step ${STEPS.indexOf(labelling() ? "pick" : step()) + 1} of 3`}
      onClose={props.onClose}
      onBack={step() === "write" ? undefined : back}
      onEnter={() => title() !== "" && goTo(STEPS[STEPS.indexOf(step()) + 1])}
      onKey={(event) => step() === "pick" && event.key === "Tab" && (goTo("labels"), true)}
      ready={title() !== ""}
      next={
        title() === ""
          ? "Write what you need to continue"
          : `Continue to ${step() === "write" ? "describe" : "assign"}`
      }
      list={listing() ? list : undefined}
      row={(o) => ({
        seed: o.person?.id,
        label: o.label,
        checked: labelling() ? hasLabel(o.id) : undefined,
      })}
      onPick={pick}
      section={
        <>
          {TEXT[step()][1]}
          <Show when={step() !== "write"}>
            {" "}
            <Quoted>{title()}</Quoted>
          </Show>
          <Show when={step() === "pick"}>
            {" to"}
            <button
              type="button"
              class={sx(palette.side, palette.sideColor)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => goTo("labels")}
            >
              {labelsText()}
              <span class={sx(palette.shortcut)}>⇥</span>
            </button>
          </Show>
        </>
      }
    >
      <Show when={labelling()}>
        <Row more selected={false} spec={{ label: "Done", shortcut: "esc" }} onClick={back} />
      </Show>
    </Palette>
  );
}
