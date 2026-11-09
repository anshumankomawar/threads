import type {
  ActionResponse,
  BootstrapEnd,
  BootstrapLine,
  DeltasResponse,
  Hello,
  MutateRequest,
  MutateResponse,
  ServerMessage,
} from "protocol";

// How a client reaches its server: `httpTransport` here, a fake network in the tests. Every read says which groups the
// client follows without being in them (`subscribed`).
export interface Transport {
  // Everything, or with `partial` only the rows of groups the client doesn't hold, plus every action after `after`.
  bootstrap(
    subscribed: string[],
    partial?: { holds: string[]; after: number },
  ): Promise<{ rows: BootstrapLine[]; end: BootstrapEnd }>;
  deltas(after: number, subscribed: string[]): Promise<DeltasResponse>;
  mutate(request: MutateRequest): Promise<MutateResponse>;
  action(name: string, args: unknown): Promise<ActionResponse>;
  // Opens the socket and sends `hello()` once it's open, and again on `hello()`; `onClose` fires once when it ends.
  connect(handlers: {
    hello: () => Hello;
    onMessage: (message: ServerMessage) => void;
    onClose: () => void;
  }): { close(): void; hello(): void };
}

// A request the server refused (400, 403, 404 for a workspace it doesn't have, 409, 413, 422: it never will take it): its transactions roll back. Anything
// else thrown is a network error, retried; that includes 401, 408 and 429, which say nothing about the edits (a token
// being refreshed, a slow or busy server), so the edits wait rather than being undone.
export class RejectedError extends Error {}

const REFUSED = new Set([400, 403, 404, 409, 413, 422]);

// The spec's endpoints over fetch and one WebSocket.
export function httpTransport({
  url,
  workspace,
  token,
}: {
  url: string;
  workspace: string;
  token: string;
}): Transport {
  async function request(path: string, body?: unknown): Promise<Response> {
    const response = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Workspace": workspace,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return response;
    const message = `${response.status} ${await response.text()}`;
    throw REFUSED.has(response.status) ? new RejectedError(message) : new Error(message);
  }
  const json = async <T>(path: string, body?: unknown): Promise<T> =>
    (await request(path, body)).json() as Promise<T>;

  return {
    async bootstrap(subscribed, partial) {
      const query = new URLSearchParams({ subscribed: subscribed.join(",") });
      if (partial) query.set("holds", partial.holds.join(","));
      if (partial) query.set("after", String(partial.after));
      const lines = (await (await request(`/sync/bootstrap?${query}`)).text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const end: BootstrapEnd = lines.pop();
      return { rows: lines as BootstrapLine[], end };
    },
    deltas: (after, subscribed) =>
      json(
        `/sync/deltas?${new URLSearchParams({ after: String(after), subscribed: subscribed.join(",") })}`,
      ),
    mutate: (body) => json("/sync/mutate", body),
    action: (name, args) => json(`/actions/${name}`, args),
    connect({ hello, onMessage, onClose }) {
      const socket = new WebSocket(
        `${url.replace(/^http/, "ws")}/sync/socket?workspace=${encodeURIComponent(workspace)}`,
      );
      socket.addEventListener("open", () => socket.send(JSON.stringify(hello())));
      socket.addEventListener("message", (event) => onMessage(JSON.parse(event.data)));
      socket.addEventListener("close", onClose);
      return {
        close: () => socket.close(),
        hello: () => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(hello())),
      };
    },
  };
}
