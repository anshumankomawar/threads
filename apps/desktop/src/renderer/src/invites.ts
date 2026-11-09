// Inviting people to your workspace, through the API's directory (apps/api/src/directory.ts). Nothing is emailed: they
// see the workspace when they next log in with Google.
import { createSignal } from "solid-js";
import { account, server } from "./startup";

// The addresses in what's typed: commas, spaces or new lines between them.
export const addresses = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part));

// What's typed that isn't an address, to say so rather than leave it out unmentioned.
export const notAddresses = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part));

const path = (workspace: string): string => `/workspaces/${workspace}/invites`;

// Who's invited to this workspace and hasn't joined yet, once asked for.
const [pending, setPending] = createSignal<string[]>([]);
export const invited = pending;

export async function refreshInvites(): Promise<void> {
  if (!account) return;
  const { ok, body } = await window.threads.call(path(server.workspace));
  if (ok) setPending((body as { invited: string[] }).invited);
}

// Invites them to `workspace` (this one unless said); whether it worked.
export async function invite(
  emails: string[],
  workspace = account ? server.workspace : undefined,
): Promise<boolean> {
  if (workspace === undefined) return false;
  const { ok, body } = await window.threads.call(path(workspace), { emails });
  if (ok && workspace === server.workspace) setPending((body as { invited: string[] }).invited);
  return ok;
}
