import { Label, PRIORITIES, STATES, Subspace, User } from "models";
import type { Filter } from "sync";
import { store } from "./session";
import { LABELS } from "./components/ThreadView";

// The thread fields a filter can test, how, and the values it offers. A filter is a list of these conditions, all of
// which a thread passes (`{ and: [...] }`); a saved view keeps one.

const people = (): [string, string][] => [
  ["$me", "Me"],
  ...store.all(User).map((u): [string, string] => [u.id, u.name]),
];

export const FIELDS: Record<
  string,
  { label: string; compare: "eq" | "contains"; values: () => [string, string][] }
> = {
  state: { label: "Status", compare: "eq", values: () => STATES.map((s) => [s, LABELS[s]]) },
  priority: {
    label: "Priority",
    compare: "eq",
    // Most urgent first, as a list grouped by it reads.
    values: () => [...PRIORITIES].reverse().map((p): [string, string] => [p, LABELS[p]]),
  },
  subspaceIds: {
    label: "Subspace",
    compare: "contains",
    values: () => store.all(Subspace).map((s) => [s.id, s.name]),
  },
  labelIds: {
    label: "Label",
    compare: "contains",
    values: () => store.all(Label).map((l) => [l.id, l.name]),
  },
  assigneeIds: { label: "Assignee", compare: "contains", values: people },
  ownerId: { label: "Owner", compare: "eq", values: people },
};

// One field's test, as the filter bar shows it: "Status: Open". Either of several ("Owner: Me or Assignee: Me") reads
// as each joined, and a field it doesn't offer by its own name, so a view made elsewhere still shows.
export function describe(condition: Filter): string {
  if ("or" in condition) return (condition.or as Filter[]).map(describe).join(" or ");
  if ("and" in condition) return (condition.and as Filter[]).map(describe).join(", ");
  const [[field, comparison]] = Object.entries(condition);
  const value = String(Object.values(comparison as object)[0]);
  const known = FIELDS[field];
  if (!known) return `${field}: ${value}`;
  return `${known.label}: ${known.values().find(([id]) => id === value)?.[1] ?? "?"}`;
}

// The subspaces a filter's conditions name, whose threads have to be loaded to test them (you may not be in them).
export const subspacesIn = (conditions: Filter[]): string[] =>
  conditions.flatMap((condition) => {
    const contains = (condition.subspaceIds as { contains?: string } | undefined)?.contains;
    return contains ? [contains] : [];
  });
