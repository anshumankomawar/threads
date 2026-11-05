import { expect, test } from "vite-plus/test";
import { personFor } from "../src/auth.ts";

test("the invite list says who an email signs in as, whatever its case or spacing", () => {
  const invites = " Arjun@Example.com = arjun , anshu@example.com=anshu,broken";
  expect(personFor(invites, "ARJUN@example.com ")).toBe("arjun");
  expect(personFor(invites, "anshu@example.com")).toBe("anshu");
  expect(personFor(invites, "mallory@example.com")).toBeUndefined();
  expect(personFor(invites, "broken")).toBeUndefined();
  expect(personFor("", "arjun@example.com")).toBeUndefined();
});
