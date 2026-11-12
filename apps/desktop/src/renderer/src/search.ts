import MiniSearch from "minisearch";
import { createSignal } from "solid-js";
import { Message, Thread } from "models";
import { plain } from "./components/ThreadView";
import { searchApi, store } from "./session";
import { save, saved } from "./startup";

// ⌘F: every thread you can see, found by its title, its description or anything said in it. The index lives in memory,
// so each keystroke answers within a frame, as in Alfred or Raycast; it's rebuilt only when what it covers changes, and
// built while the app is idle, so the first search doesn't wait for it.
type Doc = { id: string; threadId: string; title: string; text: string };
export type Found = { thread: Thread; snippet?: string; terms: string[] };

let index: MiniSearch<Doc> | undefined;
let builtFor = "";

// Words too common to tell threads apart: they match nothing and are never highlighted, so "what was the" finds nothing
// by its words and leaves the question to Ask Arc and meaning.
const STOP = new Set(
  "a about after all also am an and any are as at be because been before but by can could did do does doing done for from had has have he her here him his how i if in into is it its just me my no not of on or our out over please she should so some than that the their them then there these they this those to too up us very was we were what when where which while who why will with would you your".split(
    " ",
  ),
);

// Messages are never edited, so their count and the threads' titles and descriptions tell when to rebuild.
function current(): MiniSearch<Doc> {
  const threads = store.all(Thread);
  const messages = store.all(Message);
  const key = `${messages.length}\n${threads.map((t) => `${t.id}${t.title}${t.description ?? ""}`).join("\n")}`;
  if (index && key === builtFor) return index;
  index = new MiniSearch<Doc>({
    fields: ["title", "text"],
    storeFields: ["threadId", "text"],
    processTerm: (term) => (STOP.has(term.toLowerCase()) ? null : term.toLowerCase()),
    searchOptions: {
      boost: { title: 3 },
      // Only the word you're still typing is a prefix; a typo is forgiven only in a long word ("hidra", not "what").
      prefix: (_term, at, terms) => at === terms.length - 1,
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      combineWith: "AND",
    },
  });
  index.addAll([
    ...threads.map((t) => ({
      id: t.id,
      threadId: t.id,
      title: t.title,
      text: t.description ?? "",
    })),
    ...messages.map((m) => ({ id: m.id, threadId: m.threadId, title: "", text: plain(m.body) })),
  ]);
  builtFor = key;
  return index;
}

// The words around the first match.
function excerpt(text: string, term: string): string {
  const start = Math.max(0, text.toLowerCase().indexOf(term) - 30);
  return text.slice(start, start + 100);
}

// Fresher threads rank a little higher, as a launcher ranks what you used last.
const freshness = (t: Thread): number =>
  1 + 0.5 / (1 + (Date.now() - t.updatedAt.getTime()) / 86_400_000);

// What you opened for a query comes first the next time you type it, as in Alfred; and the threads you've opened from
// ⌘F, latest first, are your recents until you clear them. Both are kept on this Mac.
const PICKS = "find-picks";
const RECENTS = "find-recents";
let picks = saved<Record<string, string>>(PICKS, {});
const [recents, setRecents] = createSignal(saved<string[]>(RECENTS, []));
const keepRecents = (ids: string[]): void => (setRecents(ids), save(RECENTS, ids));
export const clearRecents = (): void => keepRecents([]);
export const hasRecents = (): boolean => recents().length > 0;

export function picked(query: string, thread: Thread): void {
  keepRecents([thread.id, ...recents().filter((id) => id !== thread.id)].slice(0, 8));
  if (query === "") return;
  const kept = Object.entries(picks).filter(([q]) => q !== query.toLowerCase());
  picks = Object.fromEntries([...kept.slice(-199), [query.toLowerCase(), thread.id]]);
  save(PICKS, picks);
}

// The threads that match, best first, each with where it matched; with nothing typed, your recents, else the latest.
export function find(query: string): Found[] {
  if (query === "")
    return (
      hasRecents()
        ? recents().flatMap((id) => store.findById(Thread, id) ?? [])
        : store
            .all(Thread)
            .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .slice(0, 8)
    ).map((thread) => ({ thread, terms: [] }));
  const best = new Map<string, Found & { score: number }>();
  // Every word in one place, else any of them (a sentence rarely has all its words in one message).
  const all = current().search(query);
  for (const hit of all.length > 0 ? all : current().search(query, { combineWith: "OR" })) {
    const thread = store.findById(Thread, hit.threadId as string);
    if (!thread || (best.get(thread.id)?.score ?? 0) >= hit.score) continue;
    const inTitle = Object.values(hit.match).some((fields) => fields.includes("title"));
    const snippet = inTitle ? undefined : excerpt(hit.text as string, hit.terms[0]);
    best.set(thread.id, { thread, snippet, terms: hit.terms, score: hit.score });
  }
  const pick = picks[query.toLowerCase()];
  const rank = (f: Found & { score: number }): number =>
    f.thread.id === pick ? Infinity : f.score * freshness(f.thread);
  return [...best.values()].toSorted((a, b) => rank(b) - rank(a)).slice(0, 30);
}

void store.ready().then(() => requestIdleCallback(() => current()));

// Reciprocal rank fusion: each list adds weight / (60 + rank) to its threads, so a thread high in either ranks high and
// one in both higher still. A thread keeps what the first list found it by (its highlighted words).
export function fuse(lists: [Found[], number][]): Found[] {
  const scored = new Map<string, { found: Found; score: number }>();
  for (const [list, weight] of lists)
    list.forEach((found, rank) => {
      const seen = scored.get(found.thread.id);
      scored.set(found.thread.id, {
        found: seen?.found ?? found,
        score: (seen?.score ?? 0) + weight / (60 + rank),
      });
    });
  return [...scored.values()].toSorted((a, b) => b.score - a.score).map((s) => s.found);
}

// By meaning, from the API (Vectorize, apps/api/src/search.ts): threads near the query, each with the message that was
// nearest, best first. Each query is asked once; the app shows only threads it has.
const meanings = new Map<string, Promise<Found[]>>();
export function related(query: string): Promise<Found[]> {
  let found = meanings.get(query);
  if (found === undefined) {
    found = searchApi<{ hits: { threadId: string; messageId?: string }[] }>({ query }).then(
      ({ hits }) =>
        hits.flatMap(({ threadId, messageId }) => {
          const thread = store.findById(Thread, threadId);
          const message = messageId === undefined ? undefined : store.findById(Message, messageId);
          return thread
            ? [{ thread, snippet: message && plain(message.body).slice(0, 100), terms: [] }]
            : [];
        }),
    );
    found.catch(() => meanings.delete(query));
    meanings.set(query, found);
  }
  return found;
}

// Opening ⌘F wakes the workspace's search, so the first query doesn't wait for it.
export const warm = (): void => void searchApi({ query: "" }).catch(() => {});

// Ask Arc: an answer from the threads nearest the question, and the threads it used.
export type Answered = { answer: string; threads: Thread[] };
export const ask = (question: string): Promise<Answered> =>
  searchApi<{ answer: string; threadIds: string[] }>({ query: question, ask: true }).then(
    ({ answer, threadIds }) => ({
      answer,
      threads: threadIds.flatMap((id) => store.findById(Thread, id) ?? []),
    }),
  );
