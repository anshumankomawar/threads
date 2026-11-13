import googleTest from "@convex-dev/auth/components/google/test";
import authTest from "@convex-dev/auth/test";
import { convexTest } from "convex-test";
import { createFunctionHandle } from "convex/server";
import { api, components, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const MONTH = 30 * 24 * 60 * 60;

export function world() {
  const t = convexTest(schema, modules);
  authTest.registerCore(t);
  googleTest.registerGoogleOauth(t);

  const signIn = async (name: string) => {
    const tokens = await t.run(async (ctx) =>
      ctx.runMutation(components.auth.public._internal_dangerous_signUp, {
        claims: {
          method: "google",
          profile: { id: name, name, email: `${name}@acme.com`, emailVerified: true },
        },
        componentPath: "authGoogle",
        accessTokenTtlSeconds: 60,
        refreshInactivityTimeoutSeconds: MONTH,
        sessionMaxLifetimeSeconds: MONTH,
        createUserHandle: await createFunctionHandle(internal.auth.createUser),
      }),
    );
    return t.withIdentity(authTest.sessionIdentity(tokens));
  };
  const signUp = async (name: string, host?: { as: Awaited<ReturnType<typeof signIn>> }) => {
    const as = await signIn(name);
    if (host)
      await as.mutation(api.workspace.join, {
        link: await host.as.mutation(api.workspace.inviteLink),
      });
    else await as.mutation(api.workspace.create, { name: `${name}'s workspace` });
    return { ...(await as.query(api.workspace.me)), as };
  };
  return { t, signIn, signUp };
}
