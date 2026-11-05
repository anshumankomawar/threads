import { expect, test } from "vite-plus/test";
import type { ComposeRequest } from "models";
import { composePrompt, parseCompose } from "../src/compose.ts";

const request: ComposeRequest = {
  author: { id: "kk", name: "KK" },
  people: [
    { id: "anshu", name: "Anshu" },
    { id: "arjun", name: "Arjun" },
    { id: "kk", name: "KK" },
  ],
  text: "@anshu @arjun can you review this CR. @kk track it",
};

test("the prompt numbers the people and quotes the message", () => {
  expect(composePrompt(request)).toBe(
    "Written by KK.\n\nPeople:\n1. Anshu\n2. Arjun\n3. KK\n\nMessage:\n@anshu @arjun can you review this CR. @kk track it",
  );
});

test("answers map back to people, dropping unknown numbers, the author, and empty asks", () => {
  const draft = parseCompose(
    request,
    JSON.stringify({
      title: " Review the CR ",
      context: "",
      asks: [
        { people: [1, 2, 2, 9], text: "Can you review this CR?" },
        { people: [3], text: "Track it" },
        { people: [1], text: " " },
      ],
    }),
  );
  expect(draft).toEqual({
    title: "Review the CR",
    context: "",
    asks: [{ personIds: ["anshu", "arjun"], text: "Can you review this CR?" }],
  });
});
