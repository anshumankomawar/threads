import "./assets/global.css";
import { render } from "@solidjs/web";
import { needsSignIn } from "./startup";

// Signed out, only the sign-in screen loads: the app and its store come once you're someone.
const { default: Root } = needsSignIn ? await import("./components/SignIn") : await import("./App");
render(() => <Root />, document.getElementById("root")!);
