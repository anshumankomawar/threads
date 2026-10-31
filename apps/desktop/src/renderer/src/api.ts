import type { Entry, Person, Thread } from "model";
import type { NewThreadDraft } from "./components/NewThreadPalette";

// Where the app's data comes from: the shared workspace on the hosted API, or your local Worker (apps/api) with
// either an empty workspace for testing or the demo team.
export type DataSource = "cloudflare" | "local" | "sample";

export const SOURCE_LABELS: Record<DataSource, string> = {
  cloudflare: "Cloudflare",
  local: "Local",
  sample: "Sample",
};

const LOCAL_URL = "http://127.0.0.1:3030";
const HOSTED_URL = import.meta.env.VITE_API_URL;
const HOSTED_TOKEN = import.meta.env.VITE_API_TOKEN;

// Cloudflare is offered once apps/desktop/.env.local has the hosted URL and token.
export const CLOUDFLARE_AVAILABLE = Boolean(HOSTED_URL && HOSTED_TOKEN);

type Server = { url: string; token?: string; workspace: "local" | "sample" };

export function serverFor(source: DataSource): Server {
  if (source === "cloudflare" && HOSTED_URL)
    return { url: HOSTED_URL, token: HOSTED_TOKEN, workspace: "local" };
  return { url: LOCAL_URL, workspace: source === "sample" ? "sample" : "local" };
}

type ThreadEdits = Partial<
  Pick<Thread, "title" | "status" | "priority" | "dueAtMs" | "schedule">
> & { assignee?: string };

async function send<T>(server: Server, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      "X-Workspace": server.workspace,
      // So a freshly seeded workspace lays out "10 AM today" in your time zone.
      "X-UTC-Offset": String(-new Date().getTimezoneOffset()),
      ...(server.token === undefined ? {} : { Authorization: `Bearer ${server.token}` }),
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

// Requests against one data source, made as `me`.
export const createApi = (source: DataSource, me: Person) => {
  const server = serverFor(source);
  const request = <T>(method: string, path: string, body?: unknown): Promise<T> =>
    send<T>(server, method, path, body);
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
