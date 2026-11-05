import type { JSX } from "@solidjs/web";

// A Hugeicons icon (`@hugeicons/core-free-icons`): `[tag, attributes]` pairs on a 24×24 grid.
export type IconSvgElement = readonly (readonly [
  string,
  { readonly [key: string]: string | number },
])[];

type IconProps = Omit<JSX.SvgSVGAttributes<SVGSVGElement>, "color"> & {
  icon: IconSvgElement;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

const markup = (icon: IconSvgElement, strokeWidth: number | undefined): string =>
  icon
    .map(([tag, attributes]) => {
      const pairs = Object.entries(attributes)
        .filter(([name]) => name !== "key")
        .map(([name, value]) => {
          const shown = name === "strokeWidth" && strokeWidth !== undefined ? strokeWidth : value;
          const attribute = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
          return `${attribute}="${String(shown).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
        });
      return `<${tag} ${pairs.join(" ")}/>`;
    })
    .join("");

export function Icon(props: IconProps): JSX.Element {
  return (
    <svg
      {...props}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      color={props.color ?? "currentColor"}
      innerHTML={markup(props.icon, props.strokeWidth)}
    />
  );
}
