import { STATUS_LABELS, type Person, type Thread } from "model";
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { chip, chipTone, status } from "../styles/controls";
import { page } from "../styles/page";
import { sx } from "../styles/sx";
import { THREAD_ICON } from "../threadIcon";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

// The parts the label, person and profile pages share.

// Threads as rows, under a heading with their count when titled; nothing when empty.
export function ThreadRows(props: { threads: Thread[]; title?: string }): JSX.Element {
  const app = useApp();
  return (
    <Show when={props.threads.length > 0}>
      <section aria-label={props.title}>
        <Show when={props.title}>
          <h2
            class={sx(page.subheading, page.body)}
          >{`${props.title} · ${props.threads.length}`}</h2>
        </Show>
        <ul class={sx(page.list, page.items, page.narrow)}>
          <For each={props.threads}>
            {(thread) => (
              <li>
                <button
                  type="button"
                  class={sx(page.bare, page.item, page.itemLook, page.hover, page.pointer)}
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
                    <span class={sx(page.small)}>{`By ${thread.owner.name}`}</span>
                  </span>
                  <span class={sx(page.small, page.noShrink)}>
                    {[
                      thread.assignees.map((person) => person.name.split(" ")[0]).join(", ") ||
                        "Unassigned",
                      thread.status === "open" ? "" : STATUS_LABELS[thread.status],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

// New thread, then the filters and the closed threads' chip on the right.
export function Toolbar(props: {
  newLabel?: string;
  closed: number;
  showClosed: boolean;
  onToggleClosed: () => void;
  children?: JSX.Element;
}): JSX.Element {
  const app = useApp();
  return (
    <div class={sx(page.row, page.toolbar, page.narrow)}>
      <Show when={props.newLabel}>
        <button
          type="button"
          class={sx(page.border, page.newButton, page.pointer)}
          onClick={() => app.ui.openNewThread()}
        >
          {props.newLabel}
        </button>
      </Show>
      <span class={sx(page.row, page.filters)}>
        {props.children}
        <Show when={props.closed > 0}>
          <button
            type="button"
            class={sx(chip.chip, !props.showClosed && chipTone.muted)}
            aria-pressed={`${props.showClosed}`}
            onClick={() => props.onToggleClosed()}
          >
            {props.showClosed ? "Showing closed" : `${props.closed} closed`}
          </button>
        </Show>
      </span>
    </div>
  );
}

// A person's avatar beside their name and a summary line.
export function PersonHeader(props: { person: Person; summary: string }): JSX.Element {
  return (
    <header class={sx(page.header)}>
      <Identicon seed={props.person.id} size={40} />
      <div>
        <h1 class={sx(page.title)}>{props.person.name}</h1>
        <Show when={props.summary}>
          <p class={sx(page.summary)}>{props.summary}</p>
        </Show>
      </div>
    </header>
  );
}

export function Fact(props: { term: string; children: JSX.Element }): JSX.Element {
  return (
    <>
      <dt class={sx(page.muted)}>{props.term}</dt>
      <dd class={sx(page.value)}>{props.children}</dd>
    </>
  );
}
