import type {
  AnyRecord,
  BuiltInTransaction,
  ModelName,
  Models,
  TransactionEnvelope,
} from "./protocol";

export type ChangeContext = { actorId: string; nowMs: number };

// How a product's transactions change models on the client, so they show at once (optimistically), replay after a
// restart, stay on top of newer server data (rebasing), and can be undone.
export type ClientMutations<M extends Models, T extends TransactionEnvelope> = {
  // The models a transaction changes.
  touches(input: T): { modelName: ModelName<M>; id: string }[];
  // One of those models with the change applied: the new record, null to remove it, or undefined to leave it. It's
  // given whatever the record is now (undefined if absent), which after a rebase is the server's newer copy, so it must
  // work from any starting point.
  change(
    input: T,
    modelName: ModelName<M>,
    record: AnyRecord<M> | undefined,
    context: ChangeContext,
  ): AnyRecord<M> | null | undefined;
  // The transaction that undoes this one, given each touched model as it was before it (by `modelName:id`), or null
  // when it can't be undone. Without it, creating one model undoes by deleting it, and nothing else of the product's
  // undoes. Archiving and unarchiving undo each other on their own.
  inverse?(
    input: T,
    before: ReadonlyMap<string, AnyRecord<M> | undefined>,
    context: ChangeContext,
  ): Omit<T, "id"> | Omit<BuiltInTransaction<M>, "id"> | null;
};
