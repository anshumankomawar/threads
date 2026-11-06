import * as i from "@hugeicons/core-free-icons";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { Portal, type JSX } from "@solidjs/web";
import {
  Label,
  PRIORITIES,
  STATES,
  Subspace,
  SubspaceMember,
  Thread,
  User,
  View,
  WorkspaceMember,
} from "models";
import { matches, type Filter } from "sync";
import {
  me,
  memberOf,
  open,
  pageActions,
  setDialog,
  showMenu,
  store,
  threadMenu,
  workspace,
  type Dialog,
} from "../session";
import { chip, chipTone } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";
import { MenuChip } from "./Menus";
import { ago, LABELS } from "./ThreadView";

const icon = (svg: typeof i.Tick02Icon) => <Icon icon={svg} size={12} aria-hidden="true" />;

// A page's own actions, in the top bar beside its name rather than under its title.
const Actions = (props: { children: JSX.Element }): JSX.Element => (
  <Show when={pageActions()}>{(bar) => <Portal mount={bar()}>{props.children}</Portal>}</Show>
);
const people = (): [string, string][] => [
  ["$me", "Me"],
  ...store.all(User).map((u): [string, string] => [u.id, u.name]),
];

// The thread fields a filter can test, how, and the values it offers.
export const FIELDS: Record<
  string,
  { label: string; compare: "eq" | "contains"; values: () => [string, string][] }
> = {
  state: { label: "Status", compare: "eq", values: () => STATES.map((s) => [s, LABELS[s]]) },
  priority: {
    label: "Priority",
    compare: "eq",
    values: () => PRIORITIES.map((p) => [p, LABELS[p]]),
  },
  subspaceIds: {
    label: "Subspace",
    compare: "contains",
    values: () => store.all(Subspace).map((s) => [s.id, s.name]),
  },
  labelIds: {
    label: "Label",
    compare: "contains",
    values: () => store.all(Label).map((l) => [l.id, l.name]),
  },
  assigneeIds: { label: "Assignee", compare: "contains", values: people },
  ownerId: { label: "Owner", compare: "eq", values: people },
};

// One field's test, as the filter bar shows it: "Status: Open".
function describe(condition: Filter): string {
  const [[field, comparison]] = Object.entries(condition);
  const { label, values } = FIELDS[field];
  const value = Object.values(comparison as object)[0];
  return `${label}: ${values().find(([id]) => id === value)?.[1] ?? "?"}`;
}

// Threads that pass `base` and the conditions you add, newest first, resolved ones behind a toggle. Conditions on a
// subspace follow it, so its threads load even if you're not in it. Unsaved, the conditions can become a saved view;
// on a saved view's page they're its filter.
function Threads(props: {
  base: Filter[];
  view?: View;
  newThread: Extract<Dialog, { kind: "newThread" }>;
  empty: string;
}): JSX.Element {
  const [conditions, setConditions] = createSignal<Filter[]>(
    untrack(() => props.view?.filter.and ?? []),
  );
  const [all, setAll] = createSignal(false);
  const filter = (): Filter => ({ and: [...props.base, ...conditions()] });
  createEffect(
    () =>
      filter().and!.flatMap((condition) => {
        const contains = (condition.subspaceIds as { contains?: string } | undefined)?.contains;
        return contains ? [contains] : [];
      }),
    (ids) => ids.forEach((id) => store.subscribe(`subspace:${id}`)),
  );
  const change = (next: Filter[]): void => {
    setConditions(next);
    if (!props.view) return;
    props.view.filter = { and: next };
    props.view.save();
  };
  const threads = (): Thread[] =>
    store.all(Thread).filter((t) => matches(t, filter(), { me: me().id }));
  const resolved = (): number => threads().filter((t) => !t.isOpen).length;
  const shown = (): Thread[] =>
    threads()
      .filter((t) => all() || t.isOpen)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return (
    <>
      <div class={sx(page.row, page.toolbar, page.narrow)}>
        <button
          class={sx(page.bare, page.border, page.newButton, page.pointer)}
          onClick={() => setDialog(props.newThread)}
        >
          New thread
        </button>
        <For each={conditions()}>
          {(condition) => (
            <button
              class={sx(chip.chip)}
              title="Remove"
              onClick={() => change(conditions().filter((c) => c !== condition))}
            >
              {describe(condition)} ×
            </button>
          )}
        </For>
        <button
          class={sx(chip.chip, chipTone.muted)}
          onClick={() =>
            setDialog({ kind: "filter", add: (condition) => change([...conditions(), condition]) })
          }
        >
          {icon(i.FilterIcon)} Filter
        </button>
        <span class={sx(page.row, page.filters)}>
          <Show when={!props.view && conditions().length > 0}>
            <button
              class={sx(chip.chip)}
              onClick={() => setDialog({ kind: "newView", filter: filter() })}
            >
              Save view
            </button>
          </Show>
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
                  onContextMenu={(event) => showMenu(event, threadMenu(t))}
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

// Every thread you can see, to filter and save as a view.
export function AllThreadsView(): JSX.Element {
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>All threads</h1>
      <Threads base={[]} newThread={{ kind: "newThread" }} empty="No threads yet." />
    </div>
  );
}

export function SavedView(props: { view: View }): JSX.Element {
  const v = (): View => props.view;
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>{v().name}</h1>
      <Actions>
        <MenuChip
          label={v().shared ? "Shared with the workspace" : "Only you"}
          icon={icon(v().shared ? i.UserMultipleIcon : i.LockIcon)}
          items={
            v().ownerId === me().id
              ? [
                  {
                    label: v().shared ? "Make it yours only" : "Share it",
                    run: () => toggleShared(v()),
                  },
                  "separator",
                  { label: "Delete view", run: () => (open({ thread: null }), void v().delete()) },
                ]
              : []
          }
        />
      </Actions>
      <Threads base={[]} view={v()} newThread={{ kind: "newThread" }} empty="Nothing matches." />
    </div>
  );
}

function toggleShared(view: View): void {
  view.shared = !view.shared;
  view.save();
}

export function LabelView(props: { label: Label }): JSX.Element {
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>{props.label.name}</h1>
      <Threads
        base={[{ labelIds: { contains: props.label.id } }]}
        newThread={{ kind: "newThread", labelId: props.label.id }}
        empty="Nothing here yet."
      />
    </div>
  );
}

// A subspace: who's in it, whether it's private, and its threads. Members add or remove people; anyone joins an open one.
export function SubspaceView(props: { subspace: Subspace }): JSX.Element {
  const s = (): Subspace => props.subspace;
  const membership = (userId: string): SubspaceMember | undefined =>
    s().members.filter((m) => m.userId === userId)[0];
  const isMember = (): boolean => membership(me().id) !== undefined;
  const toggle = (user: User): void => {
    const existing = membership(user.id);
    if (existing) void existing.delete();
    else store.create(SubspaceMember, { subspace: s(), user });
  };
  const members = (): SubspaceMember[] =>
    s()
      .members.sorted("createdAt")
      .filter((m) => m.user);
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>{s().name}</h1>
      <Show
        when={isMember()}
        fallback={
          <Show when={s().description}>
            <p class={sx(page.description)}>{s().description}</p>
          </Show>
        }
      >
        <textarea
          class={sx(page.description, page.descriptionField)}
          aria-label="Description"
          placeholder="Add a description…"
          rows={1}
          value={s().description ?? ""}
          onKeyDown={(event) => event.key === "Escape" && event.currentTarget.blur()}
          onBlur={(event) => {
            s().description = event.currentTarget.value.trim() || undefined;
            s().save();
          }}
        />
      </Show>
      <Actions>
        <MenuChip
          label={s().visibility === "private" ? "Private" : "Open"}
          icon={icon(s().visibility === "private" ? i.LockIcon : i.ViewIcon)}
          items={
            isMember()
              ? [
                  {
                    label: s().visibility === "private" ? "Open it to everyone" : "Make it private",
                    run: () => {
                      s().visibility = s().visibility === "private" ? "open" : "private";
                      s().save();
                    },
                  },
                  "separator",
                  // Its threads stay, outside it.
                  {
                    label: "Delete subspace",
                    run: () => (open({ thread: null }), void s().delete()),
                  },
                ]
              : []
          }
        />
        <button class={sx(chip.chip)} onClick={() => toggle(me())}>
          {isMember() ? "Leave" : "Join"}
        </button>
      </Actions>
      <h2 class={sx(page.subheading, page.body)}>Members · {members().length}</h2>
      <ul class={sx(page.list, page.narrow)}>
        <For each={members()}>
          {(m) => (
            <li class={sx(page.member)}>
              <button
                class={sx(page.bare, page.person, page.hover, page.pointer)}
                onClick={() => open({ person: m.userId })}
              >
                <Identicon seed={m.userId} size={16} />
                <span class={sx(page.personName)}>{m.user.name}</span>
              </button>
              <Show when={isMember()}>
                <button
                  class={sx(page.bare, page.small, page.pointer, page.noShrink)}
                  onClick={() => void m.delete()}
                >
                  {m.userId === me().id ? "Leave" : "Remove"}
                </button>
              </Show>
            </li>
          )}
        </For>
        <Show when={isMember()}>
          <li>
            <button
              class={sx(page.bare, page.person, page.hover, page.pointer, page.small)}
              onClick={() => setDialog({ kind: "addMember", subspace: s() })}
            >
              {icon(i.Add01Icon)} Add member…
            </button>
          </li>
        </Show>
      </ul>
      <Threads
        base={[{ subspaceIds: { contains: s().id } }]}
        newThread={{ kind: "newThread", subspaceId: s().id }}
        empty="No threads here yet."
      />
    </div>
  );
}

const ROLE = { admin: "Admin", member: "Member" };

// Someone and their role here, and the threads they own or are assigned. Your own also lists the workspace's members.
export function PersonView(props: { user: User }): JSX.Element {
  const u = (): User => props.user;
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
          base={[{ or: [{ ownerId: { eq: u().id } }, { assigneeIds: { contains: u().id } }] }]}
          newThread={{ kind: "newThread", to: u() }}
          empty={`No threads with ${u().name.split(" ")[0]} yet.`}
        />
      </Show>
    </div>
  );
}
