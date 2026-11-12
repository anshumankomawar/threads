import MiniSearch from "minisearch";
import { Message, Thread } from "models";
import { plain } from "./components/ThreadView";
import { store } from "./session";
import { save, saved } from "./startup";

// ⌘F: every thread you can see, found by its title, its description or anything said in it. The index lives in memory,
// so each keystroke answers within a frame, as in Alfred or Raycast; it's rebuilt only when what it covers changes, and
// built while the app is idle, so the first search doesn't wait for it.
type Doc = { id: string; threadId: string; title: string; text: string };
export type Found = { thread: Thread; snippet?: string; terms: string[] };

let index: MiniSearch<Doc> | undefined;
let builtFor = "";

// Messages are never edited, so their count and the threads' titles and descriptions tell when to rebuild.
function current(): MiniSearch<Doc> {
  const threads = store.all(Thread);
  const messages = store.all(Message);
  const key = `${messages.length}\n${threads.map((t) => `${t.id}${t.title}${t.description ?? ""}`).join("\n")}`;
  if (index && key === builtFor) return index;
  index = new MiniSearch<Doc>({
    fields: ["title", "text"],
    storeFields: ["threadId", "text"],
    searchOptions: {
      boost: { title: 3 },
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
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
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 100)}`;
}

// Fresher threads rank a little higher, as a launcher ranks what you used last.
const freshness = (t: Thread): number =>
  1 + 0.5 / (1 + (Date.now() - t.updatedAt.getTime()) / 86_400_000);

// What you opened for a query comes first the next time you type it, as in Alfred.
const PICKS = "find-picks";
let picks = saved<Record<string, string>>(PICKS, {});
export function picked(query: string, thread: Thread): void {
  const kept = Object.entries(picks).filter(([q]) => q !== query.toLowerCase());
  picks = Object.fromEntries([...kept.slice(-199), [query.toLowerCase(), thread.id]]);
  save(PICKS, picks);
}

// The threads that match, best first, each with where it matched; with nothing typed, the latest threads.
export function find(query: string): Found[] {
  if (query === "")
    return store
      .all(Thread)
      .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 8)
      .map((thread) => ({ thread, terms: [] }));
  const best = new Map<string, Found & { score: number }>();
  for (const hit of current().search(query)) {
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
