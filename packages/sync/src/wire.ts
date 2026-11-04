import type { BootstrapResponse, Models } from "./protocol";

// A bootstrap streams as lines, as LSE's does, so a large one never has to be one JSON value: each line one record
// (`{"m":<model>,"d":<record>}`), then a last line with where it stands and how many of each model it held, which the
// reader checks so a cut-off response is never taken for a complete one.

type MetaLine = Omit<BootstrapResponse, "models"> & { counts: Record<string, number> };

export function* encodeBootstrap<M extends Models>(
  response: BootstrapResponse<M>,
): Generator<string> {
  const { models, ...position } = response;
  const counts: Record<string, number> = {};
  for (const [modelName, records] of Object.entries(models)) {
    counts[modelName] = records?.length ?? 0;
    for (const data of records ?? []) yield `${JSON.stringify({ m: modelName, d: data })}\n`;
  }
  yield `${JSON.stringify({ meta: { ...position, counts } satisfies MetaLine })}\n`;
}

export function decodeBootstrap<M extends Models>(text: string): BootstrapResponse<M> {
  const models: Record<string, unknown[]> = {};
  let meta: MetaLine | undefined;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const parsed = JSON.parse(line) as { m: string; d: unknown } | { meta: MetaLine };
    if ("meta" in parsed) meta = parsed.meta;
    else (models[parsed.m] ??= []).push(parsed.d);
  }
  if (meta === undefined) throw new Error("The bootstrap ended early");
  const { counts, ...position } = meta;
  for (const [modelName, count] of Object.entries(counts)) {
    // A model with no records has no lines, but it's still there, empty.
    models[modelName] ??= [];
    if (models[modelName].length !== count)
      throw new Error(`The bootstrap is missing ${modelName} records`);
  }
  return { ...position, models } as BootstrapResponse<M>;
}
