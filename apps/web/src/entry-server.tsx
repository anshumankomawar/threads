import { renderToString } from "@solidjs/web";
import { Landing } from "./Landing";

// The page as HTML, and its script, for scripts/prerender.ts.
export const render = (): string => renderToString(() => <Landing />);
export { pageScript } from "./script";
