import { Building2 } from "lucide-react";
import type { Person } from "model";
import { useState } from "react";
import { buildOrgTree, chainAbove, countUnder, type OrgNode } from "../org";
import { Identicon } from "./Identicon";

// "L4 · PM", or nothing for people without org details.
function orgDetails(person: Person): string {
  return [person.level, person.role]
    .filter((detail): detail is string => detail !== undefined)
    .map((detail) => detail.toUpperCase())
    .join(" · ");
}

// Direct reports, or how many are folded away when the branch is closed.
function reportLabel(node: OrgNode, collapsed: boolean): string {
  const direct = node.reports.length;
  if (direct === 0) return "";
  if (collapsed) return `+${countUnder(node)}`;
  return `${direct} ${direct === 1 ? "report" : "reports"}`;
}

function OrgBranch({
  node,
  me,
  chain,
}: {
  node: OrgNode;
  me: Person;
  // You and the managers above you; their names stay bright.
  chain: Set<string>;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
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
        <Identicon seed={person.id} size={18} />
        <span className="org-name">
          {person.name}
          {/* The sample team already calls you "You". */}
          {isMe && person.name !== "You" && <span className="org-you">you</span>}
        </span>
        <span className="org-details">{orgDetails(person)}</span>
        <span className="org-count">{reportLabel(node, collapsed)}</span>
      </div>
      {isManager && !collapsed && (
        <ul className="org-reports" role="group">
          {reports.map((report) => (
            <OrgBranch key={report.person.id} node={report} me={me} chain={chain} />
          ))}
        </ul>
      )}
    </li>
  );
}

// Who reports to whom, in the current workspace: an outline from one top node, with guide lines and aligned
// columns for level and reports.
export function OrgView({ people, me }: { people: Person[]; me: Person }): React.JSX.Element {
  const tree = buildOrgTree(people);
  const managers = chainAbove(people, me.id);
  const chain = new Set([me.id, ...managers.map((person) => person.id)]);
  const count = `${people.length} ${people.length === 1 ? "person" : "people"}`;
  const hasReportingLines = tree.some((node) => node.reports.length > 0);
  const summary = !hasReportingLines
    ? `${count} · No reporting lines set yet`
    : managers.length === 0
      ? count
      : `${count} · You report to ${managers[0].name}`;

  return (
    <div className="org">
      <h1 className="org-title">Organization</h1>
      <p className="org-summary">{summary}</p>
      <ul className="org-tree" role="tree" aria-label="Organization">
        {tree.length > 1 ? (
          // Several people with no manager: the org itself is the one node they hang from.
          <li className="org-branch" role="treeitem" aria-expanded>
            <div className="org-row" data-chain>
              <span className="org-root-marker" aria-hidden>
                <Building2 size={12} strokeWidth={1.8} />
              </span>
              <span className="org-name">Organization</span>
              <span className="org-details" />
              <span className="org-count">{`${tree.length} at the top`}</span>
            </div>
            <ul className="org-reports" role="group">
              {tree.map((node) => (
                <OrgBranch key={node.person.id} node={node} me={me} chain={chain} />
              ))}
            </ul>
          </li>
        ) : (
          tree.map((node) => <OrgBranch key={node.person.id} node={node} me={me} chain={chain} />)
        )}
      </ul>
    </div>
  );
}
