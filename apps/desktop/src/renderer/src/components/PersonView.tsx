import { HugeiconsIcon } from "@hugeicons/react";
import { STATUS_LABELS, type Group, type Person, type Thread } from "model";
import { useState } from "react";
import { chainAbove, orgDetails } from "../org";
import { sharedGroups, sharedThreads } from "../profile";
import { THREAD_ICON } from "../threadIcon";
import { useThreadMenu } from "../threadMenu";
import { Identicon } from "./Identicon";

// Names that open their profiles, or "None".
function PersonLinks({
  people,
  onOpenPerson,
}: {
  people: Person[];
  onOpenPerson: (id: string) => void;
}): React.JSX.Element {
  if (people.length === 0) return <>None</>;
  return (
    <>
      {people.map((person, index) => (
        <span key={person.id}>
          {index > 0 && ", "}
          <button type="button" className="person-link" onClick={() => onOpenPerson(person.id)}>
            {person.name}
          </button>
        </span>
      ))}
    </>
  );
}

// One list of shared threads under its heading, or nothing when it's empty.
function ThreadList({
  title,
  threads,
  unreadIds,
  onOpenThread,
}: {
  title: string;
  threads: Thread[];
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): React.JSX.Element | null {
  const openMenu = useThreadMenu();
  if (threads.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="group-heading">
        {title} · {threads.length}
      </h2>
      <ul className="list-page-items">
        {threads.map((thread) => {
          const meta = [
            thread.assignee?.name ?? "Unassigned",
            thread.status === "open" ? null : STATUS_LABELS[thread.status],
          ]
            .filter((part) => part !== null)
            .join(" · ");
          return (
            <li key={thread.id}>
              <button
                type="button"
                className="list-page-item"
                onClick={() => onOpenThread(thread.id)}
                onContextMenu={(event) => openMenu(event, thread)}
              >
                <span className="list-page-icon" aria-hidden>
                  <HugeiconsIcon icon={THREAD_ICON} size={13} />
                </span>
                <span className="list-page-body">
                  <span className="list-page-name">
                    {thread.title}
                    {unreadIds.has(thread.id) && (
                      <span className="unread-dot" aria-label="Unread" />
                    )}
                  </span>
                  <span className="list-page-reason">{`Asked by ${thread.requester.name}`}</span>
                </span>
                {meta !== "" && <span className="list-page-meta">{meta}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Someone else's profile, in the main area like a group's page: who they are and where they sit in the org, the groups
// you're both in, and the threads you're both in (`sharedThreads`), by whose turn it is. Closed ones show on request.
// Only what you share shows, never their own inbox, though every client has every thread: it's a view, not a lock.
export function PersonView({
  person,
  me,
  people,
  threads,
  groups,
  unreadIds,
  onOpenPerson,
  onOpenLabel,
  onNewThread,
  onOpenThread,
}: {
  person: Person;
  me: Person;
  people: Person[];
  threads: Thread[];
  groups: Group[];
  unreadIds: Set<string>;
  onOpenPerson: (id: string) => void;
  onOpenLabel: (id: string) => void;
  // A new thread for them, from you.
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const [showClosed, setShowClosed] = useState(false);
  const shared = sharedThreads(threads, me.id, person.id);
  const groupsShared = sharedGroups(groups, me.id, person.id);
  const managers = chainAbove(people, person.id);
  const reports = people.filter((other) => other.managerId === person.id);
  const firstName = person.name.split(" ")[0];
  const openCount = shared.waitingOnYou.length + shared.waitingOnThem.length + shared.others.length;
  const details = orgDetails(person);

  return (
    <div className="list-page group-page person-page">
      <header className="profile">
        <Identicon seed={person.id} size={40} />
        <div>
          <h1 className="list-page-title">{person.name}</h1>
          <p className="list-page-summary">
            {[details, `${openCount} open ${openCount === 1 ? "thread" : "threads"} together`]
              .filter((part) => part !== "")
              .join(" · ")}
          </p>
        </div>
      </header>

      <dl className="profile-facts">
        <dt>Manager</dt>
        <dd>
          <PersonLinks people={managers.slice(0, 1)} onOpenPerson={onOpenPerson} />
        </dd>
        {managers.length > 1 && (
          <>
            <dt>Above them</dt>
            <dd>
              <PersonLinks people={managers.slice(1)} onOpenPerson={onOpenPerson} />
            </dd>
          </>
        )}
        <dt>Reports</dt>
        <dd>
          <PersonLinks people={reports} onOpenPerson={onOpenPerson} />
        </dd>
        <dt>Groups you share</dt>
        <dd>
          {groupsShared.length === 0
            ? "None"
            : groupsShared.map((group, index) => (
                <span key={group.id}>
                  {index > 0 && ", "}
                  <button
                    type="button"
                    className="person-link"
                    onClick={() => onOpenLabel(group.labelId)}
                  >
                    {group.name}
                  </button>
                </span>
              ))}
        </dd>
      </dl>

      <div className="group-toolbar">
        <button type="button" className="group-new" onClick={onNewThread}>
          New thread to {firstName}
        </button>
        <span className="group-filters">
          {shared.closed.length > 0 && (
            <button
              type="button"
              className="chip"
              data-tone={showClosed ? undefined : "muted"}
              aria-pressed={showClosed}
              onClick={() => setShowClosed((value) => !value)}
            >
              {showClosed ? "Showing closed" : `${shared.closed.length} closed`}
            </button>
          )}
        </span>
      </div>

      {openCount === 0 && !showClosed ? (
        <p className="group-empty">
          {shared.closed.length === 0
            ? `No threads with ${firstName} yet.`
            : `Nothing open with ${firstName}.`}
        </p>
      ) : (
        <>
          <ThreadList
            title="Waiting on you"
            threads={shared.waitingOnYou}
            unreadIds={unreadIds}
            onOpenThread={onOpenThread}
          />
          <ThreadList
            title={`Waiting on ${firstName}`}
            threads={shared.waitingOnThem}
            unreadIds={unreadIds}
            onOpenThread={onOpenThread}
          />
          <ThreadList
            title="Everything else you're both in"
            threads={shared.others}
            unreadIds={unreadIds}
            onOpenThread={onOpenThread}
          />
          {showClosed && (
            <ThreadList
              title="Closed"
              threads={shared.closed}
              unreadIds={unreadIds}
              onOpenThread={onOpenThread}
            />
          )}
        </>
      )}
    </div>
  );
}
