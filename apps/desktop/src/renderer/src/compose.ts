import { GROUP_TARGET, groupTarget, type ComposeDraft, type Group, type Person } from "model";

// Reading a message written in the new-message panel (⌘⇧N): who and which groups it @mentions, and a plain draft of
// the thread for when the model can't help.

// Someone or some group you can @mention. `id` is a person's id or `group:<id>` (`mentionToken`), which is also what
// a draft's asks list.
export type Target = { id: string; name: string; handle: string; group: Group | null };

// Everyone but you, then the groups that aren't archived. A person goes by their first name after `@`, a group by its
// name without spaces.
export function targetsFor(people: Person[], groups: Group[], me: Person): Target[] {
  return [
    ...people
      .filter((person) => person.id !== me.id)
      .map((person) => ({
        id: person.id,
        name: person.name,
        handle: person.name.split(" ")[0],
        group: null,
      })),
    ...groups
      .filter((group) => !group.archived)
      .map((group) => ({
        id: groupTarget(group.id),
        name: group.name,
        handle: group.name.replaceAll(/\s+/g, ""),
        group,
      })),
  ];
}

// Everyone and every group `@`mentioned in the text, by handle or full name without spaces, in order.
export function mentionedTargets(text: string, targets: Target[]): Target[] {
  const found: Target[] = [];
  for (const [, name] of text.matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
    const key = name.toLowerCase();
    const target = targets.find(
      (candidate) =>
        candidate.handle.toLowerCase() === key ||
        candidate.name.replaceAll(/\s+/g, "").toLowerCase() === key,
    );
    if (target !== undefined && !found.includes(target)) found.push(target);
  }
  return found;
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
      ? (groups.find((group) => groupTarget(group.id) === id)?.memberIds ?? [])
      : [id],
  );
  return [...new Set(ids)]
    .filter((id) => id !== me.id)
    .flatMap((id) => people.find((person) => person.id === id) ?? []);
}

// Without the model: the first sentence, mentions taken out, as the title, and one ask for everyone mentioned.
export function plainDraft(text: string, targets: Target[]): ComposeDraft {
  const withoutMentions = text
    .replaceAll(/@[\p{L}\p{N}_-]+/gu, "")
    .replaceAll(/\s+/g, " ")
    .trim();
  const title = (withoutMentions.split(/(?<=[.?!])\s/)[0] ?? "")
    .replace(/[.?!]+$/, "")
    .slice(0, 80);
  const asked = mentionedTargets(text, targets);
  return {
    title,
    context: "",
    asks:
      asked.length === 0
        ? []
        : [{ personIds: asked.map((target) => target.id), text: withoutMentions }],
  };
}
