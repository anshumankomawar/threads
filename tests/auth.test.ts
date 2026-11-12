import { convexTest } from "convex-test";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { beforeAll, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  process.env.JWT_PRIVATE_KEY = await exportPKCS8(keys.privateKey);
  process.env.JWKS = JSON.stringify({
    keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }],
  });
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
});

async function signUp(t: ReturnType<typeof convexTest>, name: string) {
  const params = { flow: "signUp", name, email: `${name}@Acme.com`, password: "correct horse" };
  await t.action(api.auth.signIn, { provider: "password", params });
  const user = await t.run((ctx) =>
    ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("name"), name))
      .unique(),
  );
  return { ...user!, as: t.withIdentity({ subject: `${user!._id}|session` }) };
}

test("a new account gets its own workspace and buckets, or joins the one that invited it", async () => {
  const t = convexTest(schema, modules);
  const ada = await signUp(t, "ada");
  expect(ada.email).toBe("ada@acme.com");
  expect(await ada.as.query(api.workspace.buckets)).toHaveLength(2);

  await ada.as.mutation(api.workspace.invite, { email: "Grace@acme.com" });
  const grace = await signUp(t, "grace");
  const linus = await signUp(t, "linus");
  expect(grace.workspaceId).toBe(ada.workspaceId);
  expect(linus.workspaceId).not.toBe(ada.workspaceId);
  expect(await ada.as.query(api.workspace.people)).toMatchObject([
    { name: "ada" },
    { name: "grace" },
  ]);
});

test("the wrong password doesn't sign in", async () => {
  const t = convexTest(schema, modules);
  await signUp(t, "ada");
  const params = { flow: "signIn", email: "ada@acme.com", password: "wrong horse" };
  await expect(t.action(api.auth.signIn, { provider: "password", params })).rejects.toThrow();
});
