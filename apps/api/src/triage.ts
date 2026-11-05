import type { Row, TxRecord } from "protocol";
import { plainText } from "models";
import type { Reader, Session, SyncServer } from "server";

// What the model needs to sort one person's inbox: their buckets, their inbox items that aren't sorted yet, and the
// ones they placed by hand, as examples of what they mean.
export type TriageRequest = {
  person: { id: string; name: string };
  buckets: { id: string; name: string; description: string }[];
  items: { id: string; title: string; from: string; text: string }[];
  examples: { title: string; bucketId: string }[];
};

export type TriageResult = { itemId: string; bucketId: string; reason: string };

// Sorts one batch of a person's inbox items into their buckets.
export type Classify = (request: TriageRequest) => Promise<TriageResult[]>;

// How many items go to the model at once.
const CHUNK = 20;
// How long an item the model failed on waits before it's tried again.
export const RETRY_MS = 60_000;

const ADMIN: Session = { admin: true };

const unsorted = (item: Row): boolean => item.bucketId == null && !item.manual;

// Every row in the workspace.
function readAll(server: SyncServer): Reader {
  const tables = new Map<string, Map<string, Row>>();
  for (const { model, row } of server.bootstrap(ADMIN).rows) {
    if (!tables.has(model)) tables.set(model, new Map());
    tables.get(model)!.set(row.id, row);
  }
  return {
    get: (model, id) => tables.get(model)?.get(id),
    all: (model) => [...(tables.get(model)?.values() ?? [])],
  };
}

// Everyone with unsorted inbox items and buckets to sort them into. `skip` holds items to leave for now.
export function triageRequests(db: Reader, skip: ReadonlySet<string>): TriageRequest[] {
  const items = db.all("InboxItem");
  const field = (model: string, id: unknown, key: string): string =>
    (db.get(model, id as string)?.[key] as string | undefined) ?? "";
  const plain = (text: string): string =>
    plainText(
      text,
      (id) => field("Conversation", id, "title"),
      (id) => field("User", id, "name"),
    );
  const userIds = new Set(
    items
      .filter((item) => unsorted(item) && !skip.has(item.id))
      .map((item) => item.userId as string),
  );
  return [...userIds].flatMap((userId) => {
    const buckets = db
      .all("Bucket")
      .filter((bucket) => bucket.userId === userId)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((bucket) => ({
        id: bucket.id,
        name: bucket.name as string,
        description: bucket.description as string,
      }));
    if (buckets.length === 0) return [];
    const mine = items.filter((item) => item.userId === userId);
    return [
      {
        person: { id: userId, name: field("User", userId, "name") },
        buckets,
        examples: mine
          .filter((item) => item.manual && item.bucketId != null)
          .slice(-20)
          .map((item) => ({
            title: field("Conversation", item.conversationId, "title"),
            bucketId: item.bucketId as string,
          })),
        items: mine
          .filter((item) => unsorted(item) && !skip.has(item.id))
          .map((item) => {
            const conversation = db.get("Conversation", item.conversationId as string)!;
            const messages = db
              .all("Message")
              .filter((message) => message.conversationId === conversation.id);
            // What it's about: its first message, and the latest one sent to them.
            const sent = messages.findLast((message) =>
              (message.toIds as string[]).includes(userId),
            );
            const text = [...new Set([messages[0], sent])]
              .filter((message) => message !== undefined)
              .map((message) => plain(message.body as string))
              .join("\n");
            return {
              id: item.id,
              title: conversation.title as string,
              from: field("User", sent?.authorId ?? conversation.ownerId, "name"),
              text: text.slice(0, 600),
            };
          }),
      },
    ];
  });
}

// Keeps every inbox sorted. After each change (and when the workspace loads) it asks the model about the items that
// aren't sorted, and saves its choices as the admin, so they reach clients like any other change. It runs one pass at
// a time; a kick while it's running runs another pass after it.
export class Triager {
  readonly #server: SyncServer;
  readonly #classify: Classify;
  readonly #now: () => number;
  readonly #onFailure: (retryAtMs: number) => void;
  // Items the model failed on, and when, so a failing model isn't asked again on every change.
  readonly #failedAt = new Map<string, number>();
  #running: Promise<void> | undefined;
  #again = false;

  constructor(
    server: SyncServer,
    classify: Classify,
    {
      now = Date.now,
      onFailure = () => {},
    }: { now?: () => number; onFailure?: (retryAtMs: number) => void } = {},
  ) {
    this.#server = server;
    this.#classify = classify;
    this.#now = now;
    this.#onFailure = onFailure;
  }

  // Sorts whatever needs it. Resolves once nothing is left to try.
  kick(): Promise<void> {
    if (this.#running !== undefined) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#run().finally(() => (this.#running = undefined));
    return this.#running;
  }

  async #run(): Promise<void> {
    do {
      this.#again = false;
      const nowMs = this.#now();
      const skip = new Set(
        [...this.#failedAt].filter(([, at]) => nowMs - at < RETRY_MS).map(([id]) => id),
      );
      for (const request of triageRequests(readAll(this.#server), skip))
        for (let start = 0; start < request.items.length; start += CHUNK) {
          const chunk = { ...request, items: request.items.slice(start, start + CHUNK) };
          try {
            this.#save(await this.#classify(chunk));
            for (const item of chunk.items) this.#failedAt.delete(item.id);
          } catch (error) {
            console.error("Sorting the inbox failed", error);
            for (const item of chunk.items) this.#failedAt.set(item.id, this.#now());
            this.#onFailure(this.#now() + RETRY_MS);
          }
        }
    } while (this.#again);
  }

  // An item placed by hand or sorted while the model was thinking keeps what it has; a bucket that isn't the item's
  // user's is ignored.
  #save(results: TriageResult[]): void {
    const db = readAll(this.#server);
    const transactions = results.flatMap(({ itemId, bucketId, reason }): TxRecord[] => {
      const item = db.get("InboxItem", itemId);
      if (
        item === undefined ||
        !unsorted(item) ||
        db.get("Bucket", bucketId)?.userId !== item.userId
      )
        return [];
      const changes = { bucketId, reason: reason.trim().slice(0, 120) };
      return [
        {
          id: crypto.randomUUID(),
          kind: "update",
          model: "InboxItem",
          modelId: itemId,
          changes,
          batch: 0,
        },
      ];
    });
    if (transactions.length > 0) this.#server.mutate(ADMIN, { transactions });
  }
}

// Workers AI's Llama 3.3 70B, which answers in JSON to a schema. Its free daily allocation covers a team's inbox:
// each call is about 150 neurons, and items are only sorted when they arrive.
export const TRIAGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM = `You sort one person's work inbox into the buckets they defined. Each bucket has a name and a plain-language description of what belongs in it, written by them.

For every thread, pick the one bucket whose description fits it best. Put a thread in a catch-all bucket only when no other bucket fits. Follow the examples of threads they sorted themselves: they show what they mean by each bucket.

Also give a reason of at most eight words saying what the thread is about in a way that shows why it belongs there, for example "Customer locked out after Tuesday's deploy". Don't restate the bucket name.`;

// The prompt for one batch. Items and buckets are numbered so the model never has to copy ids.
export function triagePrompt(request: TriageRequest): string {
  const bucketNumber = new Map(request.buckets.map((bucket, index) => [bucket.id, index + 1]));
  const buckets = request.buckets
    .map((bucket, index) => `${index + 1}. ${bucket.name}: ${bucket.description || bucket.name}`)
    .join("\n");
  const examples = request.examples
    .flatMap((example) => {
      const number = bucketNumber.get(example.bucketId);
      return number === undefined ? [] : [`- "${example.title}" → bucket ${number}`];
    })
    .join("\n");
  const threads = request.items
    .map(
      (item, index) =>
        `[${index + 1}] ${item.title}\nFrom: ${item.from}${item.text === "" ? "" : `\n${item.text}`}`,
    )
    .join("\n\n");
  return [
    `Inbox of ${request.person.name}.`,
    `Buckets:\n${buckets}`,
    examples === "" ? null : `Threads they sorted themselves:\n${examples}`,
    `Threads to sort:\n\n${threads}`,
  ]
    .filter((part) => part !== null)
    .join("\n\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    threads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          thread: { type: "integer" },
          bucket: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["thread", "bucket", "reason"],
      },
    },
  },
  required: ["threads"],
};

type Answer = { threads?: { thread?: unknown; bucket?: unknown; reason?: unknown }[] };

// Maps the model's numbered answer back to items and buckets, dropping anything that doesn't point at one.
export function parseTriage(request: TriageRequest, answer: unknown): TriageResult[] {
  const parsed = (typeof answer === "string" ? JSON.parse(answer) : answer) as Answer;
  return (parsed.threads ?? []).flatMap((entry) => {
    const item = request.items[Number(entry.thread) - 1];
    const bucket = request.buckets[Number(entry.bucket) - 1];
    if (item === undefined || bucket === undefined) return [];
    return [
      {
        itemId: item.id,
        bucketId: bucket.id,
        reason: typeof entry.reason === "string" ? entry.reason : "",
      },
    ];
  });
}

export function workersAiClassifier(ai: Ai): Classify {
  return async (request) => {
    const output = (await ai.run(TRIAGE_MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: triagePrompt(request) },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 60 * request.items.length + 100,
      temperature: 0,
    })) as { response?: unknown };
    return parseTriage(request, output.response);
  };
}
