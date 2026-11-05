import { createEffect, createRoot, flush } from "solid-js";
import { ClientModel, Model, Property, setAdapter } from "engine";
import { expect, test } from "vite-plus/test";
import { solidAdapter } from "../src";

setAdapter(solidAdapter);

@ClientModel("Note")
class Note extends Model {
  @Property() title!: string;
  @Property() body!: string;
}

const note = (): Note => Object.assign(new Note(), { __data: { id: "n", title: "a", body: "b" } });

// Each effect counts its runs and remembers what it last saw.
function watch(read: () => unknown): { runs: number; seen: unknown } {
  const log = { runs: 0, seen: undefined as unknown };
  createRoot(() => createEffect(read, (value) => void ((log.runs += 1), (log.seen = value))));
  flush();
  return log;
}

test("a field write updates only what read that field", () => {
  const n = note();
  const title = watch(() => n.title);
  const body = watch(() => n.body);
  n.title = "changed";
  flush();
  expect([title.runs, title.seen, body.runs]).toEqual([2, "changed", 1]);
});

test("many writes in one tick render once", () => {
  const n = note();
  const both = watch(() => `${n.title} ${n.body}`);
  n.title = "x";
  n.body = "y";
  n.title = "z";
  flush();
  expect([both.runs, both.seen]).toEqual([2, "z y"]);
});

test("a lazy collection resolves once its load does", async () => {
  const items = solidAdapter.asyncCollection(async () => [1, 2]);
  const seen = watch(() => items());
  expect(seen.runs).toBe(0);
  await Promise.resolve();
  flush();
  expect(seen.seen).toEqual([1, 2]);
});
