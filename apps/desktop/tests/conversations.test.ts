import type { Entry, Person, Thread } from "model";
import { expect, test } from "vite-plus/test";
import { conversationsFor } from "../src/renderer/src/conversations";

const me: Person = { id: "me", name: "You" };
const sam: Person = { id: "sam", name: "Sam Rivera" };
const kim: Person = { id: "kim", name: "Kim Lee" };
const NOW = new Date(2026, 10, 2, 12).getTime();

const message = (id: string, author: Person, text: string, atMs: number): Entry => ({
  kind: "message",
  id,
  author,
  text,
  createdAtMs: atMs,
});

function conversation(id: string, fields: Partial<Thread>): Thread {
  return {
    id,
    kind: "conversation",
    title: id,
    requester: sam,
    assignee: null,
    status: "open",
    priority: "none",
    dueAtMs: null,
    schedule: null,
    blocks: [],
    workedMinutes: 0,
    attendees: [sam, me],
    branchedFromId: "parent",
    blocksId: null,
    createdBy: sam,
    seenBy: {},
    effortHours: null,
    tagIds: [],
    updatedAtMs: NOW,
    entries: [message(`${id}-0`, sam, "[[person:me]] can you look?", NOW - 60_000)],
    ...fields,
  };
}

const ids = (threads: Thread[]): string[] => threads.map((thread) => thread.id);

test("a conversation is unread until you open it, and a new message from someone else makes it unread again", () => {
  const fresh = conversation("fresh", {});
  expect(ids(conversationsFor([fresh], me).unread)).toEqual(["fresh"]);

  const opened = conversation("opened", { seenBy: { me: NOW } });
  expect(ids(conversationsFor([opened], me).read)).toEqual(["opened"]);

  // Replying reads it and keeps it in the list: only messages from others count as new.
  const replied = conversation("replied", {});
  replied.entries.push(message("r", me, "On it", NOW));
  expect(conversationsFor([replied], me)).toEqual({ unread: [], read: [replied] });

  const answered = conversation("answered", { seenBy: { me: NOW - 30_000 } });
  answered.entries.push(message("a", sam, "Thanks!", NOW));
  expect(ids(conversationsFor([answered], me).unread)).toEqual(["answered"]);
});

test("only open conversations you're in are listed, newest activity first", () => {
  const older = conversation("older", { updatedAtMs: NOW - 1000 });
  const newer = conversation("newer", { updatedAtMs: NOW });
  const closed = conversation("closed", { status: "closed" });
  const others = conversation("others", { requester: kim, attendees: [kim, sam] });
  const response = { ...conversation("response", {}), kind: "response" as const };
  expect(ids(conversationsFor([older, newer, closed, others, response], me).unread)).toEqual([
    "newer",
    "older",
  ]);
});
