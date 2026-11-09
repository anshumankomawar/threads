import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vite-plus/test";
import { Directory, suggestedName, type Sql, type Who } from "../src/directory.ts";

// The directory over SQLite in memory, as D1 is.
function sqlite(): Sql {
  const db = new DatabaseSync(":memory:");
  const run = async (query: string, ...binds: unknown[]) =>
    void db.prepare(query).run(...(binds as never[]));
  return {
    run,
    all: async <T>(query: string, ...binds: unknown[]) =>
      db.prepare(query).all(...(binds as never[])) as T[],
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        for (const [query, ...binds] of statements) await run(query, ...binds);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

// Someone at Acme's Google Workspace, or (with no domain) with a personal Google account on an Acme address.
const at = (name: string, domain: string | null = "acme.com"): Who => ({
  email: `${name}@acme.com`,
  domain,
});

test("a workspace's suggested name comes from its maker's Workspace domain", () => {
  expect(suggestedName("acme-labs.io")).toBe("Acme Labs");
  expect(suggestedName(null)).toBe("");
});

test("a workspace open to its domain is offered to that Workspace's people, and joined as a new person", async () => {
  const directory = new Directory(sqlite());
  const made = await directory.create(at("ada"), "Acme", true);
  expect(made).toMatchObject({ name: "Acme", role: "admin", members: 1 });

  const grace = await directory.choices(at("grace"));
  expect(grace.sameDomain.map((w) => w.name)).toEqual(["Acme"]);
  const joined = await directory.join(made.id, at("grace"));
  expect(joined).toMatchObject({ role: "member", members: 2 });
  expect(joined!.personId).not.toBe(made.personId);
  // Joining again (a double click) is the same membership.
  expect((await directory.join(made.id, at("grace")))!.personId).toBe(joined!.personId);
});

test("an Acme address without Acme's Workspace behind it isn't offered or let in by domain", async () => {
  const directory = new Directory(sqlite());
  const made = await directory.create(at("ada"), "Acme", true);
  // A personal Google account on an Acme address (an ex-employee's, say): Google vouches for no domain.
  const eve = at("eve", null);
  expect((await directory.choices(eve)).sameDomain).toEqual([]);
  expect(await directory.join(made.id, eve)).toBeUndefined();
});

test("a closed workspace takes only who it invites, and an invite goes once they join", async () => {
  const directory = new Directory(sqlite());
  const made = await directory.create(at("ada"), "Acme", false);
  expect((await directory.choices(at("grace"))).sameDomain).toEqual([]);

  await directory.invite(made.id, "Ada", ["Grace@gmail.com", "grace@gmail.com", "ada@acme.com"]);
  expect(await directory.invited(made.id)).toEqual(["grace@gmail.com"]);
  const grace: Who = { email: "grace@gmail.com", domain: null };
  expect((await directory.choices(grace)).invited.map((w) => [w.name, w.invitedBy])).toEqual([
    ["Acme", "Ada"],
  ]);

  await directory.join(made.id, grace);
  expect(await directory.invited(made.id)).toEqual([]);
  expect((await directory.choices(grace)).invited).toEqual([]);
});

test("a workspace and its maker are made together or not at all", async () => {
  const sql = sqlite();
  const directory = new Directory(sql);
  await directory.ready();
  // The member's row can't be written (its table is gone): the workspace mustn't be left behind without it.
  await sql.run("DROP TABLE members");
  await expect(directory.create(at("ada"), "Acme", true)).rejects.toThrow();
  expect(await sql.all("SELECT * FROM workspaces")).toEqual([]);
});
