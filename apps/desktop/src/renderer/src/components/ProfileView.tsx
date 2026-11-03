import { HugeiconsIcon } from "@hugeicons/react";
import { Building03Icon } from "@hugeicons/core-free-icons";
import { bucketsOf, isDone, waitingOn, type Person, type Thread } from "model";
import { useState } from "react";
import { buildOrgTree, chainAbove, countUnder, orgDetails, type OrgNode } from "../org";
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
function Guides({
  indent,
  children,
}: {
  indent: Indent;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="org-indent">
      {indent?.rails.map((rail, level) => (
        <span key={level} className="org-guide" data-kind={rail ? "rail" : "blank"} aria-hidden />
      ))}
      {indent && (
        <span className="org-guide" data-kind={indent.last ? "elbow" : "tee"} aria-hidden />
      )}
      {children}
    </span>
  );
}

// The indent for a node's reports: its own line carries on below it unless it was the last report.
function reportIndent(indent: Indent, index: number, count: number): Indent {
  const rails = indent ? [...indent.rails, !indent.last] : [];
  return { rails, last: index === count - 1 };
}

function OrgBranch({
  node,
  me,
  chain,
  indent,
  onOpenPerson,
}: {
  node: OrgNode;
  me: Person;
  // You and the managers above you; their names stay bright and their teams start open.
  chain: Set<string>;
  indent: Indent;
  onOpenPerson: (id: string) => void;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(!chain.has(node.person.id));
  const { person, reports } = node;
  const isMe = person.id === me.id;
  const isManager = reports.length > 0;
  const toggle = (): void => setCollapsed((value) => !value);

  return (
    <li
      className="org-branch"
      role="treeitem"
      aria-selected={isMe}
      aria-expanded={isManager ? !collapsed : undefined}
    >
      {/* A manager's row opens and closes their branch. */}
      <div
        className="org-row"
        data-me={isMe}
        data-chain={chain.has(person.id)}
        data-manager={isManager}
        role={isManager ? "button" : undefined}
        tabIndex={isManager ? 0 : undefined}
        onClick={isManager ? toggle : undefined}
        onKeyDown={(event) => {
          if (isManager && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <Guides indent={indent}>
          <Identicon seed={person.id} size={16} />
        </Guides>
        <span className="org-name">
          {isMe ? (
            person.name
          ) : (
            // Their name opens their profile; the rest of a manager's row opens and closes their branch.
            <button
              type="button"
              className="person-link"
              onClick={(event) => {
                event.stopPropagation();
                onOpenPerson(person.id);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {person.name}
            </button>
          )}
          {/* The sample team already calls you "You". */}
          {isMe && person.name !== "You" && <span className="org-you">you</span>}
        </span>
        <span className="org-details">{orgDetails(person)}</span>
        <span className="org-count">{reportLabel(node, collapsed)}</span>
      </div>
      {isManager && !collapsed && (
        <ul className="org-reports" role="group">
          {reports.map((report, index) => (
            <OrgBranch
              key={report.person.id}
              node={report}
              me={me}
              chain={chain}
              indent={reportIndent(indent, index, reports.length)}
              onOpenPerson={onOpenPerson}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// You, then where you sit in the org: who you are and what's waiting on you, and below, the org tree laid out like a
// file tree (neo-tree), with your branch open and your row marked.
export function ProfileView({
  people,
  me,
  threads,
  nowMs,
  organizationName,
  onRenameOrganization,
  onOpenPerson,
}: {
  people: Person[];
  me: Person;
  threads: Thread[];
  nowMs: number;
  organizationName: string;
  // Null when the server doesn't have an organization to rename, because it hasn't been updated yet.
  onRenameOrganization: (() => void) | null;
  onOpenPerson: (id: string) => void;
}): React.JSX.Element {
  const tree = buildOrgTree(people);
  const managers = chainAbove(people, me.id);
  const chain = new Set([me.id, ...managers.map((person) => person.id)]);
  const count = `${people.length} ${people.length === 1 ? "person" : "people"}`;
  const hasReportingLines = tree.some((node) => node.reports.length > 0);
  const summary = hasReportingLines ? count : `${count} · No reporting lines set yet`;
  const reports = people.filter((person) => person.managerId === me.id);
  const waiting = threads.filter((thread) => !isDone(thread.status) && waitingOn(thread) === me.id);
  const overdue = waiting.filter((thread) => thread.dueAtMs !== null && thread.dueAtMs < nowMs);
  const buckets = bucketsOf(me);

  return (
    <div className="org">
      <header className="profile">
        <Identicon seed={me.id} size={40} />
        <div>
          <h1 className="org-title">{me.name}</h1>
          {orgDetails(me) !== "" && <p className="org-summary">{orgDetails(me)}</p>}
        </div>
      </header>

      <dl className="profile-facts">
        <dt>Manager</dt>
        <dd>{managers[0]?.name ?? "Nobody"}</dd>
        <dt>Reports</dt>
        <dd>{reports.length === 0 ? "None" : reports.map((person) => person.name).join(", ")}</dd>
        <dt>Inbox</dt>
        <dd>
          {waiting.length} waiting on you
          {overdue.length > 0 && ` · ${overdue.length} overdue`}
        </dd>
        <dt>Buckets</dt>
        <dd>{buckets.map((bucket) => bucket.name).join(", ")}</dd>
      </dl>

      <h2 className="profile-heading">{organizationName || "Organization"}</h2>
      <p className="org-summary">
        {summary}
        {onRenameOrganization !== null && (
          <>
            {" · "}
            <button type="button" className="org-rename" onClick={onRenameOrganization}>
              Rename
            </button>
          </>
        )}
      </p>
      <ul className="org-tree" role="tree" aria-label="Organization">
        {tree.length > 1 ? (
          // Several people with no manager: the org itself is the one node they hang from.
          <li className="org-branch" role="treeitem" aria-expanded>
            <div className="org-row" data-chain>
              <Guides indent={undefined}>
                <span className="org-root-marker" aria-hidden>
                  <HugeiconsIcon icon={Building03Icon} size={12} />
                </span>
              </Guides>
              <span className="org-name">{organizationName || "Organization"}</span>
              <span className="org-details" />
              <span className="org-count">{`${tree.length} at the top`}</span>
            </div>
            <ul className="org-reports" role="group">
              {tree.map((node, index) => (
                <OrgBranch
                  key={node.person.id}
                  node={node}
                  me={me}
                  chain={chain}
                  indent={reportIndent(undefined, index, tree.length)}
                  onOpenPerson={onOpenPerson}
                />
              ))}
            </ul>
          </li>
        ) : (
          tree.map((node) => (
            <OrgBranch
              key={node.person.id}
              node={node}
              me={me}
              chain={chain}
              indent={undefined}
              onOpenPerson={onOpenPerson}
            />
          ))
        )}
      </ul>
    </div>
  );
}
