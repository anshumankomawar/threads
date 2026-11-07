import * as i from "@hugeicons/core-free-icons";
import { createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Subspace, SubspaceMember, User, View, WorkspaceMember } from "models";
import { me, memberOf, open, setDialog, store, edit, memberIn, workspace } from "../session";
import { base } from "../styles/base";
import { button, chip, chipTone } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { icon } from "./Icon";
import { Identicon } from "./Identicon";
import { MenuChip } from "./Menus";
import { Table, Toolbar, type Column } from "./Table";
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
import type { Tab } from "./Tabs";

// A page's name, and a lock when not everyone sees it (`locked` says who does).
function Title(props: { name: string; locked?: string }): JSX.Element {
  return (
    <header class={sx(page.titleRow)}>
      <h1 class={sx(page.title)}>{props.name}</h1>
      <Show when={props.locked}>
        <span class={sx(page.lock)} title={props.locked}>
          {icon(i.SquareLock01Icon, 14)}
        </span>
      </Show>
    </header>
  );
}

// A page's settings: each a name and what it does on the left, its control on the right. Straight under the toolbar,
// so the first one's name lines up with a table's header.
const Settings = (props: { children: JSX.Element }): JSX.Element => (
  <ul class={sx(page.list, page.narrow)}>{props.children}</ul>
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
const MEMBERS: Tab = { label: "Members", icon: i.UserMultipleIcon };
const SETTINGS: Tab = { label: "Settings", icon: i.Settings02Icon };

// A tab of a page: its tools, in the toolbar beside the tabs, and what it shows under them. Made once, so a tab keeps
// its filters and search while you're on another.
type Page = { tab: Tab; tools?: JSX.Element; body: JSX.Element };

// A page's tabs in one toolbar, under its title and description, and the chosen tab's tools and body. The toolbar stays
// as you switch, so the chosen tab opens out to its name. A tab that goes (Settings, when you leave) falls back to the
// first.
function PageTabs(props: { pages: Page[] }): JSX.Element {
  const [chosen, choose] = createSignal(untrack(() => props.pages[0].tab));
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

const pill = (text: string, before?: JSX.Element): JSX.Element => (
  <span class={sx(page.pill)}>
    {before}
    <span class={sx(base.ellipsis)}>{text}</span>
  </span>
);
// A members table's columns: anyone's name, email and role in the workspace.
const MEMBER_COLUMNS: Column<User>[] = [
  {
    label: "Name",
    icon: i.TextFontIcon,
    width: 240,
    sort: (u) => u.name.toLowerCase(),
    cell: (u) => (
      <span class={sx(page.inCell)}>
        <Identicon seed={u.id} size={18} />
        <span class={sx(base.ellipsis, page.titleText)}>{u.name}</span>
      </span>
    ),
  },
  {
    label: "Email",
    icon: i.Mail01Icon,
    width: 240,
    sort: (u) => u.email ?? "",
    cell: (u) => u.email,
  },
  {
    label: "Role",
    icon: i.UserIcon,
    width: 120,
    sort: (u) => memberOf(u)?.role ?? "member",
    cell: (u) => pill(ROLE[memberOf(u)?.role ?? "member"]),
  },
];
const ROLE = { admin: "Admin", member: "Member" };

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
        <label class={sx(page.search)}>
          {icon(i.Search01Icon, 13)}
          <input
            class={sx(base.bare, page.searchInput)}
            aria-label="Search members"
            placeholder="Search"
            spellcheck={false}
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) =>
              event.key === "Escape" && (setSearch(""), event.currentTarget.blur())
            }
          />
        </label>
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

const Delete = (props: { onClick: () => void }): JSX.Element => (
  <button class={sx(base.hover, chip.chip, chipTone.urgent)} onClick={() => props.onClick()}>
    Delete
  </button>
);

export function SavedView(props: { view: View }): JSX.Element {
  const v = (): View => props.view;
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
      <Title name={v().name} locked={v().shared ? undefined : "Only you see this view"} />
      <p class={sx(page.summary)}>Its threads are listed beside; filter them there.</p>
      <Show when={v().ownerId === me().id}>
        <PageTabs pages={[settings]} />
      </Show>
    </div>
  );
}

// A subspace: who's in it and whether it's private (its threads are listed beside). Members add or remove people; anyone
// joins an open one.
export function SubspaceView(props: { subspace: Subspace }): JSX.Element {
  const s = (): Subspace => props.subspace;
  const isMember = (): boolean => memberIn(s(), me().id) !== undefined;
  const toggle = (user: User): void => {
    const existing = memberIn(s(), user.id);
    if (existing) void existing.delete();
    else store.create(SubspaceMember, { subspace: s(), user });
  };
  const isPrivate = (): boolean => s().visibility === "private";
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
            icon={icon(isPrivate() ? i.SquareLock01Icon : i.ViewIcon)}
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
      <Title
        name={s().name}
        locked={isPrivate() ? "Private: only its members see it" : undefined}
      />
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
          placeholder="Add a description…"
          rows={1}
          value={s().description ?? ""}
          onKeyDown={(event) => event.key === "Escape" && event.currentTarget.blur()}
          onBlur={(event) =>
            edit(s(), { description: event.currentTarget.value.trim() || undefined })
          }
        />
      </Show>
      <PageTabs pages={isMember() ? [people, settings] : [people]} />
    </div>
  );
}

// Someone and their role here; the threads they own or are assigned are listed beside.
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
    </div>
  );
}

function SearchBox(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
}): JSX.Element {
  return (
    <label class={sx(page.search)}>
      {icon(i.Search01Icon, 13)}
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

const HOTKEYS_TAB: Tab = { label: "Hotkeys", icon: i.KeyboardIcon };

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
      icon: i.TextFontIcon,
      width: 280,
      sort: (h) => h.label,
      cell: (h) => <span class={sx(page.titleText)}>{h.label}</span>,
    },
    {
      label: "Section",
      icon: i.Folder01Icon,
      width: 140,
      sort: (h) => HOTKEYS.findIndex((other) => other.section === h.section),
      cell: (h) => h.section,
    },
    {
      label: "Keys",
      icon: i.CommandIcon,
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
            <span class={sx(page.recording)}>Press keys…</span>
          </Show>
        </button>
      ),
    },
  ];
  const people = members({ users: () => store.all(WorkspaceMember).flatMap((m) => m.user ?? []) });
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
      <PageTabs pages={[hotkeys, people]} />
    </div>
  );
}
