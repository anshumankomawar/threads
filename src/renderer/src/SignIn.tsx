import { useSignInWithUsernamePassword } from "@convex-dev/auth/methods/username-password/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@ui-sdk/react/button";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { PasswordInput, PasswordInputControl } from "@ui-sdk/react/password-input";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "./data";
import horizon from "./horizon.png";

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

const DOT = 2;
const GROUND = [16, 16, 16];

function threshold(x: number, y: number) {
  let value = 0;
  for (let bit = 0; bit < 3; bit++)
    value = (value << 2) | ((((x ^ y) >> bit) & 1) << 1) | ((y >> bit) & 1);
  return (value + 0.5) / 64;
}

function paint(canvas: HTMLCanvasElement) {
  const width = Math.ceil(innerWidth / DOT);
  const height = Math.ceil(innerHeight / DOT);
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * DOT}px`;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const scale = Math.max(width / picture.width, height / picture.height);
  const [drawn, tall] = [picture.width * scale, picture.height * scale];
  context.filter = "blur(2px)";
  context.drawImage(picture, (width - drawn) / 2, (height - tall) / 2, drawn, tall);

  const image = context.getImageData(0, 0, width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const color = image.data.slice(at, at + 3);
      const peak = Math.max(...color, 1);
      const lit = (peak / 255) ** 2 > threshold(x, y);
      image.data.set(lit ? color.map((channel) => (channel / peak) * 200) : GROUND, at);
    }
  context.putImageData(image, 0, 0);
}

const STEPS = {
  signIn: {
    title: "Where decisions don’t get lost",
    lede: "Log in to Arc with your email.",
    action: "Log In",
    other: "Create an Account",
    problems: {} as Record<string, string>,
    problem: "Wrong email or password.",
  },
  signUp: {
    title: "Create your account",
    lede: "You get a workspace of your own, or join the one you were invited to.",
    action: "Create Account",
    other: "I Already Have an Account",
    problems: { USERNAME_TAKEN: "That email already has an account." } as Record<string, string>,
    problem: "Choose a longer, less common password.",
  },
};

export function SignIn() {
  const { setSession } = useAuthActions();
  const { signIn } = useSignInWithUsernamePassword(api.auth);
  const signUp = useMutation(api.auth.signUp);
  const [flow, setFlow] = useState<keyof typeof STEPS>("signIn");
  const scene = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const step = STEPS[flow];

  useEffect(() => {
    const fit = () => paint(scene.current!);
    void loaded.then(() => (fit(), setReady(true)));
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);

  const change = () =>
    document.startViewTransition(() =>
      flushSync(() => {
        setFlow(flow === "signIn" ? "signUp" : "signIn");
        setProblem(undefined);
      }),
    );
  const submit = async (form: FormData) => {
    const [name, email, password] = ["name", "email", "password"].map((key) =>
      String(form.get(key) ?? ""),
    );
    setBusy(true);
    setProblem(undefined);
    const result =
      flow === "signUp"
        ? await signUp({ name, email, password })
        : await signIn({ username: email.trim().toLowerCase(), password });
    if (result.status === "complete") await setSession(result.tokens);
    else setProblem(step.problems[result.userError.error] ?? step.problem);
    setBusy(false);
  };

  return (
    <main className="welcome">
      <canvas ref={scene} className={ready ? "scene shown" : "scene"} />
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
            {problem && <p role="alert">{problem}</p>}
            <Button className="link" onClick={change}>
              {step.other}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
