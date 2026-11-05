import { UserGroupIcon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import { formatEffort, isDone, type Group, type Person, type Sprint, type Thread } from "model";
import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { NO_FILTER, threadsWithLabel, type ThreadFilter } from "../groups";
import { useListView } from "../listView";
import {
  addableThreads,
  daysLater,
  loadByPerson,
  openSprintWith,
  sprintDates,
  sprintThreads,
  summarize,
  summaryLabel,
} from "../sprints";
import { chip, chipTone, link } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { Board } from "./Board";
import { Icon } from "./Icon";
import { ThreadRows, ViewToggle } from "./ThreadItems";
import { MenuChip } from "./ThreadView";

const styles = stylex.create({
  // A sprint's page: its name edits in place, like a title.
  titleInput: {
    width: "100%",
    maxWidth: "640px",
    margin: 0,
    padding: 0,
    borderStyle: "none",
    color: colors.textPrimary,
    font: "inherit",
    fontSize: fontSizes.pageTitle,
    fontWeight: 600,
    lineHeight: "28px",
    letterSpacing: "-0.2px",
    backgroundColor: "transparent",
    outline: "none",
  },
  // Its first and last day, after the facts' value (which keeps the text colour).
  dates: {
    display: "inline-flex",
    gap: "6px",
    alignItems: "center",
  },
  dateInput: {
    padding: "1px 4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.control,
    color: colors.textSecondary,
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: "transparent",
  },
  // Each person's load: their name, then what's left for them.
  load: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    gap: "4px 16px",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  loadItem: {
    display: "contents",
  },
  loadDetail: {
    color: colors.textTertiary,
  },
});

// The date inputs' picker follows either theme (StyleX's types have no colorScheme).
const DATE_SCHEME = { "color-scheme": "dark light" };

// A date input's value for a local midnight, and back.
const toDateInput = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const fromDateInput = (value: string): number | null => {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day).getTime() : null;
};

// A sprint's own page, opened from its group's Sprints menu: its name and dates, how far along it is, what's left for
// each person, and its threads as a list or a board. The group's members add threads, close it, and carry what's
// unfinished into the next. Only the group's threads are in it (`sprintThreads`).
export function SprintView(props: { sprint: Sprint }): JSX.Element {
  const app = useApp();
  // The page is only shown with its group.
  const group = (): Group => app.nav.sprintGroup()!;
  const update = (changes: Parameters<typeof app.groups.updateSprint>[1]): void =>
    app.groups.updateSprint(props.sprint.id, changes);
  const [name, setName] = createSignal(untrack(() => props.sprint.name));
  const [filter, setFilter] = createSignal<ThreadFilter>(NO_FILTER);
  const [view, setView] = useListView();
  const canEdit = (): boolean => group().memberIds.includes(app.me().id);
  const inSprint = createMemo(() =>
    sprintThreads(props.sprint, app.data.threads(), group().labelId),
  );
  const everything = createMemo(() =>
    threadsWithLabel(inSprint(), null, { ...filter(), includeDone: true }),
  );
  // The board has a column for closed threads, so it always has them.
  const shown = createMemo(() =>
    view() === "board" ? everything() : threadsWithLabel(inSprint(), null, filter()),
  );
  const closedCount = (): number => everything().filter((thread) => isDone(thread.status)).length;
  const loads = createMemo(() => loadByPerson(inSprint()));
  const unfinished = (): Thread[] => inSprint().filter((thread) => !isDone(thread.status));
  // Only what isn't already in another open sprint of the group can go in the next.
  const groupSprints = (): Sprint[] => app.groups.sprintsOf(group().id);
  const carried = createMemo(() =>
    unfinished().filter((thread) => openSprintWith(groupSprints(), thread.id) === undefined),
  );
  const addable = createMemo(() =>
    addableThreads(props.sprint, app.data.threads(), group().labelId, groupSprints()),
  );
  const personOptions = (): Person[] =>
    app.data
      .people()
      .filter((person) =>
        inSprint().some(
          (thread) =>
            thread.owner.id === person.id ||
            thread.assignees.some((other) => other.id === person.id),
        ),
      );
  const nameOf = (personId: string): string =>
    app.data.people().find((person) => person.id === personId)?.name ?? personId;

  const saveName = (): void => {
    const trimmed = name().trim();
    if (trimmed === "" || trimmed === props.sprint.name) setName(props.sprint.name);
    else update({ name: trimmed });
  };

  return (
    <div class={sx(page.page)}>
      <Show when={canEdit()} fallback={<h1 class={sx(page.title)}>{props.sprint.name}</h1>}>
        <input
          class={sx(styles.titleInput)}
          aria-label="Sprint name"
          maxlength={80}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          onBlur={saveName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setName(props.sprint.name);
              event.currentTarget.blur();
            }
          }}
        />
      </Show>
      <p class={sx(page.summary)}>
        <Icon icon={UserGroupIcon} size={11} class={sx(page.summaryIcon)} aria-hidden="true" />{" "}
        <button
          type="button"
          class={sx(link.person)}
          onClick={() => app.nav.openLabel(group().labelId)}
        >
          {group().name}
        </button>
        {` · ${sprintDates(props.sprint)} · ${summaryLabel(summarize(inSprint()))}${props.sprint.closed ? " · Closed" : ""}`}
      </p>

      <dl class={sx(page.facts)}>
        <dt class={sx(page.factsTerm)}>Dates</dt>
        <dd class={sx(page.factsValue, styles.dates)}>
          <input
            type="date"
            class={sx(styles.dateInput)}
            style={DATE_SCHEME}
            aria-label="First day"
            disabled={!canEdit()}
            value={toDateInput(props.sprint.startMs)}
            onChange={(event) => {
              const startMs = fromDateInput(event.currentTarget.value);
              if (startMs !== null && startMs < props.sprint.endMs) update({ startMs });
            }}
          />
          <span aria-hidden="true">–</span>
          <input
            type="date"
            class={sx(styles.dateInput)}
            style={DATE_SCHEME}
            aria-label="Last day"
            disabled={!canEdit()}
            value={toDateInput(daysLater(props.sprint.endMs, -1))}
            onChange={(event) => {
              const day = fromDateInput(event.currentTarget.value);
              if (day !== null && day >= props.sprint.startMs) update({ endMs: daysLater(day, 1) });
            }}
          />
        </dd>
        <dt class={sx(page.factsTerm)}>Load</dt>
        <dd class={sx(page.factsValue)}>
          <Show when={loads().length > 0} fallback="Nothing left">
            <ul class={sx(styles.load)} aria-label="Load">
              <For each={loads()}>
                {(load) => (
                  <li class={sx(styles.loadItem)}>
                    <button
                      type="button"
                      class={sx(link.person)}
                      onClick={() => app.nav.openPerson(load.person.id)}
                    >
                      {load.person.name}
                    </button>
                    <span class={sx(styles.loadDetail)}>
                      {[
                        load.hours > 0 ? formatEffort(load.hours) : null,
                        `${load.threads} ${load.threads === 1 ? "thread" : "threads"}`,
                        load.unestimated > 0 ? `${load.unestimated} not estimated` : null,
                      ]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </dd>
      </dl>

      <Show when={canEdit()}>
        <div class={sx(page.actions)}>
          <button
            type="button"
            class={sx(page.action)}
            onClick={() => update({ closed: !props.sprint.closed })}
          >
            {props.sprint.closed ? "Reopen sprint" : "Close sprint"}
          </button>
          <Show when={props.sprint.closed && carried().length > 0 && !group().archived}>
            <button
              type="button"
              class={sx(page.action)}
              onClick={() =>
                app.groups.startSprint(
                  group(),
                  carried().map((thread) => thread.id),
                )
              }
            >
              Start the next sprint with {carried().length} unfinished
            </button>
          </Show>
        </div>
      </Show>

      <div class={sx(page.toolbar)}>
        <Show when={canEdit() && !props.sprint.closed && !group().archived}>
          <button
            type="button"
            class={sx(page.newButton)}
            onClick={() => app.ui.openNewThread(props.sprint.id)}
          >
            New thread
          </button>
        </Show>
        <ViewToggle view={view()} onChange={setView} />
        <Show when={canEdit() && !props.sprint.closed && addable().length > 0}>
          <MenuChip
            label="Add threads"
            tone="muted"
            options={addable().map((thread) => ({ label: thread.title, value: thread.id }))}
            onSelect={(threadId) => update({ threadIds: [...props.sprint.threadIds, threadId] })}
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
        <p class={sx(page.empty)}>
          {inSprint().length === 0 ? "Nothing in this sprint yet." : "Nothing open in this sprint."}
        </p>
      ) : (
        <ThreadRows threads={shown()} />
      )}
    </div>
  );
}
