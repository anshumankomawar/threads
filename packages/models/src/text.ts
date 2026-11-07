// Links in a message's text: `[[thread:<id>]]` links a thread, `[[person:<id>]]` mentions someone, `[[subspace:<id>]]`
// mentions everyone in a subspace. An activity line's `[[date:<ms>]]` is a date, in the reader's time zone.
const TOKEN = /\[\[(thread|person|subspace|date):([^\]\s]+)\]\]/g;

export const threadLink = (id: string): string => `[[thread:${id}]]`;
export const mention = (id: string): string => `[[person:${id}]]`;
export const subspaceMention = (id: string): string => `[[subspace:${id}]]`;
export const dateToken = (ms: number): string => `[[date:${ms}]]`;

type TextPart =
  | { text: string }
  | { thread: string }
  | { person: string }
  | { subspace: string }
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
          : kind === "subspace"
            ? { subspace: id }
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
export const subspaceMentionsIn = (text: string): string[] => tokens(text, "subspace");
export const threadLinksIn = (text: string): string[] => tokens(text, "thread");

// The text with links as `#title` and mentions as `@name`.
export const plainText = (
  text: string,
  titleOf: (id: string) => string | undefined,
  nameOf: (id: string) => string | undefined,
  subspaceOf: (id: string) => string | undefined = () => undefined,
): string =>
  text.replace(TOKEN, (_, kind: string, id: string) =>
    kind === "thread"
      ? `#${titleOf(id) ?? "thread"}`
      : kind === "person"
        ? `@${nameOf(id) ?? "someone"}`
        : kind === "subspace"
          ? `@${subspaceOf(id) ?? "subspace"}`
          : new Date(Number(id)).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  );
