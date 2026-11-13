import { Button } from "@ui-sdk/react/button";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api, inBox, useBuckets, useMe, useThreads } from "./data";
import { Icon, type IconName } from "./Icon";
import { Identicon } from "./Identicon";
import { ContextMenu, type MenuEntry } from "./Menu";
import { go, setDialog, useView, type Box } from "./state";

export function Sidebar() {
  const me = useMe()!;
  const view = useView();
  const rows = useThreads();
  const buckets = useBuckets();
  const removeBucket = useMutation(api.workspace.removeBucket);
  const editBuckets: MenuEntry = {
    label: "Edit Buckets",
    run: () => setDialog("settings", "Buckets"),
  };
  const [menu, setMenu] = useState<MenuEntry[]>([editBuckets]);

  const row = (
    box: Box,
    label: string,
    icon: IconName,
    count?: number,
    entries: MenuEntry[] = [editBuckets],
    nested = false,
  ) => (
    <ListboxItem
      key={box}
      value={box}
      label={label}
      className={nested ? "box nested" : "box"}
      onContextMenu={() => setMenu(entries)}
    >
      <Icon name={icon} color={`var(--${icon})`} />
      <span className="clip">{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </ListboxItem>
  );
  const count = (box: Box) => inBox(rows, box).length;

  return (
    <aside className="sidebar">
      <ContextMenu entries={menu}>
        <Listbox
          aria-label="Mailboxes"
          value={view.box}
          onValueChange={(box) => box && go({ box, thread: undefined })}
        >
          {row("all", "All Threads", "archive")}
          {row("drafts", "Drafts", "draft")}
          {row("inbox", "Buckets", "inbox", count("inbox"))}
          {buckets.map((bucket) =>
            row(
              bucket._id,
              bucket.name,
              "folder",
              count(bucket._id),
              [
                editBuckets,
                "separator",
                { label: "Delete Bucket", run: () => void removeBucket({ id: bucket._id }) },
              ],
              true,
            ),
          )}
        </Listbox>
      </ContextMenu>
      <Button className="profile" onClick={() => setDialog("settings")}>
        <Identicon seed={me._id} size={20} />
        <span className="clip">{me.name}</span>
      </Button>
    </aside>
  );
}
