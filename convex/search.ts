import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { membership, query } from "./functions";
import { plain } from "./text";

const NEAR = 0.35;

async function embed(input: string, input_type: "document" | "query"): Promise<number[]> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-4-lite", input, input_type }),
  });
  if (!response.ok) throw new Error(`Voyage answered ${response.status}`);
  return (await response.json()).data[0].embedding;
}

export const source = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message) return null;
    const { title } = (await ctx.db.get(message.threadId))!;
    const { name } = (await ctx.db.get(message.authorId))!;
    const { workspaceId, threadId } = message;
    return {
      workspaceId,
      threadId,
      text: `${title}\n${name}: ${plain(message.body, (kind) => kind)}`,
    };
  },
});

export const store = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    vector: v.array(v.float64()),
  },
  handler: async (ctx, row) => void (await ctx.db.insert("vectors", row)),
});

export const index = internalAction({
  args: { messageId: v.id("messages"), attempt: v.optional(v.number()) },
  handler: async (ctx, { messageId, attempt = 1 }) => {
    if (!process.env.VOYAGE_API_KEY) return;
    const message = await ctx.runQuery(internal.search.source, { messageId });
    if (!message) return;
    const { text, ...row } = message;
    const vector = await embed(text, "document").catch(() => null);
    if (vector) await ctx.runMutation(internal.search.store, { ...row, messageId, vector });
    else if (attempt < 5)
      await ctx.scheduler.runAfter(60_000, internal.search.index, {
        messageId,
        attempt: attempt + 1,
      });
  },
});

export const visible = query({
  args: { ids: v.array(v.id("vectors")) },
  handler: async (ctx, { ids }) => {
    const found = await Promise.all(
      ids.map(async (id) => {
        const row = await ctx.db.get(id);
        if (row?.workspaceId !== ctx.me.workspaceId) return [];
        return membership(ctx, row.threadId).then(
          async () => [(await ctx.db.get(row.messageId))!],
          () => [],
        );
      }),
    );
    return found.flat();
  },
});

async function nearest(ctx: ActionCtx, text: string, floor: number): Promise<Doc<"messages">[]> {
  const { workspaceId } = await ctx.runQuery(api.workspace.me);
  if (!process.env.VOYAGE_API_KEY || !workspaceId) return [];
  const hits = await ctx.vectorSearch("vectors", "near", {
    vector: await embed(text, "query"),
    limit: 32,
    filter: (q) => q.eq("workspaceId", workspaceId),
  });
  return ctx.runQuery(api.search.visible, {
    ids: hits.filter((hit) => hit._score >= floor).map((hit) => hit._id),
  });
}

export const related = action({
  args: { text: v.string() },
  handler: (ctx, { text }) => nearest(ctx, text, NEAR),
});

export const ask = action({
  args: { question: v.string() },
  handler: async (ctx, { question }): Promise<string[] | null> => {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    const named = [
      ...(await ctx.runQuery(api.workspace.people)),
      ...(await ctx.runQuery(api.workspace.groups)),
    ];
    const names = new Map<string, string>(named.map((it) => [it._id, it.name]));
    const name = (id: string) => names.get(id) ?? "someone";
    const search = betaTool({
      name: "search",
      description:
        "Search the team's messages by words and by meaning. Returns messages, each with the id of the thread it is in. Call it again with other wording when the first results don't fit the request.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      run: async ({ query }) => {
        const hits = [
          ...(await ctx.runQuery(api.threads.search, { text: query })),
          ...(await nearest(ctx, query, 0).catch(() => [])),
        ];
        return JSON.stringify(
          hits.map(({ threadId, authorId, body }) => ({
            threadId,
            message: `${name(authorId)}: ${plain(body, (_kind, id) => name(id))}`,
          })),
        );
      },
    });
    const response = await new Anthropic().beta.messages.toolRunner({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      max_iterations: 6,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { threadIds: { type: "array", items: { type: "string" } } },
            required: ["threadIds"],
            additionalProperties: false,
          },
        },
      },
      system:
        "You find the threads in a team's messages that a request is about. Search, then list the ids of the threads that fit, best first. List none when nothing fits.",
      tools: [search],
      messages: [{ role: "user", content: question }],
    });
    const found = response.content.find((block) => block.type === "text");
    if (response.stop_reason !== "end_turn" || !found) return null;
    return JSON.parse(found.text).threadIds;
  },
});
