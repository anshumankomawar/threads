import type { Person } from "model";
import { expect, test } from "vite-plus/test";
import { buildOrgTree, chainAbove, countUnder, type OrgNode } from "../src/renderer/src/org";

const person = (id: string, managerId?: string): Person => ({ id, name: id, managerId });

// Each node as [id, reports], which is easier to read than the full tree.
const shape = (nodes: OrgNode[]): unknown[] =>
  nodes.map((node) => [node.person.id, shape(node.reports)]);

test("nests people under their managers, keeping their order", () => {
  const people = [
    person("you", "priya"),
    person("priya"),
    person("daniel", "maya"),
    person("jordan"),
    person("sam", "jordan"),
    person("maya", "priya"),
  ];
  expect(shape(buildOrgTree(people))).toEqual([
    [
      "priya",
      [
        ["you", []],
        ["maya", [["daniel", []]]],
      ],
    ],
    ["jordan", [["sam", []]]],
  ]);
});

test("people with no reporting lines are all at the top", () => {
  expect(shape(buildOrgTree([person("anshu"), person("arjun")]))).toEqual([
    ["anshu", []],
    ["arjun", []],
  ]);
});

test("someone whose manager isn't in the data stays visible at the top", () => {
  expect(shape(buildOrgTree([person("sam", "gone")]))).toEqual([["sam", []]]);
});

test("no people makes an empty tree", () => {
  expect(buildOrgTree([])).toEqual([]);
});

const ceo: Person = { id: "ceo", name: "Dana" };
const lead: Person = { id: "lead", name: "KK", managerId: "ceo" };
const anshu: Person = { id: "anshu", name: "Anshu", managerId: "lead" };
const arjun: Person = { id: "arjun", name: "Arjun", managerId: "lead" };
const team = [ceo, lead, anshu, arjun];

test("counts everyone under a manager, at any depth", () => {
  const [top] = buildOrgTree(team);
  expect(countUnder(top)).toBe(3);
  expect(countUnder(top.reports[0])).toBe(2);
});

test("the chain above someone runs nearest manager first, and stops on a loop", () => {
  expect(chainAbove(team, "anshu").map((person) => person.name)).toEqual(["KK", "Dana"]);
  expect(chainAbove(team, "ceo")).toEqual([]);
  const loop: Person[] = [
    { id: "a", name: "A", managerId: "b" },
    { id: "b", name: "B", managerId: "a" },
  ];
  expect(chainAbove(loop, "a").map((person) => person.name)).toEqual(["B", "A"]);
});
