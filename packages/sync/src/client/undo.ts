import { action, computed, makeObservable, observableRef } from "mobx";
import type { Models, TransactionEnvelope } from "../protocol";
import type { Transaction, TransactionQueue } from "./transactions";

// One undoable step: what the UI called it, and the transactions it made.
export type UndoOperation<M extends Models, T extends TransactionEnvelope> = {
  label: string;
  transactions: Transaction<M, T>[];
};

// Undo and redo, transaction-based as in LSE: the UI wraps an edit in `addOperation`, and every transaction queued while
// it runs becomes one step. Undoing a step queues each transaction's undo (newest first) as a new transaction, so it
// syncs like any other change, and the undos become the step that redo undoes in turn. Steps that can't be undone (a
// deletion, say) are left out.
export class UndoQueue<M extends Models, T extends TransactionEnvelope> {
  undoStack: UndoOperation<M, T>[] = [];
  redoStack: UndoOperation<M, T>[] = [];
  readonly #queue: TransactionQueue<M, T>;
  readonly #limit: number;

  constructor(queue: TransactionQueue<M, T>, limit = 100) {
    this.#queue = queue;
    this.#limit = limit;
    makeObservable(this, {
      undoStack: observableRef,
      redoStack: observableRef,
      canUndo: computed,
      canRedo: computed,
      addOperation: action,
      undo: action,
      redo: action,
      clear: action,
    });
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // Runs `edit`, recording the transactions it queues as one undoable step. A new step clears what could be redone.
  addOperation(label: string, edit: () => void): void {
    const transactions: Transaction<M, T>[] = [];
    const stop = this.#queue.onEnqueued((transaction) => transactions.push(transaction));
    try {
      edit();
    } finally {
      stop();
    }
    if (transactions.length === 0) return;
    this.undoStack = [...this.undoStack, { label, transactions }].slice(-this.#limit);
    this.redoStack = [];
  }

  // Undoes the latest step; answers its label, or undefined when there's nothing to undo.
  undo(): string | undefined {
    const step = this.undoStack.at(-1);
    if (step === undefined) return undefined;
    this.undoStack = this.undoStack.slice(0, -1);
    const undone = this.#reverse(step);
    if (undone !== undefined) this.redoStack = [...this.redoStack, undone];
    return step.label;
  }

  // Redoes the step undone last; answers its label, or undefined when there's nothing to redo.
  redo(): string | undefined {
    const step = this.redoStack.at(-1);
    if (step === undefined) return undefined;
    this.redoStack = this.redoStack.slice(0, -1);
    const redone = this.#reverse(step);
    if (redone !== undefined) this.undoStack = [...this.undoStack, redone];
    return step.label;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  // Queues the undo of each transaction in a step, newest first, and answers them as a step of their own.
  #reverse(step: UndoOperation<M, T>): UndoOperation<M, T> | undefined {
    const transactions = [...step.transactions]
      .reverse()
      .map((transaction) => transaction.undoTransaction())
      .filter((transaction) => transaction !== null);
    for (const transaction of transactions) this.#queue.enqueue(transaction);
    return transactions.length === 0 ? undefined : { label: step.label, transactions };
  }
}
