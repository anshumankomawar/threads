import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Preferences } from "@ui-sdk/react/preferences";
import { Authenticated, ConvexReactClient, Unauthenticated } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { api, useMe } from "./data";
import { SignIn, Start } from "./SignIn";
import { theme } from "./state";
import "./app.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

const kept = (change: () => void) => (change(), window.desktop.saved());
const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => kept(() => localStorage.setItem(key, value)),
  removeItem: (key: string) => kept(() => localStorage.removeItem(key)),
};

class UntilSignedOut extends Component<{ children: ReactNode }> {
  state = { over: false };
  static getDerivedStateFromError = () => ({ over: true });
  render = () => (this.state.over ? null : this.props.children);
}

function Home() {
  const me = useMe();
  return me && (me.workspaceId ? <App /> : <Start />);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex} api={api.auth} storage={storage}>
      <ConvexQueryCacheProvider>
        <Preferences preferences={[theme]}>
          <Unauthenticated>
            <SignIn />
          </Unauthenticated>
          <Authenticated>
            <UntilSignedOut>
              <Home />
            </UntilSignedOut>
          </Authenticated>
        </Preferences>
      </ConvexQueryCacheProvider>
    </ConvexAuthProvider>
  </StrictMode>,
);
