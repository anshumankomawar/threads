import { labelSlug, type Group, type Label, type Person, type Thread } from "model";
import { expect, test } from "vite-plus/test";
import {
  filterLabels,
  groupNoticesFor,
  groupsFor,
  NO_FILTER,
  selectableLabels,
  threadsWithLabel,
} from "../src/renderer/src/groups";

const me: Person = { id: "me", name: "You" };
const sam: Person = { id: "sam", name: "Sam Rivera" };
const kim: Person = { id: "kim", name: "Kim Lee" };

const DAY = 24 * 60 * 60_000;
const NOW = new Date(2026, 10, 2, 12).getTime();

function thread(id: string, fields: Partial<Thread> = {}): Thread {
  return {
    id,
    title: id,
    owner: me,
    assignees: [sam],
    status: "open",
    priority: "none",
    dueAtMs: null,
    effortHours: null,
    labelIds: [],
    triage: {},
    doneBy: {},
    snoozedUntil: {},
    branchedFromId: null,
    blocksId: null,
    seenBy: {},
    updatedAtMs: NOW,
    entries: [],
    ...fields,
  };
}

function group(id: string, name: string, fields: Partial<Group> = {}): Group {
  return {
    id,
    name,
    labelId: labelSlug(name),
    memberIds: [me.id],
    createdById: me.id,
    archived: false,
    activity: [],
    createdAtMs: NOW,
    updatedAtMs: NOW,
    ...fields,
  };
}

const label = (id: string, name: string, groupId: string | null = null): Label => ({
  id,
  name,
  groupId,
  createdById: null,
  createdAtMs: NOW,
});

const ids = (threads: Thread[]): string[] => threads.map((item) => item.id);

test("a label's threads are the ones carrying it, most recently active first", () => {
  const threads = [
    thread("older", { labelIds: ["billing"], updatedAtMs: NOW - DAY }),
    thread("newer", { labelIds: ["billing", "frontend"] }),
    thread("unrelated", { labelIds: ["frontend"] }),
  ];
  expect(ids(threadsWithLabel(threads, "billing"))).toEqual(["newer", "older"]);
});

test("closed threads show only when asked for, and archived ones never do", () => {
  const threads = [
    thread("open", { labelIds: ["billing"] }),
    thread("closed", { labelIds: ["billing"], status: "closed" }),
    thread("archived", { labelIds: ["billing"], status: "archived" }),
  ];
  expect(ids(threadsWithLabel(threads, "billing"))).toEqual(["open"]);
  expect(ids(threadsWithLabel(threads, "billing", { ...NO_FILTER, includeDone: true }))).toEqual([
    "open",
    "closed",
  ]);
});

test("every thread in the organization is the same list, unfiltered, archived ones put away", () => {
  const threads = [
    thread("billing", { labelIds: ["billing"] }),
    thread("none"),
    thread("old", { status: "archived" }),
  ];
  expect(ids(threadsWithLabel(threads, null))).toEqual(["billing", "none"]);
});

test("a label's threads narrow by person, who it's assigned to or who owns it, and by another label", () => {
  const threads = [
    thread("sams", { labelIds: ["billing"] }),
    thread("asked-by-kim", { labelIds: ["billing"], owner: kim, assignees: [me] }),
    thread("frontend", { labelIds: ["billing", "frontend"], assignees: [me] }),
  ];
  expect(ids(threadsWithLabel(threads, "billing", { ...NO_FILTER, personId: "sam" }))).toEqual([
    "sams",
  ]);
  expect(ids(threadsWithLabel(threads, "billing", { ...NO_FILTER, personId: "kim" }))).toEqual([
    "asked-by-kim",
  ]);
  expect(ids(threadsWithLabel(threads, "billing", { ...NO_FILTER, labelId: "frontend" }))).toEqual([
    "frontend",
  ]);
});

test("your groups come first, then everyone else's, by name, with archived ones aside", () => {
  const lists = groupsFor(
    [
      group("b", "Zebra"),
      group("a", "Apple"),
      group("c", "Other", { memberIds: [sam.id] }),
      group("d", "Old", { archived: true }),
    ],
    me,
  );
  expect(lists.mine.map((item) => item.name)).toEqual(["Apple", "Zebra"]);
  expect(lists.others.map((item) => item.name)).toEqual(["Other"]);
  expect(lists.archived.map((item) => item.name)).toEqual(["Old"]);
});

test("filter labels leave out groups' own, and archived groups' labels aren't offered", () => {
  const labels = [
    label("security", "Security"),
    label("billing", "Billing", "g1"),
    label("old", "Old", "g2"),
  ];
  const groups = [group("g1", "Billing"), group("g2", "Old", { archived: true })];
  expect(filterLabels(labels).map((item) => item.id)).toEqual(["security"]);
  expect(selectableLabels(labels, groups).map((item) => item.id)).toEqual(["billing", "security"]);
});

const addedMe = (atMs: number, actorId = sam.id) => ({
  actorId,
  text: "added You",
  targetIds: [me.id],
  atMs,
});

test("you hear when someone adds you to a group, as new until you've seen it", () => {
  const added = group("g1", "Billing", { activity: [addedMe(NOW - 60_000)] });
  const [notice] = groupNoticesFor([added], [me, sam], me, () => 0, NOW);
  expect(notice.actor.id).toBe("sam");
  expect(notice.text).toBe("added you to this group");
  expect(notice.unread).toBe(true);
  const [seen] = groupNoticesFor([added], [me, sam], me, () => NOW, NOW);
  expect(seen.unread).toBe(false);
});

test("you don't hear about adding yourself, old additions, or groups you've left or that are archived", () => {
  const notices = (item: Group) => groupNoticesFor([item], [me, sam], me, () => 0, NOW);
  expect(notices(group("g1", "A", { activity: [addedMe(NOW, me.id)] }))).toEqual([]);
  expect(notices(group("g2", "B", { activity: [addedMe(NOW - 8 * DAY)] }))).toEqual([]);
  expect(notices(group("g3", "C", { activity: [addedMe(NOW)], memberIds: [sam.id] }))).toEqual([]);
  expect(notices(group("g4", "D", { activity: [addedMe(NOW)], archived: true }))).toEqual([]);
});

test("label ids come from names, however they're written", () => {
  expect(labelSlug("Back-end")).toBe("back-end");
  expect(labelSlug("  BACK   end! ")).toBe("back-end");
  expect(labelSlug("Café Ops")).toBe("café-ops");
  expect(labelSlug("!!!")).toBe("");
});
