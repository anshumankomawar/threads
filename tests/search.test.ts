import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { personToken } from "../convex/text";
import { world } from "./world";

const about = (text: string) => {
  const vector = Array(1024).fill(0);
  vector[text.includes("lunch") ? 0 : 1] = 1;
  return vector;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VOYAGE_API_KEY", "test");
  vi.stubGlobal("fetch", async (_url: string, { body }: { body: string }) =>
    Response.json({ data: [{ embedding: about(JSON.parse(body).input) }] }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("search by meaning finds only what is near, in threads the asker is in", async () => {
  const { t, signUp } = world();
  const ada = await signUp("ada");
  const grace = await signUp("grace", ada);
  const linus = await signUp("linus", ada);
  const eve = await signUp("eve");
  await ada.as.mutation(api.threads.start, { body: `${personToken(grace._id)} lunch at noon?` });
  await ada.as.mutation(api.threads.start, { body: `${personToken(grace._id)} the budget` });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const found = (who: typeof ada) => who.as.action(api.search.related, { text: "lunch" });
  expect(await found(grace)).toMatchObject([{ body: `${personToken(grace._id)} lunch at noon?` }]);
  expect(await found(linus)).toEqual([]);
  expect(await found(eve)).toEqual([]);
});
