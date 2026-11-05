import { Portal } from "@solidjs/web";
import { createEffect, createSignal, For, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";

// An action, or a line between groups of them.
export type ContextMenuItem = { label: string; shortcut?: string; run: () => void } | "separator";

// A right-click menu at the pointer, kept on screen. Closes on picking an item, clicking elsewhere, scrolling or
// Escape.
export function ContextMenu(props: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}): JSX.Element {
  let ref!: HTMLDivElement;
  // Null until measured; the pointer position until then.
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
    const onClose = (): void => props.onClose();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("mousedown", onClose);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onClose);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("blur", onClose);
    };
  });

  return (
    <Portal mount={document.body}>
      <div
        ref={ref}
        class="menu context-menu"
        role="menu"
        style={{ left: `${position().left}px`, top: `${position().top}px` }}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <For each={props.items}>
          {(item) =>
            item === "separator" ? (
              <div class="menu-separator" role="separator" />
            ) : (
              <button
                type="button"
                role="menuitem"
                class="menu-item"
                onClick={() => {
                  props.onClose();
                  item.run();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut !== undefined && <span class="menu-shortcut">{item.shortcut}</span>}
              </button>
            )
          }
        </For>
      </div>
    </Portal>
  );
}
