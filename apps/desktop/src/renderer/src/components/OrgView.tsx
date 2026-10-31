import { ChevronDown } from "lucide-react";
import type { Person } from "model";
import { useState } from "react";
import { buildOrgTree, type OrgNode } from "../org";
import { Identicon } from "./Identicon";

// "L4 · PM", or nothing for people without org details.
function orgDetails(person: Person): string {
  return [person.level, person.role]
    .filter((detail): detail is string => detail !== undefined)
    .map((detail) => detail.toUpperCase())
    .join(" · ");
}

function OrgBranch({ node, me }: { node: OrgNode; me: Person }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const { person, reports } = node;
  const isMe = person.id === me.id;

  return (
    <li
      className="org-branch"
      role="treeitem"
      aria-selected={isMe}
      aria-expanded={reports.length > 0 ? !collapsed : undefined}
    >
      <div className="org-row" data-me={isMe}>
        {reports.length > 0 ? (
          <button
            type="button"
            className="org-toggle"
            data-collapsed={collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${person.name}`}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ChevronDown size={12} strokeWidth={1.8} aria-hidden />
          </button>
        ) : (
          <span className="org-toggle-spacer" />
        )}
        <Identicon seed={person.id} size={18} />
        <span className="org-name">{person.name}</span>
        {/* The sample team already calls you "You". */}
        {isMe && person.name !== "You" && <span className="org-you">You</span>}
        <span className="org-details">{orgDetails(person)}</span>
        {collapsed && <span className="org-hidden-count">{reports.length} hidden</span>}
      </div>
      {reports.length > 0 && !collapsed && (
        <ul className="org-reports" role="group">
          {reports.map((report) => (
            <OrgBranch key={report.person.id} node={report} me={me} />
          ))}
        </ul>
      )}
    </li>
  );
}

// Who reports to whom, in the current workspace.
export function OrgView({ people, me }: { people: Person[]; me: Person }): React.JSX.Element {
  const tree = buildOrgTree(people);
  const summary = `${people.length} ${people.length === 1 ? "person" : "people"}`;
  const hasReportingLines = tree.some((node) => node.reports.length > 0);

  return (
    <div className="org">
      <h1 className="org-title">Org</h1>
      <p className="org-summary">
        {hasReportingLines ? summary : `${summary} · No reporting lines set yet`}
      </p>
      <ul className="org-tree" role="tree" aria-label="Org">
        {tree.map((node) => (
          <OrgBranch key={node.person.id} node={node} me={me} />
        ))}
      </ul>
    </div>
  );
}
