import type { JSX } from "@solidjs/web";

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
