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

// How a client reaches its server: `httpTransport` here, a fake network in the tests.
export interface Transport {
  bootstrap(): Promise<{ rows: BootstrapLine[]; end: BootstrapEnd }>;
  deltas(after: number): Promise<DeltasResponse>;
  mutate(request: MutateRequest): Promise<MutateResponse>;
  action(name: string, args: unknown): Promise<ActionResponse>;
  // Opens the socket and sends `hello()` once it's open; `onClose` fires once when it ends, for any reason.
  connect(handlers: {
    hello: () => Hello;
    onMessage: (message: ServerMessage) => void;
    onClose: () => void;
  }): { close(): void };
}

// A request the server refused (4xx): its transaction rolls back. Anything else thrown is a network error: retried.
export class RejectedError extends Error {}

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
    throw response.status < 500 ? new RejectedError(message) : new Error(message);
  }
  const json = async <T>(path: string, body?: unknown): Promise<T> =>
    (await request(path, body)).json() as Promise<T>;

  return {
    async bootstrap() {
      const lines = (await (await request("/sync/bootstrap")).text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const end: BootstrapEnd = lines.pop();
      return { rows: lines as BootstrapLine[], end };
    },
    deltas: (after) => json(`/sync/deltas?after=${after}`),
    mutate: (body) => json("/sync/mutate", body),
    action: (name, args) => json(`/actions/${name}`, args),
    connect({ hello, onMessage, onClose }) {
      const socket = new WebSocket(
        `${url.replace(/^http/, "ws")}/sync/socket?workspace=${encodeURIComponent(workspace)}`,
      );
      socket.addEventListener("open", () => socket.send(JSON.stringify(hello())));
      socket.addEventListener("message", (event) => onMessage(JSON.parse(event.data)));
      socket.addEventListener("close", onClose);
      return { close: () => socket.close() };
    },
  };
}
