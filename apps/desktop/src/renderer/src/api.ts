import type { Entry, Person, Thread } from "model";
import type { NewThreadDraft } from "./components/NewThreadPalette";

// The Hono API (apps/api): the local Worker by default, or the hosted one when VITE_API_URL is set.
export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3030";
const API_TOKEN = import.meta.env.VITE_API_TOKEN;

// "local" starts empty and holds what you create; "sample" is the demo team with their threads.
export type Workspace = "local" | "sample";

type ThreadEdits = Partial<
  Pick<Thread, "title" | "status" | "priority" | "dueAtMs" | "schedule">
> & { assignee?: string };

async function send<T>(
  workspace: Workspace,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "X-Workspace": workspace,
      ...(API_TOKEN === undefined ? {} : { Authorization: `Bearer ${API_TOKEN}` }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `${method} ${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// Requests against one workspace, made as `me`.
export const createApi = (workspace: Workspace, me: Person) => {
  const request = <T>(method: string, path: string, body?: unknown): Promise<T> =>
    send<T>(workspace, method, path, body);
  return {
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
};
