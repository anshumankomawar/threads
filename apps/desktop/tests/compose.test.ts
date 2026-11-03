import {
  groupMention,
  mention,
  plainThreadLinks,
  splitThreadLinks,
  withoutLeadingMentions,
  type Group,
  type Person,
} from "model";
import { expect, test } from "vite-plus/test";
import {
  mentionedTargets,
  plainDraft,
  recipientsOf,
  targetsFor,
} from "../src/renderer/src/compose";

const me: Person = { id: "me", name: "You" };
const sam: Person = { id: "sam", name: "Sam Rivera" };
const kim: Person = { id: "kim", name: "Kim Lee" };
const people = [me, sam, kim];

const group = (fields: Partial<Group>): Group => ({
  id: "g1",
  name: "Back End",
  labelId: "back-end",
  memberIds: ["me", "sam", "kim"],
  createdById: "me",
  archived: false,
  activity: [],
  createdAtMs: 0,
  updatedAtMs: 0,
  ...fields,
});
const backEnd = group({});
const groups = [backEnd, group({ id: "g2", name: "Old", archived: true })];
const targets = targetsFor(people, groups, me);

test("you can @ everyone but yourself, and groups that aren't archived, by their name without spaces", () => {
  expect(targets.map((target) => [target.id, target.handle])).toEqual([
    ["sam", "Sam"],
    ["kim", "Kim"],
    ["group:g1", "BackEnd"],
  ]);
  expect(mentionedTargets("@backend and @Sam, again @sam", targets).map((t) => t.id)).toEqual([
    "group:g1",
    "sam",
  ]);
});

test("a group is sent to its members as they are now, once each and never you", () => {
  expect(recipientsOf(["group:g1", "sam"], people, groups, me)).toEqual([sam, kim]);
  expect(recipientsOf(["group:missing"], people, groups, me)).toEqual([]);
});

test("without the model, everyone and every group mentioned shares one ask", () => {
  expect(plainDraft("@BackEnd @Sam can you look at the outage? Thanks", targets)).toEqual({
    title: "can you look at the outage",
    context: "",
    asks: [{ personIds: ["group:g1", "sam"], text: "can you look at the outage? Thanks" }],
  });
});

test("group mentions render, read as text and lead a message like person mentions", () => {
  const text = `${groupMention("g1")} ${mention("sam")} please`;
  expect(splitThreadLinks(text)).toEqual([
    { groupId: "g1" },
    { text: " " },
    { personId: "sam" },
    { text: " please" },
  ]);
  const names: Record<string, string> = { "group:g1": "Back End", sam: "Sam" };
  expect(
    plainThreadLinks(
      text,
      () => undefined,
      (id) => names[id],
    ),
  ).toBe("@Back End @Sam please");
  expect(withoutLeadingMentions(text)).toBe("please");
});
