import type { Person } from "model";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { useApp } from "../app/state";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Identicon } from "./Identicon";

type Step = "who" | "what" | "why";

// `/blocked` in a reply, in three steps: who you're blocked on (you, for something you'll sort out yourself), what
// you need from them (the new thread's title), and why it's blocking (its description; optional). It becomes a new
// thread asking them, and the thread you're in waits until it's closed. Backspace on an empty field goes back a step.
export function BlockedPalette(props: {
  // The thread that's blocked, for the prompt.
  blockedTitle: string;
  // The new thread's title, and the reason as its description (empty for none).
  onCreate: (person: Person, title: string, description: string) => void;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  let input!: HTMLInputElement;
  const [step, setStep] = createSignal<Step>("who");
  const [person, setPerson] = createSignal<Person | null>(null);
  const [title, setTitle] = createSignal("");
  const [text, setText] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  createEffect(
    () => step(),
    () => input.focus(),
  );

  // Everyone else, then you.
  const options = createMemo(() => {
    const query = text().trim().toLowerCase();
    const me = app.me();
    return step() === "who"
      ? [...app.data.people().filter((candidate) => candidate.id !== me.id), me].filter(
          (candidate) => candidate.name.toLowerCase().includes(query),
        )
      : [];
  });
  const selectedIndex = (): number => Math.min(selected(), Math.max(0, options().length - 1));
  const isMe = (): boolean => person()?.id === app.me().id;
  const firstName = (): string | undefined => person()?.name.split(" ")[0];

  const goTo = (next: Step, value = ""): void => {
    setStep(next);
    setText(value);
    setSelected(0);
  };
  const pick = (chosen: Person): void => {
    setPerson(chosen);
    goTo("what", title());
  };
  const next = (): void => {
    const chosen = person();
    if (step() === "what" && text().trim().length > 0) {
      setTitle(text().trim());
      goTo("why");
    } else if (step() === "why" && chosen !== null) {
      props.onCreate(chosen, title(), text().trim());
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    } else if (step() === "who" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const count = options().length;
      if (count === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex() + delta + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (step() === "who") {
        const chosen = options()[selectedIndex()];
        if (chosen !== undefined) pick(chosen);
      } else next();
    } else if (event.key === "Backspace" && step() !== "who" && text() === "" && !event.repeat) {
      event.preventDefault();
      if (step() === "why") goTo("what", title());
      else goTo("who");
    }
  };

  const placeholder = (): string =>
    step() === "who"
      ? "Blocked on who?"
      : step() === "what"
        ? isMe()
          ? "What do you need to sort out?"
          : `What do you need from ${firstName()}?`
        : "Why is it blocking? (optional)";
  const action = (): string =>
    step() === "what"
      ? "Next: why it's blocking"
      : isMe()
        ? "Start a thread for it"
        : `Ask ${firstName()} in a new thread`;
  const ready = (): boolean => step() === "why" || text().trim().length > 0;

  return (
    <div class={sx(palette.overlay)} onMouseDown={() => props.onClose()}>
      <div
        class={sx(palette.panel)}
        role="dialog"
        aria-label="Blocked on someone"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class={sx(palette.inputRow)}>
          <Show when={step() !== "who" ? person() : null}>
            {(chosen) => (
              <span class={sx(styles.chip)}>
                <Identicon seed={chosen().id} size={14} />
                {isMe() ? "Me" : chosen().name}
              </span>
            )}
          </Show>
          <input
            ref={input}
            class={sx(palette.input)}
            placeholder={placeholder()}
            spellcheck="false"
            value={text()}
            onInput={(event) => {
              setText(event.currentTarget.value);
              setSelected(0);
            }}
          />
        </div>
        <div class={sx(palette.results)}>
          <div class={sx(palette.section)}>
            <div class={sx(palette.sectionLabel, palette.summary)}>
              {step() === "why" ? (
                <>
                  Asking for <span class={sx(palette.summaryTitle)}>“{title()}”</span>
                </>
              ) : (
                <>
                  Blocking <span class={sx(palette.summaryTitle)}>“{props.blockedTitle}”</span>
                </>
              )}
            </div>
            {step() === "who" ? (
              <For each={options()}>
                {(candidate, index) => (
                  <div
                    class={sx(palette.row, index() === selectedIndex() && palette.rowSelected)}
                    role="option"
                    aria-selected={index() === selectedIndex() ? "true" : "false"}
                    onMouseMove={() => setSelected(index())}
                    onClick={() => pick(candidate)}
                  >
                    <Identicon seed={candidate.id} size={16} />
                    <span class={sx(palette.rowLabel)}>
                      {candidate.id === app.me().id ? "Me" : candidate.name}
                    </span>
                  </div>
                )}
              </For>
            ) : (
              <div
                class={sx(
                  palette.row,
                  ready() && palette.rowSelected,
                  !ready() && palette.rowDisabled,
                )}
                role="option"
                aria-selected={ready() ? "true" : "false"}
                onClick={next}
              >
                <span class={sx(palette.rowLabel)}>{action()}</span>
                <span class={sx(palette.rowShortcut)}>↵</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = stylex.create({
  // .palette-chip — who the next step is about, ahead of the input.
  chip: {
    display: "inline-flex",
    flexShrink: 0,
    gap: "6px",
    alignItems: "center",
    height: "22px",
    marginRight: "8px",
    padding: "0 8px 0 5px",
    borderRadius: radii.control,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    backgroundColor: colors.panelSelected,
  },
});
