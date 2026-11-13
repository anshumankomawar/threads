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

  const session = (profile: { name: string; email: string; emailVerified: boolean }) => ({
    claims: { method: "google", profile: { id: profile.name, ...profile } },
    componentPath: "authGoogle",
    accessTokenTtlSeconds: 60,
    refreshInactivityTimeoutSeconds: MONTH,
    sessionMaxLifetimeSeconds: MONTH,
  });
  const signUp = async (name: string, emailVerified = true) => {
    const profile = { name, email: `${name}@Acme.com`, emailVerified };
    const tokens = await t.run(async (ctx) =>
      ctx.runMutation(components.auth.public._internal_dangerous_signUp, {
        ...session(profile),
        createUserHandle: await createFunctionHandle(internal.auth.createUser),
        onSignInHandle: await createFunctionHandle(internal.auth.onSignIn),
      }),
    );
    const as = t.withIdentity(authTest.sessionIdentity(tokens));
    const signIn = () =>
      t.run(async (ctx) =>
        ctx.runMutation(components.auth.public._internal_dangerous_signIn, {
          ...session(profile),
          userId: tokens.userId,
          onSignInHandle: await createFunctionHandle(internal.auth.onSignIn),
        }),
      );
    return { ...(await as.query(api.workspace.me)), as, signIn };
  };
  return { t, signUp };
}
