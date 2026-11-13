import {
  Menu,
  MenuContent,
  MenuContextTrigger,
  MenuItems,
  type MenuData,
} from "@ui-sdk/react/menu";
import type { ReactElement } from "react";

export type MenuEntry = { label: string; run: () => void } | "separator";

export function ContextMenu(props: {
  entries: MenuEntry[];
  children: ReactElement<Record<string, unknown>>;
}) {
  const actions = props.entries.filter((entry) => entry !== "separator");
  const items: MenuData = props.entries.map((entry) =>
    entry === "separator" ? { type: "separator" } : entry.label,
  );
  return (
    <Menu items={items} onAction={(label) => actions.find((entry) => entry.label === label)?.run()}>
      <MenuContextTrigger render={props.children} />
      <MenuContent className="panel menu">
        <MenuItems items={items} />
      </MenuContent>
    </Menu>
  );
}
