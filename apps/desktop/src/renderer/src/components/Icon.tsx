import type { JSX } from "@solidjs/web";
import { symbolFor } from "../symbols";

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

export function Icon(props: IconProps): JSX.Element {
  // On macOS, the system's SF Symbol for it, filled with the text's colour (as the macOS app's icons).
  const symbol = symbolFor(props.icon);
  if (symbol)
    return (
      <span
        class={props.class}
        aria-hidden={props["aria-hidden"]}
        style={{
          display: "inline-block",
          "flex-shrink": 0,
          width: `${props.size ?? 16}px`,
          height: `${props.size ?? 16}px`,
          "background-color": "currentColor",
          "mask-image": `url(${symbol})`,
          "mask-size": "contain",
          "mask-repeat": "no-repeat",
          "mask-position": "center",
        }}
      />
    );
  return (
    <svg
      {...props}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      color="currentColor"
      innerHTML={markup(props.icon)}
    />
  );
}
