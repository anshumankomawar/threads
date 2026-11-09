import type { DeltasResponse, Row, SyncAction } from "protocol";
import type { Transport } from "./http";
import type { LocalDB, Meta } from "./local-db";
import { write, type Core } from "./model";
import { registry, sees } from "./registry";
import { cell } from "./signals";
import { backoff, type Timer, type TransactionQueue } from "./transactions";

type Change = { model: string; modelId: string; data?: Row };

// How long the socket gets to bring back a change the server confirmed.
const SOCKET_GRACE_MS = 3000;

const same = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((group) => b.includes(group));

const insert = (model: string, row: Row): SyncAction => ({
  id: 0,
  txId: "",
  model,
  modelId: row.id,
  action: "I",
  data: row,
});

type SyncOptions = {
  core: Core;
  queue: TransactionQueue;
  transport: Transport;
  localDB: LocalDB;
  workspace: string;
  token: string;
  setTimeout: Timer;
};

// Loads the pool, keeps it current from the socket, and tells the queue what the server confirmed.
export class SyncClient {
  lastSyncId = 0;
  // The sync groups the local data holds, and those followed without being in them.
  #holding: Omit<Meta, "lastSyncId"> = { groups: [], subscribed: [] };
  readonly connection = cell<"connecting" | "live" | "offline">("connecting");
  readonly #o: SyncOptions;
  #lock = Promise.resolve();
  #waiters: { id: number; resolve: () => void }[] = [];
  #attempt = 0;
  #socket: { close(): void; hello(): void } | undefined;

  constructor(options: SyncOptions) {
    this.#o = options;
  }

  async bootstrap(): Promise<void> {
    const { localDB, transport, queue, workspace } = this.#o;
    if ((await localDB.open(workspace, registry.schemaHash)) === "fresh")
      for (let attempt = 0; ; attempt++)
        try {
          return await this.#full();
        } catch {
          await new Promise<void>((retry) => this.#o.setTimeout(retry, backoff(attempt)));
        }
    const loaded = await Promise.all(
      registry
        .all()
        .map(async ({ name }) => (await localDB.load(name)).map((row) => insert(name, row))),
    );
    const { lastSyncId, ...holding } = await localDB.meta.get();
    // Read before the pool fills, so the outbox replays in the same step: nothing edited in between can go first.
    const outbox = await localDB.outbox.all();
    this.#holding = holding;
    this.#update(loaded.flat(), lastSyncId);
    queue.replayOutbox(outbox);
    // Offline, the socket's Hello catches up once it connects. A server behind this cache has started over.
    await transport
      .deltas(this.lastSyncId, this.#holding.subscribed)
      .then((packet) =>
        packet.lastSyncId < this.lastSyncId
          ? this.#locked(() => this.#full())
          : this.applyDelta(packet),
      )
      .catch(() => {});
  }

  connect(): void {
    this.connection.set("connecting");
    let failed = false;
    const socket = (this.#socket = this.#o.transport.connect({
      hello: () => {
        this.#attempt = 0;
        this.connection.set("live");
        return {
          type: "hello",
          lastSyncId: this.lastSyncId,
          token: this.#o.token,
          subscribed: this.#holding.subscribed,
        };
      },
      // A step that fails can't be skipped: what came after it waits for a new Hello.
      onMessage: (message) =>
        void this.#locked(async () => {
          if (failed) return;
          try {
            await this.#apply(message);
          } catch {
            failed = true;
            socket.close();
          }
        }),
      onClose: () => {
        this.connection.set("offline");
        // After what the socket left running (a load), so the next Hello says where the data really is.
        this.#o.setTimeout(
          () => void this.#lock.then(() => this.connect()),
          backoff(this.#attempt++),
        );
      },
    }));
  }

  // Follows a group the session may read without being in it, such as a subspace it isn't a member of: the next Hello
  // asks for it, and the server answers with the group as gained.
  subscribe(group: string): void {
    if (this.#holding.subscribed.includes(group)) return;
    this.#holding = { ...this.#holding, subscribed: [...this.#holding.subscribed, group] };
    void this.#locked(async () => {
      await this.#o.localDB.meta.set({ lastSyncId: this.lastSyncId, ...this.#holding });
      this.#socket?.hello();
    });
  }

  applyDelta(packet: DeltasResponse): Promise<void> {
    return this.#locked(() => this.#apply(packet));
  }

  waitForSyncId(id: number): Promise<void> {
    if (id <= this.lastSyncId) return Promise.resolve();
    // A socket can look open and deliver nothing, which would leave this client showing only its own edits. A confirmed
    // change that hasn't come back says so: connect again, and the new Hello catches up.
    this.#o.setTimeout(() => {
      if (id > this.lastSyncId) this.#socket?.close();
    }, SOCKET_GRACE_MS);
    return new Promise((resolve) => this.#waiters.push({ id, resolve }));
  }

  // A packet older than this client's position is behind it, groups and all. One whose groups differ from what the
  // local data holds changes those first, which also brings everything up to now.
  async #apply(packet: DeltasResponse): Promise<void> {
    if (packet.lastSyncId < this.lastSyncId) return;
    if (!same(packet.groups, this.#holding.groups)) return this.#regroup();
    let { actions, lastSyncId } = packet;
    actions = actions.filter((action) => action.id > this.lastSyncId);
    // Ids filtered out by sync groups look like gaps too; the fetch confirms nothing visible is missing.
    if (actions.length > 0 && actions[0].id !== this.lastSyncId + 1) {
      const fetched = await this.#o.transport.deltas(this.lastSyncId, this.#holding.subscribed);
      if (!same(fetched.groups, this.#holding.groups)) return this.#regroup();
      ({ actions, lastSyncId } = fetched);
    }
    if (lastSyncId === this.lastSyncId) return;
    await this.#o.localDB.write(actions);
    await this.#o.localDB.meta.set({ lastSyncId, ...this.#holding });
    this.#update(actions, lastSyncId);
  }

  // The session's groups changed. The server answers as of one sync id with its groups, the rows of those this client
  // doesn't hold, and every action since this client's position; rows come after the actions, so they're what stays.
  // What the groups no longer cover goes from the local database, not just the pool, so a pending delete's rollback
  // can't bring a row back.
  async #regroup(): Promise<void> {
    const { transport, localDB } = this.#o;
    const { rows, end } = await transport.bootstrap(this.#holding.subscribed, {
      holds: this.#holding.groups,
      after: this.lastSyncId,
    });
    const stored = await Promise.all(
      registry
        .all()
        .map(async (meta) => (await localDB.load(meta.name)).map((row) => ({ meta, row }))),
    );
    const gone = stored
      .flat()
      .filter(({ meta, row }) => !sees(end.groups, meta.syncGroup?.(row) ?? []))
      .map(({ meta, row }): SyncAction => ({
        id: 0,
        txId: "",
        model: meta.name,
        modelId: row.id,
        action: "D",
      }));
    const changes = [
      ...gone,
      ...end.actions.filter((action) => action.id > this.lastSyncId),
      ...rows.map(({ model, row }) => insert(model, row)),
    ];
    const lastSyncId = Math.max(this.lastSyncId, end.lastSyncId);
    this.#holding = { ...this.#holding, groups: end.groups };
    await localDB.write(changes);
    await localDB.meta.set({ lastSyncId, ...this.#holding });
    this.#update(changes, lastSyncId);
  }

  #locked(work: () => Promise<void>): Promise<void> {
    const run = this.#lock.then(work);
    this.#lock = run.catch(() => {});
    return run;
  }

  // A full load: everything the server holds for this session replaces local data. The outbox stays.
  async #full(): Promise<void> {
    const { transport, localDB, core } = this.#o;
    const { rows, end } = await transport.bootstrap(this.#holding.subscribed);
    const inserts = rows.map(({ model, row }) => insert(model, row));
    this.#holding = { ...this.#holding, groups: end.groups };
    await localDB.wipe();
    await localDB.write(inserts);
    await localDB.meta.set({ lastSyncId: end.lastSyncId, ...this.#holding });
    const kept = new Set(rows.map(({ row }) => row.id));
    const removed = core.pool
      .ids()
      // A local create the server hasn't confirmed isn't the server's to remove.
      .filter((id) => !kept.has(id) && core.pool.get(id)!.isPersisted)
      .map((id) => ({ model: core.pool.get(id)!.__meta.name, modelId: id }));
    this.#update([...inserts, ...removed], end.lastSyncId);
  }

  // Server rows into the pool, then pending transactions and unsaved edits back on top, then the new position.
  #update(changes: Change[], lastSyncId: number): void {
    const { core, queue } = this.#o;
    const unsaved = new Map<string, [string, unknown][]>();
    for (const { model: name, modelId, data } of changes) {
      const model = core.pool.get(modelId);
      if (model && !unsaved.has(modelId))
        unsaved.set(
          modelId,
          model.changedFields.map((field) => [field, model.__data[field]]),
        );
      if (!data) core.pool.remove(modelId);
      else if (!model) {
        const fresh = core.materialize(name, data);
        fresh.__persisted = true;
        core.pool.put(fresh);
      } else {
        for (const field in data) write(model, field, data[field]);
        model.__persisted = true;
      }
    }
    for (const modelId of new Set(changes.map((change) => change.modelId))) {
      queue.onDelta(modelId, lastSyncId);
      const model = core.pool.get(modelId);
      if (model)
        for (const [field, value] of unsaved.get(modelId) ?? []) {
          model.__original[field] = model.__data[field];
          write(model, field, value);
        }
    }
    this.lastSyncId = lastSyncId;
    const ready = this.#waiters.filter((waiter) => waiter.id <= lastSyncId);
    this.#waiters = this.#waiters.filter((waiter) => waiter.id > lastSyncId);
    for (const waiter of ready) waiter.resolve();
  }
}
