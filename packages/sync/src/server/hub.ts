import type { ClientMessage, Models, SyncMessage, TransactionEnvelope } from "../protocol";
import { visibleActions, type Session, type SyncServer } from "./server";
import type { LoggedAction } from "./storage";

// A connected client, as `broadcast` needs it: its session, the groups it was last told about, and a way to reach it.
// In a Durable Object the session and groups live in the WebSocket's attachment, so they survive hibernation.
export type HubSocket = {
  session: Session;
  groups: string[];
  setGroups(groups: string[]): void;
  send(message: string): void;
};

const sameGroups = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((group) => b.includes(group));

function send(socket: HubSocket, message: unknown): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // A socket closing mid-send reconnects and catches up by sync id.
  }
}

// Sends a committed batch to every connected client, each seeing only its groups. Every client gets a packet, even an
// empty one, so its sync position keeps up. A client whose groups changed (it joined or left something) is told on the
// same packet, and loads or drops what that changes.
export function broadcast<M extends Models, T extends TransactionEnvelope>(
  server: SyncServer<M, T>,
  sockets: Iterable<HubSocket>,
  actions: LoggedAction<M>[],
): void {
  const lastSyncId = actions.at(-1)?.id ?? server.lastSyncId;
  for (const socket of sockets) {
    const groups = server.groupsOf(socket.session);
    const changed = !sameGroups(groups, socket.groups);
    if (changed) socket.setGroups(groups);
    send(socket, {
      type: "delta",
      lastSyncId,
      actions: visibleActions(actions, groups),
      ...(changed ? { syncGroups: groups } : {}),
    } satisfies SyncMessage<M>);
  }
}

// Handles a message a client sent on its socket: an ephemeral value goes to every other client that can see its
// record, and nowhere else. Anything else is ignored.
export function receive<M extends Models, T extends TransactionEnvelope>(
  server: SyncServer<M, T>,
  sockets: Iterable<HubSocket>,
  from: HubSocket,
  text: string,
): void {
  let message: ClientMessage;
  try {
    message = JSON.parse(text) as ClientMessage;
  } catch {
    return;
  }
  if (message?.type !== "ephemeral" || typeof message.key !== "string") return;
  const { modelName, modelId, key, value } = message;
  const outgoing = server.ephemeral(from.session, { modelName, modelId, key, value });
  if (outgoing === undefined) return;
  for (const socket of sockets)
    if (socket !== from && server.sees(socket.session, modelName, modelId)) send(socket, outgoing);
}
