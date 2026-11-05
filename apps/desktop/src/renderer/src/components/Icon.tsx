import { createMemo } from "solid-js";
import type { JSX } from "@solidjs/web";

// A Hugeicons icon (`@hugeicons/core-free-icons`): its elements as `[tag, attributes]` pairs, drawn on a 24×24 grid.
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

const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const escape = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// The icon's elements as markup, with its stroke width when one is given.
function markup(icon: IconSvgElement, strokeWidth: number | undefined): string {
  return icon
    .map(([tag, attributes]) => {
      const pairs = Object.entries(attributes)
        .filter(([name]) => name !== "key")
        .map(([name, value]) => {
          const shown = name === "strokeWidth" && strokeWidth !== undefined ? strokeWidth : value;
          return `${kebab(name)}="${escape(String(shown))}"`;
        });
      return `<${tag} ${pairs.join(" ")}/>`;
    })
    .join("");
}

// Draws an icon at a size (16px unless given), in the text's colour unless given one.
export function Icon(props: IconProps): JSX.Element {
  const inner = createMemo(() => markup(props.icon, props.strokeWidth));
  return (
    <svg
      {...props}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      color={props.color ?? "currentColor"}
      innerHTML={inner()}
    />
  );
}
