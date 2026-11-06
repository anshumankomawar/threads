import type { Model } from "./model";

// A saved query over one model, in Linear's shape: each field maps to a comparison of its stored value, and `and` / `or`
// combine filters. A string value starting with `$` is a variable, such as `$me`, filled in when it's evaluated.
export type Comparison = {
  eq?: unknown;
  neq?: unknown;
  in?: unknown[];
  nin?: unknown[];
  contains?: unknown; // an array field that holds the value
  null?: boolean; // no value, or an empty array
};
export type Filter = { and?: Filter[]; or?: Filter[] } & {
  [field: string]: Comparison | Filter[] | undefined;
};

const empty = (value: unknown): boolean =>
  value == null || (Array.isArray(value) && value.length === 0);

function compare(
  stored: unknown,
  comparison: Comparison,
  fill: (value: unknown) => unknown,
): boolean {
  const { eq, neq, in: within, nin, contains, null: none } = comparison;
  return (
    (eq === undefined || stored === fill(eq)) &&
    (neq === undefined || stored !== fill(neq)) &&
    (within === undefined || within.map(fill).includes(stored)) &&
    (nin === undefined || !nin.map(fill).includes(stored)) &&
    (contains === undefined || (Array.isArray(stored) && stored.includes(fill(contains)))) &&
    (none === undefined || empty(stored) === none)
  );
}

// Whether `model` passes `filter`, reading each field reactively so a view over it updates as they change.
export function matches(
  model: Model,
  filter: Filter,
  variables: Record<string, unknown> = {},
): boolean {
  const fill = (value: unknown) =>
    typeof value === "string" && value.startsWith("$") ? variables[value.slice(1)] : value;
  return Object.entries(filter).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === "and") return (value as Filter[]).every((f) => matches(model, f, variables));
    if (key === "or") return (value as Filter[]).some((f) => matches(model, f, variables));
    void (model as unknown as Record<string, unknown>)[key];
    return compare(model.__data[key], value as Comparison, fill);
  });
}
