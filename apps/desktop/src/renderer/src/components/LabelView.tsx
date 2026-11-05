import { Cancel01Icon, Tag01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import { isDone, labelSlug, type Group, type GroupChanges, type Person, type Sprint } from "model";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { formatRelativeTime } from "../format";
import { NO_FILTER, threadsWithLabel, type ThreadFilter } from "../groups";
import { useListView } from "../listView";
import { sprintDates } from "../sprints";
import { chip, chipTone, link } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { THREAD_ICON } from "../threadIcon";
import { Board } from "./Board";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";
import { ThreadRows, ViewToggle } from "./ThreadItems";
import { MenuChip } from "./ThreadView";

const styles = stylex.create({
  // A group's name, which its members click to rename.
  titleButton: {
    padding: 0,
    borderStyle: "none",
    color: "inherit",
    font: "inherit",
    letterSpacing: "inherit",
    textAlign: "left",
    backgroundColor: "transparent",
    cursor: "text",
  },
  titleInput: {
    width: "min(100%, 640px)",
    padding: 0,
    borderStyle: "none",
    outline: "none",
    color: colors.textPrimary,
    font: "inherit",
    fontSize: fontSizes.pageTitle,
    fontWeight: 600,
    lineHeight: "28px",
    letterSpacing: "-0.2px",
    backgroundColor: "transparent",
  },
  titleTaken: {
    margin: "2px 0 0",
    color: colors.urgent,
  },
  members: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
    maxWidth: "640px",
    margin: "14px 0 0",
    padding: 0,
    listStyle: "none",
  },
  member: {
    display: "inline-flex",
    gap: "5px",
    alignItems: "center",
    height: "22px",
    padding: "0 7px 0 5px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.button,
    color: colors.textSecondary,
  },
  memberRemove: {
    display: "flex",
    padding: 0,
    borderStyle: "none",
    color: {
      default: colors.iconTertiary,
      ":hover": colors.textPrimary,
    },
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  activity: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    margin: 0,
    padding: 0,
    color: colors.textTertiary,
    listStyle: "none",
  },
});

// A group's members: anyone in it can add or remove people, and anyone can join or leave.
function Members(props: { group: Group }): JSX.Element {
  const app = useApp();
  const update = (changes: GroupChanges): void => app.groups.update(props.group.id, changes);
  const isMember = (): boolean => props.group.memberIds.includes(app.me().id);
  const members = createMemo(() =>
    props.group.memberIds.flatMap(
      (id) => app.data.people().find((person) => person.id === id) ?? [],
    ),
  );
  const others = createMemo(() =>
    app.data.people().filter((person) => !props.group.memberIds.includes(person.id)),
  );
  const onlyMember = (): boolean => props.group.memberIds.length === 1;

  return (
    <ul class={sx(styles.members)} aria-label="Members">
      <For each={members()}>
        {(person) => (
          <li class={sx(styles.member)}>
            <Identicon seed={person.id} size={14} />
            <button
              type="button"
              class={sx(link.person)}
              onClick={() => app.nav.openPerson(person.id)}
            >
              {person.name}
            </button>
            <Show when={isMember() && !onlyMember()}>
              <button
                type="button"
                class={sx(styles.memberRemove)}
                aria-label={`Remove ${person.name}`}
                onClick={() =>
                  update({
                    memberIds: props.group.memberIds.filter((id) => id !== person.id),
                  })
                }
              >
                <Icon icon={Cancel01Icon} size={10} aria-hidden="true" />
              </button>
            </Show>
          </li>
        )}
      </For>
      <Show when={isMember() && others().length > 0 && !props.group.archived}>
        <li>
          <MenuChip
            label="Add someone"
            tone="muted"
            options={others().map((person) => ({
              label: person.name,
              value: person.id,
              icon: <Identicon seed={person.id} size={14} />,
            }))}
            onSelect={(id) => update({ memberIds: [...props.group.memberIds, id] })}
          />
        </li>
      </Show>
    </ul>
  );
}

// A group's own name, editable by its members.
function GroupTitle(props: { group: Group }): JSX.Element {
  const app = useApp();
  const canEdit = (): boolean => props.group.memberIds.includes(app.me().id);
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal(untrack(() => props.group.name));
  const slug = (): string => labelSlug(name().trim());
  const taken = (): boolean =>
    app.data
      .labels()
      .some(
        (label) =>
          label.id !== props.group.labelId &&
          (label.id === slug() || labelSlug(label.name) === slug()),
      );
  const valid = (): boolean => slug() !== "" && !taken();
  // A new name (from here or anyone else) starts the title over, as a fresh one.
  createEffect(
    () => props.group.name,
    (current) => {
      setEditing(false);
      setName(current);
    },
    { defer: true },
  );

  return (
    <Show
      when={editing()}
      fallback={
        <h1 class={sx(page.title)}>
          <Show when={canEdit()} fallback={props.group.name}>
            <button
              type="button"
              class={sx(styles.titleButton)}
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
      <div>
        <input
          ref={(el) => queueMicrotask(() => el.focus())}
          class={sx(styles.titleInput)}
          aria-label="Group name"
          maxlength={80}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
            if (event.key === "Enter" && valid()) {
              app.groups.update(props.group.id, { name: name().trim() });
              setEditing(false);
            }
          }}
        />
        <Show when={taken()}>
          <p class={sx(styles.titleTaken)}>That name is taken in your organization.</p>
        </Show>
      </div>
    </Show>
  );
}

// The Sprints menu's way to start one.
const NEW_SPRINT = "new-sprint";

// The organization's threads, in the main area: all of them, or a label's. A group's page is its label's threads, with
// its members too, since a thread is in a group by having the group's label. Open threads by default, and you can
// narrow by person (who owns it or is assigned it), by a group or label, and show closed ones. Any of it shows as a
// list or a board. A group's Sprints menu opens its sprints, each on its own page (`SprintView`).
export function LabelView(): JSX.Element {
  const app = useApp();
  // The page's label and group: none for every thread, and no group for a plain label.
  const label = () => app.nav.shownLabel() ?? null;
  const group = (): Group | undefined => app.nav.shownGroup();
  // The group's sprints; none on a label's page or every thread.
  const sprints = (): Sprint[] => {
    const shown = group();
    return shown === undefined ? [] : app.groups.sprintsOf(shown.id);
  };
  const updateGroup = (changes: GroupChanges): void => {
    const shown = group();
    if (shown !== undefined) app.groups.update(shown.id, changes);
  };
  const [filter, setFilter] = createSignal<ThreadFilter>(NO_FILTER);
  const [view, setView] = useListView();
  const labelId = (): string | null => label()?.id ?? null;
  const everything = createMemo(() =>
    threadsWithLabel(app.data.threads(), labelId(), { ...filter(), includeDone: true }),
  );
  // The board has a column for closed threads, so it always has them.
  const shown = createMemo(() =>
    view() === "board" ? everything() : threadsWithLabel(app.data.threads(), labelId(), filter()),
  );
  const closedCount = (): number => everything().filter((thread) => isDone(thread.status)).length;
  const inThese = createMemo(() =>
    threadsWithLabel(app.data.threads(), labelId(), { ...NO_FILTER, includeDone: true }),
  );
  const isMember = (): boolean => group()?.memberIds.includes(app.me().id) ?? false;
  const personOptions = (): Person[] =>
    app.data
      .people()
      .filter((person) =>
        inThese().some(
          (thread) =>
            thread.owner.id === person.id ||
            thread.assignees.some((other) => other.id === person.id),
        ),
      );
  const labelOptions = createMemo(() =>
    app.data
      .labels()
      .filter(
        (other) =>
          other.id !== labelId() && inThese().some((thread) => thread.labelIds.includes(other.id)),
      ),
  );
  const nameOf = (personId: string): string =>
    app.data.people().find((person) => person.id === personId)?.name ?? personId;
  // A new sprint in the group, with nothing in it yet.
  const startSprint = (): void => {
    const shown = group();
    if (shown !== undefined) app.groups.startSprint(shown, []);
  };
  const count = (): string => `${shown().length} ${shown().length === 1 ? "thread" : "threads"}`;

  return (
    <div class={sx(page.page)}>
      <Show
        when={group()}
        fallback={<h1 class={sx(page.title)}>{label()?.name ?? "All threads"}</h1>}
      >
        {(shown) => <GroupTitle group={shown()} />}
      </Show>
      <p class={sx(page.summary)}>
        <Icon
          icon={group() !== undefined ? UserGroupIcon : label() !== null ? Tag01Icon : THREAD_ICON}
          size={11}
          class={sx(page.summaryIcon)}
          aria-hidden="true"
        />{" "}
        {(() => {
          const shown = group();
          return shown === undefined
            ? `${label() === null ? "Everyone's" : "Label"} · ${count()}`
            : `${shown.memberIds.length} ${shown.memberIds.length === 1 ? "member" : "members"} · ${count()}${shown.archived ? " · Archived" : ""}`;
        })()}
      </p>

      <Show when={group()}>
        {(group) => (
          <>
            <Members group={group()} />
            <div class={sx(page.actions)}>
              <Show when={!isMember() && !group().archived}>
                <button
                  type="button"
                  class={sx(page.action)}
                  onClick={() => updateGroup({ memberIds: [...group().memberIds, app.me().id] })}
                >
                  Join
                </button>
              </Show>
              <Show when={isMember() && group().memberIds.length > 1}>
                <button
                  type="button"
                  class={sx(page.action)}
                  onClick={() =>
                    updateGroup({
                      memberIds: group().memberIds.filter((id) => id !== app.me().id),
                    })
                  }
                >
                  Leave
                </button>
              </Show>
              <Show when={isMember()}>
                <button
                  type="button"
                  class={sx(page.action)}
                  onClick={() => updateGroup({ archived: !group().archived })}
                >
                  {group().archived ? "Unarchive" : "Archive"}
                </button>
              </Show>
            </div>
          </>
        )}
      </Show>

      <div class={sx(page.toolbar)}>
        <Show when={group()?.archived !== true}>
          <button type="button" class={sx(page.newButton)} onClick={() => app.ui.openNewThread()}>
            New thread
          </button>
        </Show>
        <ViewToggle view={view()} onChange={setView} />
        {/* The group's sprints, each opening on its own page, and starting the next. */}
        <Show
          when={
            group() !== undefined &&
            (sprints().length > 0 || (isMember() && group()?.archived !== true))
          }
        >
          <MenuChip
            label={
              sprints().some((sprint) => !sprint.closed)
                ? `Sprints · ${sprints().filter((sprint) => !sprint.closed).length} open`
                : "Sprints"
            }
            options={[
              ...sprints().map((sprint) => ({
                label: `${sprint.name} · ${sprint.closed ? "Closed" : sprintDates(sprint)}`,
                value: sprint.id,
              })),
              ...(isMember() && group()?.archived !== true
                ? [{ label: "New sprint", value: NEW_SPRINT }]
                : []),
            ]}
            onSelect={(value) => (value === NEW_SPRINT ? startSprint() : app.nav.openSprint(value))}
          />
        </Show>
        <span class={sx(page.filters)}>
          <MenuChip
            label={filter().personId === null ? "Anyone" : nameOf(filter().personId ?? "")}
            tone={filter().personId === null ? "muted" : undefined}
            options={[
              { label: "Anyone", value: null as string | null },
              ...personOptions().map((person) => ({ label: person.name, value: person.id })),
            ]}
            onSelect={(personId) => setFilter((current) => ({ ...current, personId }))}
          />
          <Show when={labelOptions().length > 0}>
            <MenuChip
              label={
                app.data.labels().find((other) => other.id === filter().labelId)?.name ??
                "Any group or label"
              }
              tone={filter().labelId === null ? "muted" : undefined}
              options={[
                { label: "Any group or label", value: null as string | null },
                ...labelOptions().map((other) => ({ label: other.name, value: other.id })),
              ]}
              onSelect={(labelId) => setFilter((current) => ({ ...current, labelId }))}
            />
          </Show>
          <Show when={closedCount() > 0 && view() === "list"}>
            <button
              type="button"
              class={sx(chip.chip, !filter().includeDone && chipTone.muted)}
              aria-pressed={filter().includeDone ? "true" : "false"}
              onClick={() =>
                setFilter((current) => ({ ...current, includeDone: !current.includeDone }))
              }
            >
              {filter().includeDone ? "Showing closed" : `${closedCount()} closed`}
            </button>
          </Show>
        </span>
      </div>

      {view() === "board" ? (
        <Board threads={shown()} />
      ) : shown().length === 0 ? (
        <p class={sx(page.empty)}>No threads here yet.</p>
      ) : (
        <ThreadRows threads={shown()} />
      )}

      <Show when={(group()?.activity.length ?? 0) > 0}>
        <h2 class={sx(page.groupHeading)}>Activity</h2>
        <ul class={sx(styles.activity)}>
          <For each={group()?.activity.toReversed() ?? []}>
            {(line) => (
              <li>
                {nameOf(line.actorId)} {line.text} · {formatRelativeTime(line.atMs, app.now())}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
