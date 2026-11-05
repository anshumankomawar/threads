import { createMemo, createRoot, createSignal, getObserver, runWithOwner } from "solid-js";
import type { ReactivityAdapter } from "engine";

// What runs when an atom or memo loses its last reader, set after it's made (Solid takes the option at creation).
const unobserved = new WeakMap<object, () => void>();

// The engine keeps values in plain objects it reads at once (a signal's new value shows only after Solid's batch), so
// an atom is a signal that carries no value: reading it subscribes, writing it tells its readers to update.
export const solidAdapter: ReactivityAdapter = {
  atom() {
    const handle = {} as { track(): void; notify(): void };
    const [read, write] = createSignal(0, {
      equals: false,
      ownedWrite: true,
      unobserved: () => unobserved.get(handle)?.(),
    });
    handle.track = () => void read();
    handle.notify = () => void write(0);
    return handle;
  },
  // Owned by nothing so it outlives whichever view first reads it. Read outside a view (a handler, the engine) it
  // answers from the current values, since a memo catches up only once the batch runs.
  memo(fn) {
    const read = (): ReturnType<typeof fn> => (getObserver() === null ? fn() : cached());
    const cached = runWithOwner(null, () =>
      createRoot(() => createMemo(fn, { lazy: true, unobserved: () => unobserved.get(read)?.() })),
    );
    return read;
  },
  // An async memo: reading it before the load resolves suspends to the nearest <Loading>.
  asyncCollection(load) {
    return runWithOwner(null, () => createRoot(() => createMemo(load, { lazy: true })));
  },
  onUnobserved(atomOrMemo, fn) {
    unobserved.set(atomOrMemo as object, fn);
  },
  root: (fn) => createRoot(() => fn()),
};
