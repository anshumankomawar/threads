import type { Row, TxRecord } from "protocol";
import type { LocalDB, Meta } from "sync";

// For tests and the simulation. It copies what it stores, as IndexedDB does, so nothing outside can change it.
export function memoryLocalDB(): LocalDB {
  let schemaHash = "";
  let meta: (Meta & { schemaHash: string }) | undefined;
  const tables = new Map<string, Map<string, Row>>();
  const outbox = new Map<string, TxRecord>();
  const table = (model: string) => tables.get(model) ?? tables.set(model, new Map()).get(model)!;
  return {
    async open(_workspace, hash) {
      schemaHash = hash;
      if (meta?.schemaHash === hash) return "existing";
      tables.clear();
      outbox.clear();
      meta = undefined;
      return "fresh";
    },
    load: async (model) => [...table(model).values()].map((row) => structuredClone(row)),
    async write(actions) {
      for (const { model, modelId, data } of actions)
        if (data) table(model).set(modelId, structuredClone(data));
        else table(model).delete(modelId);
    },
    meta: {
      get: async () => structuredClone(meta) ?? { lastSyncId: 0, groups: [], subscribed: [] },
      set: async (next) => void (meta = { ...structuredClone(next), schemaHash }),
    },
    outbox: {
      put: async (txs) => txs.forEach((tx) => outbox.set(tx.id, structuredClone(tx))),
      remove: async (id) => void outbox.delete(id),
      all: async () => [...outbox.values()].map((tx) => structuredClone(tx)),
    },
    async wipe() {
      tables.clear();
      meta = undefined;
    },
  };
}
