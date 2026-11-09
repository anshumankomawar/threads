import {
  createMemo,
  createRoot,
  createSignal,
  getObserver,
  onCleanup,
  runWithOwner,
} from "@solidjs/signals";

export type Announcer = { track: () => void; notify: () => void };

// Values live in plain objects the engine reads at once (Solid shows a signal's new value only after its batch), so
// this signal carries none: reading it subscribes, writing it tells its readers to update. Owned by nothing: it lives as
// long as its model or list, and a signal keeps its owner, so made under the component that first read it, it kept
// that component (and its elements) for good after it was gone.
export function announcer(): Announcer {
  const [read, write] = runWithOwner(null, () =>
    createSignal(0, { equals: false, ownedWrite: true }),
  );
  return { track: () => void read(), notify: () => void write(0) };
}

// Announcers by key, made when something tracks one and dropped once nothing does, so a key read once (an id looked up,
// a list by some value) doesn't stay in memory for good. Notifying a key nobody tracks does nothing: nobody to tell.
export class Announcers<K> {
  readonly #live = new Map<K, { announcer: Announcer; readers: number }>();

  track(key: K): void {
    if (getObserver() === null) return;
    let entry = this.#live.get(key);
    if (!entry) this.#live.set(key, (entry = { announcer: announcer(), readers: 0 }));
    const tracked = entry;
    tracked.readers++;
    tracked.announcer.track();
    onCleanup(() => {
      if (--tracked.readers === 0 && this.#live.get(key) === tracked) this.#live.delete(key);
    });
  }

  notify(key: K): void {
    this.#live.get(key)?.announcer.notify();
  }

  // How many keys are tracked, for the tests.
  get size(): number {
    return this.#live.size;
  }
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
