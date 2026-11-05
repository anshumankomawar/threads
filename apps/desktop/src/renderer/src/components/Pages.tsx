import * as i from "@hugeicons/core-free-icons";
import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Label, Thread, User, WorkspaceMember, type Message } from "models";
import { me, memberOf, open, setDialog, store, workspace } from "../session";
import { chip, chipTone } from "../styles/controls";
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

const ROLE = { admin: "Admin", member: "Member" };

// Someone and their role here, and the threads you're both in. Your own also lists the workspace's members.
export function PersonView(props: { user: User }): JSX.Element {
  const u = (): User => props.user;
  const first = (): string => u().name.split(" ")[0];
  const inIt = (t: Thread, id: string): boolean =>
    t.ownerId === id ||
    t.assigneeIds.includes(id) ||
    t.messages.filter((m: Message) => m.authorId === id).length > 0;
  const summary = (user: User): string =>
    [user.email, ROLE[memberOf(user)?.role ?? "member"]].filter(Boolean).join(" · ");
  return (
    <div class={sx(page.page)}>
      <header class={sx(page.header)}>
        <Identicon seed={u().id} size={40} />
        <div>
          <h1 class={sx(page.title)}>{u().name}</h1>
          <p class={sx(page.summary)}>{summary(u())}</p>
        </div>
      </header>
      <Show
        when={u().id !== me().id}
        fallback={
          <>
            <h2 class={sx(page.subheading, page.body)}>Members of {workspace().name}</h2>
            <ul class={sx(page.list)}>
              <For each={store.all(WorkspaceMember)}>
                {(m) => (
                  <li>
                    <button
                      class={sx(page.bare, page.person, page.hover, page.pointer)}
                      onClick={() => open({ person: m.userId })}
                    >
                      <Identicon seed={m.userId} size={16} />
                      <span class={sx(page.personName)}>{m.user.name}</span>
                      <span class={sx(page.small)}>{ROLE[m.role]}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
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
