import { createMemo, createRoot, createSignal, getObserver, runWithOwner } from "@solidjs/signals";

export type Announcer = { track: () => void; notify: () => void };

// Values live in plain objects the engine reads at once (Solid shows a signal's new value only after its batch), so
// this signal carries none: reading it subscribes, writing it tells its readers to update.
export function announcer(): Announcer {
  const [read, write] = createSignal(0, { equals: false, ownedWrite: true });
  return { track: () => void read(), notify: () => void write(0) };
}

// A value read reactively, for the store's connection and pending count.
export function cell<T>(value: T): { (): T; set(next: T): void } {
  const { track, notify } = announcer();
  return Object.assign(() => (track(), value), {
    set(next: T) {
      if (next === value) return;
      value = next;
      notify();
    },
  });
}

// Owned by nothing, so it outlives whichever view first reads it. Read outside a tracking scope (a handler, the engine)
// it computes from the current values, since a memo catches up only once the batch runs.
export function memo<T>(fn: () => T): () => T {
  const cached = runWithOwner(null, () => createRoot(() => createMemo(fn, { lazy: true })));
  return () => (getObserver() === null ? fn() : cached());
}
