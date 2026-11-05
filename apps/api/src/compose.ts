// Writing a new thread in one go: the app sends what you typed ("@Anshu @Arjun can you review this CR. @Ganesh can
// you also track this") and the model drafts the thread from it: a title, any context that isn't an ask, and each
// person's own ask. The app previews the draft while you type and makes the thread from it with ordinary
// transactions, so this reads nothing and writes nothing.

import type { ComposeDraft, ComposeRequest } from "models";

export type Compose = (request: ComposeRequest) => Promise<ComposeDraft>;

// Llama 3.1 8B: a few times quicker than the 70B that sorts inboxes, which matters for a preview drafted as you type.
// It mixes people up when given everyone, so the app sends only who's @mentioned.
const COMPOSE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

const SYSTEM = `You turn a message someone wrote into a work thread. The message mentions people with @ and asks them for things, sometimes different things of different people.

Return:
- title: what the thread is about, at most eight words, no names, no trailing period. For example "Review the billing CR".
- context: background the asks share, such as links or details, in the author's words. Leave it empty when the asks already say everything.
- asks: one per distinct request. Each lists the numbers of the people it's for and the request itself, written to them in the author's voice, without @names, for example "Can you review this CR?". People asked the same thing share one ask. Only use people from the list.`;

// People are numbered so the model never has to copy ids.
export function composePrompt(request: ComposeRequest): string {
  const people = request.people.map((person, index) => `${index + 1}. ${person.name}`).join("\n");
  return `Written by ${request.author.name}.\n\nPeople:\n${people}\n\nMessage:\n${request.text}`;
}

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    context: { type: "string" },
    asks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          people: { type: "array", items: { type: "integer" } },
          text: { type: "string" },
        },
        required: ["people", "text"],
      },
    },
  },
  required: ["title", "context", "asks"],
};

type Answer = {
  title?: unknown;
  context?: unknown;
  asks?: { people?: unknown; text?: unknown }[];
};

// The model's answer as a draft, keeping only people from the list and asks with someone to ask.
export function parseCompose(request: ComposeRequest, response: unknown): ComposeDraft {
  const answer = (typeof response === "string" ? JSON.parse(response) : response) as Answer;
  const text = (value: unknown, max: number): string =>
    typeof value === "string" ? value.trim().slice(0, max) : "";
  const asks = (Array.isArray(answer.asks) ? answer.asks : []).flatMap((ask) => {
    const personIds = (Array.isArray(ask.people) ? ask.people : []).flatMap((number) =>
      typeof number === "number" && request.people[number - 1] !== undefined
        ? [request.people[number - 1].id]
        : [],
    );
    const unique = [...new Set(personIds)].filter((id) => id !== request.author.id);
    const written = text(ask.text, 2000);
    const said = written.charAt(0).toUpperCase() + written.slice(1);
    return unique.length === 0 || said === "" ? [] : [{ personIds: unique, text: said }];
  });
  return { title: text(answer.title, 200), context: text(answer.context, 4000), asks };
}

export function workersAiComposer(ai: Ai): Compose {
  return async (request) => {
    const output = (await ai.run(COMPOSE_MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: composePrompt(request) },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 600,
      temperature: 0,
    })) as { response?: unknown };
    return parseCompose(request, output.response);
  };
}
