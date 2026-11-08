import { createSignal } from "solid-js";
import { Bucket, Draft, Label, Subspace, Thread, User, View } from "models";
import { matches, type Filter } from "sync";
import { FIELDS } from "./filters";
import {
  edit,
  followOrder,
  inbox,
  lastActive,
  me,
  open,
  save,
  saved,
  sent,
  step,
  store,
  trackMailbox,
} from "./session";

// ── Mail's layout: a sidebar of mailboxes, the chosen one's threads beside it, and the open thread beside them ──

// What the middle column lists: your inbox (all of it, one bucket, or what the model hasn't sorted yet), what you've
// sent or drafted, or a space's, label's, person's or saved view's threads.
export type Mailbox =
  | { kind: "inbox" | "unsorted" | "personal" | "sent" | "drafts" | "all" }
  | { kind: "bucket" | "subspace" | "label" | "person" | "view"; id: string };

const [chosen, setChosen] = createSignal<Mailbox>(saved<Mailbox>("mailbox", { kind: "inbox" }));
export const mailbox = chosen;

export const sameMailbox = (a: Mailbox, b: Mailbox): boolean =>
  a.kind === b.kind && ("id" in a ? a.id : null) === ("id" in b ? b.id : null);

// What narrows the list beyond its mailbox, as a table's filter did: a saved view's are its own (and changing them
// changes it); any other mailbox starts unfiltered.
const [extra, setExtra] = createSignal<Filter[]>([]);
export function conditions(): Filter[] {
  const box = chosen();
  if (box.kind !== "view") return extra();
  return store.findById(View, box.id)?.filter.and ?? [];
}
export function setConditions(next: Filter[]): void {
  const box = chosen();
  const saved = box.kind === "view" ? store.findById(View, box.id) : undefined;
  if (saved) edit(saved, { filter: { and: next } });
  else setExtra(next);
}

// What a mailbox's threads have in common, as a filter, so that saving its filtered list as a view keeps them.
export function baseFilter(box: Mailbox): Filter[] {
  switch (box.kind) {
    case "subspace":
      return [{ subspaceIds: { contains: box.id } }];
    case "label":
      return [{ labelIds: { contains: box.id } }];
    case "person":
      return [{ or: [{ ownerId: { eq: box.id } }, { assigneeIds: { contains: box.id } }] }];
    case "personal":
      return [{ or: [{ ownerId: { eq: "$me" } }, { assigneeIds: { contains: "$me" } }] }];
    default:
      return [];
  }
}

// The mailbox as last set (the signal reads its old one until its batch is done), for history.
let chosenNow = chosen();
function setMailbox(next: Mailbox): void {
  chosenNow = next;
  setChosen(next);
  setExtra([]);
  save("mailbox", next);
}
trackMailbox(
  () => chosenNow,
  (box) => setMailbox(box as Mailbox),
);
// Following the open page to its mailbox (a space's page lists its threads), which isn't a step of its own.
export function showMailbox(next: Mailbox): void {
  if (!sameMailbox(next, chosenNow)) setMailbox(next);
}

// Choosing a mailbox shows it: its list, and in the reading pane its page (a space's, a bucket's) or the scene, not
// whatever thread was open before. Both are one step back.
export function chooseMailbox(next: Mailbox): void {
  step(() => {
    setMailbox(next);
    open({ thread: null });
  });
}

// How a mailbox's list is shown, on this Mac only (it's how you look at it, not part of it): as rows or a board, and
// grouped by any field it can be filtered by (filters.ts), or as the mailbox groups it. A board groups by status
// unless told otherwise.
export type Display = { board: boolean; group?: string };
const keyOf = (box: Mailbox): string => box.kind + ("id" in box ? `:${box.id}` : "");
const [displays, setDisplays] = createSignal<Record<string, Display>>(saved("displays", {}));
export const display = (): Display => displays()[keyOf(chosen())] ?? { board: false };
// For the mailbox as last chosen (the signal reads its old one until its batch is done).
export function setDisplay(change: Partial<Display>): void {
  const key = keyOf(chosenNow);
  setDisplays((all) => {
    const next = { ...all, [key]: { ...(all[key] ?? { board: false }), ...change } };
    save("displays", next);
    return next;
  });
}
const groupedBy = (): string | undefined =>
  display().group ?? (display().board ? "state" : undefined);

// Threads in groups by a field's values, in the field's own order: one group a value, a thread in every group it has
// (a label, a space), and the threads with none last.
function regroup(threads: Thread[], field: string): Group[] {
  const { label, values } = FIELDS[field];
  const has = (t: Thread, value: string): boolean => {
    const v = (t as unknown as Record<string, unknown>)[field];
    return Array.isArray(v) ? v.includes(value) : v === value;
  };
  const empty = (t: Thread): boolean => {
    const v = (t as unknown as Record<string, unknown>)[field];
    return Array.isArray(v) ? v.length === 0 : v === undefined || v === null;
  };
  return [
    ...values()
      .filter(([value]) => !value.startsWith("$"))
      .map(([value, title]) => ({
        key: value,
        title,
        threads: threads.filter((t) => has(t, value)),
      })),
    ...(threads.some(empty)
      ? [{ key: "none", title: `No ${label.toLowerCase()}`, threads: threads.filter(empty) }]
      : []),
  ];
}

// A group of rows under a heading: the inbox lists each bucket apart.
type Group = { key: string; bucket?: Bucket; title?: string; threads: Thread[] };

const newestFirst = (threads: Thread[]): Thread[] =>
  [...threads].sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || lastActive(b) - lastActive(a));

// The chosen mailbox's threads, grouped as they're shown, and their order (for J and K, and what opens after Done).
export const listed = store.view((): { groups: Group[]; order: Thread[] } => {
  const box = chosen();
  const groups = ((): Group[] => {
    const { sections, unsorted } = inbox();
    switch (box.kind) {
      case "inbox":
        return [
          { key: "unsorted", title: "Sorting", threads: unsorted.map((i) => i.thread) },
          ...sections.map((s) => ({
            key: s.bucket.id,
            bucket: s.bucket,
            threads: s.items.map((i) => i.thread),
          })),
        ].filter((g) => g.threads.length > 0);
      case "unsorted":
        return [{ key: "unsorted", threads: unsorted.map((i) => i.thread) }];
      case "bucket":
        return [
          {
            key: box.id,
            threads: (sections.find((s) => s.bucket.id === box.id)?.items ?? []).map(
              (i) => i.thread,
            ),
          },
        ];
      case "sent":
        return [{ key: "sent", threads: sent() }];
      // Yours: every thread you own or are assigned, open first, newest first.
      case "personal":
        return [
          {
            key: "personal",
            threads: newestFirst(
              store
                .all(Thread)
                .filter((t) => t.ownerId === me().id || t.assigneeIds.includes(me().id)),
            ),
          },
        ];
      case "drafts":
        return [];
      case "all":
        return [{ key: "all", threads: newestFirst(store.all(Thread)) }];
      case "subspace":
        return [
          {
            key: box.id,
            threads: newestFirst(store.all(Thread).filter((t) => t.subspaceIds.includes(box.id))),
          },
        ];
      case "label":
        return [
          {
            key: box.id,
            threads: newestFirst(store.all(Thread).filter((t) => t.labelIds.includes(box.id))),
          },
        ];
      case "person":
        return [
          {
            key: box.id,
            threads: newestFirst(
              store
                .all(Thread)
                .filter((t) => t.ownerId === box.id || t.assigneeIds.includes(box.id)),
            ),
          },
        ];
      case "view": {
        const saved = store.findById(View, box.id);
        const filter = saved?.filter;
        return [
          {
            key: box.id,
            threads: filter
              ? newestFirst(store.all(Thread).filter((t) => matches(t, filter, { me: me().id })))
              : [],
          },
        ];
      }
    }
  })();
  // Then the filter's conditions, if any.
  const and = box.kind === "view" ? [] : extra();
  const narrowed =
    and.length === 0
      ? groups
      : groups
          .map((g) => ({
            ...g,
            threads: g.threads.filter((t) => matches(t, { and }, { me: me().id })),
          }))
          // A bucket the filter empties isn't shown at all.
          .filter((g) => g.threads.length > 0);
  // Grouped by a field instead, if the display says so; a board keeps its empty columns, a list drops them.
  const by = groupedBy();
  const shown = by
    ? regroup([...new Set(narrowed.flatMap((g) => g.threads))], by).filter(
        (g) => display().board || g.threads.length > 0,
      )
    : narrowed;
  return { groups: shown, order: shown.flatMap((g) => g.threads) };
});

followOrder(() => listed().order);

export const drafts = store.view(() =>
  store
    .where(Draft, "userId", me().id)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
);

// The mailbox's name, for the list's header.
export function mailboxTitle(box: Mailbox): string {
  switch (box.kind) {
    // All of your inbox, every bucket at once (the sidebar's Inbox tab holds it).
    case "inbox":
      return "Buckets";
    case "unsorted":
      return "Sorting";
    case "sent":
      return "Sent";
    case "drafts":
      return "Drafts";
    case "all":
      return "Workspace";
    case "personal":
      return "Personal";
    case "bucket":
      return store.findById(Bucket, box.id)?.name ?? "Inbox";
    case "subspace":
      return store.findById(Subspace, box.id)?.name ?? "";
    case "label":
      return store.findById(Label, box.id)?.name ?? "";
    case "view":
      return store.findById(View, box.id)?.name ?? "";
    case "person":
      return store.findById(User, box.id)?.name ?? "";
  }
}
