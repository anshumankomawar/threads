// The few global rules StyleX can't reach (reset, body, #root, the editor's content); everything else is StyleX.
import "./assets/global.css";

import { render } from "@solidjs/web";
import { setReactivity } from "sync/client";
import App from "./App";
import { solidReactivity } from "./sync/solidReactivity";
import { applyTheme, savedTheme } from "./theme";

// Before any client is made, so the engine's pool and state are Solid signals.
setReactivity(solidReactivity);
// Before the first render, so the app never flashes the other theme.
applyTheme(savedTheme());

render(() => <App />, document.getElementById("root")!);
