import type {
  ActionResponse,
  BootstrapEnd,
  BootstrapLine,
  DeltasResponse,
  ModelMeta,
  MutateRequest,
  MutateResponse,
  Row,
  ServerMessage,
  SyncAction,
  TxKind,
  TxRecord,
} from "protocol";
import { ALL, registry, sees } from "sync";
import type { Logged, Storage } from "./storage";

// Who's asking. A user sees their sync groups (and any they subscribed to that they may read) and writes as themselves;
// the admin sees everything and acts as anyone.
export type Session = { userId: string; subscribed?: string[] } | { admin: true };

export type Write = Pick<TxRecord, "kind" | "model" | "modelId" | "changes">;
// A write as permission hooks and effects see it: the row before and after (undefined for a create / a delete), and
// the person who made it (none for the admin, or for an effect's own writes).
export type Change = Write & { before?: Row; after?: Row; userId?: string };

export interface Reader {
  get(model: string, id: string): Row | undefined;
  all(model: string): Row[];
}
// Writes go through the same path as a client's: validated, applied, logged, with their effects.
export interface Writer extends Reader {
  write(write: Write): void;
}

// A connected client. It receives commits once it said hello; the Durable Object keeps `greeted` in the socket's
// attachment so it survives hibernation, and `send` must not throw.
export interface Socket {
  readonly session: Session;
  greeted?: boolean;
  send(message: ServerMessage): void;
}

export type ServerOptions = {
  storage: Storage;
  sockets: () => Iterable<Socket>;
  // The groups a user is in: what they load at bootstrap and follow.
  groupsOf: (userId: string, db: Reader) => string[];
  // A group a user may subscribe to without being in it.
  mayRead?: (userId: string, group: string, db: Reader) => boolean;
  // Per model: may this user make this change? Not run for the admin or for effects.
  rules?: Record<string, (change: Change, userId: string, db: Reader) => boolean>;
  // Per model: further writes in the same commit, each its own sync action under the same tx id.
  effects?: Record<string, (change: Change, db: Writer) => void>;
  actions?: Record<string, (args: unknown, session: Session, db: Writer) => void>;
  now?: () => number;
};

type Code = "forbidden" | "invalid" | "conflict" | "not_found";

export class Refusal extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message);
  }
}

const LETTER = {
  create: "I",
  update: "U",
  archive: "A",
  unarchive: "R",
  delete: "D",
} as const satisfies Record<TxKind, SyncAction["action"]>;

// One workspace's server: every row and the whole log in memory, written through to `storage`.
export class SyncServer {
  readonly #options: ServerOptions;
  readonly #models: Map<string, ModelMeta>;
  readonly #rows = new Map<string, Map<string, Row>>();
  readonly #log: Logged[];
  readonly #txs = new Map<string, number>(); // tx id -> its highest sync id
  readonly #reader: Reader = {
    get: (model, id) => this.#table(model).get(id),
    all: (model) => [...this.#table(model).values()],
  };
  #pending: { logged: Logged; before?: Row }[] = [];
  #at = 0;

  constructor(options: ServerOptions) {
    this.#options = options;
    this.#models = new Map(registry.all().map((meta) => [meta.name, meta]));
    for (const name of this.#models.keys()) this.#rows.set(name, new Map());
    const { rows, actions } = options.storage.load([...this.#models.keys()]);
    for (const { model, row } of rows) this.#table(model).set(row.id, row);
    this.#log = actions;
    for (const { action } of actions) this.#txs.set(action.txId, action.id);
  }

  get #lastSyncId(): number {
    return this.#log.at(-1)?.action.id ?? 0;
  }

  // Every row the session sees; or, for a client that `holds` some groups already, the rows of the others and every
  // action after `after` it sees.
  bootstrap(
    session: Session,
    partial?: { holds: string[]; after: number },
  ): { rows: BootstrapLine[]; end: BootstrapEnd } {
    const groups = this.#groupsOf(session);
    const only = partial ? groups.filter((group) => !partial.holds.includes(group)) : groups;
    const rows = [...this.#models.values()].flatMap((meta) =>
      [...this.#table(meta.name).values()]
        .filter((row) => sees(only, this.#syncGroups(meta.name, row)))
        .map((row) => ({ model: meta.name, row })),
    );
    const actions = partial ? this.#visible(this.#log, groups, partial.after) : [];
    return {
      rows,
      end: { lastSyncId: this.#lastSyncId, schemaHash: registry.schemaHash, groups, actions },
    };
  }

  deltas(session: Session, after: number): DeltasResponse {
    const groups = this.#groupsOf(session);
    return {
      actions: this.#visible(this.#log, groups, after),
      lastSyncId: this.#lastSyncId,
      groups,
    };
  }

  // Sends the socket what it missed after `lastSyncId`, then every commit.
  hello(socket: Socket, lastSyncId: number): void {
    socket.greeted = true;
    socket.send({ type: "delta", ...this.deltas(socket.session, lastSyncId) });
  }

  mutate(session: Session, { transactions }: MutateRequest): MutateResponse {
    const userId = "userId" in session ? session.userId : undefined;
    return this.#run(() => ({
      results: transactions.map((tx) => {
        const done = this.#txs.get(tx.id);
        if (done !== undefined) return { txId: tx.id, ok: true, syncId: done };
        const mark = this.#pending.length;
        try {
          this.#apply(tx, tx.id, userId);
        } catch (error) {
          this.#undo(mark);
          if (!(error instanceof Refusal)) throw error;
          return { txId: tx.id, ok: false, code: error.code, message: error.message };
        }
        return { txId: tx.id, ok: true, syncId: this.#lastSyncId + this.#pending.length };
      }),
    }));
  }

  action(session: Session, name: string, args: unknown): ActionResponse {
    const run = this.#options.actions?.[name];
    if (run === undefined) throw new Refusal("not_found", `No action ${name}`);
    const userId = "userId" in session ? session.userId : undefined;
    return this.#run(() => {
      run(args, session, this.#writer(crypto.randomUUID(), userId));
      return { lastSyncId: this.#lastSyncId + this.#pending.length };
    });
  }

  // Runs one request's writes and commits them once, all or nothing.
  #run<T>(fn: () => T): T {
    this.#at = (this.#options.now ?? Date.now)();
    let result: T;
    let logged: Logged[];
    try {
      result = fn();
      logged = this.#pending.map((entry) => entry.logged);
      if (logged.length > 0) this.#options.storage.commit(logged, this.#at);
    } catch (error) {
      this.#undo(0);
      throw error;
    }
    this.#pending = [];
    if (logged.length > 0) this.#broadcast(logged);
    return result;
  }

  #broadcast(logged: Logged[]): void {
    this.#log.push(...logged);
    for (const { action } of logged) this.#txs.set(action.txId, action.id);
    for (const socket of this.#options.sockets()) {
      if (!socket.greeted) continue;
      const groups = this.#groupsOf(socket.session);
      socket.send({
        type: "delta",
        actions: this.#visible(logged, groups, 0),
        groups,
        lastSyncId: this.#lastSyncId,
      });
    }
  }

  // Validates, checks permission (when `userId` is given), applies and logs one write, then runs its effects.
  #apply(write: Write, txId: string, userId?: string): void {
    const meta = this.#models.get(write.model);
    if (meta === undefined) throw new Refusal("invalid", `Unknown model ${write.model}`);
    const before = this.#table(write.model).get(write.modelId);
    if (write.kind === "create" && before !== undefined)
      throw new Refusal("conflict", `${write.model} ${write.modelId} already exists`);
    if (write.kind !== "create" && before === undefined)
      throw new Refusal("not_found", `No ${write.model} ${write.modelId}`);
    const at = this.#at;
    let after: Row | undefined;
    if (write.kind !== "delete") {
      this.#check(meta, write.changes ?? {}, write.kind === "create");
      after = {
        ...before,
        ...write.changes,
        id: write.modelId,
        // The admin (seeding, imports) may say when a row was made; anyone else gets the server's time.
        createdAt:
          before?.createdAt ?? (userId === undefined ? write.changes?.createdAt : undefined) ?? at,
        updatedAt: at,
        archivedAt:
          write.kind === "archive"
            ? at
            : write.kind === "unarchive"
              ? null
              : (before?.archivedAt ?? null),
      };
    }
    const change: Change = { ...write, before, after, userId };
    const rule = this.#options.rules?.[write.model];
    if (userId !== undefined && rule !== undefined && !rule(change, userId, this.#reader))
      throw new Refusal(
        "forbidden",
        `Not allowed to ${write.kind} ${write.model} ${write.modelId}`,
      );

    this.#set(write.model, write.modelId, after);
    const action: SyncAction = {
      id: 0,
      txId,
      model: write.model,
      modelId: write.modelId,
      action: LETTER[write.kind],
    };
    if (after !== undefined) action.data = after;
    // Its old groups too: a row moved out of a group reaches that group's sessions as a delete.
    const groups = [before, after].flatMap((row) =>
      row ? this.#syncGroups(write.model, row) : [],
    );
    // (tx_id, model_id) is unique: a second write to the same row in one transaction replaces the first's action.
    const earlier = this.#pending.find(
      (p) => p.logged.action.txId === txId && p.logged.action.modelId === write.modelId,
    );
    if (earlier === undefined) {
      action.id = this.#lastSyncId + this.#pending.length + 1;
      this.#pending.push({ logged: { action, groups }, before });
    } else {
      const kept = earlier.logged.action.action;
      earlier.logged = {
        action: {
          ...action,
          id: earlier.logged.action.id,
          action: kept === "I" && after ? "I" : action.action,
        },
        groups: [...earlier.logged.groups, ...groups],
      };
    }
    this.#options.effects?.[write.model]?.(change, this.#writer(txId));
  }

  // Known stored fields, enum values, nullability, required fields on create, references to existing rows.
  #check(meta: ModelMeta, changes: Record<string, unknown>, create: boolean): void {
    const invalid = (message: string) => new Refusal("invalid", `${meta.name}: ${message}`);
    for (const [key, value] of Object.entries(changes)) {
      if (BASE.has(key)) continue;
      const field = meta.fields[key];
      if (field?.kind !== "property") throw invalid(`${key} isn't a stored field`);
      if (value === null && !field.nullable) throw invalid(`${key} can't be null`);
      if (value !== null && field.enum !== undefined && !field.enum.includes(value as string))
        throw invalid(`${key} can't be ${JSON.stringify(value)}`);
    }
    for (const [key, field] of Object.entries(meta.fields)) {
      if (
        create &&
        field.kind === "property" &&
        !field.nullable &&
        !BASE.has(key) &&
        !(key in changes)
      )
        throw invalid(`${key} is required`);
      if (field.kind !== "reference") continue;
      const id = changes[field.foreignKey!];
      const target = field.target!().prototype.__meta.name;
      if (typeof id === "string" && !this.#table(target).has(id))
        throw invalid(`no ${target} ${id}`);
    }
  }

  #writer(txId: string, userId?: string): Writer {
    return { ...this.#reader, write: (write) => this.#apply(write, txId, userId) };
  }

  #undo(mark: number): void {
    for (const { logged, before } of this.#pending.splice(mark).reverse())
      this.#set(logged.action.model, logged.action.modelId, before);
  }

  #set(model: string, id: string, row: Row | undefined): void {
    if (row === undefined) this.#table(model).delete(id);
    else this.#table(model).set(id, row);
  }

  #table(model: string): Map<string, Row> {
    return this.#rows.get(model)!;
  }

  #syncGroups(model: string, row: Row): string[] {
    return this.#models.get(model)!.syncGroup?.(row) ?? [];
  }

  #groupsOf(session: Session): string[] {
    if ("admin" in session) return [ALL];
    const { userId, subscribed = [] } = session;
    const own = this.#options.groupsOf(userId, this.#reader);
    const mayRead = (group: string) => this.#options.mayRead?.(userId, group, this.#reader);
    return [...own, ...subscribed.filter((group) => !own.includes(group) && mayRead(group))];
  }

  #visible(logged: Logged[], groups: string[], after: number): SyncAction[] {
    return logged
      .filter((l) => l.action.id > after && sees(groups, l.groups))
      .map(({ action: { data, ...action } }) =>
        data === undefined || sees(groups, this.#syncGroups(action.model, data))
          ? { ...action, data }
          : { ...action, action: "D" },
      );
  }
}

const BASE = new Set(["id", "createdAt", "updatedAt", "archivedAt"]);
