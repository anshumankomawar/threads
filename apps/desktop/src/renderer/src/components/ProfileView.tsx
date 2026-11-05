import { assignedIds, bucketsOf, isDone } from "model";
import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { useApp } from "../app/state";
import { buildOrgTree, chainAbove, countUnder, orgDetails, type OrgNode } from "../org";
import { link } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors, radii } from "../styles/tokens.stylex";
import { Identicon } from "./Identicon";
import { Fact, PersonHeader } from "./ThreadItems";

// Indent guides, in 24px cells: a line down under the avatar of the manager above, and a tee's arm across.
const LINE = { position: "absolute", backgroundColor: colors.strokeFocused } as const;
const RAIL = { ...LINE, content: '""', top: 0, bottom: 0, left: "7.5px", width: 1 } as const;
const ARM = { ...LINE, content: '""', top: "50%", right: 4, left: "7.5px", height: 1 } as const;
const styles = stylex.create({
  tree: { maxWidth: 560, margin: "20px 0 0 -6px" },
  row: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 26,
    padding: "0 8px 0 4px",
    borderRadius: radii.button,
    outline: "none",
  },
  manager: {
    cursor: "pointer",
    backgroundColor: {
      default: null,
      ":hover": colors.bgQuaternary,
      ":focus-visible": colors.bgQuaternary,
    },
  },
  me: { backgroundColor: colors.bgTertiary },
  indent: { display: "flex", flexShrink: 0, alignItems: "center", alignSelf: "stretch" },
  guide: { position: "relative", alignSelf: "stretch", width: 24 },
  rail: { "::before": RAIL },
  blank: {},
  tee: { "::before": RAIL, "::after": ARM },
  elbow: { "::before": { ...RAIL, bottom: "auto", height: "50%" }, "::after": ARM },
  name: { display: "flex", flex: 1, gap: 6, alignItems: "baseline", minWidth: 0 },
  nameLook: { overflow: "hidden", color: colors.textPrimary, whiteSpace: "nowrap" },
  outside: { color: colors.textSecondary },
  bold: { fontWeight: 600 },
  you: { fontWeight: 400 },
  column: { flexShrink: 0, width: 72, whiteSpace: "nowrap" },
  count: { width: 64, textAlign: "right" },
});

type Guide = "rail" | "blank" | "tee" | "elbow";

// A row as in a file tree (neo-tree): guides, avatar and name, level, reports. You and your managers start open.
function OrgBranch(props: { node: OrgNode; chain: Set<string>; guides: Guide[] }): JSX.Element {
  const app = useApp();
  const person = () => props.node.person;
  const [collapsed, setCollapsed] = createSignal(untrack(() => !props.chain.has(person().id)));
  const isMe = (): boolean => person().id === app.me().id;
  const reports = (): OrgNode[] => props.node.reports;
  const manager = (): boolean => reports().length > 0;
  const toggle = (): void => {
    if (manager()) setCollapsed((value) => !value);
  };
  const count = (): string =>
    !manager()
      ? ""
      : collapsed()
        ? `+${countUnder(props.node)}`
        : `${reports().length} report${reports().length === 1 ? "" : "s"}`;

  return (
    <li
      role="treeitem"
      aria-selected={`${isMe()}`}
      aria-expanded={manager() ? `${!collapsed()}` : undefined}
    >
      <div
        class={sx(styles.row, manager() && styles.manager, isMe() && styles.me)}
        role={manager() ? "button" : undefined}
        tabindex={manager() ? 0 : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <span class={sx(styles.indent)} aria-hidden="true">
          <For each={props.guides}>
            {(guide) => <span class={sx(styles.guide, styles[guide])} />}
          </For>
          <Identicon seed={person().id} size={16} />
        </span>
        <span
          class={sx(
            styles.name,
            !props.chain.has(person().id) && styles.outside,
            isMe() && styles.bold,
          )}
        >
          <Show
            when={!isMe()}
            fallback={
              <>
                {person().name}
                {/* The sample team already calls you "You". */}
                <Show when={person().name !== "You"}>
                  <span class={sx(page.small, styles.you)}>you</span>
                </Show>
              </>
            }
          >
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
          </Show>
        </span>
        <span class={sx(page.small, styles.column)}>{orgDetails(person())}</span>
        <span class={sx(page.small, styles.column, styles.count)}>{count()}</span>
      </div>
      <Show when={manager() && !collapsed()}>
        <ul class={sx(page.list)} role="group">
          <For each={reports()}>
            {(report, index) => (
              <OrgBranch
                node={report}
                chain={props.chain}
                guides={[
                  // A level's line runs on below its row unless the row was its manager's last report.
                  ...props.guides.map((guide) =>
                    guide === "tee" ? "rail" : guide === "elbow" ? "blank" : guide,
                  ),
                  index() === reports().length - 1 ? "elbow" : "tee",
                ]}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

// You, then the org as a file tree with your branch open and your row marked.
export function ProfileView(): JSX.Element {
  const app = useApp();
  const me = () => app.me();
  const people = () => app.data.people();
  const tree = createMemo(() => buildOrgTree(people()));
  const managers = createMemo(() => chainAbove(people(), me().id));
  const chain = createMemo(() => new Set([me().id, ...managers().map((manager) => manager.id)]));
  const reports = () => people().filter((person) => person.managerId === me().id);
  const waiting = () =>
    app.data
      .threads()
      .filter((thread) => !isDone(thread.status) && assignedIds(thread).includes(me().id));
  const overdue = () =>
    waiting().filter((thread) => thread.dueAtMs !== null && thread.dueAtMs < app.now()).length;

  return (
    <div class={sx(page.page, page.top)}>
      <PersonHeader person={me()} summary={orgDetails(me())} />
      <dl class={sx(page.facts)}>
        <Fact term="Manager">{managers()[0]?.name ?? "Nobody"}</Fact>
        <Fact term="Reports">
          {reports()
            .map((person) => person.name)
            .join(", ") || "None"}
        </Fact>
        <Fact term="Inbox">
          {waiting().length} assigned to you
          {overdue() > 0 && ` · ${overdue()} overdue`}
        </Fact>
        <Fact term="Buckets">
          {bucketsOf(me())
            .map((bucket) => bucket.name)
            .join(", ")}
        </Fact>
      </dl>
      <h2 class={sx(page.heading)}>People</h2>
      <p class={sx(page.summary)}>
        {people().length} {people().length === 1 ? "person" : "people"}
        {tree().every((node) => node.reports.length === 0) && " · No reporting lines set yet"}
      </p>
      <ul class={sx(page.list, styles.tree)} role="tree" aria-label="People">
        <For each={tree()}>{(node) => <OrgBranch node={node} chain={chain()} guides={[]} />}</For>
      </ul>
    </div>
  );
}
