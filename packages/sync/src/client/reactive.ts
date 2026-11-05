// How the engine tells a UI that something changed, without knowing which UI it is. The engine keeps every value in
// plain objects and maps it reads instantly; an atom only says "this was read" (so a view depends on it) and "this
// changed" (so the views that read it update). The app installs its framework's atoms once, before making a client
// (`setReactivity`); tests and the server use the plain ones, which do nothing.
export type Atom = {
  observed(): void;
  changed(): void;
};

export type Reactivity = {
  atom(): Atom;
  // A derived value, cached while something observes it. Read outside any view, it must answer from the current
  // values, never a cached one.
  memo<T>(compute: () => T): () => T;
};

const PLAIN_ATOM: Atom = { observed() {}, changed() {} };

export const plainReactivity: Reactivity = {
  atom: () => PLAIN_ATOM,
  memo: (compute) => compute,
};

let current: Reactivity = plainReactivity;

export function setReactivity(reactivity: Reactivity): void {
  current = reactivity;
}

export const atom = (): Atom => current.atom();
export const memo = <T>(compute: () => T): (() => T) => current.memo(compute);

// Turns plain fields into reactive ones: each reads and writes its own value, with an atom saying when it changed.
export function reactiveFields<O extends object>(target: O, keys: (keyof O)[]): void {
  for (const key of keys) {
    let value = target[key];
    const field = atom();
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get() {
        field.observed();
        return value;
      },
      set(next: O[keyof O]) {
        if (Object.is(next, value)) return;
        value = next;
        field.changed();
      },
    });
  }
}

// Turns getters on a class into derived values, cached while observed (MobX's `computed`).
export function derivedGetters<O extends object>(target: O, keys: (keyof O)[]): void {
  for (const key of keys) {
    const prototype: object = Object.getPrototypeOf(target);
    if (Object.getOwnPropertyDescriptor(prototype, key)?.get === undefined)
      throw new Error(`${String(key)} is not a getter`);
    const read = memo(() => Reflect.get(prototype, key, target) as O[keyof O]);
    Object.defineProperty(target, key, { enumerable: true, configurable: true, get: read });
  }
}

// A map whose reads are tracked: one atom per key, for `get` and `has`, and one for the whole map, for iterating and
// its size. Values are replaced whole, never mutated, so the map is all that needs to be reactive.
export class ReactiveMap<K, V> implements ReadonlyMap<K, V> {
  readonly #map = new Map<K, V>();
  readonly #keys = new Map<K, Atom>();
  readonly #all = atom();

  #atom(key: K): Atom {
    let found = this.#keys.get(key);
    if (found === undefined) {
      found = atom();
      this.#keys.set(key, found);
    }
    return found;
  }

  get(key: K): V | undefined {
    this.#atom(key).observed();
    return this.#map.get(key);
  }

  has(key: K): boolean {
    this.#atom(key).observed();
    return this.#map.has(key);
  }

  set(key: K, value: V): this {
    if (this.#map.get(key) === value && this.#map.has(key)) return this;
    this.#map.set(key, value);
    this.#keys.get(key)?.changed();
    this.#all.changed();
    return this;
  }

  delete(key: K): boolean {
    const had = this.#map.delete(key);
    if (had) {
      this.#keys.get(key)?.changed();
      this.#all.changed();
    }
    return had;
  }

  clear(): void {
    if (this.#map.size === 0) return;
    const keys = [...this.#map.keys()];
    this.#map.clear();
    for (const key of keys) this.#keys.get(key)?.changed();
    this.#all.changed();
  }

  get size(): number {
    this.#all.observed();
    return this.#map.size;
  }

  keys(): MapIterator<K> {
    this.#all.observed();
    return this.#map.keys();
  }

  values(): MapIterator<V> {
    this.#all.observed();
    return this.#map.values();
  }

  entries(): MapIterator<[K, V]> {
    this.#all.observed();
    return this.#map.entries();
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#all.observed();
    this.#map.forEach((value, key) => callback.call(thisArg, value, key, this));
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return "ReactiveMap";
  }
}
