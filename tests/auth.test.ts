import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { world } from "./world";

test("a new account has buckets and no workspace until it creates one", async () => {
  const { signIn } = world();
  const ada = await signIn("ada");
  expect(await ada.query(api.workspace.me)).not.toHaveProperty("workspaceId");
  await expect(ada.query(api.threads.list)).rejects.toThrow();

  await ada.mutation(api.workspace.create, { name: "Acme" });
  expect(await ada.query(api.workspace.me)).toMatchObject({ workspace: "Acme" });
  expect(await ada.query(api.workspace.buckets)).toMatchObject([
    { name: "Reviews" },
    { name: "Requests" },
    { name: "Social" },
  ]);
});

test("an invite link brings someone into its workspace, and nothing else does", async () => {
  const { signIn, signUp } = world();
  const ada = await signUp("ada");
  const grace = await signUp("grace", ada);
  expect(grace.workspaceId).toBe(ada.workspaceId);
  expect(await ada.as.query(api.workspace.people)).toMatchObject([
    { name: "ada" },
    { name: "grace" },
  ]);

  const linus = await signIn("linus");
  expect(await linus.mutation(api.workspace.join, { link: "arcthreads://join/guess" })).toBe(false);
  expect(await linus.mutation(api.workspace.join, { link: "" })).toBe(false);
  expect(await linus.query(api.workspace.me)).not.toHaveProperty("workspaceId");
});

test("someone in a workspace can't join or create another", async () => {
  const { signUp } = world();
  const ada = await signUp("ada");
  const eve = await signUp("eve");
  const link = await ada.as.mutation(api.workspace.inviteLink);
  await expect(eve.as.mutation(api.workspace.join, { link })).rejects.toThrow();
  await expect(eve.as.mutation(api.workspace.create, { name: "Other" })).rejects.toThrow();
});
