import type { ComposeDraft, Person } from "model";

// Reading a message written in the new-message panel (⌘⇧N): who it @mentions, and a plain draft of the thread for when
// the model can't help.

// How a person is written after `@`: their first name.
export const handle = (person: Person): string => person.name.split(" ")[0];

// Everyone `@`mentioned in the text, by first name or full name without spaces, in order.
export function mentionedPeople(text: string, people: Person[]): Person[] {
  const found: Person[] = [];
  for (const [, name] of text.matchAll(/@([\p{L}\p{N}_-]+)/gu)) {
    const key = name.toLowerCase();
    const person = people.find(
      (candidate) =>
        handle(candidate).toLowerCase() === key ||
        candidate.name.replaceAll(" ", "").toLowerCase() === key ||
        candidate.id === key,
    );
    if (person !== undefined && !found.includes(person)) found.push(person);
  }
  return found;
}

// Without the model: the first sentence, mentions taken out, as the title, and one ask for everyone mentioned.
export function plainDraft(text: string, people: Person[], me: Person): ComposeDraft {
  const withoutMentions = text
    .replaceAll(/@[\p{L}\p{N}_-]+/gu, "")
    .replaceAll(/\s+/g, " ")
    .trim();
  const title = (withoutMentions.split(/(?<=[.?!])\s/)[0] ?? "")
    .replace(/[.?!]+$/, "")
    .slice(0, 80);
  const asked = mentionedPeople(text, people).filter((person) => person.id !== me.id);
  return {
    title,
    context: "",
    asks:
      asked.length === 0
        ? []
        : [{ personIds: asked.map((person) => person.id), text: withoutMentions }],
  };
}
