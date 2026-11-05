import * as i from "@hugeicons/core-free-icons";
import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Conversation, Message, Team, User } from "model";
import { me, open, setDialog, store } from "../session";
import { chip, chipTone, link } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { ago } from "./ConversationView";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

// A button for something new, then the resolved conversations' chip on the right.
function Toolbar(props: {
  newLabel?: string;
  onNew: () => void;
  resolved: number;
  all: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div class={sx(page.row, page.toolbar, page.narrow)}>
      <Show when={props.newLabel}>
        <button
          class={sx(page.bare, page.border, page.newButton, page.pointer)}
          onClick={() => props.onNew()}
        >
          {props.newLabel}
        </button>
      </Show>
      <span class={sx(page.row, page.filters)}>
        <Show when={props.resolved > 0}>
          <button class={sx(chip.chip, !props.all && chipTone.muted)} onClick={props.onToggle}>
            {props.all ? "Showing resolved" : `${props.resolved} resolved`}
          </button>
        </Show>
      </span>
    </div>
  );
}

// Conversations as rows, open ones first; resolved ones behind a toggle.
function Conversations(props: {
  conversations: Conversation[];
  newLabel?: string;
  onNew: () => void;
  empty: string;
}): JSX.Element {
  const [all, setAll] = createSignal(false);
  const resolved = (): number => props.conversations.filter((c) => !c.isOpen).length;
  const shown = (): Conversation[] =>
    props.conversations
      .filter((c) => all() || c.isOpen)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return (
    <>
      <Toolbar
        newLabel={props.newLabel}
        onNew={props.onNew}
        resolved={resolved()}
        all={all()}
        onToggle={() => setAll(!all())}
      />
      <Show when={shown().length > 0} fallback={<p class={sx(page.empty)}>{props.empty}</p>}>
        <ul class={sx(page.list, page.items, page.narrow)}>
          <For each={shown()}>
            {(c) => (
              <li>
                <button
                  class={sx(page.bare, page.item, page.itemLook, page.hover, page.pointer)}
                  onClick={() => open({ conversation: c.id })}
                >
                  <span class={sx(page.itemIcon)} aria-hidden="true">
                    <Icon icon={i.Message01Icon} size={13} />
                  </span>
                  <span class={sx(page.itemBody)}>
                    <span class={sx(page.itemName)}>{c.title}</span>
                    <span class={sx(page.small)}>By {c.owner?.name ?? "someone"}</span>
                  </span>
                  <span class={sx(page.small, page.noShrink)}>
                    {c.isOpen ? ago(c.updatedAt) : "Resolved"}
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

export function TeamView(props: { team: Team }): JSX.Element {
  const t = (): Team => props.team;
  const member = (): boolean => t().memberIds.includes(me().id);
  const members = (): User[] => t().memberIds.flatMap((id) => store.findById(User, id) ?? []);
  const setMembers = (ids: string[]): void => {
    t().memberIds = ids;
    t().save();
  };
  const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>{t().name}</h1>
      <p class={sx(page.summary)}>
        <Icon icon={i.UserGroupIcon} size={11} class={sx(page.summaryIcon)} aria-hidden="true" />{" "}
        {count(members().length, "member")} ·{" "}
        {count(t().conversations.filter((c) => c.isOpen).length, "open conversation")}
      </p>
      <ul class={sx(page.list, page.row, page.narrow, page.members)} aria-label="Members">
        <For each={members()}>
          {(user) => (
            <li class={sx(page.border, page.member)}>
              <Identicon seed={user.id} size={14} />
              <button class={sx(link.person)} onClick={() => open({ person: user.id })}>
                {user.name}
              </button>
            </li>
          )}
        </For>
      </ul>
      <div class={sx(page.actions)}>
        <button
          class={sx(page.bare, page.pointer, page.action)}
          onClick={() =>
            setMembers(
              member() ? t().memberIds.filter((id) => id !== me().id) : [...t().memberIds, me().id],
            )
          }
        >
          {member() ? "Leave" : "Join"}
        </button>
      </div>
      <Conversations
        conversations={[...t().conversations]}
        newLabel={member() ? "New conversation" : undefined}
        onNew={() => setDialog({ kind: "newConversation", teamId: t().id })}
        empty="Nothing here yet."
      />
    </div>
  );
}

// Someone's place in the org and the conversations you're both in; your own also shows everyone, by manager.
export function PersonView(props: { user: User }): JSX.Element {
  const u = (): User => props.user;
  const first = (): string => u().name.split(" ")[0];
  const inIt = (c: Conversation, id: string): boolean =>
    c.ownerId === id ||
    c.messages.filter((m: Message) => m.authorId === id || m.toIds.includes(id)).length > 0;
  const tree = (manager?: User): JSX.Element => (
    <ul class={sx(manager ? page.branch : page.tree)}>
      <For
        each={store.all(User).filter((p) => (manager ? p.managerId === manager.id : !p.manager))}
      >
        {(p) => (
          <li>
            <button
              class={sx(
                page.bare,
                page.person,
                page.hover,
                page.pointer,
                p.id === me().id && page.me,
              )}
              onClick={() => open({ person: p.id })}
            >
              <Identicon seed={p.id} size={16} />
              <span class={sx(page.personName, p.reports.length > 0 && page.bold)}>{p.name}</span>
              <span class={sx(page.small)}>{[p.level, p.role].filter(Boolean).join(" · ")}</span>
            </button>
            <Show when={p.reports.length > 0}>{tree(p)}</Show>
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
          <p class={sx(page.summary)}>{[u().level, u().role].filter(Boolean).join(" · ")}</p>
        </div>
      </header>
      <dl class={sx(page.facts, page.narrow)}>
        <Fact term="Manager">
          <People users={u().manager ? [u().manager!] : []} />
        </Fact>
        <Fact term="Reports">
          <People users={[...u().reports]} />
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
        <Conversations
          conversations={store.all(Conversation).filter((c) => inIt(c, me().id) && inIt(c, u().id))}
          newLabel={`New conversation with ${first()}`}
          onNew={() => setDialog({ kind: "newConversation", to: u() })}
          empty={`No conversations with ${first()} yet.`}
        />
      </Show>
    </div>
  );
}
