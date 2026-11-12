import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
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
  setDialog,
  store,
  threadMenu,
  type Dialog,
  edit,
  firstName,
  memberIn,
  settingsStart,
  setSettingsStart,
  toggled,
  workspace,
} from "../session";
import { save, saved } from "../startup";
import {
  bind,
  caps,
  changed,
  HOTKEYS,
  keysFor,
  keysOf,
  reset,
  resetAll,
  type Hotkey,
  type HotkeyId,
} from "../hotkeys";
import { base } from "../styles/base";
import { button, chip, chipTone } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors } from "../styles/tokens.stylex";
import { icon } from "./Icon";
import { Identicon } from "./Identicon";
import { MenuChip } from "./Menus";
import { iconTool, Table, Toolbar, type Column } from "./Table";
import type { Tab } from "./Tabs";
import { ago, dot, LABELS } from "./ThreadView";

// A page's settings: each a name and what it does on the left, its control on the right. Straight under the toolbar,
// so the first one's name lines up with a table's header.
const Settings = (props: { children: JSX.Element }): JSX.Element => (
  <ul class={sx(base.list, page.narrow)}>{props.children}</ul>
);
function Setting(props: { name: string; hint: string; children: JSX.Element }): JSX.Element {
  return (
    <li class={sx(page.setting)}>
      <span class={sx(page.itemBody)}>
        <span class={sx(page.itemName)}>{props.name}</span>
        <span class={sx(page.small)}>{props.hint}</span>
      </span>
      {props.children}
    </li>
  );
}
const THREADS: Tab = { label: "Threads", icon: "conversation" };
const MEMBERS: Tab = { label: "Members", icon: "user-list-alt" };
const SETTINGS: Tab = { label: "Settings", icon: "settings" };

// A tab of a page: its tools, in the toolbar beside the tabs, and what it shows under them. Made once, so a tab keeps
// its filters and search while you're on another.
type Page = { tab: Tab; tools?: JSX.Element; body: JSX.Element };

// A page's tabs in one toolbar, under its title and description, and the chosen tab's tools and body. The toolbar stays
// as you switch, so the chosen tab opens out to its name. A tab that goes (Settings, when you leave) falls back to the
// first.
function PageTabs(props: { pages: Page[]; start?: string }): JSX.Element {
  const [chosen, choose] = createSignal(
    untrack(() => (props.pages.find((p) => p.tab.label === props.start) ?? props.pages[0]).tab),
  );
  const current = (): Page => props.pages.find((p) => p.tab === chosen()) ?? props.pages[0];
  return (
    <>
      <Toolbar tabs={props.pages.map((p) => p.tab)} chosen={current().tab} onChoose={choose}>
        {current().tools}
      </Toolbar>
      {current().body}
    </>
  );
}

const labelsOf = (t: Thread): Label[] =>
  t.labelIds.flatMap((id) => store.findById(Label, id) ?? []);
const pill = (text: string, before?: JSX.Element): JSX.Element => (
  <span class={sx(page.pill)}>
    {before}
    <span class={sx(base.clip)}>{text}</span>
  </span>
);
const COLUMNS: Column<Thread>[] = [
  {
    label: "Title",
    icon: "font",
    width: 256,
    sort: (t) => t.title.toLowerCase(),
    cell: (t) => <span class={sx(page.titleText)}>{t.title}</span>,
  },
  {
    label: "Status",
    icon: "sync",
    width: 108,
    sort: (t) => ORDER.indexOf(t.state),
    cell: (t) => pill(LABELS[t.state], dot(t.state)),
  },
  {
    label: "Priority",
    icon: "priority",
    width: 104,
    sort: (t) => PRIORITIES.indexOf(t.priority),
    cell: (t) => (t.priority === "none" ? "" : pill(LABELS[t.priority])),
  },
  {
    label: "Owner",
    icon: "user",
    width: 136,
    sort: (t) => t.owner?.name ?? "",
    cell: (t) => (
      <Show when={t.owner}>
        {(owner) => (
          <span class={sx(page.inCell)}>
            <Identicon seed={owner().id} size={18} />
            <span class={sx(base.clip)}>{owner().name}</span>
          </span>
        )}
      </Show>
    ),
  },
  {
    label: "Assignees",
    icon: "user-list-alt",
    width: 100,
    sort: (t) => t.assigneeIds.length,
    cell: (t) => (
      <span
        class={sx(page.avatars)}
        title={assignees(t)
          .map((u) => u.name)
          .join(", ")}
      >
        <For each={assignees(t)}>
          {(u) => <Identicon seed={u.id} size={18} class={sx(page.avatar)} />}
        </For>
      </span>
    ),
  },
  {
    label: "Labels",
    icon: "tag",
    width: 152,
    sort: (t) =>
      labelsOf(t)
        .map((l) => l.name)
        .join(),
    cell: (t) => (
      <span class={sx(page.pills)}>
        <For each={labelsOf(t)}>{(label) => pill(label.name)}</For>
      </span>
    ),
  },
  {
    label: "Updated",
    icon: "clock",
    width: 104,
    sort: (t) => t.updatedAt.getTime(),
    cell: (t) => ago(t.updatedAt),
  },
];
// The columns the tables leave out, picked under Properties and kept for next time (so a column added later shows).
// The title always shows.
const [columnsHidden, setColumnsHidden] = createSignal<string[]>(saved("hiddenColumns", []));
const hideColumn = (label: string): void => {
  setColumnsHidden(toggled(columnsHidden(), label));
  save("hiddenColumns", columnsHidden());
};
const visible = (): Column<Thread>[] => COLUMNS.filter((c) => !columnsHidden().includes(c.label));
// A members table's columns: anyone's name, email and role in the workspace.
const MEMBER_COLUMNS: Column<User>[] = [
  {
    label: "Name",
    icon: "font",
    width: 240,
    sort: (u) => u.name.toLowerCase(),
    cell: (u) => (
      <span class={sx(page.inCell)}>
        <Identicon seed={u.id} size={18} />
        <span class={sx(base.clip, page.titleText)}>{u.name}</span>
      </span>
    ),
  },
  {
    label: "Email",
    icon: "mail",
    width: 240,
    sort: (u) => u.email ?? "",
    cell: (u) => u.email,
  },
  {
    label: "Role",
    icon: "user",
    width: 120,
    sort: (u) => memberOf(u)?.role ?? "member",
    cell: (u) => pill(ROLE[memberOf(u)?.role ?? "member"]),
  },
];
const ROLE = { admin: "Admin", member: "Member" };

// A search field for a tab's tools; Escape clears it.
function SearchBox(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
}): JSX.Element {
  return (
    <label class={sx(page.search)}>
      {icon("search", 13)}
      <input
        class={sx(base.bare, page.searchInput)}
        aria-label={props.label}
        placeholder="Search"
        spellcheck={false}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) =>
          event.key === "Escape" && (props.onInput(""), event.currentTarget.blur())
        }
      />
    </label>
  );
}

// People as a page's tab: a table, with a search and `action` (Add member, Join) in its tools; `end` is what you can do
// to each, at their row's end.
function members(props: {
  users: () => User[];
  action?: JSX.Element;
  end?: (u: User) => JSX.Element;
}): Page {
  const [search, setSearch] = createSignal("");
  const shown = (): User[] => {
    const query = search().trim().toLowerCase();
    return props
      .users()
      .filter((u) => [u.name, u.email ?? ""].some((text) => text.toLowerCase().includes(query)));
  };
  return {
    tab: MEMBERS,
    tools: (
      <>
        <SearchBox label="Search members" value={search()} onInput={setSearch} />
        {props.action}
      </>
    ),
    body: (
      <Table
        columns={MEMBER_COLUMNS}
        rows={shown()}
        empty="Nobody matches."
        open={(u) => open({ person: u.id })}
        end={props.end}
      />
    ),
  };
}

const assignees = (t: Thread): User[] =>
  t.assigneeIds.flatMap((id) => store.findById(User, id) ?? []);
// The thread list's order by status, resolved last.
const ORDER: Thread["state"][] = ["open", "blocked", "resolved"];

const Delete = (props: { onClick: () => void }): JSX.Element => (
  <button class={sx(base.hover, chip.chip, chipTone.urgent)} onClick={() => props.onClick()}>
    Delete
  </button>
);
const people = (): [string, string][] => [
  ["$me", "Me"],
  ...store.all(User).map((u): [string, string] => [u.id, u.name]),
];

// The thread fields a filter can test, how, and the values it offers.
const FIELDS: Record<
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

// A page's Threads tab: a table view of the threads that pass `base` and the conditions you add, as in Notion, with
// Filter, Properties and New in its tools. Until you sort, open threads come first, then blocked, then resolved
// (dimmed), newest first in each. Conditions on a subspace follow it, so its threads load even if you're not in it. Unsaved, the conditions can become a saved view; on a saved view's page they're its filter.
function threadsTab(props: {
  base: Filter[];
  view?: View;
  newThread: Extract<Dialog, { kind: "newThread" }>;
  empty: string;
}): Page {
  const [conditions, setConditions] = createSignal<Filter[]>(
    untrack(() => props.view?.filter.and ?? []),
  );
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
    if (props.view) edit(props.view, { filter: { and: next } });
  };
  const threads = (): Thread[] =>
    store
      .all(Thread)
      .filter((t) => matches(t, filter(), { me: me().id }))
      .sort(
        (a, b) =>
          ORDER.indexOf(a.state) - ORDER.indexOf(b.state) ||
          b.updatedAt.getTime() - a.updatedAt.getTime(),
      );
  return {
    tab: THREADS,
    tools: (
      <>
        <MenuChip
          look={iconTool}
          title="Filter"
          label={icon("filter", 16)}
          items={Object.entries(FIELDS).map(([field, { label, compare, values }]) => ({
            label,
            items: values().map(([value, name]) => ({
              label: name,
              run: () => change([...conditions(), { [field]: { [compare]: value } }]),
            })),
          }))}
        />
        <MenuChip
          look={iconTool}
          title="Properties"
          label={icon("display-options", 16)}
          items={COLUMNS.slice(1).map((c) => ({
            label: c.label,
            icon: icon(c.icon, 13),
            checked: !columnsHidden().includes(c.label),
            run: () => hideColumn(c.label),
          }))}
        />
        <button
          class={sx(base.bare, button.solid)}
          title={`New thread (${keysFor("newThread")})`}
          onClick={() => setDialog(props.newThread)}
        >
          New
        </button>
      </>
    ),
    body: (
      <>
        <Show when={conditions().length > 0}>
          <div class={sx(page.filters)}>
            <For each={conditions()}>
              {(condition) => (
                <button
                  class={sx(base.bare, base.hover, page.filterPill)}
                  title="Remove"
                  onClick={() => change(conditions().filter((c) => c !== condition))}
                >
                  {describe(condition)}
                  {icon("close", 11)}
                </button>
              )}
            </For>
            <Show when={!props.view}>
              <button
                class={sx(base.bare, base.dim, page.filterPill)}
                onClick={() => setDialog({ kind: "newView", filter: filter() })}
              >
                Save view
              </button>
            </Show>
          </div>
        </Show>
        <Table
          columns={visible()}
          rows={threads()}
          empty={props.empty}
          open={(t) => open({ thread: t.id })}
          menu={threadMenu}
          dim={(t) => !t.isOpen}
          hide={hideColumn}
        />
      </>
    ),
  };
}

// Workspace: every thread you can see, to filter and save as a view.
export function WorkspaceView(): JSX.Element {
  const threads = threadsTab({
    base: [],
    newThread: { kind: "newThread" },
    empty: "No threads yet.",
  });
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>Workspace</h1>
      <PageTabs pages={[threads]} />
    </div>
  );
}

export function SavedView(props: { view: View }): JSX.Element {
  const v = (): View => props.view;
  const threads = threadsTab({
    base: [],
    view: v(),
    newThread: { kind: "newThread" },
    empty: "Nothing matches.",
  });
  const settings: Page = {
    tab: SETTINGS,
    body: (
      <Settings>
        <Setting name="Shared" hint="Everyone in the workspace sees it in their sidebar.">
          <MenuChip
            label={v().shared ? "Workspace" : "Only you"}
            items={[
              { label: "Only you", run: () => edit(v(), { shared: false }) },
              { label: "Workspace", run: () => edit(v(), { shared: true }) },
            ]}
          />
        </Setting>
        <Setting name="Delete view" hint="Its threads stay as they are.">
          <Delete onClick={() => (open({ thread: null }), void v().delete())} />
        </Setting>
      </Settings>
    ),
  };
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>{v().name}</h1>
      <PageTabs pages={v().ownerId === me().id ? [threads, settings] : [threads]} />
    </div>
  );
}

export function LabelView(props: { label: Label }): JSX.Element {
  const threads = threadsTab({
    base: [{ labelIds: { contains: props.label.id } }],
    newThread: { kind: "newThread", labelId: props.label.id },
    empty: "Nothing here yet.",
  });
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>{props.label.name}</h1>
      <PageTabs pages={[threads]} />
    </div>
  );
}

// A subspace: who's in it, whether it's private, and its threads. Members add or remove people; anyone joins an open one.
export function SubspaceView(props: { subspace: Subspace }): JSX.Element {
  const s = (): Subspace => props.subspace;
  const isMember = (): boolean => memberIn(s(), me().id) !== undefined;
  const toggle = (user: User): void => {
    const existing = memberIn(s(), user.id);
    if (existing) void existing.delete();
    else store.create(SubspaceMember, { subspace: s(), user });
  };
  const isPrivate = (): boolean => s().visibility === "private";
  const threads = threadsTab({
    base: [{ subspaceIds: { contains: s().id } }],
    newThread: { kind: "newThread", subspaceId: s().id },
    empty: "No threads here yet.",
  });
  const people = members({
    users: () =>
      s()
        .members.sorted("createdAt")
        .flatMap((m) => m.user ?? []),
    action: (
      <button
        class={sx(base.bare, button.solid)}
        onClick={() =>
          isMember() ? setDialog({ kind: "addMember", subspace: s() }) : toggle(me())
        }
      >
        {isMember() ? "Add member" : "Join"}
      </button>
    ),
    end: (u) => (
      <Show when={isMember()}>
        <button class={sx(base.bare, base.dim, page.pointer)} onClick={() => toggle(u)}>
          {u.id === me().id ? "Leave" : "Remove"}
        </button>
      </Show>
    ),
  });
  const settings: Page = {
    tab: SETTINGS,
    body: (
      <Settings>
        <Setting name="Visibility" hint="Who can find it, see its threads and join.">
          <MenuChip
            label={isPrivate() ? "Private" : "Open"}
            icon={icon(isPrivate() ? "lock" : "eye")}
            items={[
              { label: "Open: anyone can join", run: () => edit(s(), { visibility: "open" }) },
              { label: "Private: members only", run: () => edit(s(), { visibility: "private" }) },
            ]}
          />
        </Setting>
        <Setting name="Delete subspace" hint="Its threads stay, outside it.">
          <Delete onClick={() => (open({ thread: null }), void s().delete())} />
        </Setting>
      </Settings>
    ),
  };
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
          class={sx(base.bare, page.description, page.descriptionField)}
          aria-label="Description"
          placeholder="Add a description"
          rows={1}
          value={s().description ?? ""}
          onKeyDown={(event) => event.key === "Escape" && event.currentTarget.blur()}
          onBlur={(event) =>
            edit(s(), { description: event.currentTarget.value.trim() || undefined })
          }
        />
      </Show>
      <PageTabs pages={isMember() ? [threads, people, settings] : [threads, people]} />
    </div>
  );
}

// The threads someone owns or is assigned: theirs on their page, yours (with "$me") in Personal.
const involving = (id: string): Filter[] => [
  { or: [{ ownerId: { eq: id } }, { assigneeIds: { contains: id } }] },
];

// Personal: the threads that are yours, a view every workspace has, beside Workspace.
export function PersonalView(): JSX.Element {
  const threads = threadsTab({
    base: involving("$me"),
    newThread: { kind: "newThread" },
    empty: "Nothing's yours yet: threads you own or are assigned show here.",
  });
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>Personal</h1>
      <PageTabs pages={[threads]} />
    </div>
  );
}

// Someone and their role here, and the threads they own or are assigned.
export function PersonView(props: { user: User }): JSX.Element {
  const u = (): User => props.user;
  const summary = (user: User): string =>
    [user.email, ROLE[memberOf(user)?.role ?? "member"]].filter(Boolean).join(" · ");
  const threads = threadsTab({
    base: involving(u().id),
    newThread: { kind: "newThread", to: u() },
    empty: `No threads with ${firstName(u())} yet.`,
  });
  return (
    <div class={sx(page.page)}>
      <header class={sx(page.header)}>
        <Identicon seed={u().id} size={40} />
        <div>
          <h1 class={sx(page.title)}>{u().name}</h1>
          <p class={sx(page.summary)}>{summary(u())}</p>
        </div>
      </header>
      <PageTabs pages={[threads]} />
    </div>
  );
}

// Keys as key caps, or a dash for a command you've left without any.
function Keys(props: { keys: string }): JSX.Element {
  return (
    <Show when={props.keys} fallback={<span class={sx(page.small)}>—</span>}>
      <span class={sx(page.caps)}>
        <For each={caps(props.keys)}>{(cap) => <kbd class={sx(page.cap)}>{cap}</kbd>}</For>
      </span>
    </Show>
  );
}

const HOTKEYS_TAB: Tab = { label: "Hotkeys", icon: "shortcut" };
const GROUPS_TAB: Tab = { label: "Groups", icon: "user-list-alt" };

const groupStyles = stylex.create({
  list: { display: "flex", flexDirection: "column", gap: 18, maxWidth: 720, paddingTop: 8 },
  head: { display: "flex", gap: 8, alignItems: "baseline" },
  end: { display: "flex", gap: 6, marginLeft: "auto" },
  people: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  remove: {
    display: "flex",
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
  },
  empty: { color: colors.textTertiary },
});

// Groups: people you @mention together. @mentioning one brings everyone in it into the thread.
function groups(): Page {
  return {
    tab: GROUPS_TAB,
    tools: (
      <button class={sx(base.hover, chip.chip)} onClick={() => setDialog({ kind: "newSubspace" })}>
        {icon("add", 12)}
        New Group
      </button>
    ),
    body: (
      <div class={sx(groupStyles.list)}>
        <For
          each={[...store.all(Subspace)].sort((a, b) => a.name.localeCompare(b.name))}
          fallback={
            <p class={sx(groupStyles.empty)}>
              No groups yet. Make one, then @mention it in a thread to bring everyone in it.
            </p>
          }
        >
          {(group) => (
            <section>
              <div class={sx(groupStyles.head)}>
                <span class={sx(page.titleText)}>@{group.name}</span>
                <span class={sx(page.small)}>
                  {group.members.length} {group.members.length === 1 ? "person" : "people"}
                </span>
                <span class={sx(groupStyles.end)}>
                  <button
                    class={sx(base.hover, chip.chip)}
                    onClick={() => setDialog({ kind: "addMember", subspace: group })}
                  >
                    {icon("new-contact", 12)}
                    Add People
                  </button>
                  <button
                    class={sx(base.hover, chip.chip, chipTone.urgent)}
                    onClick={() => void group.delete()}
                  >
                    Delete
                  </button>
                </span>
              </div>
              <div class={sx(groupStyles.people)}>
                <For each={[...group.members]}>
                  {(member) => (
                    <span class={sx(chip.chip)}>
                      <Identicon seed={member.userId} size={14} />
                      {member.user?.name ?? "Someone"}
                      <button
                        class={sx(base.bare, groupStyles.remove)}
                        aria-label={`Remove ${member.user?.name ?? "them"}`}
                        title="Remove"
                        onClick={() => void member.delete()}
                      >
                        {icon("close", 11)}
                      </button>
                    </span>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>
    ),
  };
}

// How the app works for you, a tab for each kind of setting, and the workspace's members. Hotkeys: click one, then press its new
// keys; Escape cancels and ⌫ leaves it without any. Keys another command has move to this one.
export function SettingsView(): JSX.Element {
  const [recording, setRecording] = createSignal<HotkeyId | null>(null);
  const [search, setSearch] = createSignal("");
  // Ahead of the app's own keys, so the keys you press while recording do nothing else.
  const record = (event: KeyboardEvent): void => {
    const id = recording();
    const keys = id && keysOf(event);
    if (!keys) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (keys !== "Esc") bind(id, keys === "⌫" || keys === "⌦" ? "" : keys);
    setRecording(null);
  };
  window.addEventListener("keydown", record, true);
  onCleanup(() => window.removeEventListener("keydown", record, true));
  const columns: Column<Hotkey>[] = [
    {
      label: "Action",
      icon: "font",
      width: 280,
      sort: (h) => h.label,
      cell: (h) => <span class={sx(page.titleText)}>{h.label}</span>,
    },
    {
      label: "Section",
      icon: "folder",
      width: 140,
      sort: (h) => HOTKEYS.findIndex((other) => other.section === h.section),
      cell: (h) => h.section,
    },
    {
      label: "Keys",
      icon: "shortcut",
      width: 200,
      sort: (h) => keysFor(h.id),
      // The one thing to change here: a button of its own, not the row.
      cell: (h) => (
        <button
          class={sx(
            base.bare,
            base.hover,
            page.keysButton,
            recording() === h.id && page.recordingButton,
          )}
          aria-label={`Change the keys for ${h.label}`}
          onClick={() => setRecording(recording() === h.id ? null : h.id)}
        >
          <Show when={recording() === h.id} fallback={<Keys keys={keysFor(h.id)} />}>
            <span class={sx(page.recording)}>Press keys</span>
          </Show>
        </button>
      ),
    },
  ];
  const people = members({ users: () => store.all(WorkspaceMember).flatMap((m) => m.user ?? []) });
  // Asked for once (⌘K's Groups): the next time it opens at its first tab again.
  const start = untrack(settingsStart);
  queueMicrotask(() => setSettingsStart(undefined));
  const hotkeys: Page = {
    tab: HOTKEYS_TAB,
    tools: (
      <>
        <SearchBox label="Search hotkeys" value={search()} onInput={setSearch} />
        <Show when={HOTKEYS.some((h) => changed(h.id))}>
          <button class={sx(base.bare, base.hover, base.dim, page.quiet)} onClick={resetAll}>
            Reset all
          </button>
        </Show>
      </>
    ),
    body: (
      <Table
        columns={columns}
        rows={HOTKEYS.filter((h) =>
          [h.label, h.section].some((text) =>
            text.toLowerCase().includes(search().trim().toLowerCase()),
          ),
        )}
        empty="No hotkey matches."
        end={(h) => (
          <Show when={changed(h.id)}>
            <button class={sx(base.bare, base.dim, page.pointer)} onClick={() => reset(h.id)}>
              Reset
            </button>
          </Show>
        )}
      />
    ),
  };
  return (
    <div class={sx(page.page)}>
      <h1 class={sx(page.title)}>Settings</h1>
      <p class={sx(page.description)}>
        How Arc works for you, and who's in {workspace().name}. To change a hotkey, click it and
        press the keys you want: Escape cancels, and ⌫ leaves it without any. Hotkeys are kept on
        this Mac.
      </p>
      <PageTabs pages={[hotkeys, groups(), people]} start={start} />
    </div>
  );
}
