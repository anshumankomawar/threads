import { For } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import * as i from "@hugeicons/core-free-icons";
import { AppWindow } from "./components/AppWindow";
import { Icon } from "./components/Icon";
import { sx } from "./styles/sx";
import { colors, motion, radii } from "./styles/tokens.stylex";

// Arc's landing page, for now a waitlist, on one screen that doesn't scroll, with no top bar. Arc is the record: chat is a stream,
// Arc keeps every conversation with an owner and an end. So the page is set like something kept, not scrolled: a
// serif headline, the pitch and an email
// field, then the app itself, cut off by the bottom of the screen, over NASA's sunrise from orbit, dithered. Joining swaps the field for a
// line in the same pill. It isn't wired to anything yet: script.ts only marks it joined.

const PHONE = "@media (max-width: 767px)";
// The headline's serif: Fraunces, light, the same everywhere; Iowan Old Style (its nearest system cousin) until it loads.
const SERIF = '"Fraunces", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
const center = { display: "flex", alignItems: "center" } as const;
const column = { display: "flex", flexDirection: "column" } as const;
// The page's parts rise in as it opens, each a beat after the last, the app up from the bottom edge.
const written = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(10px)", filter: "blur(5px)" },
  to: { opacity: 1, transform: "none", filter: "blur(0)" },
});
const arrive = stylex.keyframes({ from: { opacity: 0, transform: "translateY(12px)" } });

// Joining: the field and button fall away, a check draws itself, the line slides in beside it, and the pill rings once.
const fallAway = stylex.keyframes({
  to: { opacity: 0, transform: "scale(0.96)", visibility: "hidden" },
});
const slideIn = stylex.keyframes({ from: { opacity: 0, transform: "translateY(6px)" } });
const draw = stylex.keyframes({ from: { strokeDashoffset: 30 }, to: { strokeDashoffset: 0 } });
const ring = stylex.keyframes({
  from: { boxShadow: `0 0 0 0 color-mix(in srgb, ${colors.statusClosed} 55%, transparent)` },
  to: { boxShadow: `0 0 0 14px color-mix(in srgb, ${colors.statusClosed} 0%, transparent)` },
});
const rise = stylex.keyframes({ from: { opacity: 0, transform: "translateY(72px)" } });
const fadeIn = stylex.keyframes({ from: { opacity: 0 } });

const s = stylex.create({
  // The page's own ground and ink, so a theme chosen with the toggle repaints all of it.
  page: {
    position: "relative",
    height: "100dvh",
    overflow: "hidden",
    color: colors.textPrimary,
    backgroundColor: colors.page,
  },

  // The theme toggle, a round button in the top right corner, showing what it switches to.
  toggle: {
    ...center,
    position: "fixed",
    top: { default: 20, [PHONE]: 14 },
    right: { default: 24, [PHONE]: 14 },
    zIndex: 50,
    justifyContent: "center",
    width: 40,
    height: 40,
    padding: 0,
    borderStyle: "solid",
    borderWidth: 0.5,
    borderColor: colors.strokeFocused,
    borderRadius: radii.pill,
    color: { default: colors.textSecondary, ":hover": colors.textPrimary },
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.surface} 72%, transparent)`,
      ":hover": colors.surface,
    },
    backdropFilter: "blur(24px) saturate(140%)",
    boxShadow: "0 1px 2px #0000000a, 0 6px 20px #0000000f",
    cursor: "pointer",
    transitionProperty: "background-color, color",
    transitionDuration: "300ms",
  },
  // Shown by the theme (StyleX's types only know keywords for display).
  sun: { display: colors.showSun as "flex" },
  moon: { display: colors.showMoon as "flex" },

  main: {
    position: "relative",
    zIndex: 1,
    ...column,
    alignItems: "center",
    height: "100%",
    // The pitch, then the app under it, cut off by the bottom of the screen.
    padding: { default: "clamp(72px, 12vh, 128px) 40px 0", [PHONE]: "72px 16px 0" },
    textAlign: "center",
  },
  // The app at its real size; `page` clips what doesn't fit. On a phone it starts at the left, so the inbox shows.
  // The app, at its real size (AppWindow.tsx); `page` clips what the screen can't fit. On a phone it's just the open
  // thread, sized to the screen.
  preview: {
    flexShrink: 0,
    alignSelf: "center",
    marginTop: { default: "clamp(48px, 9vh, 88px)", [PHONE]: 40 },
  },
  pitch: { ...column, position: "relative", alignItems: "center", width: "100%", maxWidth: 860 },
  // The headline's words, one after another (each delay set inline).
  word: {
    display: "inline-block",
    animationName: { default: written, [motion.reduced]: "none" },
    animationDuration: "700ms",
    animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    animationFillMode: "backwards",
  },
  // What follows the headline (its delay set inline), and the app, up from the bottom edge.
  enter: {
    animationName: { default: arrive, [motion.reduced]: "none" },
    animationDuration: "600ms",
    animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    animationFillMode: "backwards",
  },
  riseIn: {
    animationName: { default: rise, [motion.reduced]: "none" },
    animationDuration: "1100ms",
    animationDelay: "0ms",
    animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    animationFillMode: "backwards",
  },
  title: {
    margin: 0,
    color: colors.textPrimary,
    fontFamily: SERIF,
    fontSize: { default: "clamp(52px, 6.6vw, 86px)", [PHONE]: 46 },
    fontWeight: 300,
    lineHeight: 1.02,
    letterSpacing: "-0.02em",
    textWrap: "balance",
  },
  lede: {
    maxWidth: 540,
    margin: "16px 0 0",
    color: `color-mix(in srgb, ${colors.textPrimary} 90%, transparent)`,
    fontSize: { default: 18, [PHONE]: 16 },
    lineHeight: 1.5,
    textWrap: "pretty",
  },
  line: { display: { default: "block", [PHONE]: "inline" } },
  waitlist: { width: "100%", maxWidth: 440, marginTop: 28 },
  // The field and its button in one pill, with a hairline edge and a soft shadow.
  form: {
    ...center,
    position: "relative",
    gap: 4,
    height: 56,
    padding: 8,
    borderStyle: "solid",
    borderWidth: 0.5,
    borderColor: colors.strokeFocused,
    borderRadius: radii.pill,
    backgroundColor: `color-mix(in srgb, ${colors.surface} 72%, transparent)`,
    backdropFilter: "blur(24px) saturate(140%)",
    boxShadow: "0 1px 2px #0000000a, 0 6px 20px #0000000f",
    animationName: { default: "none", [stylex.when.ancestor(":is([data-joined])")]: ring },
    animationDuration: "700ms",
    animationDelay: "150ms",
    animationTimingFunction: "ease-out",
  },
  // What falls away on join; without motion it simply goes.
  gone: {
    animationName: { default: "none", [stylex.when.ancestor(":is([data-joined])")]: fallAway },
    animationDuration: "220ms",
    animationTimingFunction: "ease-in",
    animationFillMode: "forwards",
    pointerEvents: { default: "auto", [stylex.when.ancestor(":is([data-joined])")]: "none" },
    display: {
      default: "block",
      [motion.reduced]: { default: "block", [stylex.when.ancestor(":is([data-joined])")]: "none" },
    },
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    padding: "0 12px",
    borderStyle: "none",
    outline: "none",
    color: colors.textPrimary,
    font: "inherit",
    fontSize: 15,
    backgroundColor: "transparent",
    "::placeholder": { color: colors.textTertiary },
  },
  join: {
    flexShrink: 0,
    height: 40,
    padding: "0 18px",
    borderStyle: "none",
    borderRadius: radii.pill,
    color: colors.chrome,
    font: "inherit",
    fontSize: 14,
    fontWeight: 500,
    backgroundColor: { default: colors.textPrimary, ":hover": colors.textSecondary },
    cursor: "pointer",
  },
  note: {
    margin: "14px 0 0",
    color: colors.textSecondary,
    fontSize: 13,
  },
  // The confirmation, over the pill once you've joined, so nothing moves: a check that draws itself, then the line.
  joined: {
    ...center,
    position: "absolute",
    inset: 0,
    justifyContent: "center",
    gap: 10,
    margin: 0,
    color: colors.textPrimary,
    fontSize: 15,
    display: { default: "none", [stylex.when.ancestor(":is([data-joined])")]: "flex" },
    animationName: { default: slideIn, [motion.reduced]: "none" },
    animationDuration: "400ms",
    animationDelay: "200ms",
    animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    animationFillMode: "backwards",
  },
  check: { flexShrink: 0, color: colors.statusClosed },
  checkPath: {
    strokeDasharray: "30",
    animationName: { default: draw, [motion.reduced]: "none" },
    animationDuration: "350ms",
    animationDelay: "260ms",
    animationTimingFunction: "ease-out",
    animationFillMode: "backwards",
  },
  // The field behind everything (tokens: `field`): the scene at half its pixel size, so every dot lands on whole
  // pixels on a Retina screen, kept to the top right so the band sweeps down the left edge and the headline sits over
  // blue and dark. Over it, a veil of the page's colour behind the text, so the type reads in a quiet pool.
  field: {
    position: "absolute",
    inset: 0,
    backgroundImage: `radial-gradient(ellipse 70% 58% at 50% 34%, color-mix(in srgb, ${colors.page} 78%, transparent) 0%, color-mix(in srgb, ${colors.page} 55%, transparent) 45%, color-mix(in srgb, ${colors.page} 20%, transparent) 75%, transparent 100%), ${colors.field}`,
    // At least the screen's width, in whole multiples of half size where that fits, so the dots stay crisp.
    backgroundSize: { default: "auto, max(1200px, 100%) auto", [PHONE]: "auto, 1200px 900px" },
    backgroundPosition: { default: "center, center top", [PHONE]: "center, 70% top" },
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
    pointerEvents: "none",
    // It fades in as it arrives, so the first paint is the headline on the page's ground, never a wait for the image.
    animationName: { default: fadeIn, [motion.reduced]: "none" },
    animationDuration: "900ms",
    animationTimingFunction: "ease-out",
  },
});

export function Landing(): JSX.Element {
  return (
    <div class={sx(s.page)}>
      <div class={sx(s.field)} aria-hidden="true" />
      <button
        type="button"
        class={sx(s.toggle)}
        data-theme-toggle
        aria-label="Switch between light and dark"
        title="Switch between light and dark"
      >
        <span class={sx(s.sun)}>
          <Icon icon={i.Sun03Icon} size={18} aria-hidden="true" />
        </span>
        <span class={sx(s.moon)}>
          <Icon icon={i.Moon02Icon} size={18} aria-hidden="true" />
        </span>
      </button>

      <main class={sx(s.main)}>
        <div class={sx(s.pitch)}>
          <h1 class={sx(s.title)}>
            <For each={["Where", "decisions", "don’t", "get", "lost"]}>
              {(word, at) => (
                <>
                  <span class={sx(s.word)} style={{ "animation-delay": `${150 + at() * 90}ms` }}>
                    {word}
                  </span>
                  {at() < 4 ? " " : ""}
                </>
              )}
            </For>
          </h1>
          <p class={sx(s.lede, s.enter)} style={{ "animation-delay": "550ms" }}>
            {/* One sentence a line, where there's room. */}
            <span class={sx(s.line)}>Every conversation in Arc has an owner and an end.</span>{" "}
            <span class={sx(s.line)}>
              Six months from now, you can still find what was decided and why.
            </span>
          </p>
          <div
            class={sx(s.waitlist, s.enter, stylex.defaultMarker())}
            style={{ "animation-delay": "650ms" }}
            data-waitlist
          >
            <form class={sx(s.form)}>
              <input
                id="email"
                class={sx(s.input, s.gone)}
                type="email"
                name="email"
                required
                autocomplete="email"
                placeholder="Your work email"
                aria-label="Your email"
              />
              <button class={sx(s.join, s.gone)} type="submit">
                Join the waitlist
              </button>
              <p class={sx(s.joined)} role="status">
                <svg
                  class={sx(s.check)}
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    class={sx(s.checkPath)}
                    d="M4 12.5l5 5L20 6.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                You’re on the list.
              </p>
            </form>
            <p class={sx(s.note)}>Invites go out in small batches.</p>
          </div>
        </div>
        <div class={sx(s.preview, s.riseIn)}>
          <AppWindow />
        </div>
      </main>
    </div>
  );
}
