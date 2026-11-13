const TOKEN = /\[\[(person|group):(\w+)\]\]/g;

type Part = string | { kind: "person" | "group"; id: string };

export const personToken = (id: string) => `[[person:${id}]]`;
export const groupToken = (id: string) => `[[group:${id}]]`;

export function parts(body: string): Part[] {
  const found: Part[] = [];
  let at = 0;
  for (const match of body.matchAll(TOKEN)) {
    if (match.index > at) found.push(body.slice(at, match.index));
    found.push({ kind: match[1] as "person" | "group", id: match[2] });
    at = match.index + match[0].length;
  }
  if (at < body.length) found.push(body.slice(at));
  return found;
}

export const mentions = (body: string, kind: "person" | "group") =>
  parts(body).flatMap((part) => (typeof part !== "string" && part.kind === kind ? [part.id] : []));

export const plain = (body: string, name: (kind: "person" | "group", id: string) => string) =>
  parts(body)
    .map((part) => (typeof part === "string" ? part : `@${name(part.kind, part.id)}`))
    .join("");

export const titleOf = (body: string) =>
  body.replace(TOKEN, "").trim().split("\n")[0].replace(/\s+/g, " ").slice(0, 80) || "New thread";
