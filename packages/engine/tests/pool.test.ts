import { expect, test } from "vite-plus/test";
import { plainAdapter, setAdapter, type SyncAction } from "../src";
import { Conversation } from "./models";
import { row, setup, tick } from "./fake";

// Atoms that record who read them and which were notified.
let reading: Set<object> | undefined;
const notified = new Set<object>();
setAdapter({
  ...plainAdapter,
  atom() {
    const atom = { track: () => reading?.add(atom), notify: () => notified.add(atom) };
    return atom;
  },
});

const delta = (id: number, action: "I" | "D"): SyncAction => ({
  id,
  txId: `x${id}`,
  model: "Conversation",
  modelId: "c1",
  action,
  data: action === "I" ? row("c1", { title: "One", state: "open", teamId: "t1" }) : undefined,
});

test("a view over findById updates when the model arrives, goes and comes back", async () => {
  const { store, transport } = await setup();
  reading = new Set();
  expect(store.view(() => store.findById(Conversation, "c1"))()).toBeUndefined();
  const deps = reading;
  reading = undefined;
  const changed = () => {
    const hit = [...deps].some((atom) => notified.has(atom));
    notified.clear();
    return hit;
  };
  for (const [id, action] of [
    [1, "I"],
    [2, "D"],
    [3, "I"],
  ] as const) {
    transport.send({ type: "delta", actions: [delta(id, action)], lastSyncId: id });
    await tick();
    expect(changed()).toBe(true);
  }
  expect(store.findById(Conversation, "c1")!.title).toBe("One");
});
