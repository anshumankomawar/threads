import { isDone, type Entry, type Person, type Thread } from "model";

// Conversations: threads of kind "conversation", started by @mentioning people in a reply. Each is with whoever
// started it and everyone mentioned in it (`attendees`), and closes on its own or when the thread it's in closes.

type Message = Extract<Entry, { kind: "message" }>;

// Whether someone is in a conversation: they started it, were brought in by a mention, or have written in it.
export function isIn(conversation: Thread, personId: string): boolean {
  return (
    conversation.requester.id === personId ||
    conversation.attendees.some((person) => person.id === personId) ||
    conversation.entries.some((entry) => entry.kind === "message" && entry.author.id === personId)
  );
}

// The newest message someone else wrote.
export function latestFromOthers(conversation: Thread, personId: string): Message | undefined {
  return conversation.entries.findLast(
    (entry): entry is Message => entry.kind === "message" && entry.author.id !== personId,
  );
}

// Whether someone has a message from somebody else they haven't read: they haven't opened the conversation or
// replied in it since.
export function isUnread(conversation: Thread, personId: string): boolean {
  const latest = latestFromOthers(conversation, personId);
  if (latest === undefined) return false;
  const replied =
    conversation.entries.findLast(
      (entry) => entry.kind === "message" && entry.author.id === personId,
    )?.createdAtMs ?? 0;
  return latest.createdAtMs > Math.max(conversation.seenBy[personId] ?? 0, replied);
}

export type Conversations = { unread: Thread[]; read: Thread[] };

// Your open conversations, newest activity first, split by whether there's something new from someone else. Reading
// or replying moves one to Read; a new message from someone else moves it back. Closed ones leave the list.
export function conversationsFor(threads: Thread[], me: Person): Conversations {
  const mine = threads
    .filter(
      (thread) => thread.kind === "conversation" && !isDone(thread.status) && isIn(thread, me.id),
    )
    .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
  return {
    unread: mine.filter((thread) => isUnread(thread, me.id)),
    read: mine.filter((thread) => !isUnread(thread, me.id)),
  };
}
