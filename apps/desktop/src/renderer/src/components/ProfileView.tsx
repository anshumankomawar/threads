import { Building03Icon } from "@hugeicons/core-free-icons";
import { assignedIds, bucketsOf, isDone, type Person, type Thread } from "model";
import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { buildOrgTree, chainAbove, countUnder, orgDetails, type OrgNode } from "../org";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

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
    <span class="org-indent">
      <For each={props.indent?.rails ?? []}>
        {(rail) => (
          <span class="org-guide" data-kind={rail ? "rail" : "blank"} aria-hidden="true" />
        )}
      </For>
      <Show when={props.indent}>
        {(indent) => (
          <span class="org-guide" data-kind={indent().last ? "elbow" : "tee"} aria-hidden="true" />
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
  me: Person;
  // You and the managers above you; their names stay bright and their teams start open.
  chain: Set<string>;
  indent: Indent;
  onOpenPerson: (id: string) => void;
}): JSX.Element {
  const [collapsed, setCollapsed] = createSignal(
    untrack(() => !props.chain.has(props.node.person.id)),
  );
  const person = (): Person => props.node.person;
  const isMe = (): boolean => person().id === props.me.id;
  const isManager = (): boolean => props.node.reports.length > 0;
  const toggle = (): void => {
    setCollapsed((value) => !value);
  };

  return (
    <li
      class="org-branch"
      role="treeitem"
      aria-selected={`${isMe()}`}
      aria-expanded={isManager() ? `${!collapsed()}` : undefined}
    >
      {/* A manager's row opens and closes their branch. */}
      <div
        class="org-row"
        data-me={String(isMe())}
        data-chain={String(props.chain.has(person().id))}
        data-manager={String(isManager())}
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
        <span class="org-name">
          {isMe() ? (
            person().name
          ) : (
            // Their name opens their profile; the rest of a manager's row opens and closes their branch.
            <button
              type="button"
              class="person-link"
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenPerson(person().id);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {person().name}
            </button>
          )}
          {/* The sample team already calls you "You". */}
          <Show when={isMe() && person().name !== "You"}>
            <span class="org-you">you</span>
          </Show>
        </span>
        <span class="org-details">{orgDetails(person())}</span>
        <span class="org-count">{reportLabel(props.node, collapsed())}</span>
      </div>
      <Show when={isManager() && !collapsed()}>
        <ul class="org-reports" role="group">
          <For each={props.node.reports}>
            {(report, index) => (
              <OrgBranch
                node={report}
                me={props.me}
                chain={props.chain}
                indent={reportIndent(props.indent, index(), props.node.reports.length)}
                onOpenPerson={props.onOpenPerson}
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
export function ProfileView(props: {
  people: Person[];
  me: Person;
  threads: Thread[];
  nowMs: number;
  organizationName: string;
  // Null when the server doesn't have an organization to rename, because it hasn't been updated yet.
  onRenameOrganization: (() => void) | null;
  onOpenPerson: (id: string) => void;
}): JSX.Element {
  const tree = createMemo(() => buildOrgTree(props.people));
  const managers = createMemo(() => chainAbove(props.people, props.me.id));
  const chain = createMemo(() => new Set([props.me.id, ...managers().map((person) => person.id)]));
  const summary = (): string => {
    const count = `${props.people.length} ${props.people.length === 1 ? "person" : "people"}`;
    const hasReportingLines = tree().some((node) => node.reports.length > 0);
    return hasReportingLines ? count : `${count} · No reporting lines set yet`;
  };
  const reports = createMemo(() =>
    props.people.filter((person) => person.managerId === props.me.id),
  );
  const waiting = createMemo(() =>
    props.threads.filter(
      (thread) => !isDone(thread.status) && assignedIds(thread).includes(props.me.id),
    ),
  );
  const overdue = createMemo(() =>
    waiting().filter((thread) => thread.dueAtMs !== null && thread.dueAtMs < props.nowMs),
  );

  return (
    <div class="org">
      <header class="profile">
        <Identicon seed={props.me.id} size={40} />
        <div>
          <h1 class="org-title">{props.me.name}</h1>
          <Show when={orgDetails(props.me) !== ""}>
            <p class="org-summary">{orgDetails(props.me)}</p>
          </Show>
        </div>
      </header>

      <dl class="profile-facts">
        <dt>Manager</dt>
        <dd>{managers()[0]?.name ?? "Nobody"}</dd>
        <dt>Reports</dt>
        <dd>
          {reports().length === 0
            ? "None"
            : reports()
                .map((person) => person.name)
                .join(", ")}
        </dd>
        <dt>Inbox</dt>
        <dd>
          {waiting().length} assigned to you
          {overdue().length > 0 && ` · ${overdue().length} overdue`}
        </dd>
        <dt>Buckets</dt>
        <dd>
          {bucketsOf(props.me)
            .map((bucket) => bucket.name)
            .join(", ")}
        </dd>
      </dl>

      <h2 class="profile-heading">{props.organizationName || "Organization"}</h2>
      <p class="org-summary">
        {summary()}
        <Show when={props.onRenameOrganization}>
          {(rename) => (
            <>
              {" · "}
              <button type="button" class="org-rename" onClick={() => rename()()}>
                Rename
              </button>
            </>
          )}
        </Show>
      </p>
      <ul class="org-tree" role="tree" aria-label="Organization">
        <Show
          when={tree().length > 1}
          fallback={
            <For each={tree()}>
              {(node) => (
                <OrgBranch
                  node={node}
                  me={props.me}
                  chain={chain()}
                  indent={undefined}
                  onOpenPerson={props.onOpenPerson}
                />
              )}
            </For>
          }
        >
          {/* Several people with no manager: the org itself is the one node they hang from. */}
          <li class="org-branch" role="treeitem" aria-expanded="true">
            <div class="org-row" data-chain="true">
              <Guides indent={undefined}>
                <span class="org-root-marker" aria-hidden="true">
                  <Icon icon={Building03Icon} size={12} />
                </span>
              </Guides>
              <span class="org-name">{props.organizationName || "Organization"}</span>
              <span class="org-details" />
              <span class="org-count">{`${tree().length} at the top`}</span>
            </div>
            <ul class="org-reports" role="group">
              <For each={tree()}>
                {(node, index) => (
                  <OrgBranch
                    node={node}
                    me={props.me}
                    chain={chain()}
                    indent={reportIndent(undefined, index(), tree().length)}
                    onOpenPerson={props.onOpenPerson}
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
