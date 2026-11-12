import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { useQuery } from "convex-helpers/react/cache";
import { useCallback, useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { plain } from "../../../convex/text";
import type { Box } from "./state";

export { api };
export { groupToken, parts, personToken, plain } from "../../../convex/text";
export type { Doc, Id };
export type Row = NonNullable<ReturnType<typeof useThreads>>[number];

const EMPTY: never[] = [];

export const useMe = () => useQuery(api.workspace.me);
export const usePeople = () => useQuery(api.workspace.people) ?? EMPTY;
export const useGroups = () => useQuery(api.workspace.groups) ?? EMPTY;
export const useBuckets = () => useQuery(api.workspace.buckets) ?? EMPTY;
export const useThreads = () => useQuery(api.threads.list) ?? EMPTY;

export function useNames() {
  const people = usePeople();
  const groups = useGroups();
  return useMemo(() => {
    const names = new Map<string, string>([...people, ...groups].map((it) => [it._id, it.name]));
    const name = (id: string) => names.get(id) ?? "someone";
    return { name, text: (body: string) => plain(body, (_kind, id) => name(id)) };
  }, [people, groups]);
}

export const inBox = (rows: Row[], box: Box) =>
  box === "all"
    ? rows
    : rows.filter(
        (row) =>
          row.inbox &&
          (box === "inbox" || (box === "unsorted" ? !row.bucketId : row.bucketId === box)),
      );

const BOXES: Record<string, string> = {
  inbox: "Buckets",
  unsorted: "Sorting",
  all: "All Threads",
  drafts: "Drafts",
};
export const boxTitle = (box: Box, buckets: Doc<"buckets">[]) =>
  BOXES[box] ?? buckets.find((bucket) => bucket._id === box)?.name ?? "";

export function sections(rows: Row[], box: Box, buckets: Doc<"buckets">[]) {
  const listed = inBox(rows, box);
  if (box !== "inbox") return [{ title: "", rows: listed }];
  return [...buckets, undefined]
    .map((bucket) => ({
      title: bucket?.name ?? "Sorting",
      rows: listed.filter((row) => row.bucketId === bucket?._id),
    }))
    .filter((section) => section.rows.length > 0);
}

function patchRow(store: OptimisticLocalStore, threadId: Id<"threads">, change: Partial<Row>) {
  const rows = store.getQuery(api.threads.list, {});
  if (!rows) return;
  store.setQuery(
    api.threads.list,
    {},
    rows.map((row) => (row.threadId === threadId ? { ...row, ...change } : row)),
  );
}

export const useMark = () =>
  useMutation(api.threads.mark).withOptimisticUpdate((store, { threadId, ...state }) =>
    patchRow(store, threadId, state),
  );

export const useMove = () =>
  useMutation(api.threads.move).withOptimisticUpdate((store, { threadId, bucketId }) =>
    patchRow(store, threadId, { bucketId }),
  );

export function useSend() {
  const send = useMutation(api.threads.send).withOptimisticUpdate((store, { threadId, body }) => {
    const me = store.getQuery(api.workspace.me, {});
    const messages = store.getQuery(api.threads.messages, { threadId });
    if (!me || !messages) return;
    const sent = {
      _id: crypto.randomUUID() as Id<"messages">,
      _creationTime: Date.now(),
      workspaceId: me.workspaceId,
      threadId,
      authorId: me._id,
      body,
    };
    store.setQuery(api.threads.messages, { threadId }, [...messages, sent]);
    patchRow(store, threadId, { lastAuthorId: me._id, lastBody: body, activeAt: Date.now() });
  });
  return useCallback(
    (threadId: string, body: string) => send({ threadId: threadId as Id<"threads">, body }),
    [send],
  );
}
