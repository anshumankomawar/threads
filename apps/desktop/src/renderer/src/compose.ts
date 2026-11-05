import { GROUP_TARGET, groupTarget, type ComposeDraft, type Group, type Person } from "model";

// Someone or some group you can @mention. `id` is a person's id or `group:<id>`, which is also what a draft's asks list.
export type Target = { id: string; name: string; handle: string; group: Group | null };

const compact = (name: string): string => name.replaceAll(/\s+/g, "");
const MENTION = /@([\p{L}\p{N}_-]+)/gu;

// Everyone but you (by first name after `@`), then the groups that aren't archived (by name without spaces).
export function targetsFor(people: Person[], groups: Group[], me: Person): Target[] {
  return [
    ...people
      .filter((person) => person.id !== me.id)
      .map((p) => ({ id: p.id, name: p.name, handle: p.name.split(" ")[0], group: null })),
    ...groups
      .filter((group) => !group.archived)
      .map((g) => ({ id: groupTarget(g.id), name: g.name, handle: compact(g.name), group: g })),
  ];
}

// Everyone and every group `@`mentioned, by handle or full name without spaces, in order.
export function mentionedTargets(text: string, targets: Target[]): Target[] {
  const found = new Set<Target>();
  for (const [, name] of text.matchAll(MENTION)) {
    const key = name.toLowerCase();
    const target = targets.find(
      (t) => t.handle.toLowerCase() === key || compact(t.name).toLowerCase() === key,
    );
    if (target !== undefined) found.add(target);
  }
  return [...found];
}

// Who an ask goes to: its people, and each group's members as they are now, once each and never you.
export function recipientsOf(
  targetIds: string[],
  people: Person[],
  groups: Group[],
  me: Person,
): Person[] {
  const ids = targetIds.flatMap((id) =>
    id.startsWith(GROUP_TARGET)
      ? (groups.find((g) => groupTarget(g.id) === id)?.memberIds ?? [])
      : [id],
  );
  return [...new Set(ids)]
    .filter((id) => id !== me.id)
    .flatMap((id) => people.find((person) => person.id === id) ?? []);
}

// Without the model: the first sentence, mentions taken out, as the title, and one ask for everyone mentioned.
export function plainDraft(text: string, targets: Target[]): ComposeDraft {
  const rest = text.replaceAll(MENTION, "").replaceAll(/\s+/g, " ").trim();
  const title = (rest.split(/(?<=[.?!])\s/)[0] ?? "").replace(/[.?!]+$/, "").slice(0, 80);
  const asked = mentionedTargets(text, targets);
  return {
    title,
    context: "",
    asks: asked.length === 0 ? [] : [{ personIds: asked.map((target) => target.id), text: rest }],
  };
}
