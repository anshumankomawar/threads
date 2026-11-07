import { createSignal } from "solid-js";
import { Bucket, Draft, Label, Subspace, Thread, View } from "models";
import { matches } from "sync";
import {
  active,
  followOrder,
  inbox,
  lastActive,
  me,
  open,
  save,
  saved,
  sent,
  store,
} from "./session";

// ── Mail's layout: a sidebar of mailboxes, the chosen one's threads beside it, and the open thread beside them ──

// What the middle column lists: your inbox (all of it, one bucket, or what the model hasn't sorted yet), what you've
// sent or drafted, or a space's, label's or saved view's threads.
export type Mailbox =
  | { kind: "inbox" | "unsorted" | "sent" | "drafts" | "all" }
  | { kind: "bucket" | "subspace" | "label" | "view"; id: string };

const [chosen, setChosen] = createSignal<Mailbox>(saved<Mailbox>("mailbox", { kind: "inbox" }));
export const mailbox = chosen;

export const sameMailbox = (a: Mailbox, b: Mailbox): boolean =>
  a.kind === b.kind && ("id" in a ? a.id : null) === ("id" in b ? b.id : null);

// Choosing a mailbox, as in Mail, leaves no thread open unless the one you're reading is in it.
export function chooseMailbox(next: Mailbox): void {
  setChosen(next);
  save("mailbox", next);
  const reading = active();
  if (reading && !listed().order.includes(reading)) open({ thread: null });
}

// A group of rows under a heading: the inbox lists each bucket apart.
export type Group = { key: string; bucket?: Bucket; title?: string; threads: Thread[] };

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
  return { groups, order: groups.flatMap((g) => g.threads) };
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
    case "inbox":
      return "Inbox";
    case "unsorted":
      return "Sorting";
    case "sent":
      return "Sent";
    case "drafts":
      return "Drafts";
    case "all":
      return "All threads";
    case "bucket":
      return store.findById(Bucket, box.id)?.name ?? "Inbox";
    case "subspace":
      return store.findById(Subspace, box.id)?.name ?? "";
    case "label":
      return store.findById(Label, box.id)?.name ?? "";
    case "view":
      return store.findById(View, box.id)?.name ?? "";
  }
}
