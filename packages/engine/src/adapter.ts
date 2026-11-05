import type { ReactivityAdapter } from "./api";

const quiet = { track() {}, notify() {} };

// No UI: for the server and the simulation.
export const plainAdapter: ReactivityAdapter = {
  atom: () => quiet,
  memo: (fn) => fn,
  asyncCollection: (load) => {
    let items: Awaited<ReturnType<typeof load>> = [];
    void load().then((loaded) => (items = loaded));
    return () => items;
  },
  onUnobserved: () => {},
  root: (fn) => fn(),
};

export let adapter = plainAdapter;

// Once at startup, before any model or store is made.
export function setAdapter(next: ReactivityAdapter): void {
  adapter = next;
}

// A value read reactively, for the store's connection and pending count.
export function cell<T>(value: T): { (): T; set(next: T): void } {
  const atom = adapter.atom();
  const read = () => (atom.track(), value);
  return Object.assign(read, {
    set(next: T) {
      if (next === value) return;
      value = next;
      atom.notify();
    },
  });
}

// Engine-level memos are owned by the adapter's root, not by whichever component first reads them.
export const memo = <T>(fn: () => T): (() => T) => adapter.root(() => adapter.memo(fn));
