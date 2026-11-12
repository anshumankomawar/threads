import { icons } from "./icons/icons";

export type IconName = keyof typeof icons;

export const Icon = ({
  name,
  color,
  size = 16,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) => (
  <svg
    className="icon"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    style={{ color }}
    aria-hidden
    dangerouslySetInnerHTML={{ __html: icons[name] }}
  />
);
