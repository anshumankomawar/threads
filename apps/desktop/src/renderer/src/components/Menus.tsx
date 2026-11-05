import { createSignal, createUniqueId, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { menu, setMenu, type MenuItem } from "../session";
import { chip, chipTone, menu as look } from "../styles/controls";
import { sx } from "../styles/sx";

const items = (list: MenuItem[], close: () => void): JSX.Element => (
  <For each={list}>
    {(item) =>
      item === "separator" ? (
        <hr class={sx(look.separator)} />
      ) : (
        <button
          class={sx(look.item, look.itemHover)}
          role="menuitem"
          onClick={() => (close(), item.run())}
        >
          <Show when={item.icon}>
            <span class={sx(look.itemIcon)}>{item.icon}</span>
          </Show>
          <span>{item.label}</span>
          <Show when={item.shortcut}>
            <span class={sx(look.shortcut)}>{item.shortcut}</span>
          </Show>
        </button>
      )
    }
  </For>
);

// The right-click menu, at the pointer and kept on screen. A popover: a click elsewhere or Escape closes it.
export function ContextMenu(): JSX.Element {
  const show = (el: HTMLDivElement, at: { x: number; y: number }): void => {
    el.showPopover();
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(at.x, innerWidth - width - 4))}px`;
    el.style.top = `${at.y + height > innerHeight - 4 ? Math.max(4, at.y - height) : at.y}px`;
  };
  return (
    <Show when={menu()} keyed>
      {(shown) => (
        <div
          popover="auto"
          ref={(el) => queueMicrotask(() => show(el, shown))}
          onToggle={(event) => event.newState === "closed" && menu() === shown && setMenu(null)}
          onContextMenu={(event) => event.preventDefault()}
          class={sx(look.menu, look.popover, look.context)}
          style={{ left: `${shown.x}px`, top: `${shown.y}px` }}
          role="menu"
        >
          {items(shown.items, () => setMenu(null))}
        </div>
      )}
    </Show>
  );
}

// A chip that opens a menu of choices under it (the popover's implicit anchor is the chip that targets it).
export function MenuChip(props: {
  label: JSX.Element;
  icon?: JSX.Element;
  tone?: "urgent" | "muted";
  title?: string;
  items: MenuItem[];
}): JSX.Element {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let popover!: HTMLDivElement;
  return (
    <>
      <button
        popovertarget={id}
        title={props.title}
        class={sx(chip.chip, open() && chip.open, props.tone && chipTone[props.tone])}
      >
        {props.icon}
        {props.label}
      </button>
      <div
        id={id}
        ref={popover}
        popover="auto"
        onToggle={(event) => setOpen(event.newState === "open")}
        class={sx(look.menu, look.popover, chip.menu)}
        role="menu"
      >
        {items(props.items, () => popover.hidePopover())}
      </div>
    </>
  );
}
