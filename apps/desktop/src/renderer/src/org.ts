import type { Person } from "model";

export type OrgNode = { person: Person; reports: OrgNode[] };

// Who reports to whom. Anyone with no manager, or one who isn't in the data, sits at the top.
export function buildOrgTree(people: Person[]): OrgNode[] {
  const ids = new Set(people.map((person) => person.id));
  const node = (person: Person): OrgNode => ({
    person,
    reports: people.filter((candidate) => candidate.managerId === person.id).map(node),
  });
  return people
    .filter((person) => person.managerId === undefined || !ids.has(person.managerId))
    .map(node);
}

// Everyone under a node, at any depth.
export function countUnder(node: OrgNode): number {
  return node.reports.reduce((total, report) => total + 1 + countUnder(report), 0);
}

// The managers above someone, nearest first.
export function chainAbove(people: Person[], personId: string): Person[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const chain: Person[] = [];
  let managerId = byId.get(personId)?.managerId;
  while (managerId !== undefined && !chain.some((person) => person.id === managerId)) {
    const manager = byId.get(managerId);
    if (manager === undefined) break;
    chain.push(manager);
    managerId = manager.managerId;
  }
  return chain;
}

// "L4 · PM", or nothing for people without org details.
export function orgDetails(person: Person): string {
  return [person.level, person.role]
    .filter((detail): detail is string => detail !== undefined)
    .map((detail) => detail.toUpperCase())
    .join(" · ");
}
