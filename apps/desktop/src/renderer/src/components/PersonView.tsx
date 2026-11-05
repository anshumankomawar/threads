import { STATUS_LABELS, type Person, type Thread } from "model";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { chainAbove, orgDetails } from "../org";
import { sharedGroups, sharedThreads } from "../profile";
import { chip, chipTone, link, status } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { THREAD_ICON } from "../threadIcon";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";
import { profile } from "./ProfileView.styles";

// Names that open what they name (a person's profile, a group's page), or "None".
function Links<T>(props: {
  items: T[];
  name: (item: T) => string;
  onOpen: (item: T) => void;
}): JSX.Element {
  return (
    <Show when={props.items.length > 0} fallback="None">
      <For each={props.items}>
        {(item, index) => (
          <span>
            {index() > 0 && ", "}
            <button type="button" class={sx(link.person)} onClick={() => props.onOpen(item)}>
              {props.name(item)}
            </button>
          </span>
        )}
      </For>
    </Show>
  );
}

// Names that open their profiles, or "None".
function PersonLinks(props: { people: Person[] }): JSX.Element {
  const app = useApp();
  return (
    <Links
      items={props.people}
      name={(person) => person.name}
      onOpen={(person) => app.nav.openPerson(person.id)}
    />
  );
}

// One list of shared threads under its heading, or nothing when it's empty.
function ThreadList(props: { title: string; threads: Thread[] }): JSX.Element {
  const app = useApp();
  return (
    <Show when={props.threads.length > 0}>
      <section aria-label={props.title}>
        <h2 class={sx(page.groupHeading)}>
          {props.title} · {props.threads.length}
        </h2>
        <ul class={sx(page.items, page.itemsInGroupPage)}>
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
                    class={sx(page.item)}
                    onClick={() => app.nav.openThread(thread.id)}
                    onContextMenu={(event) => app.threads.openMenu(event, thread)}
                  >
                    <span class={sx(page.itemIcon)} aria-hidden="true">
                      <Icon icon={THREAD_ICON} size={13} />
                    </span>
                    <span class={sx(page.itemBody)}>
                      <span class={sx(page.itemName)}>
                        {thread.title}
                        <Show when={app.inbox.unreadIds().has(thread.id)}>
                          <span class={sx(status.unread)} aria-label="Unread" />
                        </Show>
                      </span>
                      <span class={sx(page.itemReason)}>{`By ${thread.owner.name}`}</span>
                    </span>
                    <Show when={meta() !== ""}>
                      <span class={sx(page.itemMeta)}>{meta()}</span>
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
export function PersonView(props: { person: Person }): JSX.Element {
  const app = useApp();
  const [showClosed, setShowClosed] = createSignal(false);
  const shared = createMemo(() => sharedThreads(app.data.threads(), app.me().id, props.person.id));
  const groupsShared = createMemo(() =>
    sharedGroups(app.data.groups(), app.me().id, props.person.id),
  );
  const managers = createMemo(() => chainAbove(app.data.people(), props.person.id));
  const reports = createMemo(() =>
    app.data.people().filter((other) => other.managerId === props.person.id),
  );
  const firstName = (): string => props.person.name.split(" ")[0];
  const openCount = (): number =>
    shared().forYou.length + shared().forThem.length + shared().others.length;

  return (
    <div class={sx(page.page)}>
      <header class={sx(profile.header)}>
        <Identicon seed={props.person.id} size={40} />
        <div>
          <h1 class={sx(page.title)}>{props.person.name}</h1>
          <p class={sx(page.summary)}>
            {[
              orgDetails(props.person),
              `${openCount()} open ${openCount() === 1 ? "thread" : "threads"} together`,
            ]
              .filter((part) => part !== "")
              .join(" · ")}
          </p>
        </div>
      </header>

      <dl class={sx(page.facts, page.factsNarrow)}>
        <dt class={sx(page.factsTerm)}>Manager</dt>
        <dd class={sx(page.factsValue)}>
          <PersonLinks people={managers().slice(0, 1)} />
        </dd>
        <Show when={managers().length > 1}>
          <dt class={sx(page.factsTerm)}>Above them</dt>
          <dd class={sx(page.factsValue)}>
            <PersonLinks people={managers().slice(1)} />
          </dd>
        </Show>
        <dt class={sx(page.factsTerm)}>Reports</dt>
        <dd class={sx(page.factsValue)}>
          <PersonLinks people={reports()} />
        </dd>
        <dt class={sx(page.factsTerm)}>Groups you share</dt>
        <dd class={sx(page.factsValue)}>
          <Links
            items={groupsShared()}
            name={(group) => group.name}
            onOpen={(group) => app.nav.openLabel(group.labelId)}
          />
        </dd>
      </dl>

      <div class={sx(page.toolbar)}>
        {/* A new thread for them, from you. */}
        <button type="button" class={sx(page.newButton)} onClick={() => app.ui.openNewThread()}>
          New thread to {firstName()}
        </button>
        <span class={sx(page.filters)}>
          <Show when={shared().closed.length > 0}>
            <button
              type="button"
              class={sx(chip.chip, !showClosed() && chipTone.muted)}
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
          <p class={sx(page.empty)}>
            {shared().closed.length === 0
              ? `No threads with ${firstName()} yet.`
              : `Nothing open with ${firstName()}.`}
          </p>
        }
      >
        {/* Right under the chip that shows them, so they appear where you clicked rather than below every open thread. */}
        <Show when={showClosed()}>
          <ThreadList title="Closed" threads={shared().closed} />
        </Show>
        <ThreadList title="Assigned to you" threads={shared().forYou} />
        <ThreadList title={`Assigned to ${firstName()}`} threads={shared().forThem} />
        <ThreadList title="Everything else you're both in" threads={shared().others} />
      </Show>
    </div>
  );
}
