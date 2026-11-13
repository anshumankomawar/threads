import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@ui-sdk/react/button";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { PasswordInput, PasswordInputControl } from "@ui-sdk/react/password-input";
import { useEffect, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import horizon from "./horizon.png";

const PICTURE = { width: 640, height: 427 };
const CELL = 3;

function cover(): CSSProperties {
  const ratio = devicePixelRatio;
  const per = Math.max(
    Math.round(CELL * ratio),
    Math.ceil((innerWidth * ratio) / PICTURE.width),
    Math.ceil((innerHeight * ratio) / PICTURE.height),
  );
  const [width, height] = [(PICTURE.width * per) / ratio, (PICTURE.height * per) / ratio];
  const snap = (value: number) => Math.round(value * ratio) / ratio;
  return {
    width,
    height,
    left: snap((innerWidth - width) / 2),
    top: snap((innerHeight - height) / 2),
    backgroundImage: `url(${horizon})`,
  };
}

const picture = new Image();
picture.src = horizon;
const loaded = Promise.race([
  Promise.all([
    picture.decode().catch(() => {}),
    document.fonts.load('300 36px "Fraunces"'),
    document.fonts.load('400 14px "Hanken Grotesk"'),
  ]),
  new Promise((resolve) => setTimeout(resolve, 1000)),
]);

const STEPS = {
  signIn: {
    title: "Where decisions don’t get lost",
    lede: "Log in to Arc with your email.",
    action: "Log In",
    other: "Create an Account",
    problem: "Wrong email or password.",
  },
  signUp: {
    title: "Create your account",
    lede: "You get a workspace of your own, or join the one you were invited to.",
    action: "Create Account",
    other: "I Already Have an Account",
    problem: "That didn’t work. Is the email already in use?",
  },
};

export function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<keyof typeof STEPS>("signIn");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scene, setScene] = useState(cover);
  const step = STEPS[flow];

  useEffect(() => {
    void loaded.then(() => setReady(true));
    const fit = () => setScene(cover());
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);

  const change = () =>
    document.startViewTransition(() =>
      flushSync(() => {
        setFlow(flow === "signIn" ? "signUp" : "signIn");
        setFailed(false);
      }),
    );
  const submit = async (form: FormData) => {
    setBusy(true);
    setFailed(false);
    await signIn("password", form).catch(() => setFailed(true));
    setBusy(false);
  };

  return (
    <main className="welcome">
      <span className={ready ? "scene shown" : "scene"} style={scene} />
      <span className="veil" />
      {ready && (
        <form key={flow} action={submit}>
          <h1>
            {step.title.split(" ").map((word, index) => (
              <span key={index} style={{ animationDelay: `${80 + index * 80}ms` }}>
                {word}{" "}
              </span>
            ))}
          </h1>
          <p>{step.lede}</p>
          <div>
            <input name="flow" type="hidden" value={flow} />
            {flow === "signUp" && (
              <Field name="name">
                <FieldLabel className="hidden">Name</FieldLabel>
                <Input placeholder="Name" required autoFocus />
              </Field>
            )}
            <Field name="email">
              <FieldLabel className="hidden">Email</FieldLabel>
              <Input type="email" placeholder="Email" required autoFocus />
            </Field>
            <Field>
              <FieldLabel className="hidden">Password</FieldLabel>
              <PasswordInput name="password" required>
                <PasswordInputControl placeholder="Password" pattern=".{8,}" />
              </PasswordInput>
            </Field>
            <Button type="submit" disabled={busy}>
              {busy && <i />}
              {step.action}
            </Button>
            {failed && <p role="alert">{step.problem}</p>}
            <Button className="link" onClick={change}>
              {step.other}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
