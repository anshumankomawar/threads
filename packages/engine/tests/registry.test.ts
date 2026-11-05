import { expect, test } from "vite-plus/test";
import { ClientModel, memoryLocalDB, Model, Property, registry } from "../src";
import { Conversation, Message, User } from "./models";
import { row, setup } from "./fake";

async function seeded() {
  const { store } = await setup([
    { model: "User", row: row("u1", { name: "Marcus" }) },
    {
      model: "Conversation",
      row: row("c1", { title: "Quotes", state: "open", dueAt: 5, teamId: "t1", ownerId: "u1" }),
    },
    { model: "Message", row: row("m1", { conversationId: "c1", body: "b" }) },
    { model: "Message", row: row("m2", { conversationId: "c1", body: "a" }) },
  ]);
  return { store, c: store.findById(Conversation, "c1")! };
}

test("properties read and write the stored row; ephemerals stay out of it", async () => {
  const { c } = await seeded();
  expect(c.title).toBe("Quotes");
  expect(c.dueAt).toEqual(new Date(5));
  expect(c.createdAt).toEqual(new Date(1));
  c.dueAt = new Date(9);
  c.typing = true;
  expect(c.__data.dueAt).toBe(9);
  expect(c.typing).toBe(true);
  expect("typing" in c.__data).toBe(false);
  expect(registry.get("Conversation").fields.typing).toEqual({ kind: "ephemeral" });
});

test("a reference resolves through the pool and sets its id field", async () => {
  const { store, c } = await seeded();
  expect(c.owner).toBe(store.findById(User, "u1"));
  c.owner = undefined;
  expect(c.ownerId).toBeUndefined();
  expect(c.__data.ownerId).toBeNull();
  expect(registry.get("Conversation").fields.ownerId).toEqual({
    kind: "property",
    indexed: true,
    nullable: true,
  });
  expect(registry.get("Conversation").fields.owner).toMatchObject({
    kind: "reference",
    foreignKey: "ownerId",
  });
});

test("a OneToMany is the live set of models pointing here", async () => {
  const { store, c } = await seeded();
  expect(c.messages.sorted("body").map((m) => m.id)).toEqual(["m2", "m1"]);
  const m1 = store.findById(Message, "m1")!;
  m1.conversation = store.create(Conversation, { title: "Other", state: "open", teamId: "t1" });
  expect([...c.messages].map((m) => m.id)).toEqual(["m2"]);
  expect(c.messages.length).toBe(1);
  expect(store.where(Message, "conversationId", "c1")).toEqual([...c.messages]);
});

test("a Computed derives from fields", async () => {
  const { c } = await seeded();
  expect(c.isOpen).toBe(true);
  c.state = "resolved";
  expect(c.isOpen).toBe(false);
});

test("the schema hash follows the metadata, and a new hash makes the local database fresh", async () => {
  const before = registry.schemaHash;
  expect(registry.schemaHash).toBe(before);
  const db = memoryLocalDB();
  expect(await db.open("w", before)).toBe("fresh");
  await db.meta.set({ lastSyncId: 1 });
  expect(await db.open("w", before)).toBe("existing");

  @ClientModel("Extra")
  class Extra extends Model {
    @Property() note!: string;
  }
  void Extra;
  expect(registry.schemaHash).not.toBe(before);
  expect(await db.open("w", registry.schemaHash)).toBe("fresh");
});
