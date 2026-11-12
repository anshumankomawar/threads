import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import logo from "./logo.png";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [failed, setFailed] = useState(false);
  const isNew = flow === "signUp";

  return (
    <form
      className="sign-in"
      action={(form) =>
        signIn("password", form).then(
          () => setFailed(false),
          () => setFailed(true),
        )
      }
    >
      <img src={logo} alt="" />
      <h1>{isNew ? "Create your account" : "Sign in to Arc"}</h1>
      <input name="flow" type="hidden" value={flow} />
      {isNew && <input name="name" placeholder="Name" required autoFocus />}
      <input name="email" type="email" placeholder="Email" required autoFocus={!isNew} />
      <input name="password" type="password" placeholder="Password" minLength={8} required />
      <button>{isNew ? "Create Account" : "Sign In"}</button>
      {failed && (
        <p>
          {isNew ? "That didn't work. Is the email already in use?" : "Wrong email or password."}
        </p>
      )}
      <a onClick={() => (setFlow(isNew ? "signIn" : "signUp"), setFailed(false))}>
        {isNew ? "I already have an account" : "Create an account"}
      </a>
    </form>
  );
}
