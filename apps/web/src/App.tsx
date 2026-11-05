import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState, type FormEvent } from "react";

// Signing in to Threads: Google, or a one-time code sent to your email. Only invited emails get in. Once signed in, the
// page trades the session for the Threads person you are (`POST /auth/token` on the API).

const auth = createAuthClient({ baseURL: window.location.origin, plugins: [emailOTPClient()] });

type Me = { personId: string; email: string; token: string | null } | { error: string };

// Google sends you back here with `?error=…` when it didn't work out, such as an email that isn't invited.
function redirectError(): string | null {
  const error = new URLSearchParams(window.location.search).get("error");
  return error === null ? null : error.replaceAll("_", " ");
}

export default function App() {
  const { data: session, isPending } = auth.useSession();
  return (
    <main className="card">
      <h1>Threads</h1>
      {isPending ? (
        <p className="muted">Loading…</p>
      ) : session ? (
        <SignedIn email={session.user.email} />
      ) : (
        <SignIn />
      )}
    </main>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(redirectError);

  const run = async (work: () => Promise<{ error: { message?: string } | null }>) => {
    setBusy(true);
    setError(null);
    const { error: failed } = await work();
    setBusy(false);
    if (failed) setError(failed.message ?? "That didn't work");
    return failed === null;
  };

  const google = () =>
    run(() =>
      auth.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
        errorCallbackURL: window.location.origin,
      }),
    );

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" })))
      setSent(true);
  };

  const verify = (event: FormEvent) => {
    event.preventDefault();
    void run(() => auth.signIn.emailOtp({ email, otp: code }));
  };

  return (
    <>
      <button type="button" className="primary" disabled={busy} onClick={() => void google()}>
        Continue with Google
      </button>
      <p className="or">or</p>
      {sent ? (
        <form onSubmit={verify}>
          <p className="muted">If {email} is invited, a code is on its way.</p>
          <input
            aria-label="Code"
            placeholder="6-digit code"
            inputMode="numeric"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="submit" disabled={busy || code.trim() === ""}>
            Sign in
          </button>
          <button type="button" className="link" onClick={() => setSent(false)}>
            Use another email
          </button>
        </form>
      ) : (
        <form onSubmit={(event) => void sendCode(event)}>
          <input
            aria-label="Email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit" disabled={busy || email.trim() === ""}>
            Email me a code
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function SignedIn({ email }: { email: string }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    void fetch("/auth/token", { method: "POST", credentials: "include" })
      .then((response) => response.json() as Promise<Me>)
      .then(setMe, () => setMe({ error: "Couldn't reach Threads" }));
  }, []);

  return (
    <>
      <p>
        Signed in as <strong>{email}</strong>
      </p>
      {me === null ? (
        <p className="muted">Finding you in Threads…</p>
      ) : "error" in me ? (
        <p className="error" role="alert">
          {me.error}
        </p>
      ) : (
        <p className="muted">
          You're <strong>{me.personId}</strong> in Threads.
        </p>
      )}
      <button type="button" onClick={() => void auth.signOut()}>
        Sign out
      </button>
    </>
  );
}
