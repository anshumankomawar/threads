import { createSignal, For, Match, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import logo from "../assets/logo.png";
import logoDark from "../assets/logo-dark.png";
import { otherSources, source, SOURCES, theme, useSource } from "../startup";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { Titlebar } from "./DragRegionResync";

const field = {
  width: "100%",
  height: 44,
  padding: "0 18px",
  borderWidth: 1,
  borderStyle: "solid",
  borderRadius: radii.pill,
  font: "inherit",
  fontSize: fontSizes.input,
} as const;

const styles = stylex.create({
  screen: {
    display: "grid",
    flex: 1,
    placeItems: "center",
    backgroundColor: colors.chrome,
  },
  column: { display: "flex", flexDirection: "column", gap: 12, alignItems: "center", width: 320 },
  logo: { width: 52, height: 52, marginBottom: 14 },
  title: { margin: "0 0 12px", color: colors.textPrimary, fontSize: 19, fontWeight: 500 },
  button: {
    ...field,
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    borderColor: colors.strokeTertiary,
    color: colors.textPrimary,
    fontWeight: 500,
    backgroundColor: { default: colors.bgQuaternary, ":hover": colors.bgTertiary },
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.6 },
  },
  primary: {
    borderColor: "transparent",
    color: colors.chrome,
    backgroundColor: { default: colors.textPrimary, ":hover": colors.textSecondary },
  },
  input: {
    ...field,
    borderColor: colors.strokeTertiary,
    outline: "none",
    color: colors.textPrimary,
    backgroundColor: "transparent",
    "::placeholder": { color: colors.textTertiary },
  },
  form: { display: "flex", flexDirection: "column", gap: 12, width: "100%" },
  note: { margin: 0, color: colors.textTertiary, fontSize: fontSizes.name, textAlign: "center" },
  error: { color: colors.urgent },
  link: {
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    fontSize: fontSizes.name,
    cursor: "pointer",
  },
  footer: {
    display: "flex",
    gap: 14,
    marginTop: 28,
    color: colors.textTertiary,
    fontSize: fontSizes.name,
  },
});

const GoogleLogo = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

// Signed out, the whole window is this, as in Linear: Google (in the browser, straight to Google, back on a
// `com.threads.arc://` link, or with a code to paste here). Signing in reloads the window as you.
export default function SignIn(): JSX.Element {
  const [step, setStep] = createSignal<"start" | "google">("start");
  const [error, setError] = createSignal<string | null>(null);
  const go = (next: ReturnType<typeof step>): void => {
    setError(null);
    setStep(next);
  };
  const google = (): void => {
    void window.requestAuth({ provider: "google" });
    go("google");
  };
  const submit = (event: SubmitEvent, run: (value: string) => void): void => {
    event.preventDefault();
    const value = new FormData(event.currentTarget as HTMLFormElement).get("value");
    if (typeof value === "string" && value.trim()) run(value.trim());
  };

  return (
    <>
      <Titlebar />
      <main class={sx(styles.screen)}>
        <div class={sx(styles.column)}>
          <img class={sx(styles.logo)} src={theme() === "dark" ? logoDark : logo} alt="" />
          <h1 class={sx(styles.title)}>Log in to Arc</h1>
          <Switch>
            <Match when={step() === "start"}>
              <button class={sx(styles.button, styles.primary)} onClick={google}>
                <GoogleLogo />
                Continue with Google
              </button>
            </Match>
            <Match when={step() === "google"}>
              <p class={sx(styles.note)}>Finish logging in in your browser.</p>
              <form
                class={sx(styles.form)}
                onSubmit={(event) =>
                  submit(event, (token) => {
                    // Signing in this way reloads the window (`onAuthenticated`).
                    window
                      .authenticate({ token })
                      .catch(() => setError("That code didn't work. Try again."));
                  })
                }
              >
                <input
                  class={sx(styles.input)}
                  name="value"
                  placeholder="Or paste the code from your browser"
                />
              </form>
            </Match>
          </Switch>
          <Show when={step() !== "start"}>
            <button class={sx(base.bare, styles.link)} onClick={() => go("start")}>
              Back to login
            </button>
          </Show>
          <Show when={error()}>
            <p class={sx(styles.note, styles.error)} role="alert">
              {error()}
            </p>
          </Show>
          <div class={sx(styles.footer)}>
            <span>{SOURCES[source]}</span>
            <For each={otherSources}>
              {(other) => (
                <button class={sx(base.bare, styles.link)} onClick={() => void useSource(other)}>
                  Use {SOURCES[other]}
                </button>
              )}
            </For>
          </div>
        </div>
      </main>
    </>
  );
}
