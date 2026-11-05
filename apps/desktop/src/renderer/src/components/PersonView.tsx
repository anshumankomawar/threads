import type { Person } from "model";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { chainAbove, orgDetails } from "../org";
import { sharedGroups, sharedThreads } from "../profile";
import { link } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { Fact, PersonHeader, ThreadRows, Toolbar } from "./ThreadItems";

// Names that open what they name, or "None".
function Links(props: { items: { id: string; name: string }[]; onOpen: (id: string) => void }) {
  return (
    <Show when={props.items.length > 0} fallback="None">
      <For each={props.items}>
        {(item, index) => (
          <span>
            {index() > 0 && ", "}
            <button type="button" class={sx(link.person)} onClick={() => props.onOpen(item.id)}>
              {item.name}
            </button>
          </span>
        )}
      </For>
    </Show>
  );
}

// Someone else's profile: where they sit in the org, the groups and threads you share. Only what you share shows.
export function PersonView(props: { person: Person }): JSX.Element {
  const app = useApp();
  const [showClosed, setShowClosed] = createSignal(false);
  const shared = createMemo(() => sharedThreads(app.data.threads(), app.me().id, props.person.id));
  const managers = createMemo(() => chainAbove(app.data.people(), props.person.id));
  const reports = () => app.data.people().filter((other) => other.managerId === props.person.id);
  const first = (): string => props.person.name.split(" ")[0];
  const open = (): number =>
    shared().forYou.length + shared().forThem.length + shared().others.length;
  const people = (list: Person[]): JSX.Element => (
    <Links items={list} onOpen={app.nav.openPerson} />
  );
  const closed = (): number => shared().closed.length;

  return (
    <div class={sx(page.page)}>
      <PersonHeader
        person={props.person}
        summary={[
          orgDetails(props.person),
          `${open()} open thread${open() === 1 ? "" : "s"} together`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <dl class={sx(page.facts, page.narrow)}>
        <Fact term="Manager">{people(managers().slice(0, 1))}</Fact>
        <Show when={managers().length > 1}>
          <Fact term="Above them">{people(managers().slice(1))}</Fact>
        </Show>
        <Fact term="Reports">{people(reports())}</Fact>
        <Fact term="Groups you share">
          <Links
            items={sharedGroups(app.data.groups(), app.me().id, props.person.id).map((group) => ({
              id: group.labelId,
              name: group.name,
            }))}
            onOpen={app.nav.openLabel}
          />
        </Fact>
      </dl>
      <Toolbar
        newLabel={`New thread to ${first()}`}
        closed={closed()}
        showClosed={showClosed()}
        onToggleClosed={() => setShowClosed((value) => !value)}
      />
      <Show
        when={open() > 0 || showClosed()}
        fallback={
          <p class={sx(page.empty)}>
            {closed() === 0 ? `No threads with ${first()} yet.` : `Nothing open with ${first()}.`}
          </p>
        }
      >
        {/* Right under the chip that shows them, where you clicked. */}
        <Show when={showClosed()}>
          <ThreadRows title="Closed" threads={shared().closed} />
        </Show>
        <ThreadRows title="Assigned to you" threads={shared().forYou} />
        <ThreadRows title={`Assigned to ${first()}`} threads={shared().forThem} />
        <ThreadRows title="Everything else you're both in" threads={shared().others} />
      </Show>
    </div>
  );
}
