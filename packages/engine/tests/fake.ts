import {
  createStore,
  memoryLocalDB,
  type BootstrapLine,
  type LocalDB,
  type MutateRequest,
  type MutateResponse,
  type Row,
  type ServerMessage,
  type SyncAction,
  type Transport,
} from "../src";

type Handlers = Parameters<Transport["connect"]>[0];

// A server the test drives by hand: it records mutate requests and answers them when told.
export function fakeTransport() {
  const fake = {
    rows: [] as BootstrapLine[],
    log: [] as SyncAction[],
    lastSyncId: 0,
    bootstraps: 0,
    deltaCalls: [] as number[],
    requests: [] as {
      request: MutateRequest;
      resolve: (response: MutateResponse) => void;
      reject: (error: Error) => void;
    }[],
    socket: undefined as Handlers | undefined,
    send: (message: ServerMessage) => fake.socket!.onMessage(message),
  };
  const transport: Transport = {
    async bootstrap() {
      fake.bootstraps++;
      return {
        rows: structuredClone(fake.rows),
        end: { lastSyncId: fake.lastSyncId, schemaHash: "" },
      };
    },
    async deltas(after) {
      fake.deltaCalls.push(after);
      return { actions: fake.log.filter((a) => a.id > after), lastSyncId: fake.lastSyncId };
    },
    mutate: (request) =>
      new Promise((resolve, reject) => fake.requests.push({ request, resolve, reject })),
    action: async () => ({ lastSyncId: fake.lastSyncId }),
    connect(handlers) {
      fake.socket = handlers;
      queueMicrotask(() => handlers.hello());
      return { close: () => handlers.onClose() };
    },
  };
  return Object.assign(fake, transport);
}

export const row = (id: string, fields: Record<string, unknown>): Row => ({
  id,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  ...fields,
});

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function setup(rows: BootstrapLine[] = [], localDB: LocalDB = memoryLocalDB()) {
  const transport = fakeTransport();
  transport.rows = rows;
  const timers: (() => void)[] = [];
  const store = createStore({
    transport,
    localDB,
    workspace: "w",
    token: "t",
    setTimeout: (fn) => timers.push(fn),
  });
  await store.ready();
  await tick();
  return { store, transport, timers, localDB };
}
