import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import * as i from "@hugeicons/core-free-icons";
import { sx } from "../styles/sx";
import { colors, fontSizes } from "../styles/tokens.stylex";
import { Identicon } from "./Identicon";
import { BUCKET, icon, MessageList, Sidebar } from "./Inbox";

// Arc's window, drawn in HTML at the app's own sizes (a 1440×900 window at its 110%): the sidebar, the inbox, and the
// open thread as a conversation (ThreadView.tsx and styles/thread.ts on solid-email). It's the page's product shot,
// sharp on any screen and costing no image; the landing page cuts it off at the bottom of the screen.

const WIDE = "@media (min-width: 1800px)";
const center = { display: "flex", alignItems: "center" } as const;
const column = { display: "flex", flexDirection: "column" } as const;

const s = stylex.create({
  window: {
    position: "relative",
    display: "grid",
    // The app's columns (Mail.tsx): 220 and 340, the thread taking the rest of 1440 ÷ 1.1.
    gridTemplateColumns: "220px 340px 749px",
    height: 818,
    zoom: { default: 1.1, [WIDE]: 1.35 },
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.strokeFocused,
    borderRadius: 12,
    backgroundColor: colors.frosted,
    boxShadow: colors.windowShadow,
    // The app's own face, whatever the page around it uses.
    fontFamily:
      '"Inter Variable", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: fontSizes.body,
    lineHeight: "16px",
    textAlign: "left",
    userSelect: "none",
  },
  // macOS draws the lights unscaled under the app's 110% (main/index.ts): 13.5pt wide, 23pt apart, 12pt in from the
  // top and left. Here each is over 1.1.
  lights: { position: "absolute", top: 10.9, left: 10.9, display: "flex", gap: 8.64 },
  light: { width: 12.27, height: 12.27, borderRadius: "50%" },

  pane: { ...column, minWidth: 0, overflow: "hidden" },
  bar: { ...center, flexShrink: 0, gap: 2.5, height: 34, paddingLeft: 8, paddingRight: 8 },
  barButton: {
    ...center,
    justifyContent: "center",
    width: 22,
    height: 22,
    color: colors.textPrimary,
  },
  barButtonOff: { opacity: 0.35 },
  barTitle: { flex: 1, minWidth: 0, marginLeft: 6, color: colors.textSecondary },
  doc: {
    ...column,
    gap: 28,
    padding: "16px 32px 0 52px",
    maskImage: "linear-gradient(to bottom, #000 calc(100% - 60px), transparent)",
  },
  turn: { display: "flex", gap: 14 },
  mine: { flexDirection: "row-reverse" },
  avatar: { display: "flex", flexShrink: 0, justifyContent: "center", width: 28, marginTop: 8 },
  body: { ...column, flex: 1, minWidth: 0 },
  mineBody: { alignItems: "flex-end" },
  meta: { display: "flex", alignItems: "baseline", gap: 8, lineHeight: "22px" },
  author: { color: colors.textPrimary, fontSize: fontSizes.name, fontWeight: 500 },
  when: { color: colors.textTertiary },
  title: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.message,
    fontWeight: 500,
    lineHeight: "22px",
  },
  properties: { ...center, flexWrap: "wrap", gap: 2, margin: "4px 0 0 -6px" },
  value: {
    ...center,
    gap: 6,
    height: 26,
    padding: "0 6px",
    color: colors.textSecondary,
    whiteSpace: "nowrap",
  },
  dot: {
    width: 8,
    height: 8,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: colors.iconTertiary,
    borderRadius: "50%",
  },
  text: { margin: 0, color: colors.textPrimary, fontSize: fontSizes.message, lineHeight: "22px" },
  mineText: { maxWidth: "80%", textAlign: "right" },
  mention: { color: colors.accent },
  placeholder: { color: colors.textTertiary },
});

function Turn(props: {
  who: string;
  name: string;
  when?: string;
  mine?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class={sx(s.turn, props.mine && s.mine)}>
      <span class={sx(s.avatar)}>
        <Identicon seed={props.who} size={28} />
      </span>
      <div class={sx(s.body, props.mine && s.mineBody)}>
        <div class={sx(s.meta)}>
          <span class={sx(s.author)}>{props.name}</span>
          {props.when && <span class={sx(s.when)}>{props.when}</span>}
        </div>
        {props.children}
      </div>
    </div>
  );
}

const at = (name: string): JSX.Element => <span class={sx(s.mention)}>@{name}</span>;
const value = (label: string, svg?: Parameters<typeof icon>[0]): JSX.Element => (
  <span class={sx(s.value)}>
    {svg && icon(svg)}
    {label}
  </span>
);

export function AppWindow(): JSX.Element {
  return (
    <div
      class={sx(s.window)}
      role="img"
      aria-label="Arc: an inbox sorted into buckets, beside an open thread"
    >
      <span class={sx(s.lights)} aria-hidden="true">
        <span class={sx(s.light)} style={{ "background-color": "#ff5f57" }} />
        <span class={sx(s.light)} style={{ "background-color": "#febc2e" }} />
        <span class={sx(s.light)} style={{ "background-color": "#28c840" }} />
      </span>
      <Sidebar />
      <MessageList />
      <section class={sx(s.pane)}>
        <div class={sx(s.bar)}>
          <span class={sx(s.barButton)}>{icon(i.ArrowLeft01Icon)}</span>
          <span class={sx(s.barButton, s.barButtonOff)}>{icon(i.ArrowRight01Icon)}</span>
          <span class={sx(s.barTitle)}>Launch checklist for Threads 2.0</span>
          <span class={sx(s.barButton)}>{icon(i.MoreHorizontalIcon)}</span>
        </div>
        <div class={sx(s.doc)}>
          <Turn who="daniel" name="Daniel Okafor" when="2h ago">
            <h3 class={sx(s.title)}>Launch checklist for Threads 2.0</h3>
            <div class={sx(s.properties)}>
              <span class={sx(s.value)}>
                <span class={sx(s.dot)} />
                Open
              </span>
              {value(BUCKET, i.Target02Icon)}
              {value("Launch", i.Tag01Icon)}
              {value("Go-to-market", i.Layers01Icon)}
              {value("Jamie +1", i.UserIcon)}
              {value("High")}
              {value("Due Nov 9", i.Calendar03Icon)}
            </div>
          </Turn>
          <Turn who="daniel" name="Daniel Okafor" when="2h ago">
            <p class={sx(s.text)}>
              {at("Jamie Lin")} Launch is Thursday. Docs, changelog and the announcement post are
              ready; what's left is the pricing page and a final pass on the onboarding flow. Can
              you own the go/no-go on Wednesday?
            </p>
          </Turn>
          <Turn who="you" name="Jamie Lin" when="2h ago" mine>
            <p class={sx(s.text, s.mineText)}>
              {at("Daniel Okafor")} Yes. Let's do go/no-go at 4pm Wednesday with design and support
              in the room.
            </p>
          </Turn>
          <Turn who="daniel" name="Daniel Okafor" when="1h ago">
            <p class={sx(s.text)}>
              {at("Jamie Lin")} Booked. I'll bring the launch metrics dashboard so we can agree on
              what success looks like for week one.
            </p>
            <p class={sx(s.text)}>
              Also: support wants a heads-up email the day before. Drafting it now.
            </p>
          </Turn>
          <Turn who="you" name="Jamie Lin" mine>
            <p class={sx(s.text, s.mineText, s.placeholder)}>Reply to Daniel</p>
          </Turn>
        </div>
      </section>
    </div>
  );
}
