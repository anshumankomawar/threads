import { Building03Icon } from "@hugeicons/core-free-icons";
import { assignedIds, bucketsOf, isDone, type Person } from "model";
import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { useApp } from "../app/state";
import { buildOrgTree, chainAbove, countUnder, orgDetails, type OrgNode } from "../org";
import { link } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";
import { profile } from "./ProfileView.styles";

// The guides' lines: 1px, in the stroke colour, inside their 24px cells.
const LINE = {
  position: "absolute",
  content: '""',
  backgroundColor: colors.strokeFocused,
} as const;
// A line down the cell, right under the 16px avatar of the manager above.
const RAIL = { ...LINE, top: 0, bottom: 0, left: "7.5px", width: "1px" } as const;
// The rest of the cell, across from the rail: the tee's arm.
const ARM = { ...LINE, top: "50%", right: "4px", left: "7.5px", height: "1px" } as const;

const styles = stylex.create({
  tree: {
    maxWidth: "560px",
    margin: "20px 0 0 -6px",
    padding: 0,
    listStyle: "none",
  },
  reports: {
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  // A row, as in a file tree: indent guides, avatar and name, then aligned columns for level and reports. The
  // highlight spans the full width whatever the depth.
  row: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    height: "26px",
    padding: "0 8px 0 4px",
    borderRadius: radii.button,
    outline: "none",
  },
  // A manager's row opens and closes their branch.
  rowManager: {
    cursor: "pointer",
    backgroundColor: {
      default: null,
      ":hover": colors.bgQuaternary,
      ":focus-visible": colors.bgQuaternary,
    },
  },
  // You, like the open file.
  rowMe: {
    backgroundColor: colors.bgTertiary,
  },
  // The guides, in 24px cells with no gap, then the avatar. Guides run the row's full height so lines join row to row.
  indent: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    alignSelf: "stretch",
  },
  guide: {
    position: "relative",
    alignSelf: "stretch",
    width: "24px",
  },
  rail: {
    "::before": RAIL,
  },
  tee: {
    "::before": RAIL,
    "::after": ARM,
  },
  elbow: {
    "::before": { ...RAIL, bottom: "auto", height: "50%" },
    "::after": ARM,
  },
  name: {
    display: "flex",
    flex: 1,
    gap: "6px",
    alignItems: "baseline",
    minWidth: 0,
    overflow: "hidden",
    color: colors.textPrimary,
    whiteSpace: "nowrap",
  },
  // Outside your chain, names step back a little.
  nameOutsideChain: {
    color: colors.textSecondary,
  },
  nameMe: {
    fontWeight: 600,
  },
  you: {
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    fontWeight: 400,
  },
  details: {
    flexShrink: 0,
    width: "72px",
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    whiteSpace: "nowrap",
  },
  count: {
    flexShrink: 0,
    width: "64px",
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  // The stand-in top node, sized like an avatar.
  rootMarker: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    borderRadius: radii.control,
    color: colors.textTertiary,
    backgroundColor: colors.bgTertiary,
  },
});

// Each guide's lines: a rail for a level still running, nothing for one that's ended, a tee or an elbow beside a row.
const guideKinds = {
  rail: styles.rail,
  blank: null,
  tee: styles.tee,
  elbow: styles.elbow,
};

// Direct reports, or how many are folded away when the branch is closed.
function reportLabel(node: OrgNode, collapsed: boolean): string {
  const direct = node.reports.length;
  if (direct === 0) return "";
  if (collapsed) return `+${countUnder(node)}`;
  return `${direct} ${direct === 1 ? "report" : "reports"}`;
}

// Where a row sits in the tree, for its indent guides: for each level above it, whether that level's line carries
// on past it, and whether it's the last of its manager's reports. Rows at the top have none.
type Indent = { rails: boolean[]; last: boolean } | undefined;

// The indent, as in neo-tree: a rail for every level still running, then a tee (or an elbow on the last report),
// then the avatar. Each cell's line sits under where an avatar's middle would be, so a manager's avatar sits right
// above their reports' tees.
function Guides(props: { indent: Indent; children: JSX.Element }): JSX.Element {
  return (
    <span class={sx(styles.indent)}>
      <For each={props.indent?.rails ?? []}>
        {(rail) => (
          <span class={sx(styles.guide, guideKinds[rail ? "rail" : "blank"])} aria-hidden="true" />
        )}
      </For>
      <Show when={props.indent}>
        {(indent) => (
          <span
            class={sx(styles.guide, guideKinds[indent().last ? "elbow" : "tee"])}
            aria-hidden="true"
          />
        )}
      </Show>
      {props.children}
    </span>
  );
}

// The indent for a node's reports: its own line carries on below it unless it was the last report.
function reportIndent(indent: Indent, index: number, count: number): Indent {
  const rails = indent ? [...indent.rails, !indent.last] : [];
  return { rails, last: index === count - 1 };
}

function OrgBranch(props: {
  node: OrgNode;
  // You and the managers above you; their names stay bright and their teams start open.
  chain: Set<string>;
  indent: Indent;
}): JSX.Element {
  const app = useApp();
  const [collapsed, setCollapsed] = createSignal(
    untrack(() => !props.chain.has(props.node.person.id)),
  );
  const person = (): Person => props.node.person;
  const isMe = (): boolean => person().id === app.me().id;
  const inChain = (): boolean => props.chain.has(person().id);
  const isManager = (): boolean => props.node.reports.length > 0;
  const toggle = (): void => {
    setCollapsed((value) => !value);
  };

  return (
    <li
      role="treeitem"
      aria-selected={`${isMe()}`}
      aria-expanded={isManager() ? `${!collapsed()}` : undefined}
    >
      {/* A manager's row opens and closes their branch. */}
      <div
        class={sx(styles.row, isManager() && styles.rowManager, isMe() && styles.rowMe)}
        role={isManager() ? "button" : undefined}
        tabindex={isManager() ? 0 : undefined}
        onClick={() => {
          if (isManager()) toggle();
        }}
        onKeyDown={(event) => {
          if (isManager() && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <Guides indent={props.indent}>
          <Identicon seed={person().id} size={16} />
        </Guides>
        <span
          class={sx(styles.name, !inChain() && styles.nameOutsideChain, isMe() && styles.nameMe)}
        >
          {isMe() ? (
            person().name
          ) : (
            // Their name opens their profile; the rest of a manager's row opens and closes their branch.
            <button
              type="button"
              class={sx(link.person, link.personTruncate)}
              onClick={(event) => {
                event.stopPropagation();
                app.nav.openPerson(person().id);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {person().name}
            </button>
          )}
          {/* The sample team already calls you "You". */}
          <Show when={isMe() && person().name !== "You"}>
            <span class={sx(styles.you)}>you</span>
          </Show>
        </span>
        <span class={sx(styles.details)}>{orgDetails(person())}</span>
        <span class={sx(styles.count)}>{reportLabel(props.node, collapsed())}</span>
      </div>
      <Show when={isManager() && !collapsed()}>
        <ul class={sx(styles.reports)} role="group">
          <For each={props.node.reports}>
            {(report, index) => (
              <OrgBranch
                node={report}
                chain={props.chain}
                indent={reportIndent(props.indent, index(), props.node.reports.length)}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

// You, then where you sit in the org: who you are and what's assigned to you, and below, the org tree laid out like a
// file tree (neo-tree), with your branch open and your row marked.
export function ProfileView(): JSX.Element {
  const app = useApp();
  const me = (): Person => app.me();
  const people = (): Person[] => app.data.people();
  const organizationName = (): string => app.data.organization()?.name ?? "";
  const tree = createMemo(() => buildOrgTree(people()));
  const managers = createMemo(() => chainAbove(people(), me().id));
  const chain = createMemo(() => new Set([me().id, ...managers().map((person) => person.id)]));
  const summary = (): string => {
    const count = `${people().length} ${people().length === 1 ? "person" : "people"}`;
    const hasReportingLines = tree().some((node) => node.reports.length > 0);
    return hasReportingLines ? count : `${count} · No reporting lines set yet`;
  };
  const reports = createMemo(() => people().filter((person) => person.managerId === me().id));
  const waiting = createMemo(() =>
    app.data
      .threads()
      .filter((thread) => !isDone(thread.status) && assignedIds(thread).includes(me().id)),
  );
  const overdue = createMemo(() =>
    waiting().filter((thread) => thread.dueAtMs !== null && thread.dueAtMs < app.now()),
  );

  return (
    <div class={sx(profile.page)}>
      <header class={sx(profile.header)}>
        <Identicon seed={me().id} size={40} />
        <div>
          <h1 class={sx(page.title)}>{me().name}</h1>
          <Show when={orgDetails(me()) !== ""}>
            <p class={sx(page.summary)}>{orgDetails(me())}</p>
          </Show>
        </div>
      </header>

      <dl class={sx(page.facts)}>
        <dt class={sx(page.factsTerm)}>Manager</dt>
        <dd class={sx(page.factsValue)}>{managers()[0]?.name ?? "Nobody"}</dd>
        <dt class={sx(page.factsTerm)}>Reports</dt>
        <dd class={sx(page.factsValue)}>
          {reports().length === 0
            ? "None"
            : reports()
                .map((person) => person.name)
                .join(", ")}
        </dd>
        <dt class={sx(page.factsTerm)}>Inbox</dt>
        <dd class={sx(page.factsValue)}>
          {waiting().length} assigned to you
          {overdue().length > 0 && ` · ${overdue().length} overdue`}
        </dd>
        <dt class={sx(page.factsTerm)}>Buckets</dt>
        <dd class={sx(page.factsValue)}>
          {bucketsOf(me())
            .map((bucket) => bucket.name)
            .join(", ")}
        </dd>
      </dl>

      <h2 class={sx(page.heading)}>{organizationName() || "Organization"}</h2>
      <p class={sx(page.summary)}>
        {summary()}
        {/* Not until the server has an organization to rename, because it hasn't been updated yet. */}
        <Show when={app.data.organization() !== undefined}>
          {" · "}
          <button
            type="button"
            class={sx(profile.textButton)}
            onClick={() => app.ui.setRenamingOrganization(true)}
          >
            Rename
          </button>
        </Show>
      </p>
      <ul class={sx(styles.tree)} role="tree" aria-label="Organization">
        <Show
          when={tree().length > 1}
          fallback={
            <For each={tree()}>
              {(node) => <OrgBranch node={node} chain={chain()} indent={undefined} />}
            </For>
          }
        >
          {/* Several people with no manager: the org itself is the one node they hang from. */}
          <li role="treeitem" aria-expanded="true">
            <div class={sx(styles.row)}>
              <Guides indent={undefined}>
                <span class={sx(styles.rootMarker)} aria-hidden="true">
                  <Icon icon={Building03Icon} size={12} />
                </span>
              </Guides>
              <span class={sx(styles.name)}>{organizationName() || "Organization"}</span>
              <span class={sx(styles.details)} />
              <span class={sx(styles.count)}>{`${tree().length} at the top`}</span>
            </div>
            <ul class={sx(styles.reports)} role="group">
              <For each={tree()}>
                {(node, index) => (
                  <OrgBranch
                    node={node}
                    chain={chain()}
                    indent={reportIndent(undefined, index(), tree().length)}
                  />
                )}
              </For>
            </ul>
          </li>
        </Show>
      </ul>
    </div>
  );
}
