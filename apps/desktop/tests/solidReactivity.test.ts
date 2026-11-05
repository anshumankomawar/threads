import { createEffect, createRoot, flush } from "solid-js";
import { atom, memo, ReactiveMap, reactiveFields, setReactivity } from "sync/client";
import { afterAll, expect, test } from "vite-plus/test";
import { plainReactivity } from "sync/client";
import { solidReactivity } from "../src/renderer/src/sync/solidReactivity";

setReactivity(solidReactivity);
afterAll(() => setReactivity(plainReactivity));

test("a view that read a pool entry updates when it changes, and only then", () => {
  const map = new ReactiveMap<string, string>();
  map.set("a", "one");
  map.set("b", "two");
  const seen: (string | undefined)[] = [];
  const dispose = createRoot((dispose) => {
    createEffect(
      () => map.get("a"),
      (value) => void seen.push(value),
    );
    return dispose;
  });
  flush();
  map.set("b", "three");
  flush();
  map.set("a", "four");
  flush();
  expect(seen).toEqual(["one", "four"]);
  dispose();
});

test("fields update their views, and a memo read outside a view is never stale", () => {
  const state = { status: "bootstrapping" };
  reactiveFields(state, ["status"]);
  const counted = atom();
  let runs = 0;
  const upper = memo(() => {
    runs += 1;
    counted.observed();
    return state.status.toUpperCase();
  });
  const seen: string[] = [];
  const dispose = createRoot((dispose) => {
    createEffect(
      () => upper(),
      (value) => void seen.push(value),
    );
    return dispose;
  });
  flush();
  state.status = "ready";
  // Read at once, outside any view: the current value, even before Solid's batch runs.
  expect(upper()).toBe("READY");
  flush();
  expect(seen).toEqual(["BOOTSTRAPPING", "READY"]);
  expect(runs).toBeGreaterThan(1);
  dispose();
});
