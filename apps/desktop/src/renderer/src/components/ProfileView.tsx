import { HugeiconsIcon } from "@hugeicons/react";
import { Building03Icon } from "@hugeicons/core-free-icons";
import {
  isDone,
  WORKING_HOURS,
  waitingOn,
  workdayOf,
  type Person,
  type Thread,
  type Workday,
} from "model";
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
}: {
  node: OrgNode;
  me: Person;
  // You and the managers above you; their names stay bright and their teams start open.
  chain: Set<string>;
  indent: Indent;
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
          {person.name}
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// A clock time, always with minutes ("9:00 AM", "4:30 PM"). In a menu, single-digit hours lead with a figure space
// (as wide as a digit) so the times line up.
function hourLabel(hour: number, minute = 0, aligned = false): string {
  const suffix = hour % 24 < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const label = `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`;
  return aligned && twelve < 10 ? `\u2007${label}` : label;
}

// How long someone is booked for in the working week (from Monday, or next Monday at the weekend): their work, their
// meetings and their focus time, in hours.
function weekLoad(
  threads: Thread[],
  me: Person,
  nowMs: number,
): { work: number; meetings: number; focus: number } {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const weekday = start.getDay();
  start.setDate(start.getDate() + (weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday));
  const end = start.getTime() + 5 * 24 * 60 * 60_000;
  const hours = (blocks: { startMs: number; endMs: number }[]): number =>
    blocks
      .filter((block) => block.startMs >= start.getTime() && block.startMs < end)
      .reduce((sum, block) => sum + (block.endMs - block.startMs) / 3_600_000, 0);
  const load = { work: 0, meetings: 0, focus: 0 };
  for (const thread of threads) {
    if (isDone(thread.status)) continue;
    if (thread.kind === "response" && waitingOn(thread) === me.id)
      load.work += hours(thread.blocks);
    if (thread.kind === "meeting" && thread.attendees.some((person) => person.id === me.id))
      load.meetings += hours(thread.blocks);
    if (thread.kind === "focus" && thread.requester.id === me.id)
      load.focus += hours(thread.blocks);
  }
  return load;
}

const hoursLabel = (hours: number): string => `${Math.round(hours * 10) / 10}h`;

// Every hour of the day, for the working hours pickers.
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

// Your working day, edited in place and saved as you change it: the hours your schedule is laid out in, and the half
// hours inside them kept free for questions.
function WorkdaySettings({
  me,
  onChange,
}: {
  me: Person;
  onChange: (workday: Workday) => void;
}): React.JSX.Element {
  const workday = workdayOf(me);
  // Hours change the catch-up times with them: any that fall outside are dropped.
  const setHours = (startHour: number, endHour: number): void =>
    onChange({
      startHour,
      endHour,
      catchUp: workday.catchUp.filter(({ hour }) => hour >= startHour && hour < endHour),
    });
  const free = HOURS.slice(workday.startHour, workday.endHour)
    .flatMap((hour) => [
      { hour, minute: 0 },
      { hour, minute: 30 },
    ])
    .filter(
      (time) =>
        !workday.catchUp.some((taken) => taken.hour === time.hour && taken.minute === time.minute),
    );
  const sorted = [...workday.catchUp].sort(
    (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute),
  );
  return (
    <>
      <div className="profile-setting">
        <span className="profile-setting-label">Working hours</span>
        <span className="profile-setting-control">
          Weekdays,
          <select
            className="profile-select"
            aria-label="Start of the working day"
            value={workday.startHour}
            onChange={(event) => setHours(Number(event.target.value), workday.endHour)}
          >
            {HOURS.slice(0, workday.endHour).map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour, 0, true)}
              </option>
            ))}
          </select>
          to
          <select
            className="profile-select"
            aria-label="End of the working day"
            value={workday.endHour}
            onChange={(event) => setHours(workday.startHour, Number(event.target.value))}
          >
            {HOURS.slice(workday.startHour + 1).map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour, 0, true)}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="profile-setting">
        <span className="profile-setting-label">Catch-up</span>
        <span className="profile-setting-control">
          {sorted.map((time) => (
            <span key={`${time.hour}:${time.minute}`} className="profile-chip">
              {hourLabel(time.hour, time.minute)}
              <button
                type="button"
                className="profile-chip-remove"
                aria-label={`Remove ${hourLabel(time.hour, time.minute)}`}
                onClick={() =>
                  onChange({
                    ...workday,
                    catchUp: workday.catchUp.filter((taken) => taken !== time),
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
          {workday.catchUp.length < 4 && free.length > 0 && (
            <select
              className="profile-select profile-select-add"
              aria-label="Add a catch-up time"
              value=""
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(":").map(Number);
                onChange({ ...workday, catchUp: [...workday.catchUp, { hour, minute }] });
              }}
            >
              <option value="" disabled>
                Add…
              </option>
              {free.map(({ hour, minute }) => (
                <option key={`${hour}:${minute}`} value={`${hour}:${minute}`}>
                  {hourLabel(hour, minute, true)}
                </option>
              ))}
            </select>
          )}
        </span>
      </div>
      <p className="profile-hint">
        Your schedule is laid out in these hours. Catch-up half hours stay free for answering
        questions, and a question counts as late once the next one has passed.
        {me.workday !== undefined && (
          <>
            {" "}
            <button
              type="button"
              className="profile-link"
              onClick={() => onChange(workdayOf(undefined))}
            >
              Use the org's hours
            </button>
          </>
        )}
      </p>
    </>
  );
}

// You, then where you sit in the org: who you are and how your week looks, your working day (saved to your profile,
// so the scheduler and everyone asking you questions go by it), and below, the org tree laid out like a file tree (neo-tree), with your branch open and your row marked.
export function ProfileView({
  people,
  me,
  threads,
  nowMs,
  organizationName,
  onWorkday,
  onRenameOrganization,
}: {
  people: Person[];
  me: Person;
  threads: Thread[];
  nowMs: number;
  organizationName: string;
  onWorkday: (workday: Workday) => void;
  onRenameOrganization: () => void;
}): React.JSX.Element {
  const tree = buildOrgTree(people);
  const managers = chainAbove(people, me.id);
  const chain = new Set([me.id, ...managers.map((person) => person.id)]);
  const count = `${people.length} ${people.length === 1 ? "person" : "people"}`;
  const hasReportingLines = tree.some((node) => node.reports.length > 0);
  const summary = hasReportingLines ? count : `${count} · No reporting lines set yet`;
  const reports = people.filter((person) => person.managerId === me.id);
  const load = weekLoad(threads, me, nowMs);
  const timeZone =
    new Intl.DateTimeFormat(undefined, { timeZone: WORKING_HOURS.timeZone, timeZoneName: "long" })
      .formatToParts(nowMs)
      .find((part) => part.type === "timeZoneName")?.value ?? WORKING_HOURS.timeZone;

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
        <dt>Time zone</dt>
        <dd>{timeZone}</dd>
        <dt>This week</dt>
        <dd>
          {hoursLabel(load.work)} of work · {hoursLabel(load.meetings)} of meetings ·{" "}
          {hoursLabel(load.focus)} of focus
        </dd>
      </dl>

      <h2 className="profile-heading">Working day</h2>
      <WorkdaySettings me={me} onChange={onWorkday} />

      <h2 className="profile-heading">{organizationName || "Organization"}</h2>
      <p className="org-summary">
        {summary}
        {" · "}
        <button type="button" className="org-rename" onClick={onRenameOrganization}>
          Rename
        </button>
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
                />
              ))}
            </ul>
          </li>
        ) : (
          tree.map((node) => (
            <OrgBranch key={node.person.id} node={node} me={me} chain={chain} indent={undefined} />
          ))
        )}
      </ul>
    </div>
  );
}
