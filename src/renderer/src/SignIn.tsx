import { useSignInWithUsernamePassword } from "@convex-dev/auth/methods/username-password/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@ui-sdk/react/button";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { PasswordInput, PasswordInputControl } from "@ui-sdk/react/password-input";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "./data";

const loaded = Promise.race([
  Promise.all([
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
    problem: "Choose a longer, less common password.",
  },
};

export function SignIn() {
  const { setSession } = useAuthActions();
  const { signIn } = useSignInWithUsernamePassword(api.auth);
  const signUp = useMutation(api.auth.signUp);
  const startGoogle = useMutation(api.auth.startSignInWithGoogle);
  const completeGoogle = useMutation(api.auth.completeSignInWithGoogle);
  const [flow, setFlow] = useState<keyof typeof STEPS>("signIn");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const step = STEPS[flow];

  useEffect(() => {
    void loaded.then(() => setReady(true));
  }, []);

  const change = () =>
    document.startViewTransition(() =>
      flushSync(() => {
        setFlow(flow === "signIn" ? "signUp" : "signIn");
        setProblem(undefined);
      }),
    );
  const google = async () => {
    setBusy(true);
    setProblem(undefined);
    const { redirect, state } = await startGoogle({ redirectTo: "http://127.0.0.1:47201/" });
    const code = await window.desktop.google(redirect);
    const result = code ? await completeGoogle({ code, state }) : undefined;
    if (result?.status === "complete") await setSession(result.tokens);
    else setProblem("Signing in with Google didn't finish.");
    setBusy(false);
  };
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
    else
      setProblem(
        result.userError.error === "USERNAME_TAKEN"
          ? "That email already has an account."
          : step.problem,
      );
    setBusy(false);
  };

  return (
    <main className="welcome">
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
            <Button className="secondary" onClick={google} disabled={busy}>
              Continue with Google
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
