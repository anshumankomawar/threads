import { useSignInWithGoogle } from "@convex-dev/auth/methods/google/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@ui-sdk/react/button";
import {
  Authenticated,
  ConvexReactClient,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../../convex/_generated/api";
import { Icon } from "../renderer/src/Icon";
import { Start } from "../renderer/src/SignIn";
import "../renderer/src/app.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const invite = location.pathname.match(/^\/join\/([\w-]+)/)?.[1];

function Welcome() {
  const { signIn } = useSignInWithGoogle(api.auth);
  const workspace = useQuery(api.workspace.invited, invite ? { invite } : "skip");
  if (invite && workspace === undefined) return null;

  return (
    <main className="welcome">
      <div>
        <h1>{workspace ? `Join ${workspace} on Arc` : "Where decisions don’t get lost"}</h1>
        <p>
          {workspace
            ? "Sign in with your Google account to accept the invite."
            : "Arc is team messaging in threads that sort themselves. Sign in to start a workspace."}
        </p>
        <Button onClick={() => void signIn()}>
          <Icon name="google" size={18} />
          Continue with Google
        </Button>
        {invite && !workspace && <p role="alert">That invite link doesn't lead to a workspace.</p>}
      </div>
    </main>
  );
}

function Home() {
  const me = useQuery(api.workspace.me);
  const join = useMutation(api.workspace.join);
  const { signOut } = useAuthActions();
  const [joined, setJoined] = useState(false);
  const waiting = !!invite && !joined && !!me && !me.workspaceId;

  useEffect(() => {
    if (waiting) void join({ link: invite }).then(() => setJoined(true));
  }, [waiting]);

  if (!me || waiting) return null;
  if (!me.workspaceId) return <Start />;
  return (
    <main className="welcome">
      <div>
        <h1>You’re in {me.workspace}</h1>
        <p>Open Arc on your Mac and sign in with the same Google account.</p>
        <Button onClick={() => (location.href = "arc://open")}>Open Arc</Button>
        <Button className="link" onClick={() => void signOut()}>
          Sign Out
        </Button>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex} api={api.auth}>
      <Unauthenticated>
        <Welcome />
      </Unauthenticated>
      <Authenticated>
        <Home />
      </Authenticated>
    </ConvexAuthProvider>
  </StrictMode>,
);
