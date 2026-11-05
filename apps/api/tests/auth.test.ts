import { expect, test } from "vite-plus/test";
import { parseInvites, personFor, type AuthEnv } from "../src/auth.ts";

const env = (invites: string): AuthEnv => ({ AUTH_DB: {} as D1Database, INVITES: invites });

test("the invite list maps each email to the person it signs in as", () => {
  const invites = parseInvites(
    " Arjun@Example.com = arjun , anshu@example.com=anshu,broken, =nobody",
  );
  expect([...invites]).toEqual([
    ["arjun@example.com", "arjun"],
    ["anshu@example.com", "anshu"],
  ]);
});

test("an email signs in as its person whatever its case, and an uninvited one as nobody", () => {
  const withInvites = env("arjun@example.com=arjun");
  expect(personFor(withInvites, "ARJUN@example.com ")).toBe("arjun");
  expect(personFor(withInvites, "mallory@example.com")).toBeUndefined();
  expect(personFor(env(""), "arjun@example.com")).toBeUndefined();
});
