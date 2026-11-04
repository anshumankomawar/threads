import { computed, makeObservable } from "mobx";
import {
  labelSlug,
  ORGANIZATION_ID,
  threadsMutations,
  threadsSchema,
  toThreads,
  type BuiltIn,
  type EntryCreate,
  type Group,
  type GroupChanges,
  type Label,
  type ModelRecords,
  type Organization,
  type Person,
  type PersonChanges,
  type Sprint,
  type SprintChanges,
  type Thread,
  type ThreadChanges,
  type TransactionInput,
} from "model";
import { listsAsOps } from "sync";
import { SyncClient, type ClientEvent, type SyncDatabase, type Transport } from "sync/client";

// How the app reaches its server: the sync engine's transport, plus wiping the workspace (a development tool).
export type ThreadsTransport = Transport<ModelRecords, TransactionInput> & {
  // Starts the workspace over: deletes every thread, keeping its people, organization, labels and groups.
  reset(): Promise<unknown>;
};

export type NewThread = {
  title: string;
  // Its description (`descriptionOf`), shown under the title; empty for none.
  description: string;
  // Who it's assigned to from the start; anyone @mentioned in it joins them.
  assignees?: Person[];
  // The thread this one branches off from.
  branchedFromId?: string | null;
  // The thread this one blocks (`/blocked`).
  blocksId?: string | null;
  // Messages moved in from the parent to open the thread, in place of a description.
  movedEntryIds?: string[];
  // Its labels from the start, by name; any that don't exist yet are made with it.
  labelNames?: string[];
};

// Threads on the sync engine's client (`SyncClient` in packages/sync, which keeps the pool, the queue, the local cache
// and the socket). This adds what the app reads (threads with their people resolved, labels, groups) and the changes
// it makes, each one a transaction.
export class ThreadsClient extends SyncClient<ModelRecords, TransactionInput> {
  readonly #transport: ThreadsTransport;

  constructor(
    transport: ThreadsTransport,
    openDatabase: () => Promise<SyncDatabase<ModelRecords, TransactionInput | BuiltIn>>,
    onEvent?: (event: ClientEvent) => void,
  ) {
    super({ schema: threadsSchema, mutations: threadsMutations, transport, openDatabase, onEvent });
    this.#transport = transport;
    makeObservable(this, {
      threads: computed,
      people: computed,
      organization: computed,
      labels: computed,
      groups: computed,
      sprints: computed,
    });
  }

  // The pool's threads with their references resolved, as the app renders them.
  get threads(): Thread[] {
    const { maps } = this.pool;
    return toThreads(maps.Thread.values(), maps.Entry.values(), maps.Person);
  }

  get people(): Person[] {
    return [...this.pool.maps.Person.values()];
  }

  get organization(): Organization | undefined {
    return this.pool.maps.Organization.get(ORGANIZATION_ID);
  }

  get labels(): Label[] {
    return [...this.pool.maps.Label.values()];
  }

  get groups(): Group[] {
    return [...this.pool.maps.Group.values()];
  }

  get sprints(): Sprint[] {
    return [...this.pool.maps.Sprint.values()];
  }

  // Wipes the workspace's threads (people and the org stay), drops anything still unsent, and loads the clean copy
  // straight away rather than waiting for the socket to notice.
  async wipe(): Promise<void> {
    await this.#transport.reset();
    await this.discardAndReload();
  }

  #enqueue(input: TransactionInput, me: Person): void {
    this.transact(input, me.id);
  }

  // A label by name: the one that exists, however it's written, or a new one sent along with whatever needs it. Making
  // one that someone else just made is harmless, so it can't sink the thread it's for. Returns its id.
  ensureLabel(name: string, me: Person): string {
    const id = labelSlug(name);
    const existing = this.labels.find((label) => label.id === id || labelSlug(label.name) === id);
    if (existing !== undefined) return existing.id;
    this.#enqueue(
      {
        id: crypto.randomUUID(),
        type: "create",
        modelName: "Label",
        data: { id, name: name.trim() },
      },
      me,
    );
    return id;
  }

  // Makes a group, with you in it. The server makes its label. Returns its id.
  createGroup(name: string, members: Person[], me: Person): string {
    const groupId = crypto.randomUUID();
    this.#enqueue(
      {
        id: crypto.randomUUID(),
        type: "create",
        modelName: "Group",
        data: { id: groupId, name: name.trim(), memberIds: members.map((person) => person.id) },
      },
      me,
    );
    return groupId;
  }

  // Lists given whole go as the ops that make them (`listsAsOps`), so they merge with anyone else's edits to the same list.
  updateGroup(groupId: string, changes: GroupChanges, me: Person): void {
    this.#enqueue(
      {
        id: crypto.randomUUID(),
        type: "update",
        modelName: "Group",
        modelId: groupId,
        changes: listsAsOps(this.pool.get("Group", groupId), changes),
      },
      me,
    );
  }

  // Starts a sprint in a group, with any of its threads to begin with. Returns its id.
  createSprint(
    groupId: string,
    name: string,
    dates: { startMs: number; endMs: number },
    threadIds: string[],
    me: Person,
  ): string {
    const sprintId = crypto.randomUUID();
    this.#enqueue(
      {
        id: crypto.randomUUID(),
        type: "create",
        modelName: "Sprint",
        data: { id: sprintId, groupId, name: name.trim(), ...dates, threadIds },
      },
      me,
    );
    return sprintId;
  }

  updateSprint(sprintId: string, changes: SprintChanges, me: Person): void {
    this.#enqueue(
      {
        id: crypto.randomUUID(),
        type: "update",
        modelName: "Sprint",
        modelId: sprintId,
        changes: listsAsOps(this.pool.get("Sprint", sprintId), changes),
      },
      me,
    );
  }

  renameOrganization(name: string, me: Person): void {
    this.#enqueue(
      {
        id: crypto.randomUUID(),
        type: "update",
        modelName: "Organization",
        modelId: ORGANIZATION_ID,
        changes: { name },
      },
      me,
    );
  }

  // A thread and its description (or the messages moved in to open it), sent together. Returns its id.
  createThread(draft: NewThread, me: Person): string {
    const threadId = crypto.randomUUID();
    const labelIds = (draft.labelNames ?? []).map((name) => this.ensureLabel(name, me));
    this.#enqueue(
      {
        id: crypto.randomUUID(),
        type: "create",
        modelName: "Thread",
        data: {
          id: threadId,
          title: draft.title.trim().slice(0, 200),
          assigneeIds: (draft.assignees ?? []).map((person) => person.id),
          branchedFromId: draft.branchedFromId ?? null,
          blocksId: draft.blocksId ?? null,
          labelIds,
        },
      },
      me,
    );
    if (draft.movedEntryIds !== undefined) this.moveMessages(draft.movedEntryIds, threadId, me);
    else if (draft.description.trim() !== "")
      this.addEntry(threadId, "message", draft.description, me, threadId);
    return threadId;
  }

  moveMessages(entryIds: string[], threadId: string, me: Person): void {
    this.#enqueue(
      { id: crypto.randomUUID(), type: "move", modelName: "Entry", entryIds, threadId },
      me,
    );
  }

  // Changes your own profile; the server refuses anyone else's.
  updatePerson(changes: PersonChanges, me: Person): void {
    this.#enqueue(
      { id: crypto.randomUUID(), type: "update", modelName: "Person", modelId: me.id, changes },
      me,
    );
  }

  updateThread(threadId: string, changes: ThreadChanges, me: Person): void {
    this.#enqueue(
      {
        id: crypto.randomUUID(),
        type: "update",
        modelName: "Thread",
        modelId: threadId,
        changes: listsAsOps(this.pool.get("Thread", threadId), changes),
      },
      me,
    );
  }

  // `id` is given only for a thread's description, which takes the thread's id. A message sent to nobody is a note.
  addEntry(
    threadId: string,
    kind: EntryCreate["kind"],
    text: string,
    me: Person,
    id: string = crypto.randomUUID(),
    sentTo: Person[] = [],
  ): void {
    this.#enqueue(
      {
        id: crypto.randomUUID(),
        type: "create",
        modelName: "Entry",
        data: { id, threadId, kind, text, sentToIds: sentTo.map((person) => person.id) },
      },
      me,
    );
  }

  // Deletes one of your own messages; the server refuses anyone else's, and a thread's description.
  deleteMessage(entryId: string, me: Person): void {
    this.delete("Entry", entryId, me.id);
  }
}
