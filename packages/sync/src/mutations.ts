import type { AnyRecord, ModelName, Models, TransactionEnvelope } from "./protocol";

export type ChangeContext = { actorId: string; nowMs: number };

// How a product's transactions change models on the client, so they show at once (optimistically), replay after a
// restart, and stay on top of newer server data (rebasing).
export type ClientMutations<M extends Models, T extends TransactionEnvelope> = {
  // The models a transaction changes.
  touches(input: T): { modelName: ModelName<M>; id: string }[];
  // One of those models with the change applied: the new record, null to remove it, or undefined to leave it. It's
  // given whatever the record is now (undefined if absent), which after a rebase is the server's newer copy, so it
  // must work from any starting point.
  change(
    input: T,
    modelName: ModelName<M>,
    record: AnyRecord<M> | undefined,
    context: ChangeContext,
  ): AnyRecord<M> | null | undefined;
};
