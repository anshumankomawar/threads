import type { Entry, Person, Thread } from "model";
import type { NewThreadDraft } from "./components/NewThreadPalette";
import { me } from "./me";

// The local Hono API (apps/api). It keeps everything in memory, seeded with the sample team.
const BASE = "http://127.0.0.1:3030";

type ThreadEdits = Partial<
  Pick<Thread, "title" | "status" | "priority" | "dueAtMs" | "schedule">
> & { assignee?: string };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `${method} ${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  people: (): Promise<Person[]> => request("GET", "/users"),
  threads: (): Promise<Thread[]> => request("GET", "/threads"),
  createThread: (draft: NewThreadDraft): Promise<Thread> =>
    request("POST", "/threads", {
      kind: draft.kind,
      creator: me.id,
      text: draft.text,
      assignee: draft.assignee?.id ?? null,
      invitees: draft.invitees.map((person) => person.id),
      schedule: draft.schedule,
    }),
  // The server records an activity line for each field that changes.
  editThread: (id: string, edits: ThreadEdits): Promise<Thread> =>
    request("PATCH", `/threads/${id}`, { actor: me.id, ...edits }),
  addEntry: (id: string, kind: Extract<Entry["kind"], "message" | "resolution">, text: string) =>
    request<Thread>("POST", `/threads/${id}/entries`, { kind, author: me.id, text }),
  setDecision: (id: string, entryId: string, decision: boolean): Promise<Thread> =>
    request("PATCH", `/threads/${id}/entries/${entryId}`, { decision }),
};
