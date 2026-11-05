// The spec's deterministic simulation: the real engine and server over a fake network and clock, driven by
// fast-check. A failure prints the seed and the shrunk step log. `SIM_RUNS=5000 vp test` for a long run.
import fc from "fast-check";
import type { Row } from "protocol";
import { memoryStorage, SyncServer, type Change, type Reader } from "server";
import { ClientModel, Model, Property, Reference, registry, type Transaction } from "sync";
import { expect, test, vi } from "vite-plus/test";
import { drain, World, type Client } from "../src";

declare module "sync" {
  interface ServerActions {
    toggle: { teamId: string }; // join or leave a team
  }
}

@ClientModel("Team", { syncGroup: () => ["workspace:w"] })
class Team extends Model {
  @Property() name!: string;
  @Property() memberIds!: string[];
}

@ClientModel("Note", { syncGroup: (row) => [`team:${row.teamId as string}`] })
class Note extends Model {
  @Property() title!: string;
  @Property() authorId!: string;
  @Reference(() => Team) team!: Team;
  declare teamId: string;
}

@ClientModel("Memo", { syncGroup: (row) => [`user:${row.userId as string}`] })
class Memo extends Model {
  @Property() userId!: string;
  @Property() text!: string;
}

const MODELS = [Team, Note, Memo];
const USERS = ["u0", "u1", "u0", "u2", "u1"]; // client i is USERS[i]: with 3+ clients, two tabs of u0
const TEAMS = ["t0", "t1", "t2"];
const WORDS = ["a", "b", "c", "x"]; // the permission hook refuses "x"
const ADMIN = { admin: true } as const;

const groupsOf = (userId: string, teams: Row[]) => [
  "workspace:w",
  `user:${userId}`,
  ...teams.filter((t) => (t.memberIds as string[]).includes(userId)).map((t) => `team:${t.id}`),
];
const inTeam = (db: Reader, row: Row | undefined, me: string) =>
  !row || (db.get("Team", row.teamId as string)!.memberIds as string[]).includes(me);
const onlyMe = (a: string[], b: string[], me: string) =>
  [...a.filter((id) => !b.includes(id)), ...b.filter((id) => !a.includes(id))].every(
    (id) => id === me,
  );
const clean = (change: Change) => !Object.values(change.changes ?? {}).includes("x");

function createServer(world: World): SyncServer {
  const server = new SyncServer({
    storage: memoryStorage(),
    sockets: () => world.sockets(),
    groupsOf: (userId, db) => groupsOf(userId, db.all("Team")),
    rules: {
      // Anyone may rename a team or join or leave it; nobody makes or deletes one.
      Team: (c, me) =>
        clean(c) &&
        c.kind !== "create" &&
        c.kind !== "delete" &&
        onlyMe(c.before!.memberIds as string[], c.after!.memberIds as string[], me),
      Note: (c, me, db) =>
        clean(c) &&
        inTeam(db, c.before, me) &&
        inTeam(db, c.after, me) &&
        (c.kind !== "create" || c.after!.authorId === me),
      Memo: (c, me) => clean(c) && [c.before, c.after].every((row) => !row || row.userId === me),
    },
    effects: {
      // A new note leaves its author a memo.
      Note: (c, db) =>
        c.kind === "create" &&
        db.write({
          kind: "create",
          model: "Memo",
          modelId: crypto.randomUUID(),
          changes: { userId: c.after!.authorId, text: "noted" },
        }),
    },
    actions: {
      toggle: (args, session, db) => {
        const { teamId } = args as { teamId: string };
        const me = (session as { userId: string }).userId;
        const ids = db.get("Team", teamId)!.memberIds as string[];
        const memberIds = ids.includes(me) ? ids.filter((id) => id !== me) : [...ids, me];
        db.write({ kind: "update", model: "Team", modelId: teamId, changes: { memberIds } });
      },
    },
    now: () => world.now,
  });
  const seed = (model: string, modelId: string, changes: Record<string, unknown>) =>
    ({ id: `seed-${modelId}`, kind: "create", model, modelId, changes, batch: 0 }) as const;
  const members = [["u0", "u1"], ["u1", "u2"], ["u2"]];
  server.mutate(ADMIN, {
    transactions: [
      ...TEAMS.map((id, i) => seed("Team", id, { name: id, memberIds: members[i] })),
      ...TEAMS.map((id) => seed("Note", `n${id}`, { title: "a", authorId: "u1", teamId: id })),
      ...["u0", "u1", "u2"].map((id) => seed("Memo", `m${id}`, { userId: id, text: "a" })),
    ],
  });
  return server;
}

// [what, a, b, c]: which client / flight is `a`, which row `b`, which value `c`.
const WEIGHTS = {
  edit: 4,
  create: 2,
  archive: 1,
  delete: 1,
  action: 1,
  deliver: 14,
  delay: 1,
  duplicate: 1,
  drop: 1,
  disconnect: 1,
  reconnect: 1,
  reload: 1,
  tick: 2,
};
type Step = [keyof typeof WEIGHTS, number, number, number];
const LOCAL = new Set(["edit", "create", "archive", "delete"]); // several in a row share a tick, so a batch
const step: fc.Arbitrary<Step> = fc.tuple(
  fc.oneof(
    ...Object.entries(WEIGHTS).map(([what, weight]) => ({
      weight,
      arbitrary: fc.constant(what as Step[0]),
    })),
  ),
  fc.nat(99),
  fc.nat(99),
  fc.nat(6),
);

const rows = (client: Client) =>
  MODELS.flatMap((type) => client.store.all<Model>(type, { includeArchived: true }));

async function run(world: World, [what, a, b, c]: Step): Promise<void> {
  const client = world.clients[a % world.clients.length];
  const { store, user } = client;
  const model = rows(client)[b % Math.max(1, rows(client).length)];
  const word = WORDS[c % WORDS.length];
  const team = TEAMS[c % TEAMS.length];
  const track = (promise: Promise<void>) => world.track(client, promise);
  const transact = (tx: Transaction, modelId: string) => {
    if (tx.status !== "done") world.transactions.push({ tx, modelId });
    track(tx.result());
  };
  const flights = world.network.filter((f) => f.ready());
  const flight = flights[a % Math.max(1, flights.length)];
  switch (what) {
    case "edit":
      if (model instanceof Team) model.name = word;
      else if (model instanceof Note && c > 3) model.teamId = team;
      else if (model instanceof Note) model.title = word;
      else if (model instanceof Memo) model.text = word;
      if (model) transact(model.save(), model.id);
      break;
    case "create": {
      const owner = c === 6 ? USERS[(a + 1) % USERS.length] : user; // someone else's: refused
      const made = [
        () => store.create(Team, { name: word, memberIds: [user] }),
        () => store.create(Note, { title: word, authorId: owner, teamId: team }),
        () => store.create(Memo, { userId: owner, text: word }),
      ][b % 3]();
      transact(made.transaction, made.id);
      break;
    }
    case "archive":
      if (model) transact(model.archivedAt ? model.unarchive() : model.archive(), model.id);
      break;
    case "delete":
      if (model) transact(model.delete(), model.id);
      break;
    case "action":
      track(store.action("toggle", { teamId: team }));
      break;
    case "deliver":
    case "duplicate":
    case "drop":
      flight?.[what]();
      break;
    case "delay":
      if (flight) world.network.push(...world.network.splice(world.network.indexOf(flight), 1));
      break;
    case "disconnect":
      client.offline = true;
      client.conn?.drop();
      break;
    case "reconnect":
      client.offline = false;
      break;
    case "reload":
      await drain(); // the page finishes its tick first
      world.start(client);
      break;
    case "tick":
      world.tick();
  }
  if (!LOCAL.has(what)) await drain();
}

const byId = (a: { row: Row }, b: { row: Row }) => (a.row.id < b.row.id ? -1 : 1);

async function check(world: World): Promise<void> {
  const { server } = world;
  const log = server.deltas(ADMIN, 0).actions;
  const approved = new Set(log.map((action) => JSON.stringify(action.data)));
  const teams = server
    .bootstrap(ADMIN)
    .rows.filter((line) => line.model === "Team")
    .map((line) => line.row);
  for (const client of world.clients) {
    const session = { userId: client.user };
    const { db, store } = client;
    const expected = server.bootstrap(session).rows.sort(byId);
    const pool = rows(client).map((m) => ({ model: m.__meta.name, row: m.__data }));
    const local = (
      await Promise.all(
        MODELS.map(async ({ prototype: { __meta } }) =>
          (await db.load(__meta.name)).map((row) => ({ model: __meta.name, row })),
        ),
      )
    ).flat();
    // Convergence.
    const who = `client ${world.clients.indexOf(client)} (${client.user})`;
    expect(pool.sort(byId), who).toEqual(expected);
    expect(local.sort(byId), who).toEqual(expected);
    // Ordering: since its last full load, exactly the actions it may see, in order.
    const load = db.loads.at(-1)!;
    expect(load.ids).toEqual(server.deltas(session, load.base!).actions.map((x) => x.id));
    for (const { ids } of db.loads) expect(ids).toEqual([...new Set(ids)].sort((x, y) => x - y));
    // Local database purity.
    for (const { data } of db.written) if (data) expect(approved).toContain(JSON.stringify(data));
    // Permissions.
    const mine = groupsOf(client.user, teams);
    for (const { model, row } of [...pool, ...local])
      expect(registry.get(model).syncGroup!(row).some((g) => mine.includes(g))).toBe(true);
    // Completion.
    expect(client.promises.every((p) => p.settled)).toBe(true);
    expect(store.pendingCount()).toBe(0);
    expect(await db.outbox.all()).toEqual([]);
    expect(store.connection()).toBe("live");
  }
  // No lost writes: a done transaction is on the server once; a rejected one not at all.
  for (const { tx, modelId } of world.transactions) {
    const applied = log.filter((action) => action.txId === tx.id);
    if (tx.status === "done") expect(applied.filter((x) => x.modelId === modelId)).toHaveLength(1);
    if (tx.status === "rejected") expect(applied).toEqual([]);
  }
}

async function simulate(clients: number, steps: Step[]): Promise<void> {
  const world = new World();
  vi.spyOn(Date, "now").mockImplementation(() => world.now);
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `00000000-0000-4000-8000-${String(++world.ids).padStart(12, "0")}`,
  );
  try {
    world.server = createServer(world);
    for (const user of USERS.slice(0, clients)) world.addClient(user);
    await drain();
    for (const s of steps) await run(world, s);
    await world.quiesce();
    await check(world);
  } finally {
    vi.restoreAllMocks();
  }
}

test("clients converge under random faults", { timeout: 600_000 }, async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 5 }),
      fc.array(step, { maxLength: 150, size: "max" }),
      simulate,
    ),
    { numRuns: Number(process.env.SIM_RUNS ?? 500) },
  );
});

// Shrunk failures the simulation found, by the seed that found them; each step is "what a b c".
const REGRESSIONS: [string, number, string][] = [
  // Groups that changed between a client's bootstrap and its hello were never reloaded.
  ["2075244279", 2, "action 0 0 0"],
  // A first bootstrap that failed was never retried.
  ["-927178221", 2, "drop 0 0 0"],
  // Rolling back a delete of a refused creation brought the model back.
  ["-2079187972", 2, "create 3 0 0; delete 45 0 0"],
  // Rolling back a delete brought back a row the client had lost access to.
  ["-1551107030", 2, "deliver 0 0 0; action 0 0 0; deliver 0 0 0; delete 0 18 0"],
  // A delta with a transaction's own change, ahead of its answer, had the transaction rebased onto it again.
  ["1211903262", 2, "disconnect 0 0 0; create 0 55 0; archive 0 0 0"],
  // A note moved to another team stayed, stale, with the old team's members.
  ["2102101155", 4, "action 0 0 1; deliver 4 0 0; deliver 0 0 0; deliver 0 0 0; edit 0 46 6"],
  // A confirmed creation in a team the client had just left stayed in its pool.
  ["-835277521", 2, "deliver 0 0 0; create 0 4 0; action 0 0 0; deliver 95 0 0"],
  // A packet queued behind a failed re-bootstrap still applied, so the client passed its groups change.
  [
    "-981586404",
    3,
    "create 0 0 0; deliver 0 0 0; deliver 0 0 0; deliver 0 0 0; deliver 0 0 0; deliver 0 0 0; action 0 0 0; deliver 0 0 0; deliver 54 0 0; deliver 49 0 0; deliver 5 0 0; deliver 21 0 0; deliver 5 0 0; deliver 1 0 0; archive 94 0 0; deliver 46 0 0; deliver 44 0 0; drop 48 0 0",
  ],
  // A reload whose catch-up failed on its gap fetch never connected.
  [
    "431470674",
    4,
    "reload 6 0 0; drop 0 0 0; deliver 59 0 0; deliver 0 0 0; deliver 63 0 0; edit 6 89 5; deliver 0 0 0; drop 0 0 0; duplicate 26 0 0; create 5 10 0; reload 5 0 0; deliver 63 0 0; deliver 11 0 0; disconnect 29 0 0; deliver 2 0 0; deliver 4 0 0",
  ],
  // Two refused edits of one field, replayed after a reload: undoing the second restored the first's value.
  [
    "494997966",
    2,
    "action 0 0 5; action 0 0 0; deliver 0 0 0; create 0 46 5; edit 0 0 6; deliver 0 0 0; deliver 0 0 0; deliver 0 0 0; deliver 0 0 0; drop 15 0 0; deliver 0 0 0; deliver 0 0 0; deliver 0 0 0; deliver 0 0 0; create 0 22 0; delete 0 0 0; deliver 0 0 0; deliver 0 0 0; deliver 11 0 0; create 0 67 0; reload 3 0 0; deliver 16 0 0; create 0 64 0; edit 0 29 4",
  ],
  // A reconnect said hello while the old socket's full load was still running, so its position was stale.
  [
    "12517352",
    2,
    "deliver 0 0 0; delay 0 0 0; deliver 27 0 0; drop 14 0 0; delete 0 0 0; action 0 0 4; deliver 73 0 0; deliver 0 0 0; deliver 0 0 0; deliver 0 0 0; action 0 0 1; disconnect 0 0 0; tick 0 0 0; reconnect 0 0 0; deliver 21 0 0; tick 0 0 0; create 21 0 0; deliver 97 0 0; deliver 0 0 0; deliver 8 0 0; edit 0 0 0; deliver 0 0 0; deliver 12 0 0",
  ],
  // A gap fetch held back by a groups change dropped its packet, and an empty packet then skipped past it.
  [
    "1633704108",
    5,
    "action 1 0 0; delay 20 0 0; deliver 29 0 0; duplicate 0 0 0; deliver 83 0 0; create 68 43 1; create 69 0 0; deliver 65 0 0; deliver 73 0 0; archive 87 0 0; edit 33 0 0; deliver 60 0 0; deliver 60 0 0; deliver 22 0 0; action 0 0 5; deliver 35 0 0; deliver 51 0 0; reload 0 0 0; deliver 12 0 0; deliver 57 0 0; deliver 92 0 0; create 0 0 0; deliver 4 0 0; deliver 64 0 0; deliver 48 0 0; action 0 0 5; action 0 0 0; deliver 92 0 0; duplicate 77 0 0; drop 14 0 0",
  ],
];
test.each(REGRESSIONS)("regression %s", (_seed, clients, log) =>
  simulate(
    clients,
    log.split("; ").map((step) => {
      const [what, ...abc] = step.split(" ");
      return [what, ...abc.map(Number)] as Step;
    }),
  ),
);
