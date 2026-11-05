import { Portal } from "@solidjs/web";
import { createEffect, createSignal, For, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { menu } from "../styles/controls";
import { sx } from "../styles/sx";

export type ContextMenuItem = { label: string; shortcut?: string; run: () => void } | "separator";

// A right-click menu at the pointer, kept on screen. Closes on a pick, a click elsewhere, scrolling or Escape.
export function ContextMenu(props: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}): JSX.Element {
  let ref!: HTMLDivElement;
  const [measured, setMeasured] = createSignal<{ left: number; top: number } | null>(null);
  createEffect(
    () => ({ x: props.x, y: props.y }),
    ({ x, y }) => {
      const { width, height } = ref.getBoundingClientRect();
      setMeasured({
        left: Math.min(x, window.innerWidth - width - 4),
        top: y + height > window.innerHeight - 4 ? Math.max(4, y - height) : y,
      });
    },
  );
  const position = (): { left: number; top: number } =>
    measured() ?? { left: props.x, top: props.y };
  onSettled(() => {
    const close = (): void => props.onClose();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    const events = ["mousedown", "wheel", "blur"] as const;
    for (const name of events) window.addEventListener(name, close);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      for (const name of events) window.removeEventListener(name, close);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  });
  return (
    <Portal mount={document.body}>
      <div
        ref={ref}
        class={[sx(menu.menu, menu.context), "context-menu"]}
        role="menu"
        style={{ left: `${position().left}px`, top: `${position().top}px` }}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <For each={props.items}>
          {(item) =>
            item === "separator" ? (
              <div class={sx(menu.separator)} role="separator" />
            ) : (
              <button
                role="menuitem"
                class={sx(menu.item, menu.itemHover)}
                onClick={() => {
                  props.onClose();
                  item.run();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut !== undefined && (
                  <span class={sx(menu.shortcut)}>{item.shortcut}</span>
                )}
              </button>
            )
          }
        </For>
      </div>
    </Portal>
  );
}
