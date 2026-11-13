import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@ui-sdk/react/button";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "./data";
import { reset } from "./state";

const loaded = Promise.race([
  Promise.all([
    document.fonts.load('300 36px "Fraunces"'),
    document.fonts.load('400 14px "Hanken Grotesk"'),
  ]),
  new Promise((resolve) => setTimeout(resolve, 1000)),
]);

export function SignIn() {
  const { setSession } = useAuthActions();
  const start = useMutation(api.auth.startSignInWithGoogle);
  const complete = useMutation(api.auth.completeSignInWithGoogle);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void loaded.then(() => setReady(true));
  }, []);

  const signIn = async () => {
    setBusy(true);
    setFailed(false);
    const { redirect, state } = await start({ redirectTo: "http://127.0.0.1:47201/" });
    const code = await window.desktop.google(redirect);
    const result = code ? await complete({ code, state }) : undefined;
    if (result?.status === "complete") await setSession(result.tokens);
    else setFailed(true);
    setBusy(false);
  };

  return (
    <main className="welcome">
      {ready && (
        <div>
          <h1>
            {"Where decisions don’t get lost".split(" ").map((word, index) => (
              <span key={index} style={{ animationDelay: `${80 + index * 80}ms` }}>
                {word}{" "}
              </span>
            ))}
          </h1>
          <p>Sign in to Arc with your Google account.</p>
          <Button onClick={signIn} disabled={busy}>
            {busy && <i />}
            Continue with Google
          </Button>
          {failed && <p role="alert">Signing in with Google didn't finish.</p>}
        </div>
      )}
    </main>
  );
}

export function Start() {
  const create = useMutation(api.workspace.create);
  const join = useMutation(api.workspace.join);
  const { signOut } = useAuthActions();
  const [failed, setFailed] = useState(false);

  return (
    <main className="welcome">
      <div>
        <h1>Start a workspace</h1>
        <p>Create one for your team, or paste an invite link to join theirs.</p>
        <form action={(form) => void create({ name: String(form.get("name")).trim() })}>
          <Field name="name">
            <FieldLabel className="hidden">Workspace name</FieldLabel>
            <Input placeholder="Workspace name" required autoFocus />
          </Field>
          <Button type="submit">Create Workspace</Button>
        </form>
        <form action={async (form) => setFailed(!(await join({ link: String(form.get("link")) })))}>
          <Field name="link">
            <FieldLabel className="hidden">Invite link</FieldLabel>
            <Input placeholder="Invite link" required />
          </Field>
          <Button type="submit" className="secondary">
            Join Workspace
          </Button>
        </form>
        {failed && <p role="alert">That link doesn't lead to a workspace.</p>}
        <Button className="link" onClick={() => void signOut().then(reset)}>
          Sign Out
        </Button>
      </div>
    </main>
  );
}
