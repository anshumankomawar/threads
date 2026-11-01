import type { SyncMessage } from "model";
import { openIndexedDb } from "./sync/database";
import { SyncClient, type Transport } from "./sync/syncClient";
import { RejectedError } from "./sync/transactions";

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

// The sync engine's transport over HTTP and a WebSocket.
function httpTransport(server: Server): Transport {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: {
        "X-Workspace": server.workspace,
        // So a freshly seeded workspace lays out "10 AM today" in your time zone.
        "X-UTC-Offset": utcOffset(),
        ...(server.token === undefined ? {} : { Authorization: `Bearer ${server.token}` }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      const message = error ?? `${method} ${path} failed with ${response.status}`;
      // A refusal is final; a server error may pass, so it's retried like being offline.
      throw response.status < 500 ? new RejectedError(message) : new Error(message);
    }
    return response.json() as Promise<T>;
  };

  return {
    bootstrap: () => request("GET", "/sync/bootstrap"),
    deltas: (after) => request("GET", `/sync/deltas?after=${after}`),
    send: (batch) => request("POST", "/sync/transactions", batch),
    connect: ({ onOpen, onMessage, onClose }) => {
      // A browser WebSocket can't send headers, so these go in the query string.
      const query = new URLSearchParams({ workspace: server.workspace, utcOffset: utcOffset() });
      if (server.token !== undefined) query.set("token", server.token);
      const socket = new WebSocket(`${server.url.replace(/^http/, "ws")}/sync/ws?${query}`);
      let ping: ReturnType<typeof setInterval> | undefined;
      socket.onopen = () => {
        ping = setInterval(() => socket.send("ping"), PING_MS);
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
      return { close: () => socket.close() };
    },
  };
}

// A sync client for a data source, with its own local database.
export function createSyncClient(source: DataSource): SyncClient {
  return new SyncClient(httpTransport(serverFor(source)), () => openIndexedDb(`threads-${source}`));
}
