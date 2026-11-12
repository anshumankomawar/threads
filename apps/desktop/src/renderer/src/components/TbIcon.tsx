import type { JSX } from "@solidjs/web";
import { TB_ICONS, type TbIconName, type TbPart } from "../tbIcons";

const escape = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Thunderbird paints its icons with the context's fill (a 20% tint) and stroke (the full colour): both currentColor
// here, so an icon takes its colour from the text around it, as a folder's does from `--icon-color`.
const markup = (parts: readonly TbPart[]): string =>
  parts
    .map(([tag, role, attributes]) => {
      const pairs = Object.entries(attributes).map(([name, value]) => `${name}="${escape(value)}"`);
      const paint =
        role === "fill" ? 'fill="currentColor" fill-opacity="0.2"' : 'fill="currentColor"';
      return `<${tag} ${pairs.join(" ")} ${paint}/>`;
    })
    .join("");

// One of Thunderbird's icons, 16px unless told otherwise (its 24px "touch" ones end in -lg).
export function TbIcon(props: { name: TbIconName; size?: number; class?: string }): JSX.Element {
  const data = () => TB_ICONS[props.name];
  return (
    <svg
      class={props.class}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox={data().viewBox}
      aria-hidden="true"
      innerHTML={markup(data().parts as readonly TbPart[])}
    />
  );
}
