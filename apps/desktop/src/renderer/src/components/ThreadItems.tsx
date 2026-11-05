import { STATUS_LABELS, type Thread } from "model";
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ListView } from "../listView";
import { THREAD_ICON } from "../threadIcon";
import { useThreadMenu } from "../threadMenu";
import { Icon } from "./Icon";

// List or board, beside New thread.
export function ViewToggle(props: {
  view: ListView;
  onChange: (view: ListView) => void;
}): JSX.Element {
  return (
    <span class="view-toggle" role="group" aria-label="View">
      <For each={["list", "board"] as const}>
        {(option) => (
          <button
            type="button"
            class="view-toggle-option"
            aria-pressed={props.view === option ? "true" : "false"}
            onClick={() => props.onChange(option)}
          >
            {option === "list" ? "List" : "Board"}
          </button>
        )}
      </For>
    </span>
  );
}

// Threads as rows: title, who made it, and who has it. Click opens one; right-click has its menu.
export function ThreadRows(props: {
  threads: Thread[];
  unreadIds: Set<string>;
  onOpenThread: (id: string) => void;
}): JSX.Element {
  const openMenu = useThreadMenu();
  return (
    <ul class="list-page-items">
      <For each={props.threads}>
        {(thread) => {
          const meta = (): string =>
            [
              thread.assignees.length === 0
                ? "Unassigned"
                : thread.assignees.map((person) => person.name.split(" ")[0]).join(", "),
              thread.status === "open" ? null : STATUS_LABELS[thread.status],
            ]
              .filter((part) => part !== null)
              .join(" · ");
          return (
            <li>
              <button
                type="button"
                class="list-page-item"
                onClick={() => props.onOpenThread(thread.id)}
                onContextMenu={(event) => openMenu(event, thread)}
              >
                <span class="list-page-icon" aria-hidden="true">
                  <Icon icon={THREAD_ICON} size={13} />
                </span>
                <span class="list-page-body">
                  <span class="list-page-name">
                    {thread.title}
                    <Show when={props.unreadIds.has(thread.id)}>
                      <span class="unread-dot" aria-label="Unread" />
                    </Show>
                  </span>
                  <span class="list-page-reason">{`By ${thread.owner.name}`}</span>
                </span>
                <Show when={meta() !== ""}>
                  <span class="list-page-meta">{meta()}</span>
                </Show>
              </button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
