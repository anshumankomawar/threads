import { createMemo, createRoot, createSignal, getObserver, runWithOwner } from "solid-js";
import type { Reactivity } from "sync/client";

// The sync engine's reactivity in Solid: an atom is a signal that carries no value (the engine keeps values in plain
// objects, which it reads at once, while a signal's new value shows only after Solid's batch runs), so reading it
// subscribes and writing it tells the views that read it to update.
export const solidReactivity: Reactivity = {
  atom() {
    const [read, write] = createSignal(0, { equals: false, ownedWrite: true });
    return {
      observed: () => void read(),
      changed: () => write(0),
    };
  },
  // Cached for views; read outside one (an event handler, the engine), it answers from the current values, since a
  // memo only catches up once the batch runs. Made up front, owned by nothing, so it outlives whichever view reads it
  // (Solid forbids making one in some places a view reads from, such as `onSettled`); lazy, so it computes only once
  // something reads it.
  memo(compute) {
    const cached = runWithOwner(null, () => createRoot(() => createMemo(compute, { lazy: true })));
    return () => (getObserver() === null ? compute() : cached());
  },
};
