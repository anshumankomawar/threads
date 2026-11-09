import "./assets/global.css";
import { render } from "@solidjs/web";
import { needsSignIn, needsWorkspace } from "./startup";

// Signed out, or with no workspace yet, only the welcome screen loads: the app and its store come once you're someone
// somewhere.
const { default: Root } =
  needsSignIn || needsWorkspace ? await import("./components/Welcome") : await import("./App");
render(() => <Root />, document.getElementById("root")!);
