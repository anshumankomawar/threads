import type { SyncEngine, TriageRequest, TriageResult } from "./engine.ts";

// Sorts one batch of a person's threads into their buckets.
export type Classify = (request: TriageRequest) => Promise<TriageResult[]>;

// How many threads go to the model at once.
const CHUNK = 20;
// How long a thread the model failed on waits before it's tried again.
export const RETRY_MS = 60_000;

// Keeps every inbox sorted. After each change (and when the workspace loads) it asks the model about the threads
// that aren't sorted for whoever they're waiting on, and saves its choices as their own batch, so they reach clients
// like any other change. It runs one pass at a time; a kick while it's running runs another pass after it.
export class Triager {
  readonly #engine: SyncEngine;
  readonly #classify: Classify;
  readonly #now: () => number;
  readonly #onFailure: (retryAtMs: number) => void;
  // Threads the model failed on, and when, so a failing model isn't asked again on every change.
  readonly #failedAt = new Map<string, number>();
  #running: Promise<void> | undefined;
  #again = false;

  constructor(
    engine: SyncEngine,
    classify: Classify,
    {
      now = Date.now,
      onFailure = () => {},
    }: { now?: () => number; onFailure?: (retryAtMs: number) => void } = {},
  ) {
    this.#engine = engine;
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
      for (const request of this.#engine.triageRequests(skip))
        for (let start = 0; start < request.threads.length; start += CHUNK) {
          const chunk = { ...request, threads: request.threads.slice(start, start + CHUNK) };
          try {
            const results = await this.#classify(chunk);
            this.#engine.applyTriage(request.person.id, results);
            for (const thread of chunk.threads) this.#failedAt.delete(thread.id);
          } catch (error) {
            console.error("Sorting the inbox failed", error);
            for (const thread of chunk.threads) this.#failedAt.set(thread.id, this.#now());
            this.#onFailure(this.#now() + RETRY_MS);
          }
        }
    } while (this.#again);
  }
}

// Workers AI's Llama 3.3 70B, which answers in JSON to a schema. Its free daily allocation covers a team's inbox:
// each call is about 150 neurons, and threads are only sorted when they arrive, change hands or are retitled.
export const TRIAGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM = `You sort one person's work inbox into the buckets they defined. Each bucket has a name and a plain-language description of what belongs in it, written by them.

For every thread, pick the one bucket whose description fits it best. Put a thread in a catch-all bucket only when no other bucket fits. Follow the examples of threads they sorted themselves: they show what they mean by each bucket.

Also give a reason of at most eight words saying what the thread is about in a way that shows why it belongs there, for example "Customer locked out after Tuesday's deploy". Don't restate the bucket name.`;

// The prompt for one batch. Threads and buckets are numbered so the model never has to copy ids.
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
  const threads = request.threads
    .map(
      (thread, index) =>
        `[${index + 1}] ${thread.title}\nFrom: ${thread.from}${thread.text === "" ? "" : `\n${thread.text}`}`,
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

// Maps the model's numbered answer back to threads and buckets, dropping anything that doesn't point at one.
export function parseTriage(request: TriageRequest, answer: unknown): TriageResult[] {
  const parsed = (typeof answer === "string" ? JSON.parse(answer) : answer) as Answer;
  return (parsed.threads ?? []).flatMap((item) => {
    const thread = request.threads[Number(item.thread) - 1];
    const bucket = request.buckets[Number(item.bucket) - 1];
    if (thread === undefined || bucket === undefined) return [];
    return [
      {
        threadId: thread.id,
        bucketId: bucket.id,
        reason: typeof item.reason === "string" ? item.reason : "",
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
      max_tokens: 60 * request.threads.length + 100,
      temperature: 0,
    })) as { response?: unknown };
    return parseTriage(request, output.response);
  };
}
