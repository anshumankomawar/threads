import { createEffect, createRoot, flush } from "@solidjs/signals";
import type { SyncAction } from "protocol";
import { row, setup, tick } from "testing";
import { expect, test } from "vite-plus/test";
import { Conversation } from "./models";

// Each effect counts its runs and remembers what it last saw.
function watch(read: () => unknown): { runs: number; seen: unknown } {
  const log = { runs: 0, seen: undefined as unknown };
  createRoot(() => createEffect(read, (value) => void ((log.runs += 1), (log.seen = value))));
  flush();
  return log;
}

const c1 = { model: "Conversation", row: row("c1", { title: "a", state: "open", teamId: "t1" }) };

test("a field write updates only what read that field", async () => {
  const { store } = await setup([c1]);
  const c = store.findById(Conversation, "c1")!;
  const title = watch(() => c.title);
  const state = watch(() => c.state);
  c.title = "changed";
  flush();
  expect([title.runs, title.seen, state.runs]).toEqual([2, "changed", 1]);
});

test("many writes in one tick run once", async () => {
  const { store } = await setup([c1]);
  const c = store.findById(Conversation, "c1")!;
  const both = watch(() => `${c.title} ${c.state}`);
  c.title = "x";
  c.state = "resolved";
  c.title = "z";
  flush();
  expect([both.runs, both.seen]).toEqual([2, "z resolved"]);
});

test("a view over findById updates when the model arrives, goes and comes back", async () => {
  const { store, transport } = await setup();
  const view = store.view(() => store.findById(Conversation, "c1")?.title);
  const seen = watch(view);
  const delta = (id: number, action: "I" | "D"): SyncAction => ({
    id,
    txId: `x${id}`,
    model: "Conversation",
    modelId: "c1",
    action,
    data: action === "I" ? c1.row : undefined,
  });
  for (const [id, action, title] of [
    [1, "I", "a"],
    [2, "D", undefined],
    [3, "I", "a"],
  ] as const) {
    transport.send({ type: "delta", groups: [], actions: [delta(id, action)], lastSyncId: id });
    await tick();
    flush();
    expect(seen.seen).toBe(title);
  }
  expect(seen.runs).toBe(4);
});
