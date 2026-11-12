import type { JSX } from "@solidjs/web";
import { TB_ICONS, type TbIconName, type TbPart } from "../tbIcons";

const escape = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Thunderbird paints its icons with the context's fill (a 20% tint) and stroke (the full colour): both currentColor
// here, so an icon takes its colour from the text around it.
export const tbMarkup = (name: TbIconName): string =>
  (TB_ICONS[name].parts as readonly TbPart[])
    .map(([tag, role, attributes]) => {
      const pairs = Object.entries(attributes).map(([key, value]) => `${key}="${escape(value)}"`);
      const paint =
        role === "fill" ? 'fill="currentColor" fill-opacity="0.2"' : 'fill="currentColor"';
      return `<${tag} ${pairs.join(" ")} ${paint}/>`;
    })
    .join("");

// One of Thunderbird's icons, 16px unless told otherwise.
export function TbIcon(props: { name: TbIconName; size?: number; class?: string }): JSX.Element {
  return (
    <svg
      class={props.class}
      style={{ display: "block", "flex-shrink": "0" }}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox={TB_ICONS[props.name].viewBox}
      aria-hidden="true"
      innerHTML={tbMarkup(props.name)}
    />
  );
}
