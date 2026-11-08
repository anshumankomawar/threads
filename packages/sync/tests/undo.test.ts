import { expect, test } from "vite-plus/test";
import { Conversation } from "./models";
import { row, setup, tick } from "testing";

const seed = [
  { model: "Conversation", row: row("c1", { title: "One", state: "open", teamId: "t1" }) },
  { model: "Conversation", row: row("c2", { title: "Two", state: "open", teamId: "t1" }) },
];

test("an edit undoes to what it was and redoes to what it became, each as a transaction", async () => {
  const { store, localDB } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  store.undo.group("Rename", () => {
    c1.title = "A";
    c1.save();
  });
  expect(store.undo.nextUndo()).toBe("Rename");

  expect(store.undo.undo()).toBe("Rename");
  expect(c1.title).toBe("One");
  expect(store.undo.nextUndo()).toBe(null);
  expect(store.undo.nextRedo()).toBe("Rename");

  expect(store.undo.redo()).toBe("Rename");
  expect(c1.title).toBe("A");
  await tick();
  // Queued to sync in order (one at a time, as they're for the same conversation).
  const outbox = await localDB.outbox.all();
  expect(outbox.map((tx) => [tx.kind, tx.changes?.title])).toEqual([
    ["update", "A"],
    ["update", "One"],
    ["update", "A"],
  ]);
});

test("everything saved inside one group is one step, undone last first", async () => {
  const { store } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  const c2 = store.findById(Conversation, "c2")!;
  store.undo.group("Resolve both", () => {
    c1.state = "resolved";
    c1.save();
    c2.state = "resolved";
    c2.save();
    c1.title = "Done";
    c1.save();
  });
  store.undo.undo();
  expect([c1.state, c1.title, c2.state]).toEqual(["open", "One", "open"]);
  expect(store.undo.nextUndo()).toBe(null);
});

test("undoing a creation deletes it; redoing makes it again with the same id", async () => {
  const { store } = await setup(seed);
  let id = "";
  store.undo.group("New", () => {
    id = store.create(Conversation, { title: "New", state: "open", teamId: "t1" }).id;
  });
  store.undo.undo();
  expect(store.findById(Conversation, id)).toBeUndefined();
  store.undo.redo();
  expect(store.findById(Conversation, id)?.title).toBe("New");
});

test("undoing a deletion makes it again as it was", async () => {
  const { store } = await setup(seed);
  store.undo.group("Delete", () => void store.findById(Conversation, "c2")!.delete());
  expect(store.findById(Conversation, "c2")).toBeUndefined();
  store.undo.undo();
  expect(store.findById(Conversation, "c2")?.title).toBe("Two");
});

test("undoing an archive unarchives it", async () => {
  const { store } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  store.undo.group("Archive", () => void c1.archive());
  expect(c1.archivedAt).toBeTruthy();
  store.undo.undo();
  expect(c1.archivedAt).toBeFalsy();
  store.undo.redo();
  expect(c1.archivedAt).toBeTruthy();
});

test("a field changed since isn't undone; the step's other fields are", async () => {
  const { store } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  store.undo.group("Edit", () => {
    c1.title = "A";
    c1.state = "resolved";
    c1.save();
  });
  c1.title = "Someone else's"; // not in a group: no undo step of its own
  c1.save();
  store.undo.undo();
  expect([c1.title, c1.state]).toEqual(["Someone else's", "open"]);
});

test("a step that no longer holds is skipped for the one before it", async () => {
  const { store } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  const c2 = store.findById(Conversation, "c2")!;
  store.undo.group("First", () => {
    c2.title = "B";
    c2.save();
  });
  store.undo.group("Second", () => {
    c1.title = "A";
    c1.save();
  });
  c1.title = "Changed";
  c1.save();
  expect(store.undo.undo()).toBe("First");
  expect([c1.title, c2.title]).toEqual(["Changed", "Two"]);
});

test("undo and redo record nothing; a new step clears what could be redone", async () => {
  const { store } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  const rename = (title: string) =>
    store.undo.group(title, () => {
      c1.title = title;
      c1.save();
    });
  rename("A");
  rename("B");
  store.undo.undo();
  expect(store.undo.nextUndo()).toBe("A");
  expect(store.undo.nextRedo()).toBe("B");
  rename("C");
  expect(store.undo.nextRedo()).toBe(null);
  expect(store.undo.undo()).toBe("C");
  expect(store.undo.undo()).toBe("A");
  expect(c1.title).toBe("One");
  expect(store.undo.undo()).toBe(null);
});

test("a nested group is part of the one around it", async () => {
  const { store } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  store.undo.group("Outer", () => {
    c1.title = "A";
    c1.save();
    store.undo.group("Inner", () => {
      c1.state = "resolved";
      c1.save();
    });
  });
  expect(store.undo.nextUndo()).toBe("Outer");
  store.undo.undo();
  expect([c1.title, c1.state]).toEqual(["One", "open"]);
});

test("a rejected edit, already rolled back, has nothing left to undo", async () => {
  const { store, transport } = await setup(seed);
  const c1 = store.findById(Conversation, "c1")!;
  store.undo.group("Rename", () => {
    c1.title = "A";
    c1.save();
  });
  await tick();
  const [request] = transport.requests;
  request.resolve({
    results: request.request.transactions.map((tx) => ({
      txId: tx.id,
      ok: false as const,
      code: "forbidden" as const,
      message: "no",
    })),
  });
  await tick();
  expect(c1.title).toBe("One");
  expect(store.undo.undo()).toBe(null);
});
