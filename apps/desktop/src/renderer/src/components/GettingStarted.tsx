import * as i from "@hugeicons/core-free-icons";
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Subspace, Thread, WorkspaceMember } from "models";
import { invited, refreshInvites } from "../invites";
import { account, edit, me, newThreadHere, open, setDialog, store } from "../session";
import { base } from "../styles/base";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii, space } from "../styles/tokens.stylex";
import { Icon, type IconSvgElement } from "./Icon";

// The first things to do in a new workspace, at the bottom of the sidebar. Each ticks itself off once it's done, by
// you or anyone, and the list goes once they all are or you put it away (⌘K brings it back). Only for someone signed in
// to a workspace of their own, not the Sample.

type Step = {
  id: string;
  label: string;
  icon: IconSvgElement;
  done: () => boolean;
  run: () => void;
};

const mine = (): Thread[] => store.where(Thread, "ownerId", me().id);

const STEPS: Step[] = [
  {
    id: "thread",
    label: "Start a thread",
    icon: i.PencilEdit02Icon,
    done: () => mine().length > 0,
    run: newThreadHere,
  },
  {
    id: "due",
    label: "Give it a due date",
    icon: i.Calendar03Icon,
    done: () => store.all(Thread).some((t) => t.dueAt != null),
    // Your latest thread, where its date chip is; with none yet, one to start.
    run: () => {
      const latest = mine().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (latest) open({ thread: latest.id });
      else newThreadHere();
    },
  },
  {
    id: "space",
    label: "Make a space for a team",
    icon: i.Layers01Icon,
    done: () => store.all(Subspace).length > 0,
    run: () => setDialog({ kind: "newSubspace" }),
  },
  {
    id: "invite",
    label: "Invite your team",
    icon: i.UserAdd01Icon,
    done: () => store.all(WorkspaceMember).length > 1 || invited().length > 0,
    run: () => setDialog({ kind: "invite" }),
  },
];

const finished = (): number => STEPS.filter((step) => step.done()).length;
// Whether it's in the sidebar: yours to see, not put away, and not all done.
export const gettingStartedShown = (): boolean =>
  account !== null && me().gettingStartedHiddenAt == null && finished() < STEPS.length;
// Puts it away, or brings it back (⌘K).
export const showGettingStarted = (shown: boolean): void =>
  edit(
    me(),
    { gettingStartedHiddenAt: shown ? undefined : new Date() },
    shown ? "Show Getting Started" : "Hide Getting Started",
  );

const s = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    marginInline: space.inset,
    marginBottom: 6,
    padding: 4,
    borderRadius: radii.item,
    backgroundColor: colors.bgQuaternary,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingBlock: 4,
    paddingInline: "6px 2px",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    fontWeight: 600,
  },
  count: { flex: 1, color: colors.textTertiary, fontWeight: 400 },
  hide: {
    display: "grid",
    placeItems: "center",
    width: 18,
    height: 18,
    borderRadius: radii.control,
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    backgroundColor: { default: "transparent", ":hover": colors.bgTertiary },
  },
  step: {
    display: "flex",
    gap: 7,
    alignItems: "center",
    paddingBlock: 4,
    paddingInline: 6,
    borderRadius: radii.control,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    textAlign: "left",
    backgroundColor: { default: "transparent", ":hover": colors.bgTertiary },
  },
  done: { color: colors.textTertiary, textDecoration: "line-through" },
  tick: { flexShrink: 0, color: colors.textTertiary },
  ticked: { color: colors.statusClosed },
});

export function GettingStarted(): JSX.Element {
  void refreshInvites();
  return (
    <Show when={gettingStartedShown()}>
      <section class={sx(s.card)} aria-label="Getting Started">
        <div class={sx(s.head)}>
          Getting Started
          <span class={sx(s.count)}>
            {finished()} of {STEPS.length}
          </span>
          <button
            class={sx(base.bare, s.hide)}
            aria-label="Hide Getting Started"
            title="Hide Getting Started"
            onClick={() => showGettingStarted(false)}
          >
            <Icon icon={i.Cancel01Icon} size={11} />
          </button>
        </div>
        <For each={STEPS}>
          {(step) => (
            <button class={sx(base.bare, s.step, step.done() && s.done)} onClick={step.run}>
              <span class={sx(s.tick, step.done() && s.ticked)}>
                <Icon icon={step.done() ? i.CheckmarkCircle02Icon : step.icon} size={13} />
              </span>
              {step.label}
            </button>
          )}
        </For>
      </section>
    </Show>
  );
}
