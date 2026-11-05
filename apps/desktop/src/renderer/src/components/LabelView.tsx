import { Cancel01Icon, Tag01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import { isDone, labelSlug, type Group } from "model";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { formatRelativeTime } from "../format";
import { NO_FILTER, threadsWithLabel, type ThreadFilter } from "../groups";
import { link } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors, radii } from "../styles/tokens.stylex";
import { THREAD_ICON } from "../threadIcon";
import { Icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { ThreadRows, Toolbar } from "./ThreadItems";
import { MenuChip } from "./ThreadView";

const styles = stylex.create({
  titleButton: { color: "inherit", letterSpacing: "inherit", textAlign: "left", cursor: "text" },
  titleInput: { width: "min(100%, 640px)", outline: "none" },
  taken: { margin: "2px 0 0", color: colors.urgent },
  members: { margin: "14px 0 0" },
  member: { display: "inline-flex", gap: 5, alignItems: "center", padding: "0 7px 0 5px" },
  memberLook: { height: 22, borderRadius: radii.button, color: colors.textSecondary },
  remove: { display: "flex" },
  activity: { display: "flex", flexDirection: "column", gap: 4 },
});

function Summary(props: { icon: IconSvgElement; children: JSX.Element }): JSX.Element {
  return (
    <p class={sx(page.summary)}>
      <Icon icon={props.icon} size={11} class={sx(page.summaryIcon)} aria-hidden="true" />{" "}
      {props.children}
    </p>
  );
}

// A group's name (its members click to rename it), members, and Join, Leave and Archive.
function GroupHead(props: { group: Group; count: string }): JSX.Element {
  const app = useApp();
  const ids = (): string[] => props.group.memberIds;
  const member = (): boolean => ids().includes(app.me().id);
  const setMembers = (memberIds: string[]): void =>
    app.groups.update(props.group.id, { memberIds });
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");
  const slug = (): string => labelSlug(name().trim());
  const taken = (): boolean =>
    app.data
      .labels()
      .some(
        (label) =>
          label.id !== props.group.labelId &&
          (label.id === slug() || labelSlug(label.name) === slug()),
      );
  // A new name, from here or anyone else, ends the editing.
  createEffect(
    () => props.group.name,
    () => {
      setEditing(false);
    },
    { defer: true },
  );
  const people = () => app.data.people();
  const others = () => people().filter((person) => !ids().includes(person.id));
  const actions = () =>
    [
      [!member() && !props.group.archived, "Join", () => setMembers([...ids(), app.me().id])],
      [
        member() && ids().length > 1,
        "Leave",
        () => setMembers(ids().filter((id) => id !== app.me().id)),
      ],
      [
        member(),
        props.group.archived ? "Unarchive" : "Archive",
        () => app.groups.update(props.group.id, { archived: !props.group.archived }),
      ],
    ] as const;

  return (
    <>
      <Show
        when={editing()}
        fallback={
          <h1 class={sx(page.title)}>
            <Show when={member()} fallback={props.group.name}>
              <button
                type="button"
                class={sx(page.bare, styles.titleButton)}
                title="Rename this group"
                onClick={() => {
                  setName(props.group.name);
                  setEditing(true);
                }}
              >
                {props.group.name}
              </button>
            </Show>
          </h1>
        }
      >
        <input
          ref={(el) => queueMicrotask(() => el.focus())}
          class={sx(page.bare, page.title, styles.titleInput)}
          aria-label="Group name"
          maxlength={80}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
            if (event.key === "Enter" && slug() !== "" && !taken()) {
              app.groups.update(props.group.id, { name: name().trim() });
              setEditing(false);
            }
          }}
        />
        <Show when={taken()}>
          <p class={sx(styles.taken)}>That name is taken in your organization.</p>
        </Show>
      </Show>
      <Summary icon={UserGroupIcon}>
        {`${ids().length} member${ids().length === 1 ? "" : "s"} · ${props.count}`}
        {props.group.archived && " · Archived"}
      </Summary>
      <ul class={sx(page.list, page.row, page.narrow, styles.members)} aria-label="Members">
        <For each={ids().flatMap((id) => people().find((person) => person.id === id) ?? [])}>
          {(person) => (
            <li class={sx(page.border, styles.member, styles.memberLook)}>
              <Identicon seed={person.id} size={14} />
              <button
                type="button"
                class={sx(link.person)}
                onClick={() => app.nav.openPerson(person.id)}
              >
                {person.name}
              </button>
              <Show when={member() && ids().length > 1}>
                <button
                  type="button"
                  class={sx(page.bare, page.pointer, page.action, styles.remove)}
                  aria-label={`Remove ${person.name}`}
                  onClick={() => setMembers(ids().filter((id) => id !== person.id))}
                >
                  <Icon icon={Cancel01Icon} size={10} aria-hidden="true" />
                </button>
              </Show>
            </li>
          )}
        </For>
        <Show when={member() && others().length > 0 && !props.group.archived}>
          <li>
            <MenuChip
              label="Add someone"
              tone="muted"
              options={others().map((person) => ({
                label: person.name,
                value: person.id,
                icon: <Identicon seed={person.id} size={14} />,
              }))}
              onSelect={(id) => setMembers([...ids(), id])}
            />
          </li>
        </Show>
      </ul>
      <div class={sx(page.actions)}>
        <For each={actions().filter(([show]) => show)}>
          {([, label, run]) => (
            <button type="button" class={sx(page.bare, page.pointer, page.action)} onClick={run}>
              {label}
            </button>
          )}
        </For>
      </div>
    </>
  );
}

// All threads, a label's, or a group's (a group's are its label's), narrowed by person, label, or showing closed ones.
export function LabelView(): JSX.Element {
  const app = useApp();
  const label = () => app.nav.shownLabel();
  const group = () => app.nav.shownGroup();
  const labelId = (): string | null => label()?.id ?? null;
  const [filter, setFilter] = createSignal<ThreadFilter>(NO_FILTER);
  const every = createMemo(() =>
    threadsWithLabel(app.data.threads(), labelId(), { ...filter(), includeDone: true }),
  );
  const open = () => every().filter((thread) => !isDone(thread.status));
  const shown = () => (filter().includeDone ? every() : open());
  const these = createMemo(() =>
    threadsWithLabel(app.data.threads(), labelId(), { ...NO_FILTER, includeDone: true }),
  );
  const people = () =>
    app.data
      .people()
      .filter((person) =>
        these().some(
          (t) => t.owner.id === person.id || t.assignees.some((other) => other.id === person.id),
        ),
      );
  const labels = () =>
    app.data
      .labels()
      .filter(
        (other) => other.id !== labelId() && these().some((t) => t.labelIds.includes(other.id)),
      );
  const count = (): string => `${shown().length} thread${shown().length === 1 ? "" : "s"}`;
  const nameOf = (id: string): string =>
    app.data.people().find((person) => person.id === id)?.name ?? id;
  const pick = (
    key: "personId" | "labelId",
    none: string,
    options: { id: string; name: string }[],
  ) => (
    <MenuChip
      label={options.find((option) => option.id === filter()[key])?.name ?? none}
      tone={filter()[key] === null ? "muted" : undefined}
      options={[
        { label: none, value: null as string | null },
        ...options.map((option) => ({ label: option.name, value: option.id })),
      ]}
      onSelect={(value) => setFilter((current) => ({ ...current, [key]: value }))}
    />
  );

  return (
    <div class={sx(page.page)}>
      <Show
        when={group()}
        fallback={
          <>
            <h1 class={sx(page.title)}>{label()?.name ?? "All threads"}</h1>
            <Summary icon={label() ? Tag01Icon : THREAD_ICON}>
              {`${label() ? "Label" : "Everyone's"} · ${count()}`}
            </Summary>
          </>
        }
      >
        {(shownGroup) => <GroupHead group={shownGroup()} count={count()} />}
      </Show>
      <Toolbar
        newLabel={group()?.archived ? undefined : "New thread"}
        closed={every().length - open().length}
        showClosed={filter().includeDone}
        onToggleClosed={() =>
          setFilter((current) => ({ ...current, includeDone: !current.includeDone }))
        }
      >
        {pick("personId", "Anyone", people())}
        <Show when={labels().length > 0}>{pick("labelId", "Any group or label", labels())}</Show>
      </Toolbar>
      <Show when={shown().length > 0} fallback={<p class={sx(page.empty)}>No threads here yet.</p>}>
        <ThreadRows threads={shown()} />
      </Show>
      <Show when={group()?.activity.length}>
        <h2 class={sx(page.subheading, page.body)}>Activity</h2>
        <ul class={sx(page.list, page.muted, styles.activity)}>
          <For each={group()?.activity.toReversed()}>
            {(line) => (
              <li>{`${nameOf(line.actorId)} ${line.text} · ${formatRelativeTime(line.atMs, app.now())}`}</li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
