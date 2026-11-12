import { useMutation } from "convex/react";
import { api, inBox, useBuckets, useMe, useThreads } from "./data";
import { Icon, type IconName } from "./Icon";
import { Identicon } from "./Identicon";
import { useResize } from "./resize";
import { go, setDialog, showMenu, useUI, useView, type Box, type MenuItem } from "./state";

function BoxRow(props: {
  box: Box;
  label: string;
  icon: IconName;
  count: number;
  nested?: boolean;
  menu?: MenuItem[];
}) {
  const view = useView();
  return (
    <li>
      <button
        className={props.nested ? "box nested" : "box"}
        aria-current={view.box === props.box && !view.settings}
        onClick={() => go({ box: props.box, thread: undefined })}
        onContextMenu={(event) => props.menu && showMenu(event, props.menu)}
      >
        <Icon name={props.icon} color={`var(--${props.icon})`} />
        <span className="clip">{props.label}</span>
        <span className="count">{props.count}</span>
      </button>
    </li>
  );
}

export function Sidebar() {
  const me = useMe()!;
  const rows = useThreads();
  const buckets = useBuckets();
  const drafts = useUI((ui) => ui.drafts);
  const removeBucket = useMutation(api.workspace.removeBucket);
  const { width, edge } = useResize("sidebar-width", 242, 200, 350);
  const count = (box: Box) => inBox(rows, box).length;
  const editBuckets = { label: "Edit Buckets", run: () => go({ settings: true }) };

  return (
    <aside className="sidebar" style={{ width }}>
      <nav>
        <ul>
          <BoxRow
            box="inbox"
            label="Buckets"
            icon="inbox"
            count={count("inbox")}
            menu={[editBuckets]}
          />
          {count("unsorted") > 0 && (
            <BoxRow box="unsorted" label="Sorting" icon="folder" count={count("unsorted")} nested />
          )}
          {buckets.map((bucket) => (
            <BoxRow
              key={bucket._id}
              box={bucket._id}
              label={bucket.name}
              icon="folder"
              count={count(bucket._id)}
              nested
              menu={[
                editBuckets,
                "separator",
                { label: "Delete Bucket", run: () => void removeBucket({ id: bucket._id }) },
              ]}
            />
          ))}
        </ul>
        <ul>
          <BoxRow box="all" label="All Threads" icon="archive" count={rows.length} />
          <BoxRow box="drafts" label="Drafts" icon="draft" count={drafts.length} />
        </ul>
        <button className="new-message" onClick={() => setDialog({ kind: "new" })}>
          <Icon name="add" />
          New Message
        </button>
      </nav>
      <button className="profile" onClick={() => go({ settings: true })}>
        <Identicon seed={me._id} size={20} />
        <span className="clip">{me.name}</span>
      </button>
      {edge}
    </aside>
  );
}
