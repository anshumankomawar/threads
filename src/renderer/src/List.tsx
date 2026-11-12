import { useEffect, useRef, type MouseEvent } from "react";
import {
  boxTitle,
  sections,
  useBuckets,
  useMark,
  useMove,
  useNames,
  useThreads,
  type Row,
} from "./data";
import { Icon } from "./Icon";
import { useResize } from "./resize";
import { go, removeDraft, setDialog, showMenu, useUI, useView, type Draft } from "./state";
import { stamp } from "./time";

function ThreadRow({ row }: { row: Row }) {
  const active = useView().thread === row.threadId;
  const buckets = useBuckets();
  const names = useNames();
  const mark = useMark();
  const move = useMove();
  const card = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) void card.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const { threadId } = row;
  const menu = (event: MouseEvent) =>
    showMenu(event, [
      { label: "Open", run: () => go({ thread: threadId }) },
      "separator",
      row.inbox
        ? { label: "Done", run: () => void mark({ threadId, inbox: false }) }
        : { label: "Move to Buckets", run: () => void mark({ threadId, inbox: true }) },
      { label: "Mark Unread", run: () => void mark({ threadId, unread: true }) },
      "separator",
      ...buckets
        .filter((bucket) => bucket._id !== row.bucketId)
        .map((bucket) => ({
          label: `Move to ${bucket.name}`,
          run: () => void move({ threadId, bucketId: bucket._id }),
        })),
    ]);

  return (
    <li>
      <button
        ref={card}
        className="card"
        aria-current={active}
        onClick={() => go({ thread: threadId })}
        onContextMenu={menu}
      >
        <span className="line">
          <b className="clip">{row.title}</b>
          {row.unread && <i className="unread" aria-label="Unread" />}
          <time>{stamp(row.activeAt)}</time>
        </span>
        <span className="preview clip">
          <b>{names.name(row.lastAuthorId)}</b> {names.text(row.lastBody)}
        </span>
      </button>
    </li>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const [title, ...rest] = draft.text.split("\n");
  return (
    <li>
      <button
        className="card"
        onClick={() => setDialog({ kind: "new", draft })}
        onContextMenu={(event) =>
          showMenu(event, [{ label: "Delete Draft", run: () => removeDraft(draft.id) }])
        }
      >
        <span className="line">
          <b className="clip">{title}</b>
          <time>{stamp(draft.at)}</time>
        </span>
        <span className="preview clip">{rest.join(" ")}</span>
      </button>
    </li>
  );
}

export function List({ alone }: { alone: boolean }) {
  const { box } = useView();
  const rows = useThreads();
  const buckets = useBuckets();
  const drafts = useUI((ui) => ui.drafts);
  const { width, edge } = useResize("list-width", 374, 310, 660);
  const groups = sections(rows, box, buckets);
  const listed = groups.flatMap((group) => group.rows);
  const unread = listed.filter((row) => row.unread).length;
  const total = box === "drafts" ? drafts.length : listed.length;
  const noun = box === "drafts" ? "draft" : "thread";

  return (
    <section className={alone ? "list alone" : "list"} style={{ width: alone ? undefined : width }}>
      <h1>
        <span className="clip">{boxTitle(box, buckets)}</span>
        <small>
          {unread > 0 ? `${unread} unread` : `${total} ${noun}${total === 1 ? "" : "s"}`}
        </small>
      </h1>
      <div className="scroll">
        {box === "drafts" ? (
          <ul>
            {drafts.map((draft) => (
              <DraftRow key={draft.id} draft={draft} />
            ))}
          </ul>
        ) : (
          groups.map((group) => (
            <ul key={group.title}>
              {group.title && (
                <h2>
                  <Icon name="folder" color="var(--folder)" />
                  {group.title}
                  <small>{group.rows.length}</small>
                </h2>
              )}
              {group.rows.map((row) => (
                <ThreadRow key={row.threadId} row={row} />
              ))}
            </ul>
          ))
        )}
        {total === 0 && (
          <div className="empty">
            <Icon name="inbox" size={28} />
            <b>{box === "inbox" ? "All caught up" : "Nothing here"}</b>
            {box === "inbox" && "Nothing in your buckets needs you right now."}
          </div>
        )}
      </div>
      {!alone && edge}
    </section>
  );
}
