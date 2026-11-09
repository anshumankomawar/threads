// Who's in which workspace, kept in D1 beside Better Auth's tables: each workspace's name and the domain anyone at
// may join it from, its members (an email and the Person they are in it) and who's invited. Signing in finds your
// workspaces here; each workspace's own data (its Persons among it) is in its Durable Object, which `admit` fills
// from this.
//
// A company's domain is the Google Workspace one Google vouches for (its `hd` claim, on a verified address; auth.ts),
// never just what's after the @: anyone can have a Google account on any address, a personal one on a work address
// included, and only a domain's own Workspace can say who's still in it.

// The queries the directory runs, over D1 in the Worker and over SQLite in tests.
export interface Sql {
  run(query: string, ...binds: unknown[]): Promise<void>;
  all<T>(query: string, ...binds: unknown[]): Promise<T[]>;
  // Several writes, all or none.
  batch(statements: [string, ...unknown[]][]): Promise<void>;
}

export const d1 = (db: D1Database): Sql => ({
  run: async (query, ...binds) =>
    void (await db
      .prepare(query)
      .bind(...binds)
      .run()),
  all: async <T>(query: string, ...binds: unknown[]) =>
    (
      await db
        .prepare(query)
        .bind(...binds)
        .all<T>()
    ).results,
  batch: async (statements) =>
    void (await db.batch(statements.map(([query, ...binds]) => db.prepare(query).bind(...binds)))),
});

// Who's asking: their address, and the Workspace domain Google vouches for, if any.
export type Who = { email: string; domain: string | null };

export type Role = "admin" | "member";
export type Summary = { id: string; name: string; members: number };
export type Membership = Summary & { personId: string; role: Role };
// Where someone can go once signed in: their workspaces, the ones they're invited to, and the ones anyone at their
// company's domain may join.
export type Choices = {
  workspaces: Membership[];
  invited: (Summary & { invitedBy: string })[];
  domain: string | null;
  sameDomain: Summary[];
};

const TABLES = [
  `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT,
     createdAt INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS members (workspaceId TEXT NOT NULL, email TEXT NOT NULL, personId TEXT NOT NULL,
     role TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY (workspaceId, email))`,
  `CREATE TABLE IF NOT EXISTS invites (workspaceId TEXT NOT NULL, email TEXT NOT NULL, invitedBy TEXT NOT NULL,
     createdAt INTEGER NOT NULL, PRIMARY KEY (workspaceId, email))`,
  "CREATE INDEX IF NOT EXISTS members_email ON members (email)",
  "CREATE INDEX IF NOT EXISTS invites_email ON invites (email)",
  "CREATE INDEX IF NOT EXISTS workspaces_domain ON workspaces (domain)",
];

export const normal = (email: string): string => email.trim().toLowerCase();

// A name for a new workspace from its maker's Workspace domain: acme.com → Acme, acme-labs.io → Acme Labs.
export function suggestedName(domain: string | null): string {
  if (domain === null) return "";
  return domain
    .split(".")[0]
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export class Directory {
  readonly #sql: Sql;
  #ready: Promise<void> | undefined;
  readonly #known = new Set<string>();

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  // The tables, made the first time.
  ready(): Promise<void> {
    this.#ready ??= (async () => {
      for (const table of TABLES) await this.#sql.run(table);
    })().catch((error: unknown) => {
      this.#ready = undefined;
      throw error;
    });
    return this.#ready;
  }

  async choices({ email, domain }: Who): Promise<Choices> {
    await this.ready();
    const address = normal(email);
    const count = "(SELECT COUNT(*) FROM members m WHERE m.workspaceId = w.id) AS members";
    const workspaces = await this.#sql.all<Membership>(
      `SELECT w.id, w.name, ${count}, me.personId, me.role FROM members me JOIN workspaces w ON w.id = me.workspaceId
       WHERE me.email = ? ORDER BY me.createdAt`,
      address,
    );
    const invited = await this.#sql.all<Summary & { invitedBy: string }>(
      `SELECT w.id, w.name, ${count}, i.invitedBy FROM invites i JOIN workspaces w ON w.id = i.workspaceId
       WHERE i.email = ? AND w.id NOT IN (SELECT workspaceId FROM members WHERE email = ?) ORDER BY i.createdAt`,
      address,
      address,
    );
    const sameDomain =
      domain === null
        ? []
        : await this.#sql.all<Summary>(
            `SELECT w.id, w.name, ${count} FROM workspaces w WHERE w.domain = ?
             AND w.id NOT IN (SELECT workspaceId FROM members WHERE email = ?)
             AND w.id NOT IN (SELECT workspaceId FROM invites WHERE email = ?) ORDER BY w.createdAt`,
            domain,
            address,
            address,
          );
    return { workspaces, invited, domain, sameDomain };
  }

  // Whether a workspace is in the directory. Every sync request asks, so what's found is remembered (none is removed).
  async exists(id: string): Promise<boolean> {
    if (this.#known.has(id)) return true;
    await this.ready();
    const found = (await this.#sql.all("SELECT 1 FROM workspaces WHERE id = ?", id)).length > 0;
    if (found) this.#known.add(id);
    return found;
  }

  async membership(workspaceId: string, who: Who): Promise<Membership | undefined> {
    return (await this.choices(who)).workspaces.find((w) => w.id === workspaceId);
  }

  // A new workspace, with its maker as its admin, both at once. With `openToDomain`, anyone in the maker's Workspace
  // domain may join it.
  async create(who: Who, name: string, openToDomain: boolean): Promise<Membership> {
    await this.ready();
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.#sql.batch([
      [
        "INSERT INTO workspaces (id, name, domain, createdAt) VALUES (?, ?, ?, ?)",
        id,
        name,
        openToDomain ? who.domain : null,
        now,
      ],
      [
        "INSERT INTO members (workspaceId, email, personId, role, createdAt) VALUES (?, ?, ?, 'admin', ?)",
        id,
        normal(who.email),
        crypto.randomUUID(),
        now,
      ],
    ]);
    return (await this.membership(id, who))!;
  }

  // Joins a workspace you're invited to, or one open to your Workspace domain; undefined when you may not. Joining
  // twice (a double click) is the one membership.
  async join(workspaceId: string, who: Who): Promise<Membership | undefined> {
    const choices = await this.choices(who);
    const joined = choices.workspaces.find((w) => w.id === workspaceId);
    if (joined) return joined;
    if (![...choices.invited, ...choices.sameDomain].some((w) => w.id === workspaceId)) return;
    await this.#sql.run(
      `INSERT OR IGNORE INTO members (workspaceId, email, personId, role, createdAt) VALUES (?, ?, ?, 'member', ?)`,
      workspaceId,
      normal(who.email),
      crypto.randomUUID(),
      Date.now(),
    );
    return this.membership(workspaceId, who);
  }

  // Invites addresses to a workspace (`by` is a member's name, shown to them). Members aren't invited again.
  async invite(workspaceId: string, by: string, emails: string[]): Promise<void> {
    await this.ready();
    for (const email of new Set(emails.map(normal)))
      await this.#sql.run(
        `INSERT OR IGNORE INTO invites (workspaceId, email, invitedBy, createdAt)
         SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM members WHERE workspaceId = ? AND email = ?)`,
        workspaceId,
        email,
        by,
        Date.now(),
        workspaceId,
        email,
      );
  }

  // Who's invited to a workspace and hasn't joined yet.
  async invited(workspaceId: string): Promise<string[]> {
    await this.ready();
    const rows = await this.#sql.all<{ email: string }>(
      `SELECT email FROM invites WHERE workspaceId = ?
       AND email NOT IN (SELECT email FROM members WHERE workspaceId = ?) ORDER BY createdAt`,
      workspaceId,
      workspaceId,
    );
    return rows.map((row) => row.email);
  }
}
