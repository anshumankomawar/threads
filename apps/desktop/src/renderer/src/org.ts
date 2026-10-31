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
