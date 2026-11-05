import { STATUS_LABELS, type Group, type Person, type Thread } from "model";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { chainAbove, orgDetails } from "../org";
import { sharedGroups, sharedThreads } from "../profile";
import { THREAD_ICON } from "../threadIcon";
import { useThreadMenu } from "../threadMenu";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

// Names that open their profiles, or "None".
function PersonLinks(props: { people: Person[]; onOpenPerson: (id: string) => void }): JSX.Element {
  return (
    <Show when={props.people.length > 0} fallback="None">
      <For each={props.people}>
        {(person, index) => (
          <span>
            {index() > 0 && ", "}
            <button type="button" class="person-link" onClick={() => props.onOpenPerson(person.id)}>
              {person.name}
            </button>
          </span>
        )}
      </For>
    </Show>
  );
}

// One list of shared threads under its heading, or nothing when it's empty.
function ThreadList(props: {
  title: string;
  threads: Thread[];
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): JSX.Element {
  const openMenu = useThreadMenu();
  return (
    <Show when={props.threads.length > 0}>
      <section aria-label={props.title}>
        <h2 class="group-heading">
          {props.title} · {props.threads.length}
        </h2>
        <ul class="list-page-items">
          <For each={props.threads}>
            {(thread) => {
              const meta = (): string =>
                [
                  thread.assignees.length === 0
                    ? "Unassigned"
                    : thread.assignees.map((person) => person.name.split(" ")[0]).join(", "),
                  thread.status === "open" ? null : STATUS_LABELS[thread.status],
                ]
                  .filter((part) => part !== null)
                  .join(" · ");
              return (
                <li>
                  <button
                    type="button"
                    class="list-page-item"
                    onClick={() => props.onOpenThread(thread.id)}
                    onContextMenu={(event) => openMenu(event, thread)}
                  >
                    <span class="list-page-icon" aria-hidden="true">
                      <Icon icon={THREAD_ICON} size={13} />
                    </span>
                    <span class="list-page-body">
                      <span class="list-page-name">
                        {thread.title}
                        <Show when={props.unreadIds.has(thread.id)}>
                          <span class="unread-dot" aria-label="Unread" />
                        </Show>
                      </span>
                      <span class="list-page-reason">{`By ${thread.owner.name}`}</span>
                    </span>
                    <Show when={meta() !== ""}>
                      <span class="list-page-meta">{meta()}</span>
                    </Show>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </section>
    </Show>
  );
}

// Someone else's profile, in the main area like a group's page: who they are and where they sit in the org, the groups
// you're both in, and the threads you're both in (`sharedThreads`), by whose turn it is. Closed ones show on request.
// Only what you share shows, never their own inbox, though every client has every thread: it's a view, not a lock.
export function PersonView(props: {
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
}): JSX.Element {
  const [showClosed, setShowClosed] = createSignal(false);
  const shared = createMemo(() => sharedThreads(props.threads, props.me.id, props.person.id));
  const groupsShared = createMemo(() => sharedGroups(props.groups, props.me.id, props.person.id));
  const managers = createMemo(() => chainAbove(props.people, props.person.id));
  const reports = createMemo(() =>
    props.people.filter((other) => other.managerId === props.person.id),
  );
  const firstName = (): string => props.person.name.split(" ")[0];
  const openCount = (): number =>
    shared().forYou.length + shared().forThem.length + shared().others.length;

  return (
    <div class="list-page group-page person-page">
      <header class="profile">
        <Identicon seed={props.person.id} size={40} />
        <div>
          <h1 class="list-page-title">{props.person.name}</h1>
          <p class="list-page-summary">
            {[
              orgDetails(props.person),
              `${openCount()} open ${openCount() === 1 ? "thread" : "threads"} together`,
            ]
              .filter((part) => part !== "")
              .join(" · ")}
          </p>
        </div>
      </header>

      <dl class="profile-facts">
        <dt>Manager</dt>
        <dd>
          <PersonLinks people={managers().slice(0, 1)} onOpenPerson={props.onOpenPerson} />
        </dd>
        <Show when={managers().length > 1}>
          <dt>Above them</dt>
          <dd>
            <PersonLinks people={managers().slice(1)} onOpenPerson={props.onOpenPerson} />
          </dd>
        </Show>
        <dt>Reports</dt>
        <dd>
          <PersonLinks people={reports()} onOpenPerson={props.onOpenPerson} />
        </dd>
        <dt>Groups you share</dt>
        <dd>
          <Show when={groupsShared().length > 0} fallback="None">
            <For each={groupsShared()}>
              {(group, index) => (
                <span>
                  {index() > 0 && ", "}
                  <button
                    type="button"
                    class="person-link"
                    onClick={() => props.onOpenLabel(group.labelId)}
                  >
                    {group.name}
                  </button>
                </span>
              )}
            </For>
          </Show>
        </dd>
      </dl>

      <div class="group-toolbar">
        <button type="button" class="group-new" onClick={() => props.onNewThread()}>
          New thread to {firstName()}
        </button>
        <span class="group-filters">
          <Show when={shared().closed.length > 0}>
            <button
              type="button"
              class="chip"
              data-tone={showClosed() ? undefined : "muted"}
              aria-pressed={`${showClosed()}`}
              onClick={() => setShowClosed((value) => !value)}
            >
              {showClosed() ? "Showing closed" : `${shared().closed.length} closed`}
            </button>
          </Show>
        </span>
      </div>

      <Show
        when={openCount() > 0 || showClosed()}
        fallback={
          <p class="group-empty">
            {shared().closed.length === 0
              ? `No threads with ${firstName()} yet.`
              : `Nothing open with ${firstName()}.`}
          </p>
        }
      >
        {/* Right under the chip that shows them, so they appear where you clicked rather than below every open thread. */}
        <Show when={showClosed()}>
          <ThreadList
            title="Closed"
            threads={shared().closed}
            unreadIds={props.unreadIds}
            onOpenThread={props.onOpenThread}
          />
        </Show>
        <ThreadList
          title="Assigned to you"
          threads={shared().forYou}
          unreadIds={props.unreadIds}
          onOpenThread={props.onOpenThread}
        />
        <ThreadList
          title={`Assigned to ${firstName()}`}
          threads={shared().forThem}
          unreadIds={props.unreadIds}
          onOpenThread={props.onOpenThread}
        />
        <ThreadList
          title="Everything else you're both in"
          threads={shared().others}
          unreadIds={props.unreadIds}
          onOpenThread={props.onOpenThread}
        />
      </Show>
    </div>
  );
}
