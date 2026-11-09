import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vite-plus/test";
import { companyDomain, Directory, suggestedName, type Sql } from "../src/directory.ts";

// The directory over SQLite in memory, as D1 is.
function sqlite(): Sql {
  const db = new DatabaseSync(":memory:");
  return {
    run: async (query, ...binds) => void db.prepare(query).run(...(binds as never[])),
    all: async <T>(query: string, ...binds: unknown[]) =>
      db.prepare(query).all(...(binds as never[])) as T[],
  };
}

test("a company's domain names its workspace; a personal address has none", () => {
  expect(companyDomain(" Ada@Acme.com ")).toBe("acme.com");
  expect(companyDomain("ada@gmail.com")).toBeNull();
  expect(suggestedName("ada@acme-labs.io")).toBe("Acme Labs");
  expect(suggestedName("ada@gmail.com")).toBe("");
});

test("the invite list's people are members of the first workspace", async () => {
  const directory = new Directory(sqlite(), "Anshu@Example.com=anshu, arjun@example.com=arjun");
  const { workspaces } = await directory.choices("anshu@example.com");
  expect(workspaces.map((w) => [w.id, w.personId, w.role, w.members])).toEqual([
    ["local", "anshu", "admin", 2],
  ]);
});

test("a workspace open to its domain is offered to anyone there, and joined as a new person", async () => {
  const directory = new Directory(sqlite());
  const made = await directory.create("ada@acme.com", "Acme", true);
  expect(made).toMatchObject({ name: "Acme", role: "admin", members: 1 });

  const grace = await directory.choices("grace@acme.com");
  expect(grace.domain).toBe("acme.com");
  expect(grace.sameDomain.map((w) => w.name)).toEqual(["Acme"]);
  expect((await directory.choices("eve@evil.com")).sameDomain).toEqual([]);
  expect(await directory.join(made.id, "eve@evil.com")).toBeUndefined();

  const joined = await directory.join(made.id, "grace@acme.com");
  expect(joined).toMatchObject({ role: "member", members: 2 });
  expect(joined!.personId).not.toBe(made.personId);
  // Joining again is the same membership.
  expect((await directory.join(made.id, "grace@acme.com"))!.personId).toBe(joined!.personId);
});

test("a closed workspace takes only who it invites, and an invite goes once they join", async () => {
  const directory = new Directory(sqlite());
  const made = await directory.create("ada@acme.com", "Acme", false);
  expect((await directory.choices("grace@acme.com")).sameDomain).toEqual([]);

  await directory.invite(made.id, "Ada", ["Grace@gmail.com", "grace@gmail.com", "ada@acme.com"]);
  expect(await directory.invited(made.id)).toEqual(["grace@gmail.com"]);
  const grace = await directory.choices("grace@gmail.com");
  expect(grace.invited.map((w) => [w.name, w.invitedBy])).toEqual([["Acme", "Ada"]]);

  await directory.join(made.id, "grace@gmail.com");
  expect(await directory.invited(made.id)).toEqual([]);
  expect((await directory.choices("grace@gmail.com")).invited).toEqual([]);
});
