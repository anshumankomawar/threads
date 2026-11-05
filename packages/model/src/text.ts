// Links in a message's text: `[[thread:<id>]]` links a conversation, `[[person:<id>]]` mentions someone.
const TOKEN = /\[\[(thread|person):([^\]\s]+)\]\]/g;

export const threadLink = (id: string): string => `[[thread:${id}]]`;
export const mention = (id: string): string => `[[person:${id}]]`;

export type TextPart = { text: string } | { thread: string } | { person: string };

export function splitText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push(match[1] === "thread" ? { thread: match[2] } : { person: match[2] });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

export const mentionsIn = (text: string): string[] =>
  [...text.matchAll(TOKEN)].filter((m) => m[1] === "person").map((m) => m[2]);

// The text with links as `#title` and mentions as `@name`.
export const plainText = (
  text: string,
  titleOf: (id: string) => string | undefined,
  nameOf: (id: string) => string | undefined,
): string =>
  text.replace(TOKEN, (_, kind: string, id: string) =>
    kind === "thread" ? `#${titleOf(id) ?? "conversation"}` : `@${nameOf(id) ?? "someone"}`,
  );
