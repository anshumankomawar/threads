import type { Person } from "model";
import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Identicon } from "./Identicon";
import { createList, matching, others, Palette, Quoted } from "./Palette";

type Step = "who" | "what" | "why";

// `/blocked` in a reply: who you're blocked on (you, for something you'll sort out yourself), what you need from them
// (the new thread's title), and why it's blocking (its description; optional). The thread you're in waits on it.
export function BlockedPalette(props: {
  blockedTitle: string;
  onCreate: (person: Person, title: string, description: string) => void;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  const [step, setStep] = createSignal<Step>("who");
  const [person, setPerson] = createSignal<Person | null>(null);
  const [title, setTitle] = createSignal("");
  const [text, setText] = createSignal("");
  const everyone = (): Person[] => [...others(app.data.people(), app.me()), app.me()];
  const list = createList(() => everyone().filter((p) => matching(p.name, text())));
  const isMe = (): boolean => person()?.id === app.me().id;
  const firstName = (): string | undefined => person()?.name.split(" ")[0];
  const nameOf = (someone: Person): string => (someone.id === app.me().id ? "Me" : someone.name);
  const goTo = (next: Step, value = ""): void => {
    setStep(next);
    setText(value);
    list.set(0);
  };
  return (
    <Palette
      label="Blocked on someone"
      placeholder={
        step() === "who"
          ? "Blocked on who?"
          : step() === "why"
            ? "Why is it blocking? (optional)"
            : isMe()
              ? "What do you need to sort out?"
              : `What do you need from ${firstName()}?`
      }
      value={text()}
      onInput={setText}
      onClose={props.onClose}
      onKey={(event) => event.key === "Escape" && (props.onClose(), true)}
      onBack={
        step() === "who"
          ? undefined
          : () => (step() === "why" ? goTo("what", title()) : goTo("who"))
      }
      list={step() === "who" ? list : undefined}
      row={(p) => ({ seed: p.id, label: nameOf(p) })}
      onPick={(chosen) => {
        setPerson(chosen);
        goTo("what", title());
      }}
      onEnter={() => {
        const chosen = person();
        if (step() === "what" && text().trim() !== "") {
          setTitle(text().trim());
          goTo("why");
        } else if (step() === "why" && chosen !== null)
          props.onCreate(chosen, title(), text().trim());
      }}
      ready={step() === "why" || text().trim() !== ""}
      next={
        step() === "what"
          ? "Next: why it's blocking"
          : isMe()
            ? "Start a thread for it"
            : `Ask ${firstName()} in a new thread`
      }
      section={
        <>
          {step() === "why" ? "Asking for" : "Blocking"}{" "}
          <Quoted>{step() === "why" ? title() : props.blockedTitle}</Quoted>
        </>
      }
      chip={
        <Show when={step() !== "who" ? person() : null}>
          {(chosen) => (
            <span class={sx(palette.chip, palette.chipLook, palette.chipFill)}>
              <Identicon seed={chosen().id} size={14} />
              {nameOf(chosen())}
            </span>
          )}
        </Show>
      }
    />
  );
}
