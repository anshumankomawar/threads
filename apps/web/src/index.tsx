import { render } from "@solidjs/web";
import { Landing } from "./Landing";
import { installScript } from "./script";

// Development only: `vp dev` renders the page in the browser. The build prerenders it (entry-server.tsx).
installScript();
render(() => <Landing />, document.getElementById("root")!);
