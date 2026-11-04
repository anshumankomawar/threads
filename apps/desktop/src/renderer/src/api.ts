import type {
  BuiltIn,
  ComposeDraft,
  ComposeRequest,
  ModelRecords,
  SyncMessage,
  TransactionInput,
} from "model";
import { openIndexedDb, RejectedError, UnauthorizedError } from "sync/client";
import { ThreadsClient, type ThreadsTransport } from "./sync/syncClient";

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

const utcOffset = (): string => String(-new Date().getTimezoneOffset());
const PING_MS = 25_000;

// Who the app talks to the server as. On the hosted API, the API token is an admin session; viewing as someone, the app
// trades it for that person's session token (POST /auth/session), so the server treats it as them: it acts only as
// them and sees only their sync groups. Locally there are no tokens, and `X-User` says who you are. With nobody to view
// as yet (the first load), it's the admin session.
function sessionFor(server: Server, viewerId: string | null) {
  let token: Promise<string | undefined> | undefined;
  const mint = async (): Promise<string | undefined> => {
    if (server.token === undefined || viewerId === null) return server.token;
    const response = await fetch(`${server.url}/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${server.token}` },
      body: JSON.stringify({ workspace: server.workspace, personId: viewerId }),
    });
    if (!response.ok) throw new Error(`Signing in failed with ${response.status}`);
    return ((await response.json()) as { token: string }).token;
  };
  return {
    // The bearer token to send, made once and kept.
    token: (): Promise<string | undefined> =>
      (token ??= mint().catch((error: unknown) => {
        token = undefined;
        throw error;
      })),
    // Forgets the token, after the server didn't take it (it expired), so the next request makes a new one.
    renew: (): void => void (token = undefined),
    user: viewerId,
  };
}

// The sync engine's transport over HTTP and a WebSocket, as one person (or the admin session).
function httpTransport(server: Server, viewerId: string | null): ThreadsTransport {
  const session = sessionFor(server, viewerId);
  const request = async <T>(
    method: string,
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<T> => {
    const token = await session.token();
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: {
        "X-Workspace": server.workspace,
        // So a freshly seeded workspace lays out "10 AM today" in your time zone.
        "X-UTC-Offset": utcOffset(),
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        ...(token === undefined && session.user !== null ? { "X-User": session.user } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401) {
      session.renew();
      if (!retried) return request(method, path, body, true);
      throw new UnauthorizedError("Signed out");
    }
    if (!response.ok) {
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      const message = error ?? `${method} ${path} failed with ${response.status}`;
      // A refusal is final; a server error may pass, so it's retried like being offline.
      throw response.status < 500 ? new RejectedError(message) : new Error(message);
    }
    return response.json() as Promise<T>;
  };

  return {
    bootstrap: (onlyGroups) =>
      request(
        "GET",
        `/sync/bootstrap${onlyGroups === undefined ? "" : `?groups=${encodeURIComponent(onlyGroups.join(","))}`}`,
      ),
    deltas: (after) => request("GET", `/sync/deltas?after=${after}`),
    send: (batch) => request("POST", "/sync/transactions", batch),
    // Wiping is an operator's tool, so it goes as the admin session.
    reset: () => adminRequest(server, "POST", "/sync/reset"),
    connect: ({ onOpen, onMessage, onClose }) => {
      let socket: WebSocket | undefined;
      let ping: ReturnType<typeof setInterval> | undefined;
      let closed = false;
      // A browser WebSocket can't send headers, so these go in the query string.
      void session.token().then(
        (token) => {
          if (closed) return;
          const query = new URLSearchParams({
            workspace: server.workspace,
            utcOffset: utcOffset(),
          });
          if (token !== undefined) query.set("token", token);
          else if (session.user !== null) query.set("user", session.user);
          socket = new WebSocket(`${server.url.replace(/^http/, "ws")}/sync/ws?${query}`);
          socket.onopen = () => {
            ping = setInterval(() => socket?.send("ping"), PING_MS);
            onOpen();
          };
          socket.onmessage = (event) => {
            if (event.data === "pong") return;
            onMessage(JSON.parse(String(event.data)) as SyncMessage);
          };
          socket.onclose = () => {
            clearInterval(ping);
            onClose();
          };
        },
        () => onClose(),
      );
      return {
        close: () => {
          closed = true;
          socket?.close();
        },
      };
    },
  };
}

// A request with the API token itself (the admin session), or none locally.
async function adminRequest(server: Server, method: string, path: string): Promise<unknown> {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      "X-Workspace": server.workspace,
      "X-UTC-Offset": utcOffset(),
      ...(server.token === undefined ? {} : { Authorization: `Bearer ${server.token}` }),
    },
  });
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}`);
  return response.json();
}

// The model's draft of a new thread from what you typed (POST /ai/compose). Not part of sync: it reads and writes
// nothing.
export async function composeDraft(
  source: DataSource,
  request: ComposeRequest,
  signal: AbortSignal,
): Promise<ComposeDraft> {
  const server = serverFor(source);
  const response = await fetch(`${server.url}/ai/compose`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(server.token === undefined ? {} : { Authorization: `Bearer ${server.token}` }),
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Drafting failed with ${response.status}`);
  return response.json() as Promise<ComposeDraft>;
}

// A sync client for a data source as one person (or, with nobody yet, the admin session), with its own local database,
// as Linear keeps one per user and workspace.
export function createSyncClient(source: DataSource, viewerId: string | null): ThreadsClient {
  return new ThreadsClient(httpTransport(serverFor(source), viewerId), () =>
    openIndexedDb<ModelRecords, TransactionInput | BuiltIn>(
      `threads-${source}-${viewerId ?? "admin"}`,
    ),
  );
}
