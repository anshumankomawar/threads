import type { Row, TxKind, TxRecord } from "protocol";

type Fields = Record<string, unknown>;
import { equal, write, type Core } from "./model";
import { cell } from "./signals";
import type { TransactionQueue } from "./transactions";

// What one transaction did, kept for undoing it: its kind, its model, and the values it changed from and to (and which
// transaction it was, so a correction to it reaches it here).
type Change = Pick<TxRecord, "kind" | "model" | "modelId" | "changes" | "original"> & {
  txId?: string;
};
// One undo step: what the UI called it, and the changes made within it, in order.
type Step = { label: string; changes: Change[] };

const LIMIT = 100;

// A copy, so a rebase (which refills a pending transaction's original from the pool, the server's echo of it included)
// can't make it undo to itself. The one correction it does need, an earlier transaction refused, comes from the
// queue's onCorrect.
const copy = ({ id, kind, model, modelId, changes, original }: TxRecord): Change => ({
  txId: id,
  kind,
  model,
  modelId,
  changes: changes && { ...changes },
  original: original && { ...original },
});

// Undo and redo, as Linear's UndoQueue: built on transactions. `group` listens to the transaction queue while its
// function runs, and every transaction queued in that time (each save(), create, archive, delete) is one step. Undoing
// a step reverses each of its changes, last first, with new transactions that sync like any others; those reversals
// are the step redo reverses in turn. Undoing and redoing record nothing themselves.
//
// A change is only reversed where it still holds: a field someone (or something) has changed since is left as it is,
// a model that's gone is skipped, and so is a rejected transaction, which the queue has already rolled back.
export class UndoStack {
  readonly #core: Core;
  readonly #queue: TransactionQueue;
  #undos: Step[] = [];
  #redos: Step[] = [];
  #recording: Change[] | null = null;
  // The labels of the steps undo and redo would take, for menus and toasts (null when there are none).
  readonly nextUndo = cell<string | null>(null);
  readonly nextRedo = cell<string | null>(null);

  constructor(core: Core, queue: TransactionQueue) {
    this.#core = core;
    this.#queue = queue;
    // A refused transaction rolled back under a later one: that one now undoes past the refused value too.
    queue.onCorrect((txId, field, value) => {
      for (const step of [...this.#undos, ...this.#redos])
        for (const change of step.changes)
          if (change.txId === txId && change.original && field in change.original)
            change.original[field] = value;
    });
  }

  // Runs `fn`, and makes everything it queues one undo step called `label`. Inside another group, it's part of that
  // one. A new step clears what could be redone, as in any editor.
  group(label: string, fn: () => void): void {
    if (this.#recording) return fn();
    const recording: Change[] = [];
    this.#recording = recording;
    const stop = this.#queue.listen((record) => recording.push(copy(record)));
    try {
      fn();
    } finally {
      stop();
      this.#recording = null;
    }
    if (recording.length === 0) return;
    this.#undos = [...this.#undos, { label, changes: recording }].slice(-LIMIT);
    this.#redos = [];
    this.#announce();
  }

  undo(): string | null {
    return this.#move(this.#undos, this.#redos);
  }

  redo(): string | null {
    return this.#move(this.#redos, this.#undos);
  }

  // Reverses the latest step on `from` and puts what that did on `to`, in the order it ran, so reversing that is last
  // first too; returns the step's label, or null if there was nothing to reverse. A step whose changes have all been overtaken is dropped, and the one before it is tried.
  #move(from: Step[], to: Step[]): string | null {
    while (from.length > 0) {
      const step = from.pop()!;
      const done = step.changes
        .toReversed()
        .map((change) => this.#reverse(change))
        .filter((change): change is Change => change !== null);
      if (done.length === 0) continue;
      to.push({ label: step.label, changes: done });
      this.#announce();
      return step.label;
    }
    this.#announce();
    return null;
  }

  #announce(): void {
    this.nextUndo.set(this.#undos.at(-1)?.label ?? null);
    this.nextRedo.set(this.#redos.at(-1)?.label ?? null);
  }

  // Reverses one change with a new transaction, if it still holds; returns the change that transaction makes.
  #reverse(change: Change): Change | null {
    const { pool, materialize, enqueue } = this.#core;
    const model = pool.get(change.modelId);
    const made = (kind: TxKind, changes?: Fields, original?: Fields): Change => ({
      kind,
      model: change.model,
      modelId: change.modelId,
      changes,
      original,
    });

    switch (change.kind) {
      // Made: delete it again, as it is now.
      case "create": {
        if (!model) return null;
        const data = { ...model.__data };
        model.delete();
        return made("delete", undefined, data);
      }
      // Deleted: make it again, with the id and fields it had.
      case "delete": {
        if (model || !change.original) return null;
        const data = { ...change.original };
        const again = materialize(change.model, data as Row);
        again.__original = {};
        pool.put(again);
        enqueue("create", again, { ...data });
        return made("create", data);
      }
      // Archived or unarchived: the other, if it's still as that left it.
      case "archive":
      case "unarchive": {
        if (!model || equal(model.__data.archivedAt ?? null, change.original?.archivedAt ?? null))
          return null;
        const original = { archivedAt: model.__data.archivedAt };
        if (change.kind === "archive") model.unarchive();
        else model.archive();
        return made(
          change.kind === "archive" ? "unarchive" : "archive",
          { archivedAt: model.__data.archivedAt },
          original,
        );
      }
      // Edited: each field back to what it was, where it still has the value this gave it.
      case "update": {
        if (!model || !change.changes || !change.original) return null;
        const back: Fields = {};
        const was: Fields = {};
        for (const [field, value] of Object.entries(change.changes)) {
          if (!(field in change.original) || !equal(model.__data[field], value)) continue;
          back[field] = change.original[field];
          was[field] = model.__data[field];
        }
        if (Object.keys(back).length === 0) return null;
        for (const [field, value] of Object.entries(back)) write(model, field, value);
        // The queue keeps its own (it refills them as it rebases); these are this step's, for reversing it again.
        enqueue("update", model, { ...back }, { ...was });
        return made("update", back, was);
      }
    }
  }
}
