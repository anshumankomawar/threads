import * as i from "@hugeicons/core-free-icons";
import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Label, Thread, User, WorkspaceMember, type Message } from "models";
import { me, memberOf, open, position, setDialog, store } from "../session";
import { chip, chipTone, link } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { ago } from "./ThreadView";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

// Threads as rows, newest first, under a button for a new one; resolved ones behind a toggle.
function Threads(props: {
  threads: Thread[];
  newText: string;
  onNew: () => void;
  empty: string;
}): JSX.Element {
  const [all, setAll] = createSignal(false);
  const resolved = (): number => props.threads.filter((t) => !t.isOpen).length;
  const shown = (): Thread[] =>
    props.threads
      .filter((t) => all() || t.isOpen)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return (
    <>
      <div class={sx(page.row, page.toolbar, page.narrow)}>
        <button
          class={sx(page.bare, page.border, page.newButton, page.pointer)}
          onClick={() => props.onNew()}
        >
          {props.newText}
        </button>
        <span class={sx(page.row, page.filters)}>
          <Show when={resolved() > 0}>
            <button class={sx(chip.chip, !all() && chipTone.muted)} onClick={() => setAll(!all())}>
              {all() ? "Showing resolved" : `${resolved()} resolved`}
            </button>
          </Show>
        </span>
      </div>
      <Show when={shown().length > 0} fallback={<p class={sx(page.empty)}>{props.empty}</p>}>
        <ul class={sx(page.list, page.items, page.narrow)}>
          <For each={shown()}>
            {(t) => (
              <li>
                <button
                  class={sx(page.bare, page.item, page.itemLook, page.hover, page.pointer)}
                  onClick={() => open({ thread: t.id })}
                >
                  <span class={sx(page.itemIcon)} aria-hidden="true">
                    <Icon icon={i.Message01Icon} size={13} />
                  </span>
                  <span class={sx(page.itemBody)}>
                    <span class={sx(page.itemName)}>{t.title}</span>
                    <span class={sx(page.small)}>By {t.owner?.name ?? "someone"}</span>
                  </span>
                  <span class={sx(page.small, page.noShrink)}>
                    {t.isOpen ? ago(t.updatedAt) : "Resolved"}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </>
  );
}

// Names that open someone's profile, or "None".
const People = (props: { users: User[] }): JSX.Element => (
  <Show when={props.users.length > 0} fallback="None">
    <For each={props.users}>
      {(user, index) => (
        <span>
          {index() > 0 && ", "}
          <button class={sx(link.person)} onClick={() => open({ person: user.id })}>
            {user.name}
          </button>
        </span>
      )}
    </For>
  </Show>
);

const Fact = (props: { term: string; children: JSX.Element }): JSX.Element => (
  <>
    <dt class={sx(page.muted)}>{props.term}</dt>
    <dd class={sx(page.value)}>{props.children}</dd>
  </>
);

export function LabelView(props: { label: Label }): JSX.Element {
  const threads = (): Thread[] =>
    store.all(Thread).filter((t) => t.labelIds.includes(props.label.id));
  const openCount = (): number => threads().filter((t) => t.isOpen).length;
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>{props.label.name}</h1>
      <p class={sx(page.summary)}>
        <Icon icon={i.Tag01Icon} size={11} class={sx(page.summaryIcon)} aria-hidden="true" />{" "}
        {openCount()} open thread{openCount() === 1 ? "" : "s"}
      </p>
      <Threads
        threads={threads()}
        newText="New thread"
        onNew={() => setDialog({ kind: "newThread", labelId: props.label.id })}
        empty="Nothing here yet."
      />
    </div>
  );
}

// Someone's place in the org and the threads you're both in; your own also shows everyone, by manager.
export function PersonView(props: { user: User }): JSX.Element {
  const u = (): User => props.user;
  const member = (): WorkspaceMember | undefined => memberOf(u());
  const first = (): string => u().name.split(" ")[0];
  const inIt = (t: Thread, id: string): boolean =>
    t.ownerId === id ||
    t.messages.filter((m: Message) => m.authorId === id || m.toIds.includes(id)).length > 0;
  const tree = (manager?: WorkspaceMember): JSX.Element => (
    <ul class={sx(manager ? page.branch : page.tree)}>
      <For
        each={manager ? [...manager.reports] : store.all(WorkspaceMember).filter((m) => !m.manager)}
      >
        {(m) => (
          <li>
            <button
              class={sx(
                page.bare,
                page.person,
                page.hover,
                page.pointer,
                m.userId === me().id && page.me,
              )}
              onClick={() => open({ person: m.userId })}
            >
              <Identicon seed={m.userId} size={16} />
              <span class={sx(page.personName, m.reports.length > 0 && page.bold)}>
                {m.user.name}
              </span>
              <span class={sx(page.small)}>{position(m.user)}</span>
            </button>
            <Show when={m.reports.length > 0}>{tree(m)}</Show>
          </li>
        )}
      </For>
    </ul>
  );
  return (
    <div class={sx(page.page)}>
      <header class={sx(page.header)}>
        <Identicon seed={u().id} size={40} />
        <div>
          <h1 class={sx(page.title)}>{u().name}</h1>
          <p class={sx(page.summary)}>{position(u())}</p>
        </div>
      </header>
      <dl class={sx(page.facts, page.narrow)}>
        <Fact term="Manager">
          <People users={member()?.manager ? [member()!.manager!.user] : []} />
        </Fact>
        <Fact term="Reports">
          <People users={[...(member()?.reports ?? [])].map((m) => m.user)} />
        </Fact>
      </dl>
      <Show
        when={u().id !== me().id}
        fallback={
          <>
            <h2 class={sx(page.subheading, page.body)}>People</h2>
            {tree()}
          </>
        }
      >
        <Threads
          threads={store.all(Thread).filter((t) => inIt(t, me().id) && inIt(t, u().id))}
          newText={`New thread with ${first()}`}
          onNew={() => setDialog({ kind: "newThread", to: u() })}
          empty={`No threads with ${first()} yet.`}
        />
      </Show>
    </div>
  );
}
