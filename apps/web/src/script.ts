import * as stylex from "@stylexjs/stylex";
import { darkTheme, lightTheme } from "./styles/tokens.stylex";

// The page's only script, inlined in <head> by the build (scripts/prerender.ts) so a chosen theme is on before the
// first paint. `install` runs on its own source, so it may use nothing from outside itself but its argument.
//
// - The theme toggle: the page follows the system until you pick one, which is remembered on this browser.
// - The waitlist: joining marks the form `data-joined`, which swaps the field for "You're on the list". It isn't sent
//   anywhere yet; once the API has a waitlist route, it's posted there first.

type Classes = { light: string; dark: string };

function install(classes: Classes): void {
  const root = document.documentElement;
  let chosen: "light" | "dark" | null = null;
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") chosen = saved;
  } catch {}
  // The two themes' classes share one (their variables'), so clear both before adding the chosen one's.
  const apply = (): void => {
    root.classList.remove(...`${classes.light} ${classes.dark}`.split(" "));
    if (chosen) root.classList.add(...classes[chosen].split(" "));
    root.style.colorScheme = chosen ?? "";
  };
  apply();
  addEventListener("click", (event) => {
    if (!(event.target as Element).closest?.("[data-theme-toggle]")) return;
    // The page is dark until a theme's chosen, whatever the system's.
    chosen = chosen === "light" ? "dark" : "light";
    apply();
    try {
      localStorage.setItem("theme", chosen);
    } catch {}
  });
  addEventListener("submit", (event) => {
    const waitlist = (event.target as Element).closest?.("[data-waitlist]");
    if (!(waitlist instanceof HTMLElement)) return;
    event.preventDefault();
    waitlist.dataset.joined = "";
  });
}

const classes: Classes = {
  light: stylex.props(lightTheme).className ?? "",
  dark: stylex.props(darkTheme).className ?? "",
};

export const installScript = (): void => install(classes);
export const pageScript = `(${install.toString()})(${JSON.stringify(classes)})`;
