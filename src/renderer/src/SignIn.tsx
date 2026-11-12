import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import logo from "./logo.png";

const REDIRECT = "http://127.0.0.1:47821";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);

  const google = async () => {
    setBusy(true);
    const code = window.desktop.signIn();
    await signIn("google", { redirectTo: REDIRECT });
    await signIn("google", { code: await code });
  };

  return (
    <div className="sign-in">
      <img src={logo} alt="" />
      <h1>Sign in to Arc</h1>
      <button disabled={busy} onClick={() => void google()}>
        {busy ? "Finish in your browser" : "Continue with Google"}
      </button>
      {import.meta.env.DEV && (
        <form action={(form) => void signIn("dev", form)}>
          <input
            name="email"
            type="email"
            placeholder="Development: sign in as this email"
            required
          />
        </form>
      )}
    </div>
  );
}
