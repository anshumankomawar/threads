import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Preferences } from "@ui-sdk/react/preferences";
import { Authenticated, ConvexReactClient, Unauthenticated } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { api } from "./data";
import { SignIn } from "./SignIn";
import { theme } from "./state";
import "./app.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

class UntilSignedOut extends Component<{ children: ReactNode }> {
  state = { over: false };
  static getDerivedStateFromError = () => ({ over: true });
  render = () => (this.state.over ? null : this.props.children);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex} api={api.auth}>
      <ConvexQueryCacheProvider>
        <Preferences preferences={[theme]}>
          <Unauthenticated>
            <SignIn />
          </Unauthenticated>
          <Authenticated>
            <UntilSignedOut>
              <App />
            </UntilSignedOut>
          </Authenticated>
        </Preferences>
      </ConvexQueryCacheProvider>
    </ConvexAuthProvider>
  </StrictMode>,
);
