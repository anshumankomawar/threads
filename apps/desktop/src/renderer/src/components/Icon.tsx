import type { JSX } from "@solidjs/web";
import { TB_FOR } from "../tbMap";
import type { TbIconName } from "../tbIcons";
import { tbMarkup } from "./TbIcon";

// A Hugeicons icon (`@hugeicons/core-free-icons`): `[tag, attributes]` pairs on a 24×24 grid.
export type IconSvgElement = readonly (readonly [
  string,
  { readonly [key: string]: string | number },
])[];

type IconProps = JSX.SvgSVGAttributes<SVGSVGElement> & { icon: IconSvgElement; size?: number };

const markup = (icon: IconSvgElement): string =>
  icon
    .map(([tag, attributes]) => {
      const pairs = Object.entries(attributes)
        .filter(([name]) => name !== "key")
        .map(([name, value]) => {
          const attribute = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
          return `${attribute}="${String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
        });
      return `<${tag} ${pairs.join(" ")}/>`;
    })
    .join("");

// An icon that only decorates.
export const icon = (svg: IconSvgElement, size = 12): JSX.Element => (
  <Icon icon={svg} size={size} aria-hidden="true" />
);

// Thunderbird's icons in place of Hugeicons wherever there's one (tbMap.ts). Its 16px icons run nearly to their edges
// where Hugeicons' leave a margin in 24px, so it gets a pixel of room on each side to come out the same size.
export function Icon(props: IconProps): JSX.Element {
  const tb = (): TbIconName | undefined => TB_FOR.get(props.icon);
  return (
    <svg
      {...props}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox={tb() ? "-1 -1 18 18" : "0 0 24 24"}
      fill="none"
      color="currentColor"
      innerHTML={tb() ? tbMarkup(tb()!) : markup(props.icon)}
    />
  );
}
