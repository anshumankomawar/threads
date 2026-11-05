// The simulation's fake world: a clock, a network the simulator drives, and the clients' local databases. Engine and
// server are the real ones; only what they talk through is faked here.
import { Refusal, type Socket, type SyncServer } from "server";
import type { ServerMessage, SyncAction } from "protocol";
import {
  createStore,
  RejectedError,
  type LocalDB,
  type Store,
  type Transaction,
  type Transport,
} from "sync";
import { memoryLocalDB } from "./memory-local-db";

type Handlers = Parameters<Transport["connect"]>[0];

// Something on the wire: an HTTP exchange or an open socket with messages waiting.
interface Flight {
  ready(): boolean;
  deliver(): void;
  duplicate(): void;
  drop(): void;
}

export type Client = {
  user: string;
  db: Recorded;
  store: Store;
  life: number; // bumped on reload: the old page's transport and timers go quiet
  offline: boolean;
  conn?: Conn;
  promises: { settled: boolean }[]; // this life's result() and action() promises
};

// What a client applied to its local database: every row written, and the sync ids since each full load.
type Recorded = LocalDB & {
  written: SyncAction[];
  loads: { base?: number; ids: number[] }[];
};

// Through JSON, as on the wire, so neither side shares objects with the other.
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export const drain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function recorded(db: LocalDB): Recorded {
  const loads: Recorded["loads"] = [{ ids: [] }];
  const written: SyncAction[] = [];
  return {
    ...db,
    written,
    loads,
    write(actions) {
      written.push(...structuredClone(actions));
      loads.at(-1)!.ids.push(...actions.filter((a) => a.id > 0).map((a) => a.id));
      return db.write(actions);
    },
    wipe() {
      loads.push({ ids: [] });
      return db.wipe();
    },
    meta: {
      get: () => db.meta.get(),
      set(meta) {
        loads.at(-1)!.base ??= meta.lastSyncId;
        return db.meta.set(meta);
      },
    },
  };
}

class Http implements Flight {
  #respond?: () => void;
  constructor(
    readonly world: World,
    readonly call: () => unknown,
    readonly resolve: (value: unknown) => void,
    readonly reject: (error: Error) => void,
  ) {}

  ready = () => true;

  // The first delivery reaches the server; the second brings its answer back.
  deliver(): void {
    if (this.#respond === undefined) this.#respond = this.#serve();
    else {
      this.world.remove(this);
      this.#respond();
    }
  }

  duplicate(): void {
    if (this.#respond === undefined) this.#serve();
    this.deliver();
  }

  drop(): void {
    this.world.remove(this);
    this.reject(new Error("dropped"));
  }

  #serve(): () => void {
    try {
      const value = wire(this.call());
      return () => this.resolve(value);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      return () => this.reject(new RejectedError(error.message));
    }
  }
}

class Conn implements Flight {
  socket?: Socket;
  inbox: ServerMessage[] = [];
  constructor(
    readonly world: World,
    readonly client: Client,
    readonly handlers: Handlers,
  ) {}

  ready = () => this.socket === undefined || this.inbox.length > 0;

  // The first delivery opens the socket and says hello; later ones deliver the next message, in order.
  deliver(): void {
    if (this.socket !== undefined) return this.handlers.onMessage(this.inbox.shift()!);
    this.socket = { session: { userId: this.client.user }, send: (m) => this.inbox.push(wire(m)) };
    this.world.server.hello(this.socket, this.handlers.hello().lastSyncId);
  }

  duplicate(): void {
    if (this.socket === undefined) this.deliver();
    else this.handlers.onMessage(wire(this.inbox[0]));
  }

  drop(): void {
    this.world.close(this, true);
  }
}

export class World {
  now = 1_000;
  ids = 0;
  network: Flight[] = [];
  timers: { at: number; fn: () => void }[] = [];
  clients: Client[] = [];
  transactions: { tx: Transaction; modelId: string }[] = [];
  server!: SyncServer;

  sockets(): Socket[] {
    return this.network.flatMap((f) => (f instanceof Conn && f.socket ? [f.socket] : []));
  }

  remove(flight: Flight): void {
    this.network.splice(this.network.indexOf(flight), 1);
  }

  close(conn: Conn, notify: boolean): void {
    if (!this.network.includes(conn)) return;
    this.remove(conn);
    if (notify) queueMicrotask(conn.handlers.onClose);
  }

  // Runs the earliest timer, moving the clock to it.
  tick(): boolean {
    if (this.timers.length === 0) return false;
    const next = this.timers.reduce((a, b) => (b.at < a.at ? b : a));
    this.timers.splice(this.timers.indexOf(next), 1);
    this.now = Math.max(this.now, next.at);
    next.fn();
    return true;
  }

  addClient(user: string): void {
    const client = { user, db: recorded(memoryLocalDB()), life: 0, offline: false } as Client;
    this.clients.push(client);
    this.start(client);
  }

  // A new page over the same local database; the old one's socket closes and it hears nothing more.
  start(client: Client): void {
    if (client.conn) this.close(client.conn, false);
    const life = ++client.life;
    const alive = () => client.life === life;
    const session = { userId: client.user };
    const http = <T>(call: () => T) =>
      new Promise<T>((resolve, reject) => {
        if (client.offline) return reject(new Error("offline"));
        this.network.push(
          new Http(
            this,
            call,
            (value) => alive() && resolve(value as T),
            (error) => alive() && reject(error),
          ),
        );
      });
    const { server } = this;
    const transport: Transport = {
      bootstrap: () => http(() => server.bootstrap(session)),
      deltas: (after) => http(() => server.deltas(session, after)),
      mutate: (request) => http(() => server.mutate(session, wire(request))),
      action: (name, args) => http(() => server.action(session, name, wire(args))),
      connect: (handlers) => {
        const conn = new Conn(this, client, handlers);
        if (client.offline) queueMicrotask(handlers.onClose);
        else this.network.push((client.conn = conn));
        return { close: () => this.close(conn, true) };
      },
    };
    client.promises = [];
    client.store = createStore({
      transport,
      localDB: client.db,
      workspace: "w",
      token: client.user,
      setTimeout: (fn, ms) => this.timers.push({ at: this.now + ms, fn: () => alive() && fn() }),
    });
  }

  track(client: Client, promise: Promise<void>): void {
    const tracked = { settled: false };
    client.promises.push(tracked);
    const settle = () => void (tracked.settled = true);
    promise.then(settle, settle);
  }

  // Heals the network and runs it until nothing is in flight and no timer is left.
  async quiesce(): Promise<void> {
    for (const client of this.clients) client.offline = false;
    for (let step = 0; ; step++) {
      if (step > 10_000) throw new Error("the world never went quiet");
      await drain();
      const flight = this.network.find((f) => f.ready());
      if (flight) flight.deliver();
      else if (!this.tick()) return;
    }
  }
}
