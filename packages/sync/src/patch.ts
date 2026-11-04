// Updates as patches. A field is set to a value, or, for an array of ids, changed by adding and removing items, so two
// people changing the same list at once both keep their change rather than the later one replacing the whole list.

export type ArrayOp = { $add?: string[]; $remove?: string[] };

// The changes to a record: each field a new value, or an `ArrayOp` for an array field.
export type Patch<R> = {
  [Field in keyof R]?: R[Field] | (R[Field] extends string[] ? ArrayOp : never);
};

export function isArrayOp(value: unknown): value is ArrayOp {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => key === "$add" || key === "$remove")
  );
}

// An array with an op applied: removals, then additions not already there, keeping the existing order.
export function applyArrayOp(current: readonly string[], op: ArrayOp): string[] {
  const removed = new Set(op.$remove ?? []);
  const next = current.filter((item) => !removed.has(item));
  for (const item of op.$add ?? []) if (!next.includes(item)) next.push(item);
  return next;
}

// The op that turns one array into another.
export function arrayOp(before: readonly string[], after: readonly string[]): ArrayOp {
  return {
    $add: after.filter((item) => !before.includes(item)),
    $remove: before.filter((item) => !after.includes(item)),
  };
}

// A record with a patch applied.
export function applyPatch<R extends object>(record: R, patch: Patch<R>): R {
  const next = { ...record } as Record<string, unknown>;
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    next[field] = isArrayOp(value)
      ? applyArrayOp((next[field] as string[] | undefined) ?? [], value)
      : value;
  }
  return next as R;
}

// The patch that undoes `patch` on `before`: the old values back, and array ops reversed for only the items the op
// actually changed.
export function invertPatch<R extends object>(before: R, patch: Patch<R>): Patch<R> {
  const was = before as Record<string, unknown>;
  const inverse: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isArrayOp(value)) {
      const current = (was[field] as string[] | undefined) ?? [];
      inverse[field] = {
        $add: (value.$remove ?? []).filter((item) => current.includes(item)),
        $remove: (value.$add ?? []).filter((item) => !current.includes(item)),
      } satisfies ArrayOp;
    } else inverse[field] = was[field] ?? null;
  }
  return inverse as Patch<R>;
}

// A patch's changes as plain values: each array op replaced by the array it makes from `record`'s. For rules that need
// to see the outcome, such as who a group's members will be.
export function resolvePatch<R extends object, P extends object>(
  record: R,
  patch: P,
): ResolvedPatch<P> {
  const was = record as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(patch).map(([field, value]) => [
      field,
      isArrayOp(value) ? applyArrayOp((was[field] as string[] | undefined) ?? [], value) : value,
    ]),
  ) as ResolvedPatch<P>;
}

export type ResolvedPatch<P> = { [Field in keyof P]: Exclude<P[Field], ArrayOp> };

// Changes with every array replaced by the op that turns `record`'s array into it, so a whole new list sent from one
// client merges with another's edits to the same list instead of replacing them.
export function listsAsOps<R extends object, C extends object>(
  record: R | undefined,
  changes: C,
): C {
  if (record === undefined) return changes;
  const was = record as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(changes).map(([field, value]) => [
      field,
      Array.isArray(value) && Array.isArray(was[field])
        ? arrayOp(was[field] as string[], value as string[])
        : value,
    ]),
  ) as C;
}
