import { expect, test } from "vite-plus/test";
import { Conversation } from "./models";
import { row, setup, tick } from "testing";

const seed = [
  { model: "Conversation", row: row("c1", { title: "Quotes", state: "open", teamId: "t1" }) },
];

test("save sends the changed fields with their values before the first edit; discardChanges reverts", async () => {
  const { store, transport } = await setup(seed);
  const c = store.findById(Conversation, "c1")!;
  c.title = "A";
  c.title = "B";
  expect(c.changedFields).toEqual(["title"]);
  c.discardChanges();
  expect(c.title).toBe("Quotes");
  expect(c.changedFields).toEqual([]);
  expect(c.save().status).toBe("done");

  c.title = "B";
  c.save();
  expect(c.changedFields).toEqual([]);
  await tick();
  expect(transport.requests[0].request.transactions).toMatchObject([
    {
      kind: "update",
      model: "Conversation",
      modelId: "c1",
      changes: { title: "B" },
      original: { title: "Quotes" },
    },
  ]);
});

test("create, archive and delete change the pool at once", async () => {
  const { store, transport } = await setup(seed);
  const c = store.create(Conversation, { title: "New", state: "open", teamId: "t1" });
  expect(store.findById(Conversation, c.id)).toBe(c);
  expect(c.isPersisted).toBe(false);
  expect(store.where(Conversation, "teamId", "t1")).toHaveLength(2);

  c.archive();
  expect(store.all(Conversation).map((m) => m.id)).toEqual(["c1"]);
  expect(store.all(Conversation, { includeArchived: true })).toHaveLength(2);

  store.findById(Conversation, "c1")!.delete();
  expect(store.findById(Conversation, "c1")).toBeUndefined();
  await tick();
  expect(transport.requests[0].request.transactions.map((tx) => tx.kind)).toEqual(["create"]);
  expect(transport.requests[0].request.transactions[0].changes).toMatchObject({
    id: c.id,
    title: "New",
    dueAt: null,
    ownerId: null,
    archivedAt: null,
  });
});
