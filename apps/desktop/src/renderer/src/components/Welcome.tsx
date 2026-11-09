import { createSignal, flush, For, Match, onSettled, Show, Switch, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import horizon from "../assets/horizon.png";
import logo from "../assets/logo-dark.png";
import {
  needsSignIn,
  openWorkspace,
  server,
  otherSources,
  signOut,
  source,
  SOURCES,
  useSource,
} from "../startup";
import { addresses, invite } from "../invites";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { motion } from "../styles/tokens.stylex";
import { Titlebar } from "./DragRegionResync";

// Before the app: logging in, then making or joining a workspace (and inviting your team to one you made). The whole
// window is this, over NASA's photo of Earth's limb from orbit dithered into dots (scripts/horizon), set as the web
// page is: Fraunces for the headlines, written in a word at a time, and Hanken Grotesk for the rest. It's always dark:
// the scene is a picture, not the app's colour.
//
// Nothing shows until the picture is decoded and the faces are loaded (or a moment has passed), so it all arrives
// together: the scene fades up and the headline writes itself over it. Each step gives way to the next as a view
// transition (the old one lifts away while the new one writes in), and the last fades out into the app.

// What the API says you can do once you're signed in (apps/api/src/directory.ts).
type Summary = { id: string; name: string; members: number };
export type Choices = {
  email: string;
  name: string;
  suggestedName: string;
  domain: string | null;
  workspaces: Summary[];
  invited: (Summary & { invitedBy: string })[];
  sameDomain: Summary[];
};
type Call = typeof window.threads.call;

const SERIF = '"Fraunces", "Iowan Old Style", Georgia, serif';
const SANS = '"Hanken Grotesk", -apple-system, BlinkMacSystemFont, sans-serif';
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ink = (alpha: number): string => `rgb(255 255 255 / ${alpha}%)`;
// The window's own ground (main/index.ts), so there's no step from it to this.
const GROUND = "#141414";

// Each headline's words are written in, then what follows rises; a spinner turns.
const written = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(10px)", filter: "blur(5px)" },
  to: { opacity: 1, transform: "none", filter: "blur(0)" },
});
const arrive = stylex.keyframes({ from: { opacity: 0, transform: "translateY(12px)" } });
const turn = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const appear = stylex.keyframes({ from: { opacity: 0 } });

const pill = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  width: "100%",
  height: 42,
  paddingInline: 18,
  borderWidth: 0.5,
  borderStyle: "solid",
  borderRadius: 999,
  fontFamily: SANS,
  fontSize: 14,
} as const;

const s = stylex.create({
  screen: {
    position: "relative",
    display: "grid",
    flex: 1,
    placeItems: "center",
    overflow: "hidden",
    color: ink(92),
    fontFamily: SANS,
    fontSize: 14,
    lineHeight: 1.45,
    backgroundColor: GROUND,
    userSelect: "none",
    transitionProperty: "opacity",
    transitionDuration: "320ms",
    transitionTimingFunction: "ease-in",
  },
  // On the way into the app: all of it fades to the window's ground.
  leaving: { opacity: 0 },
  // Covering the window, each of its pixels on whole screen pixels at any zoom (`cover`), so the dots stay crisp; it
  // fades up once decoded.
  scene: {
    position: "absolute",
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
    pointerEvents: "none",
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: { default: "1.2s", [motion.reduced]: "0s" },
    transitionTimingFunction: "cubic-bezier(0.25, 0.1, 0.25, 1)",
  },
  shown: { opacity: 1 },
  // A pool of the ground behind the words, so they read over the bright band too.
  veil: {
    position: "absolute",
    inset: 0,
    backgroundImage: `radial-gradient(ellipse 460px 400px at 50% 48%, rgb(12 12 13 / 80%), rgb(12 12 13 / 50%) 50%, transparent)`,
    pointerEvents: "none",
  },
  // A fixed height, its steps from the top, so the logo never moves as they change.
  column: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: 360,
    minHeight: 360,
    textAlign: "center",
  },
  // The step under the logo: what a view transition lifts away.
  step: { display: "flex", flexDirection: "column", alignItems: "center", width: "100%" },
  // Waiting on the API: a spinner, only after a moment, so a quick answer shows none.
  pending: {
    marginTop: 64,
    animationName: { default: appear, [motion.reduced]: "none" },
    animationDuration: "400ms",
    animationDelay: "500ms",
    animationFillMode: "backwards",
  },
  spinner: {
    display: "inline-block",
    flexShrink: 0,
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: "currentColor",
    borderRightColor: "transparent",
    borderRadius: 999,
    opacity: 0.7,
    animationName: turn,
    animationDuration: "700ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  big: { width: 18, height: 18, color: ink(60) },
  logo: {
    width: 40,
    height: 40,
    marginBottom: 22,
    animationName: { default: appear, [motion.reduced]: "none" },
    animationDuration: "600ms",
    animationFillMode: "backwards",
  },
  title: {
    margin: 0,
    fontFamily: SERIF,
    fontSize: 36,
    fontWeight: 300,
    lineHeight: 1.08,
    letterSpacing: "-0.02em",
    textWrap: "balance",
  },
  word: {
    display: "inline-block",
    animationName: { default: written, [motion.reduced]: "none" },
    animationDuration: "700ms",
    animationTimingFunction: EASE,
    animationFillMode: "backwards",
  },
  lede: { margin: "10px 0 0", color: ink(62), fontSize: 14, textWrap: "balance" },
  // What follows the headline: rises in once it's written.
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    width: "100%",
    marginTop: 26,
    animationName: { default: arrive, [motion.reduced]: "none" },
    animationDuration: "600ms",
    animationDelay: "420ms",
    animationTimingFunction: EASE,
    animationFillMode: "backwards",
  },
  primary: {
    ...pill,
    borderColor: "transparent",
    color: GROUND,
    fontWeight: 500,
    backgroundColor: { default: ink(94), ":hover": ink(84) },
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.55 },
    transform: { default: "none", ":active:not(:disabled)": "scale(0.985)" },
    transitionProperty: "background-color, opacity, transform",
    transitionDuration: "160ms",
  },
  // Working: still itself, a little quieter, and not pressable again.
  busy: { opacity: { default: 0.8, ":disabled": 0.8 } },
  secondary: {
    ...pill,
    borderColor: ink(14),
    color: ink(92),
    fontWeight: 500,
    backgroundColor: { default: ink(6), ":hover": ink(11) },
    backdropFilter: "blur(20px)",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: "160ms",
  },
  input: {
    ...pill,
    borderColor: { default: ink(14), ":focus": ink(34) },
    outline: "none",
    transitionProperty: "border-color, background-color",
    transitionDuration: "160ms",
    color: ink(92),
    textAlign: "left",
    backgroundColor: ink(6),
    backdropFilter: "blur(20px)",
    userSelect: "text",
    "::placeholder": { color: ink(40) },
  },
  // A workspace you can join: its name and who's there, and Join.
  choice: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    paddingBlock: 10,
    paddingInline: "18px 8px",
    borderWidth: 0.5,
    borderStyle: "solid",
    borderColor: ink(14),
    borderRadius: 16,
    textAlign: "left",
    backgroundColor: ink(6),
    backdropFilter: "blur(20px)",
  },
  choiceText: { display: "flex", flex: 1, flexDirection: "column", minWidth: 0 },
  choiceName: {
    overflow: "hidden",
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  choiceHint: { color: ink(50), fontSize: 12.5 },
  join: { ...pill, width: "auto", height: 32, paddingInline: 14, fontSize: 13 },
  check: {
    display: "flex",
    gap: 9,
    alignItems: "center",
    justifyContent: "center",
    color: ink(70),
    fontSize: 13,
    cursor: "pointer",
  },
  box: { width: 14, height: 14, margin: 0, accentColor: "white", cursor: "pointer" },
  note: { margin: 0, color: ink(50), fontSize: 13, textWrap: "balance" },
  waiting: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  error: { color: "#ff8a80" },
  link: {
    color: { default: ink(55), ":hover": ink(92) },
    transitionProperty: "color",
    transitionDuration: "160ms",
    fontFamily: SANS,
    fontSize: 13,
    cursor: "pointer",
  },
  links: { display: "flex", gap: 16, justifyContent: "center", marginTop: 6 },
  footer: {
    position: "absolute",
    right: 0,
    bottom: 18,
    left: 0,
    display: "flex",
    gap: 14,
    justifyContent: "center",
    color: ink(38),
    fontSize: 12,
  },
});

// Moves to another step: the one on screen lifts away as the next writes itself in (a view transition on the step,
// ::view-transition-*(welcome-step) in global.css). Without view transitions, or with less motion, it just changes.
export function toStep(change: () => void): void {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduced) return change();
  document.startViewTransition(() => {
    change();
    flush();
  });
}

const Spinner = (props: { big?: boolean }): JSX.Element => (
  <span class={sx(s.spinner, props.big && s.big)} aria-hidden="true" />
);

// The picture is 2400×1800. Shown at a whole number of screen pixels per pixel of it, the least that covers the
// window, and placed on whole screen pixels, its dots stay crisp at any zoom (the app is at 110%).
const PICTURE = { width: 2400, height: 1800 };
function cover(): JSX.CSSProperties {
  const ratio = devicePixelRatio;
  const times = Math.max(
    1,
    Math.ceil(
      Math.max((innerWidth * ratio) / PICTURE.width, (innerHeight * ratio) / PICTURE.height),
    ),
  );
  const [width, height] = [(PICTURE.width * times) / ratio, (PICTURE.height * times) / ratio];
  const snap = (value: number): number => Math.round(value * ratio) / ratio;
  return {
    width: `${width}px`,
    height: `${height}px`,
    left: `${snap((innerWidth - width) / 2)}px`,
    top: `${snap((innerHeight - height) / 2)}px`,
    "background-image": `url(${horizon})`,
  };
}

// Whether the picture is decoded and the faces are in, so everything arrives together; after a second, regardless.
const [ready, setReady] = createSignal(false);
const picture = new Image();
picture.src = horizon;
void Promise.race([
  Promise.all([
    picture.decode().catch(() => {}),
    document.fonts.load('300 36px "Fraunces"'),
    document.fonts.load('400 14px "Hanken Grotesk"'),
    document.fonts.load('500 14px "Hanken Grotesk"'),
  ]),
  new Promise((resolve) => setTimeout(resolve, 1000)),
]).then(() => setReady(true));

// A headline, its words written in one after another. Keyed on its text, so a new one writes itself in again.
function Headline(props: { text: string }): JSX.Element {
  return (
    <For each={[props.text]}>
      {(text) => (
        <h1 class={sx(s.title)}>
          <For each={text.split(" ")}>
            {(word, at) => (
              <>
                <span class={sx(s.word)} style={{ "animation-delay": `${80 + at() * 80}ms` }}>
                  {word}
                </span>{" "}
              </>
            )}
          </For>
        </h1>
      )}
    </For>
  );
}

// One step: its headline, a line under it, and what you do there.
function Step(props: { title: string; lede?: string; children: JSX.Element }): JSX.Element {
  return (
    <>
      <Headline text={props.title} />
      <Show when={props.lede}>
        <p class={sx(s.lede, s.body)} style={{ "margin-top": "10px", "animation-delay": "300ms" }}>
          {props.lede}
        </p>
      </Show>
      <div class={sx(s.body)}>{props.children}</div>
    </>
  );
}

const Problem = (props: { text: string | null }): JSX.Element => (
  <Show when={props.text}>
    <p class={sx(s.note, s.error)} role="alert">
      {props.text}
    </p>
  </Show>
);

// Focuses a field as it appears (`autofocus` only works for what's there as the page loads).
const focus = (field: HTMLInputElement): void => void requestAnimationFrame(() => field.focus());

const people = (count: number): string => (count === 1 ? "1 person" : `${count} people`);

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

// Google, in the browser, straight to Google, back on a `com.threads.arc://` link (or with a code to paste here).
// Logging in reloads the window as you.
function LogIn(): JSX.Element {
  const [waiting, setWaiting] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const google = (): void => {
    void window.requestAuth({ provider: "google" });
    setProblem(null);
    if (!waiting()) toStep(() => setWaiting(true));
  };
  const paste = (event: SubmitEvent): void => {
    event.preventDefault();
    const token = new FormData(event.currentTarget as HTMLFormElement).get("code");
    if (typeof token === "string" && token.trim())
      window
        .authenticate({ token: token.trim() })
        .catch(() => setProblem("That code didn't work. Try again."));
  };
  return (
    <Show
      when={waiting()}
      fallback={
        <Step
          title="Where decisions don’t get lost"
          lede="Log in to Arc with your work Google account."
        >
          <button class={sx(s.primary)} onClick={google}>
            <GoogleLogo />
            Continue with Google
          </button>
        </Step>
      }
    >
      <Step title="Finish in your browser" lede="Arc opens again once you’re logged in.">
        <p class={sx(s.note, s.waiting)}>
          <Spinner />
          Waiting for Google
        </p>
        <form onSubmit={paste}>
          <input
            class={sx(s.input)}
            name="code"
            placeholder="Or paste the code from your browser"
          />
        </form>
        <Problem text={problem()} />
        <div class={sx(s.links)}>
          <button class={sx(base.bare, s.link)} onClick={google}>
            Open Google Again
          </button>
          <button class={sx(base.bare, s.link)} onClick={() => toStep(() => setWaiting(false))}>
            Back to Login
          </button>
        </div>
      </Step>
    </Show>
  );
}

// Making or joining a workspace. Invited, or at a company with one open to its domain, you're offered those first.
export function ChooseWorkspace(props: {
  choices: Choices;
  call: Call;
  done: (workspace: { id: string; name: string }, made: boolean) => void;
}): JSX.Element {
  const choices = untrack(() => props.choices);
  const joinable = [...choices.invited, ...choices.sameDomain];
  const [making, setMaking] = createSignal(joinable.length === 0);
  // What's being done: making the workspace, or joining one (its id).
  const [busy, setBusy] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [name, setName] = createSignal(choices.suggestedName);
  const [open, setOpen] = createSignal(true);
  const current = choices.workspaces.find((w) => w.id === server.workspace);

  const run = async (path: string, body: unknown, doing: string): Promise<void> => {
    setBusy(doing);
    setProblem(null);
    const { ok, body: member } = await props.call(path, body);
    if (ok) return props.done(member as { id: string; name: string }, doing === "make");
    setBusy(null);
    setProblem(doing === "make" ? "Couldn't make it. Try again." : "Couldn't join it. Try again.");
  };
  const make = (event: SubmitEvent): void => {
    event.preventDefault();
    if (name().trim())
      void run(
        "/workspaces",
        { name: name().trim(), openToDomain: open() && choices.domain !== null },
        "make",
      );
  };

  return (
    <>
      <Show
        when={making()}
        fallback={
          <Step
            title={choices.invited.length > 0 ? "Your team is here" : "Join your team"}
            lede={
              choices.invited.length > 0
                ? "You’ve been invited to Arc."
                : `People at ${choices.domain} already use Arc.`
            }
          >
            <For each={joinable}>
              {(workspace) => (
                <div class={sx(s.choice)}>
                  <span class={sx(s.choiceText)}>
                    <span class={sx(s.choiceName)}>{workspace.name}</span>
                    <span class={sx(s.choiceHint)}>
                      {people(workspace.members)}
                      {"invitedBy" in workspace
                        ? ` · invited by ${String(workspace.invitedBy)}`
                        : ""}
                    </span>
                  </span>
                  <button
                    class={sx(s.primary, s.join, busy() === workspace.id && s.busy)}
                    disabled={busy() !== null}
                    onClick={() => void run(`/workspaces/${workspace.id}/join`, {}, workspace.id)}
                  >
                    <Show when={busy() === workspace.id}>
                      <Spinner />
                    </Show>
                    Join
                  </button>
                </div>
              )}
            </For>
            <Problem text={problem()} />
            <div class={sx(s.links)}>
              <button class={sx(base.bare, s.link)} onClick={() => toStep(() => setMaking(true))}>
                Create a New Workspace
              </button>
            </div>
          </Step>
        }
      >
        <Step
          title="Name your workspace"
          lede="It’s where your team’s threads live. You can rename it later."
        >
          <form class={sx(s.body)} style={{ margin: 0, animation: "none" }} onSubmit={make}>
            <input
              class={sx(s.input)}
              value={name()}
              onInput={(event) => void setName(event.currentTarget.value)}
              placeholder="Acme"
              maxlength={60}
              ref={focus}
            />
            <Show when={choices.domain}>
              <label class={sx(s.check)}>
                <input
                  type="checkbox"
                  class={sx(s.box)}
                  checked={open()}
                  onChange={(event) => setOpen(event.currentTarget.checked)}
                />
                Let anyone at {choices.domain} join
              </label>
            </Show>
            <button
              class={sx(s.primary, busy() === "make" && s.busy)}
              type="submit"
              disabled={busy() !== null || !name().trim()}
            >
              <Show when={busy() === "make"}>
                <Spinner />
              </Show>
              Create Workspace
            </button>
          </form>
          <Problem text={problem()} />
          <Show when={joinable.length > 0}>
            <div class={sx(s.links)}>
              <button class={sx(base.bare, s.link)} onClick={() => toStep(() => setMaking(false))}>
                Join Your Team Instead
              </button>
            </div>
          </Show>
        </Step>
      </Show>
      <div class={sx(s.links, s.body)} style={{ "margin-top": "18px", "animation-delay": "560ms" }}>
        <Show
          when={current}
          fallback={
            <span class={sx(s.note)}>
              {choices.email} ·{" "}
              <button class={sx(base.bare, s.link)} onClick={() => void signOut()}>
                Log Out
              </button>
            </span>
          }
        >
          {(workspace) => (
            <button class={sx(base.bare, s.link)} onClick={() => openWorkspace(workspace().id)}>
              Back to {workspace().name}
            </button>
          )}
        </Show>
      </div>
    </>
  );
}

// After making a workspace: who else should be in it. Nothing is emailed; they see it when they log in with Google.
export function InviteTeam(props: {
  workspace: { id: string; name: string };
  domain: string | null;
  done: () => void;
}): JSX.Element {
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const emails = addresses(text());
    if (emails.length === 0) return void setProblem("Add an email address.");
    setBusy(true);
    const ok = await invite(emails, props.workspace.id);
    if (ok) return props.done();
    setBusy(false);
    setProblem("Couldn't invite them. Try again.");
  };
  return (
    <Step
      title="Invite your team"
      lede={`They’ll see ${untrack(() => props.workspace.name)} when they log in to Arc with Google.`}
    >
      <form
        class={sx(s.body)}
        style={{ margin: 0, animation: "none" }}
        onSubmit={(e) => void submit(e)}
      >
        <input
          class={sx(s.input)}
          value={text()}
          onInput={(event) => {
            setText(event.currentTarget.value);
            setProblem(null);
          }}
          placeholder={untrack(() =>
            props.domain ? `grace@${props.domain}, alan@${props.domain}` : "Email addresses",
          )}
          ref={focus}
        />
        <button
          class={sx(s.primary, busy() && s.busy)}
          type="submit"
          disabled={busy() || addresses(text()).length === 0}
        >
          <Show when={busy()}>
            <Spinner />
          </Show>
          {addresses(text()).length > 1 ? `Invite ${addresses(text()).length} People` : "Invite"}
        </button>
      </form>
      <Problem text={problem()} />
      <div class={sx(s.links)}>
        <button class={sx(base.bare, s.link)} onClick={() => props.done()}>
          Skip for Now
        </button>
      </div>
    </Step>
  );
}

// What's on screen, and the scene behind it. `leaving` fades it all out, on the way into the app.
export function WelcomeScreen(props: { leaving?: boolean; children: JSX.Element }): JSX.Element {
  const [size, setSize] = createSignal(cover());
  onSettled(() => {
    const fit = (): void => void setSize(cover());
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  });
  return (
    <>
      <Titlebar />
      <main class={sx(s.screen, props.leaving && s.leaving)}>
        <span class={sx(s.scene, ready() && s.shown)} style={size()} aria-hidden="true" />
        <span class={sx(s.veil)} aria-hidden="true" />
        <div class={sx(s.column)}>
          <Show when={ready()}>
            <img class={sx(s.logo)} src={logo} alt="" />
            <div class={sx(s.step)} style={{ "view-transition-name": "welcome-step" }}>
              {props.children}
            </div>
          </Show>
        </div>
        <div class={sx(s.footer)}>
          <span>{SOURCES[source]}</span>
          <For each={otherSources}>
            {(other) => (
              <button
                class={sx(base.bare, s.link)}
                style={{ "font-size": "12px" }}
                onClick={() => void useSource(other)}
              >
                Use {SOURCES[other]}
              </button>
            )}
          </For>
        </div>
      </main>
    </>
  );
}

export default function Welcome(): JSX.Element {
  const call = window.threads.call;
  const [choices, setChoices] = createSignal<Choices | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [made, setMade] = createSignal<{ id: string; name: string } | null>(null);
  const [leaving, setLeaving] = createSignal(false);
  // Asked as it opens, and again from Try Again; the answer comes after, outside the component.
  const load = (): void =>
    void call("/onboarding").then(({ ok, body }) =>
      toStep(() => {
        setProblem(ok ? null : "Couldn’t reach Arc. Check your connection.");
        if (ok) setChoices(body as Choices);
      }),
    );
  if (!needsSignIn) load();
  // Into the app: everything fades out first, then the window opens it.
  const enter = (id: string): void => {
    setLeaving(true);
    setTimeout(() => openWorkspace(id), 320);
  };

  return (
    <WelcomeScreen leaving={leaving()}>
      <Switch
        fallback={
          <div class={sx(s.pending)}>
            <Spinner big />
          </div>
        }
      >
        <Match when={needsSignIn}>
          <LogIn />
        </Match>
        <Match when={made()}>
          {(workspace) => (
            <InviteTeam
              workspace={workspace()}
              domain={choices()!.domain}
              done={() => enter(workspace().id)}
            />
          )}
        </Match>
        <Match when={choices()}>
          {(loaded) => (
            <ChooseWorkspace
              choices={loaded()}
              call={call}
              done={(workspace, isNew) =>
                isNew ? toStep(() => void setMade(workspace)) : enter(workspace.id)
              }
            />
          )}
        </Match>
        <Match when={problem()}>
          <Step title="Something went wrong" lede={problem()!}>
            <button class={sx(s.secondary)} onClick={load}>
              Try Again
            </button>
          </Step>
        </Match>
      </Switch>
    </WelcomeScreen>
  );
}
