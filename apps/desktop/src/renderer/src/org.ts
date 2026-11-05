import type { Person } from "model";

export type OrgNode = { person: Person; reports: OrgNode[] };

// Who reports to whom. Anyone with no manager, or one who isn't in the data, sits at the top.
export function buildOrgTree(people: Person[]): OrgNode[] {
  const ids = new Set(people.map((person) => person.id));
  const node = (person: Person): OrgNode => ({
    person,
    reports: people.filter((other) => other.managerId === person.id).map(node),
  });
  return people.filter((person) => !ids.has(person.managerId ?? "")).map(node);
}

export function countUnder(node: OrgNode): number {
  return node.reports.reduce((total, report) => total + 1 + countUnder(report), 0);
}

// The managers above someone, nearest first, stopping on a loop.
export function chainAbove(people: Person[], personId: string): Person[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const chain: Person[] = [];
  let manager = byId.get(byId.get(personId)?.managerId ?? "");
  while (manager !== undefined && !chain.includes(manager)) {
    chain.push(manager);
    manager = byId.get(manager.managerId ?? "");
  }
  return chain;
}

// "L4 · PM", or nothing for people without org details.
export function orgDetails(person: Person): string {
  return [person.level, person.role].filter(Boolean).join(" · ").toUpperCase();
}
