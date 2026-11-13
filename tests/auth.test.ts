import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { world } from "./world";

test("a new account gets its own workspace and buckets, or joins the one that invited it", async () => {
  const { signUp } = world();
  const ada = await signUp("ada");
  expect(ada).toMatchObject({ email: "ada@acme.com", workspace: "ada's workspace" });
  expect(await ada.as.query(api.workspace.buckets)).toHaveLength(2);

  await ada.as.mutation(api.workspace.invite, { email: "Grace@acme.com" });
  const grace = await signUp("grace");
  const linus = await signUp("linus");
  expect(grace.workspaceId).toBe(ada.workspaceId);
  expect(linus.workspaceId).not.toBe(ada.workspaceId);
  expect(await ada.as.query(api.workspace.people)).toMatchObject([
    { name: "ada" },
    { name: "grace" },
  ]);
});

test("an invite moves someone who already has an account the next time they sign in", async () => {
  const { signUp } = world();
  const ada = await signUp("ada");
  const grace = await signUp("grace");
  await ada.as.mutation(api.workspace.invite, { email: grace.email });
  await grace.signIn();
  expect((await grace.as.query(api.workspace.me)).workspaceId).toBe(ada.workspaceId);
});

test("an email Google hasn't verified can't take an invite", async () => {
  const { signUp } = world();
  const ada = await signUp("ada");
  await ada.as.mutation(api.workspace.invite, { email: "grace@acme.com" });
  const grace = await signUp("grace", false);
  expect(grace).toMatchObject({ email: "" });
  expect(grace.workspaceId).not.toBe(ada.workspaceId);
});
