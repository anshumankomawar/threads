import { Button } from "@ui-sdk/react/button";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api, inBox, useBuckets, useMe, useThreads } from "./data";
import { Icon, type IconName } from "./Icon";
import { Identicon } from "./Identicon";
import { ContextMenu, type MenuEntry } from "./Menu";
import { go, useUI, useView, type Box } from "./state";

export function Sidebar() {
  const me = useMe()!;
  const view = useView();
  const rows = useThreads();
  const buckets = useBuckets();
  const drafts = useUI((ui) => ui.drafts);
  const removeBucket = useMutation(api.workspace.removeBucket);
  const editBuckets: MenuEntry = { label: "Edit Buckets", run: () => go({ settings: true }) };
  const [menu, setMenu] = useState<MenuEntry[]>([editBuckets]);

  const row = (
    box: Box,
    label: string,
    icon: IconName,
    count: number,
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
      <span className="count">{count}</span>
    </ListboxItem>
  );
  const count = (box: Box) => inBox(rows, box).length;

  return (
    <aside className="sidebar">
      <ContextMenu entries={menu}>
        <Listbox
          aria-label="Mailboxes"
          value={view.settings ? null : view.box}
          onValueChange={(box) => box && go({ box, thread: undefined })}
        >
          {row("all", "All Threads", "archive", rows.length)}
          {row("drafts", "Drafts", "draft", drafts.length)}
          {row("inbox", "Buckets", "inbox", count("inbox"))}
          {count("unsorted") > 0 &&
            row("unsorted", "Sorting", "folder", count("unsorted"), undefined, true)}
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
      <Button className="profile" onClick={() => go({ settings: true })}>
        <Identicon seed={me._id} size={20} />
        <span className="clip">{me.name}</span>
      </Button>
    </aside>
  );
}
