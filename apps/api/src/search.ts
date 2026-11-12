import type { Row } from "protocol";
import { plainText } from "models";
import type { Reader, Session, SyncServer } from "server";
import { readAll } from "./triage.ts";

// Search by meaning (⌘F's Related) and questions answered from threads (Ask Arc). Each thread's title and description,
// and each message under its thread's title, is embedded with Workers AI and kept in Vectorize. After every change the
// indexer embeds what's new or changed and drops what's gone, remembering what it holds in the workspace's own SQLite.
// A query is embedded the same way, and the nearest vectors are narrowed to the threads the asker may see, by the filter
// sync uses (`readAll` as their session). Asking hands those threads to an LLM, which answers from them alone and says
// which it used: retrieval-augmented generation.

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const ANSWER_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const BATCH = 50;
const RETRY_MS = 60_000;
// Nearest isn't always near: below this cosine similarity a vector says nothing about the query.
const MIN_SCORE = 0.5;
const MAX_TEXT = 2000;

type Doc = { id: string; threadId: string; text: string };
export type Hit = { threadId: string; messageId?: string };
export type Answer = { answer: string; threadIds: string[] };

// A row's field as text ("" when it isn't any).
const str = (value: unknown): string => (typeof value === "string" ? value : "");

// Text with its links and mentions as words ("#Launch plan", "@Nora").
const plainOf =
  (db: Reader) =>
  (text: unknown): string => {
    const field = (model: string, key: string) => (id: string) => str(db.get(model, id)?.[key]);
    return plainText(
      str(text),
      field("Thread", "title"),
      field("User", "name"),
      field("Subspace", "name"),
    );
  };

// What's worth finding, as text: each thread's title and description, and each message under its thread's title.
function docs(db: Reader): Doc[] {
  const plain = plainOf(db);
  const threads = db.all("Thread");
  const titles = new Map(threads.map((t) => [t.id, str(t.title)]));
  return [
    ...threads.map((t) => ({
      id: t.id,
      threadId: t.id,
      text: `${str(t.title)}\n${plain(t.description)}`,
    })),
    ...db.all("Message").map((m) => ({
      id: m.id,
      threadId: str(m.threadId),
      text: `${titles.get(str(m.threadId))}: ${plain(m.body)}`,
    })),
  ].map((d) => ({ ...d, text: d.text.slice(0, MAX_TEXT) }));
}

// FNV-1a: only has to change when the text does.
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

async function embed(ai: Ai, texts: string[]): Promise<number[][]> {
  const { data } = (await ai.run(EMBEDDING_MODEL, { text: texts })) as { data: number[][] };
  return data;
}

const SYSTEM = `You answer a question about a team's work using only the threads given, each numbered. Answer in at most three short sentences, in plain words. If the threads don't answer the question, say so briefly. In "sources", list the numbers of the threads you used.`;
const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    sources: { type: "array", items: { type: "integer" } },
  },
  required: ["answer", "sources"],
};

// One workspace's vectors, under a namespace of its own: a key made once and kept with its data, so a workspace that
// starts over, or a developer's local one, never touches another's.
export class Search {
  readonly #server: SyncServer;
  readonly #ai: Ai;
  readonly #vectors: VectorizeIndex;
  readonly #sql: SqlStorage;
  readonly #key: string;
  readonly #onFailure: (retryAtMs: number) => void;
  #running: Promise<void> | undefined;
  #again = false;

  constructor(
    server: SyncServer,
    ai: Ai,
    vectors: VectorizeIndex,
    sql: SqlStorage,
    onFailure: (retryAtMs: number) => void,
  ) {
    this.#server = server;
    this.#ai = ai;
    this.#vectors = vectors;
    this.#sql = sql;
    this.#onFailure = onFailure;
    sql.exec("CREATE TABLE IF NOT EXISTS search_key (key TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS search_index (id TEXT PRIMARY KEY, hash TEXT NOT NULL)");
    const stored = sql.exec<{ key: string }>("SELECT key FROM search_key").toArray()[0]?.key;
    this.#key = stored ?? crypto.randomUUID().slice(0, 8);
    if (stored === undefined) sql.exec("INSERT INTO search_key (key) VALUES (?)", this.#key);
  }

  // Brings the vectors up to date. A kick while it's running runs another pass after it.
  index(): Promise<void> {
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
      const held = new Map(
        this.#sql
          .exec<{ id: string; hash: string }>("SELECT id, hash FROM search_index")
          .toArray()
          .map((r) => [r.id, r.hash]),
      );
      const all = docs(readAll(this.#server));
      const changed = all.filter((d) => held.get(d.id) !== hash(d.text));
      const ids = new Set(all.map((d) => d.id));
      const gone = [...held.keys()].filter((id) => !ids.has(id));
      try {
        for (let at = 0; at < changed.length; at += BATCH) {
          const batch = changed.slice(at, at + BATCH);
          const values = await embed(
            this.#ai,
            batch.map((d) => d.text),
          );
          await this.#vectors.upsert(
            batch.map((d, i) => ({
              id: `${this.#key}:${d.id}`,
              namespace: this.#key,
              values: values[i],
              metadata: { threadId: d.threadId },
            })),
          );
          for (const d of batch)
            this.#sql.exec(
              "INSERT OR REPLACE INTO search_index (id, hash) VALUES (?, ?)",
              d.id,
              hash(d.text),
            );
        }
        for (let at = 0; at < gone.length; at += 1000) {
          const batch = gone.slice(at, at + 1000);
          await this.#vectors.deleteByIds(batch.map((id) => `${this.#key}:${id}`));
          for (const id of batch) this.#sql.exec("DELETE FROM search_index WHERE id = ?", id);
        }
      } catch (error) {
        console.error("Indexing for search failed", error);
        this.#onFailure(Date.now() + RETRY_MS);
        return;
      }
    } while (this.#again);
  }

  // The threads nearest the query in meaning that the session may see, best first, each with the message that matched.
  async search(
    session: Session,
    query: string,
    db = readAll(this.#server, session),
  ): Promise<Hit[]> {
    const [vector] = await embed(this.#ai, [query.slice(0, MAX_TEXT)]);
    const { matches } = await this.#vectors.query(vector, {
      topK: 50,
      namespace: this.#key,
      returnMetadata: "all",
    });
    const hits = new Map<string, Hit>();
    for (const match of matches) {
      const threadId = str(match.metadata?.threadId);
      if (match.score < MIN_SCORE || hits.has(threadId) || db.get("Thread", threadId) === undefined)
        continue;
      const id = match.id.slice(this.#key.length + 1);
      hits.set(threadId, { threadId, messageId: id === threadId ? undefined : id });
    }
    return [...hits.values()].slice(0, 10);
  }

  // An answer from the threads nearest the question, read only from what the session may see.
  async ask(session: Session, question: string): Promise<Answer> {
    const db = readAll(this.#server, session);
    const threads = (await this.search(session, question, db))
      .slice(0, 5)
      .map((h) => db.get("Thread", h.threadId)!);
    if (threads.length === 0)
      return { answer: "Nothing in the threads you can see answers that.", threadIds: [] };
    const plain = plainOf(db);
    const nameOf = (id: unknown) => str(db.get("User", str(id))?.name) || "Someone";
    const told = (t: Row, n: number) =>
      [
        `[${n + 1}] ${str(t.title)}`,
        ...(t.description ? [plain(t.description)] : []),
        ...db
          .all("Message")
          .filter((m) => m.threadId === t.id)
          .slice(-30)
          .map((m) => `${nameOf(m.authorId)}: ${plain(m.body).slice(0, 500)}`),
      ].join("\n");
    const output = (await this.#ai.run(ANSWER_MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `${threads.map(told).join("\n\n")}\n\nQuestion: ${question.slice(0, 500)}`,
        },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 400,
      temperature: 0.2,
    })) as { response?: unknown };
    const parsed = (
      typeof output.response === "string" ? JSON.parse(output.response) : output.response
    ) as {
      answer?: string;
      sources?: number[];
    };
    return {
      answer: parsed.answer ?? "",
      threadIds: (parsed.sources ?? []).flatMap((n) => threads[n - 1]?.id ?? []),
    };
  }
}
