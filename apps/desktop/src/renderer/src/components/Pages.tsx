import * as i from "@hugeicons/core-free-icons";
import { createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
  Bucket,
  Label,
  Subspace,
  SubspaceMember,
  Thread,
  User,
  View,
  WorkspaceMember,
} from "models";
import {
  byLastActive,
  me,
  memberOf,
  setDialog,
  shortDate,
  myBuckets,
  open,
  store,
  edit,
  memberIn,
  type MenuItem,
  undoable,
  workspace,
} from "../session";
import { askDeleteBucket } from "./Mail";
import { ago, dot } from "./ThreadView";
import { base } from "../styles/base";
import { chip, chipTone } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { icon } from "./Icon";
import { Identicon } from "./Identicon";
import { ComboButton, MenuChip } from "./Menus";
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

// A page's name.
function Title(props: { name: string }): JSX.Element {
  return (
    <header class={sx(page.titleRow)}>
      <h1 class={sx(page.title)}>{props.name}</h1>
    </header>
  );
}

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
            aria-label="Search Members"
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
        <Setting name="Shared" hint="Everyone in the workspace can find it and pin it.">
          <MenuChip
            label={v().shared ? "Workspace" : "Only You"}
            items={[
              { label: "Only You", run: () => edit(v(), { shared: false }, "Share View") },
              { label: "Workspace", run: () => edit(v(), { shared: true }, "Share View") },
            ]}
          />
        </Setting>
        <Setting name="Delete View" hint="Its threads stay as they are.">
          <Delete
            onClick={() => (
              open({ thread: null }),
              undoable("Delete View", () => void v().delete())
            )}
          />
        </Setting>
      </Settings>
    ),
  };
  return (
    <div class={sx(page.page)}>
      <Title name={v().name} />
      <p class={sx(page.summary)}>Its threads are listed beside; filter them there.</p>
      <Show when={v().ownerId === me().id}>
        <PageTabs pages={[settings]} />
      </Show>
    </div>
  );
}

// A bucket of your inbox: its name and what goes in it (the model sorts threads into it by that), edited in place, and
// deleting it. Its threads are listed beside.
export function BucketView(props: { bucket: Bucket }): JSX.Element {
  const b = (): Bucket => props.bucket;
  const settings: Page = {
    tab: SETTINGS,
    body: (
      <Settings>
        <Setting name="Name" hint="How it's listed in your inbox.">
          <input
            class={sx(base.bare, fields.field)}
            aria-label="Name"
            value={b().name}
            spellcheck={false}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim().slice(0, 40);
              if (name && name !== b().name) edit(b(), { name }, "Rename Bucket");
            }}
          />
        </Setting>
        <Setting name="What goes in it" hint="Threads like this are sorted into it.">
          <textarea
            class={sx(base.bare, fields.field, fields.area)}
            aria-label="What goes in it"
            rows={1}
            value={b().description}
            onBlur={(event) => {
              const description = event.currentTarget.value.trim().slice(0, 500);
              if (description !== b().description) edit(b(), { description }, "Edit Bucket");
            }}
          />
        </Setting>
        {/* Sorting needs somewhere to put things. */}
        <Show when={myBuckets().length > 1}>
          <Setting name="Delete Bucket" hint="Its threads go back to be sorted.">
            <button
              class={sx(base.hover, chip.chip, chipTone.urgent)}
              onClick={(event) => askDeleteBucket(event.currentTarget.getBoundingClientRect(), b())}
            >
              Delete
            </button>
          </Setting>
        </Show>
      </Settings>
    ),
  };
  return (
    <div class={sx(page.page)}>
      <Title name={b().name} />
      <p class={sx(page.summary)}>Its threads are listed beside; filter them there.</p>
      <PageTabs pages={[settings]} />
    </div>
  );
}

// A setting's text field: plain text with a quiet border, a wash while you're in it.
const fields = stylex.create({
  field: {
    width: 280,
    padding: "4px 8px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.control,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    backgroundColor: { default: "transparent", ":focus": colors.bgQuaternary },
  },
  area: { resize: "none", fieldSizing: "content", minHeight: 24 },
});

// A label: its threads are listed beside, and here it can go.
export function LabelView(props: { label: Label }): JSX.Element {
  const l = (): Label => props.label;
  const settings: Page = {
    tab: SETTINGS,
    body: (
      <Settings>
        <Setting name="Delete Label" hint="It comes off its threads, which stay as they are.">
          <Delete
            onClick={() => (
              open({ thread: null }),
              undoable("Delete Label", () => void l().delete())
            )}
          />
        </Setting>
      </Settings>
    ),
  };
  return (
    <div class={sx(page.page)}>
      <Title name={l().name} />
      <p class={sx(page.summary)}>Its threads are listed beside; filter them there.</p>
      <PageTabs pages={[settings]} />
    </div>
  );
}

// ── A space's overview: how it's doing at a glance ──

const DAY = 86_400_000;
const startOfToday = (): number => new Date().setHours(0, 0, 0, 0);
// Due before today, and not done.
const overdue = (t: Thread): boolean =>
  t.isOpen && t.dueAt !== undefined && t.dueAt.getTime() < startOfToday();
// Due from today through the next seven days.
const dueSoon = (t: Thread): boolean =>
  t.isOpen &&
  t.dueAt !== undefined &&
  t.dueAt.getTime() >= startOfToday() &&
  t.dueAt.getTime() < startOfToday() + 7 * DAY;
const pressing = (t: Thread): boolean => t.priority === "urgent" || t.priority === "high";
// Why a thread needs a look, most pressing first: blocked, late, then urgent or high.
const attention = (t: Thread): number =>
  !t.isOpen ? -1 : t.state === "blocked" ? 0 : overdue(t) ? 1 : pressing(t) ? 2 : -1;

// A thread as a line of the overview: its status, title, who's on it, and when (due, or last active).
function ThreadLine(props: { thread: Thread; why?: string }): JSX.Element {
  const t = (): Thread => props.thread;
  const when = (): string =>
    t().dueAt && t().isOpen ? `Due ${shortDate(t().dueAt!)}` : ago(t().updatedAt);
  return (
    <li>
      <button class={sx(base.bare, overview.line)} onClick={() => open({ thread: t().id })}>
        {dot(t().state)}
        <span class={sx(base.ellipsis, overview.lineTitle)}>{t().title}</span>
        <Show when={props.why}>
          <span class={sx(overview.why)}>{props.why}</span>
        </Show>
        <span class={sx(page.avatars, overview.faces)}>
          <For each={t().assigneeIds.slice(0, 3)}>
            {(id) => <Identicon seed={id} size={16} class={sx(page.avatar)} />}
          </For>
        </span>
        <span class={sx(overview.when, overdue(t()) && overview.urgent)}>{when()}</span>
      </button>
    </li>
  );
}

function Lines(props: {
  title: string;
  threads: Thread[];
  why?: (t: Thread) => string;
}): JSX.Element {
  return (
    <Show when={props.threads.length > 0}>
      <section class={sx(overview.section)}>
        <h2 class={sx(overview.heading)}>{props.title}</h2>
        <ul class={sx(base.list)}>
          <For each={props.threads}>{(t) => <ThreadLine thread={t} why={props.why?.(t)} />}</For>
        </ul>
      </section>
    </Show>
  );
}

// How a space's threads stand: its counts as one line for the header (how many are open, then only what's not
// nothing), and its lists for under its members.
function overviewOf(s: () => Subspace): { counts: () => JSX.Element; body: JSX.Element } {
  const threads = createMemo(() => store.all(Thread).filter((t) => t.subspaceIds.includes(s().id)));
  const unresolved = createMemo(() => threads().filter((t) => t.isOpen));
  const needs = createMemo(() =>
    unresolved()
      .filter((t) => attention(t) >= 0)
      .sort(
        (a, b) =>
          attention(a) - attention(b) ||
          (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity),
      )
      .slice(0, 6),
  );
  const upcoming = createMemo(() =>
    unresolved()
      .filter(dueSoon)
      .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())
      .slice(0, 6),
  );
  const recent = createMemo(() => byLastActive([...threads()]).slice(0, 6));
  // Late shows in its date, in red; the rest say why.
  const why = (t: Thread): string =>
    t.state === "blocked"
      ? "Blocked"
      : overdue(t)
        ? ""
        : t.priority === "urgent"
          ? "Urgent"
          : "High priority";
  const counts = (): JSX.Element => {
    // An empty space says so where its threads would be, not with a count of none.
    if (threads().length === 0) return null;
    const blocked = unresolved().filter((t) => t.state === "blocked").length;
    const late = unresolved().filter(overdue).length;
    const soon = unresolved().filter(dueSoon).length;
    const calendar = (): JSX.Element => icon(i.Calendar03Icon, 12);
    const parts: { mark: () => JSX.Element; text: string; urgent?: boolean }[] = [
      { mark: () => dot("open"), text: `${unresolved().length} open` },
      ...(blocked
        ? [{ mark: () => dot("blocked"), text: `${blocked} blocked`, urgent: true }]
        : []),
      ...(late ? [{ mark: calendar, text: `${late} overdue`, urgent: true }] : []),
      ...(soon ? [{ mark: calendar, text: `${soon} due this week` }] : []),
    ];
    return (
      <For each={parts}>
        {(part) => (
          <span class={sx(overview.count, part.urgent && overview.urgent)}>
            {part.mark()}
            {part.text}
          </span>
        )}
      </For>
    );
  };
  return {
    counts,
    body: (
      <Show
        when={threads().length > 0}
        fallback={
          <section class={sx(overview.section)}>
            <h2 class={sx(overview.heading)}>Threads</h2>
            <button
              class={sx(base.bare, overview.line, overview.newLine)}
              onClick={() => setDialog({ kind: "newThread", subspaceId: s().id })}
            >
              {icon(i.Add01Icon, 13)}
              <span class={sx(overview.lineTitle)}>New Thread</span>
              <span class={sx(overview.when)}>⌘N</span>
            </button>
          </section>
        }
      >
        <Lines title="Needs attention" threads={needs()} why={why} />
        <Lines title="Coming up" threads={upcoming()} />
        <Lines title="Recently active" threads={recent()} />
      </Show>
    ),
  };
}

const overview = stylex.create({
  urgent: { color: colors.urgent },
  // A count after its mark (a status's dot, a calendar), as a property is.
  count: {
    display: "inline-flex",
    gap: 5,
    alignItems: "center",
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },
  section: { maxWidth: 720, marginTop: 24, containerType: "inline-size" },
  // Who's on a thread, until the page is too narrow to spare them the room.
  faces: { flexShrink: 0, display: { default: "flex", "@container (max-width: 420px)": "none" } },
  headingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 28,
  },
  headingCount: { marginLeft: 4, color: colors.textTertiary, fontWeight: 400 },
  // Ten rows, then it scrolls.
  // Its rows' grounds reach 8px past the text, so it makes room for them on both sides (it scrolls, so it clips).
  people: {
    maxHeight: 300,
    marginInline: -8,
    paddingInline: 8,
    overflowY: "auto",
    overflowX: "hidden",
  },
  personName: {
    display: "flex",
    flex: 1,
    gap: 8,
    alignItems: "center",
    minWidth: 0,
    height: "100%",
  },
  email: { marginLeft: 8, color: colors.textTertiary },
  // Shown over the end of the row under the pointer (or reached by Tab), so it takes no room from the name.
  remove: {
    position: "absolute",
    right: 4,
    height: 22,
    paddingInline: 6,
    borderRadius: radii.control,
    fontSize: fontSizes.small,
    cursor: "pointer",
    opacity: { default: 0, ":focus-visible": 1, [stylex.when.ancestor(":hover")]: 1 },
    backgroundColor: { default: colors.bgTertiary, ":hover": colors.bgQuaternary },
  },
  person: { position: "relative" },
  // A quiet button by a heading: an icon and a word, on a ground under the pointer.
  headingButton: {
    display: "inline-flex",
    flexShrink: 0,
    gap: 4,
    alignItems: "center",
    height: 24,
    marginRight: -8,
    paddingInline: 8,
    borderRadius: radii.row,
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    fontSize: fontSizes.small,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": colors.bgTertiary },
  },
  lock: { display: "flex", color: colors.iconTertiary },
  settings: { marginLeft: "auto", marginRight: -6 },
  settingsButton: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: radii.row,
    color: colors.iconTertiary,
  },
  heading: {
    margin: "0 0 4px",
    color: colors.textTertiary,
    fontSize: fontSizes.caption,
    fontWeight: 500,
  },
  // A row whose ground reaches 8px past the text on both sides, so the text lines up with the headings.
  line: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    boxSizing: "border-box",
    width: "calc(100% + 16px)",
    height: 30,
    marginInline: -8,
    paddingInline: 8,
    borderRadius: radii.row,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    textAlign: "start",
    cursor: "default",
    backgroundColor: { default: "transparent", ":hover": colors.bgTertiary },
  },
  lineTitle: { flex: 1, minWidth: 0 },
  why: { flexShrink: 0, color: colors.urgent, fontSize: fontSizes.small },
  when: {
    flexShrink: 0,
    minWidth: 64,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    textAlign: "end",
    fontVariantNumeric: "tabular-nums",
  },
  // The first thread's row, where the threads will be: quiet until the pointer's on it.
  newLine: { color: { default: colors.textTertiary, ":hover": colors.textPrimary } },
  // The header as wide as the sections under it, so its menu lines up with their buttons.
  header: { maxWidth: 720 },
  // Under the description: how its threads stand.
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "center",
    marginTop: 10,
    marginBottom: 4,
  },
});

// A subspace, on one page: its name and description (members edit them in place) and how its threads stand; who's in
// it (members add or remove people, anyone joins an open one); then what needs a look, what's coming up and what's been
// active. Its visibility and deleting it are in the menu by its name.
export function SubspaceView(props: { subspace: Subspace }): JSX.Element {
  const s = (): Subspace => props.subspace;
  const isMember = (): boolean => memberIn(s(), me().id) !== undefined;
  const toggle = (user: User): void => {
    const existing = memberIn(s(), user.id);
    undoable(existing ? "Remove Member" : "Add Member", () => {
      if (existing) void existing.delete();
      else store.create(SubspaceMember, { subspace: s(), user });
    });
  };
  const isPrivate = (): boolean => s().visibility === "private";
  const people = (): User[] =>
    s()
      .members.sorted("createdAt")
      .flatMap((m) => m.user ?? []);
  const summary = overviewOf(s);
  const settings = (): MenuItem[] => [
    {
      label: "Open: Anyone Can Join",
      checked: !isPrivate(),
      run: () => edit(s(), { visibility: "open" }, "Change Visibility"),
    },
    {
      label: "Private: Members Only",
      checked: isPrivate(),
      run: () => edit(s(), { visibility: "private" }, "Change Visibility"),
    },
    "separator",
    {
      label: "Delete Space",
      icon: icon(i.Delete02Icon, 13),
      run: () => (open({ thread: null }), undoable("Delete Space", () => void s().delete())),
    },
  ];
  return (
    <div class={sx(page.page)}>
      <header class={sx(page.titleRow, overview.header)}>
        <h1 class={sx(page.title)}>{s().name}</h1>
        <Show when={isPrivate()}>
          <span class={sx(overview.lock)} title="Private: members only">
            {icon(i.SquareLock01Icon, 14)}
          </span>
        </Show>
        <Show when={isMember()}>
          <span class={sx(overview.settings)}>
            <MenuChip
              look={[base.bare, base.hover, overview.settingsButton]}
              title="Space Settings"
              label={icon(i.MoreHorizontalIcon, 14)}
              items={settings()}
            />
          </span>
        </Show>
      </header>
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
          onBlur={(event) => {
            // Only a change is a step to undo.
            const description = event.currentTarget.value.trim() || undefined;
            if (description !== s().description) edit(s(), { description }, "Edit Description");
          }}
        />
      </Show>
      <div class={sx(overview.meta)}>{summary.counts()}</div>
      <section class={sx(overview.section)}>
        <div class={sx(overview.headingRow)}>
          <h2 class={sx(overview.heading)}>
            Members <span class={sx(overview.headingCount)}>{people().length}</span>
          </h2>
          {/* Members add people from a list under the button; anyone else can join. */}
          <Show
            when={isMember()}
            fallback={
              <button class={sx(base.bare, overview.headingButton)} onClick={() => toggle(me())}>
                {icon(i.Add01Icon, 12)}
                Join
              </button>
            }
          >
            <ComboButton
              label={
                <>
                  {icon(i.Add01Icon, 12)}
                  Add
                </>
              }
              class={sx(base.bare, overview.headingButton)}
              placeholder="Add someone"
              empty="Everyone's in it."
              options={(query) =>
                store
                  .all(User)
                  .filter((u) => !memberIn(s(), u.id) && u.name.toLowerCase().includes(query))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((u) => ({ label: u.name, seed: u.id, run: () => toggle(u) }))
              }
            />
          </Show>
        </div>
        {/* Ten at a time; more scroll. */}
        <ul class={sx(base.list, overview.people)}>
          <For each={people()}>
            {(u) => (
              <li
                class={sx(overview.line, overview.person, stylex.defaultMarker())}
                onClick={() => open({ person: u.id })}
              >
                <span class={sx(overview.personName)}>
                  <Identicon seed={u.id} size={18} />
                  <span class={sx(base.ellipsis, overview.lineTitle)}>
                    {u.name}
                    <span class={sx(overview.email)}>{u.email}</span>
                  </span>
                </span>
                <Show when={isMember()}>
                  <button
                    class={sx(base.bare, base.dim, overview.remove)}
                    onClick={(event) => (event.stopPropagation(), toggle(u))}
                  >
                    {u.id === me().id ? "Leave" : "Remove"}
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </section>
      {summary.body}
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
            <span class={sx(page.recording)}>Press keys</span>
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
        <SearchBox label="Search Hotkeys" value={search()} onInput={setSearch} />
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
      {/* You, then your settings: what the sidebar's button at its foot opens. */}
      <header class={sx(page.header)}>
        <Identicon seed={me().id} size={40} />
        <div>
          <h1 class={sx(page.title)}>{me().name}</h1>
          <p class={sx(page.summary)}>
            {[me().email, ROLE[memberOf(me())?.role ?? "member"]].filter(Boolean).join(" · ")}
          </p>
        </div>
      </header>
      <p class={sx(page.description)}>
        How Arc works for you, and who's in {workspace().name}. To change a hotkey, click it and
        press the keys you want: Escape cancels, and ⌫ leaves it without any. Hotkeys are kept on
        this Mac.
      </p>
      <PageTabs pages={[hotkeys, people]} />
    </div>
  );
}
