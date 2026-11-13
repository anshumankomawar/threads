import passwordTest from "@convex-dev/auth/components/password/test";
import usernameTest from "@convex-dev/auth/components/username/test";
import authTest from "@convex-dev/auth/test";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

export function world() {
  const t = convexTest(schema, modules);
  authTest.registerCore(t);
  passwordTest.registerPassword(t);
  usernameTest.registerUsername(t);

  const signUp = async (name: string) => {
    const result = await t.mutation(api.auth.signUp, {
      name,
      email: `${name}@Acme.com`,
      password: "correct horse battery staple",
    });
    if (result.status !== "complete") throw new Error(result.userError.error);
    const as = t.withIdentity(authTest.sessionIdentity(result.tokens));
    return { ...(await as.query(api.workspace.me)), as };
  };
  return { t, signUp };
}
