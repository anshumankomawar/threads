import { STATUS_LABELS, type Thread } from "model";
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { status } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { THREAD_ICON } from "../threadIcon";
import { Icon } from "./Icon";

// Threads as rows: title, who made it, and who has it. Click opens one; right-click has its menu.
export function ThreadRows(props: { threads: Thread[] }): JSX.Element {
  const app = useApp();
  return (
    <ul class={sx(page.items, page.itemsInGroupPage)}>
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
                class={sx(page.item)}
                onClick={() => app.nav.openThread(thread.id)}
                onContextMenu={(event) => app.threads.openMenu(event, thread)}
              >
                <span class={sx(page.itemIcon)} aria-hidden="true">
                  <Icon icon={THREAD_ICON} size={13} />
                </span>
                <span class={sx(page.itemBody)}>
                  <span class={sx(page.itemName)}>
                    {thread.title}
                    <Show when={app.inbox.unreadIds().has(thread.id)}>
                      <span class={sx(status.unread)} aria-label="Unread" />
                    </Show>
                  </span>
                  <span class={sx(page.itemReason)}>{`By ${thread.owner.name}`}</span>
                </span>
                <Show when={meta() !== ""}>
                  <span class={sx(page.itemMeta)}>{meta()}</span>
                </Show>
              </button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
