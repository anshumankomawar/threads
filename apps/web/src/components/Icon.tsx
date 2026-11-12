import type { JSX } from "@solidjs/web";
import { TB_ICONS, type TbIconName } from "../tbIcons";
import { tbMarkup } from "./TbIcon";

// The app's icons are Thunderbird's (tbIcons.ts), named.
export type IconName = TbIconName;

type IconProps = JSX.SvgSVGAttributes<SVGSVGElement> & { icon: IconName; size?: number };

// An icon that only decorates.
export const icon = (name: IconName, size = 12): JSX.Element => (
  <Icon icon={name} size={size} aria-hidden="true" />
);

// A Thunderbird icon drawn as Thunderbird draws it (TbIcon): at its own 16px on its own grid, a 20% fill and a solid line
// in the text's colour. Only a large one (an empty list's) takes the size it asks for.
export function Icon(props: IconProps): JSX.Element {
  const size = (): number => {
    const asked = props.size ?? 16;
    return asked <= 20 ? 16 : asked;
  };
  return (
    <svg
      {...props}
      width={size()}
      height={size()}
      viewBox={TB_ICONS[props.icon].viewBox}
      fill="none"
      color="currentColor"
      innerHTML={tbMarkup(props.icon)}
    />
  );
}
