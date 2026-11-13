import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Preferences } from "@ui-sdk/react/preferences";
import { Authenticated, ConvexReactClient, Unauthenticated } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SignIn } from "./SignIn";
import { theme } from "./state";
import "./app.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <ConvexQueryCacheProvider>
        <Preferences preferences={[theme]}>
          <Unauthenticated>
            <SignIn />
          </Unauthenticated>
          <Authenticated>
            <App />
          </Authenticated>
        </Preferences>
      </ConvexQueryCacheProvider>
    </ConvexAuthProvider>
  </StrictMode>,
);
