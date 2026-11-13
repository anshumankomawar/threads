import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@ui-sdk/react/button";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "./data";

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
