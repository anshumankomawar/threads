import { createGlassScene } from "@glass-sdk/liquid-glass/dom";
import "@glass-sdk/liquid-glass/styles.css";

// Real glass under what's chosen (Glass-HQ's Liquid Glass: WebGPU material maps, applied to the live `content` layer by
// SVG filters): one surface for each selector, put at once on the element it matches inside `scene`, and hidden while
// none does. It doesn't slide or follow the pointer; it moves only when the choice does, and while the chosen element
// changes size (a tab opening out to its name).
export function glassUnder(
  scene: HTMLElement,
  content: HTMLElement,
  targets: { selector: string; radius: number }[],
  appearance: "light" | "dark",
): () => void {
  const glass = createGlassScene(scene);
  glass.setContent(content);
  const surfaces = targets.map(({ selector, radius }) => {
    const surface = document.createElement("div");
    surface.className = "lg-surface";
    surface.setAttribute("aria-hidden", "true");
    Object.assign(surface.style, {
      position: "absolute",
      top: "0",
      left: "0",
      pointerEvents: "none",
      zIndex: "0",
    });
    scene.append(surface);
    const remove = glass.addSurface(surface, {
      material: "regular",
      appearance,
      radius,
      refraction: 6,
      interactive: false,
    });
    return { selector, surface, remove };
  });

  const place = (): void => {
    const box = scene.getBoundingClientRect();
    for (const { selector, surface } of surfaces) {
      const target = [...scene.querySelectorAll<HTMLElement>(selector)].find(
        (el) => !el.closest("[inert]"),
      );
      if (!target) {
        surface.style.display = "none";
        continue;
      }
      const at = target.getBoundingClientRect();
      Object.assign(surface.style, {
        display: "",
        transform: `translate(${at.left - box.left}px, ${at.top - box.top}px)`,
        width: `${at.width}px`,
        height: `${at.height}px`,
      });
    }
  };
  // A new choice, a row scrolled, the sidebar resized, or the chosen tab growing to its name.
  const sizes = new ResizeObserver(place);
  const watch = (): void => {
    sizes.disconnect();
    sizes.observe(scene);
    for (const { selector } of surfaces)
      scene.querySelectorAll(selector).forEach((el) => sizes.observe(el));
  };
  const changes = new MutationObserver(() => {
    watch();
    place();
  });
  changes.observe(scene, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-current", "aria-selected", "inert"],
  });
  scene.addEventListener("scroll", place, { capture: true, passive: true });
  watch();
  place();

  return () => {
    sizes.disconnect();
    changes.disconnect();
    scene.removeEventListener("scroll", place, { capture: true });
    for (const { surface, remove } of surfaces) {
      remove();
      surface.remove();
    }
    glass.dispose();
  };
}
