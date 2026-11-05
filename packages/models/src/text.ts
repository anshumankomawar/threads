// Links in a message's text: `[[thread:<id>]]` links a thread, `[[person:<id>]]` mentions someone, `[[label:<id>]]`
// mentions a group (a label with members). An activity line's `[[date:<ms>]]` is a date, in the reader's time zone.
const TOKEN = /\[\[(thread|person|label|date):([^\]\s]+)\]\]/g;

export const threadLink = (id: string): string => `[[thread:${id}]]`;
export const mention = (id: string): string => `[[person:${id}]]`;
export const groupMention = (id: string): string => `[[label:${id}]]`;
export const dateToken = (ms: number): string => `[[date:${ms}]]`;

type TextPart =
  | { text: string }
  | { thread: string }
  | { person: string }
  | { label: string }
  | { date: number };

export function splitText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    const [, kind, id] = match;
    parts.push(
      kind === "thread"
        ? { thread: id }
        : kind === "person"
          ? { person: id }
          : kind === "label"
            ? { label: id }
            : { date: Number(id) },
    );
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

const tokens = (text: string, kind: string): string[] =>
  [...text.matchAll(TOKEN)].filter((m) => m[1] === kind).map((m) => m[2]);
export const mentionsIn = (text: string): string[] => tokens(text, "person");
export const groupMentionsIn = (text: string): string[] => tokens(text, "label");

// The text with links as `#title` and mentions as `@name`.
export const plainText = (
  text: string,
  titleOf: (id: string) => string | undefined,
  nameOf: (id: string) => string | undefined,
  labelOf: (id: string) => string | undefined = () => undefined,
): string =>
  text.replace(TOKEN, (_, kind: string, id: string) =>
    kind === "thread"
      ? `#${titleOf(id) ?? "thread"}`
      : kind === "person"
        ? `@${nameOf(id) ?? "someone"}`
        : kind === "label"
          ? `@${labelOf(id) ?? "group"}`
          : new Date(Number(id)).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  );
