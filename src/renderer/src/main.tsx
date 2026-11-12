import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Authenticated, ConvexReactClient, Unauthenticated } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SignIn } from "./SignIn";
import "./app.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <ConvexQueryCacheProvider>
        <Unauthenticated>
          <SignIn />
        </Unauthenticated>
        <Authenticated>
          <App />
        </Authenticated>
      </ConvexQueryCacheProvider>
    </ConvexAuthProvider>
  </StrictMode>,
);
