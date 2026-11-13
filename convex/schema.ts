import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    workspaceId: v.id("workspaces"),
  }).index("workspace", ["workspaceId"]),

  workspaces: defineTable({ name: v.string() }),

  invites: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
  }).index("email", ["email"]),

  groups: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    userIds: v.array(v.id("users")),
  }).index("workspace", ["workspaceId"]),

  threads: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    lastAuthorId: v.id("users"),
    lastBody: v.string(),
  }),

  messages: defineTable({
    workspaceId: v.id("workspaces"),
    threadId: v.id("threads"),
    authorId: v.id("users"),
    body: v.string(),
  })
    .index("thread", ["threadId"])
    .searchIndex("search", { searchField: "body", filterFields: ["workspaceId"] }),

  vectors: defineTable({
    workspaceId: v.id("workspaces"),
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    vector: v.array(v.float64()),
  }).vectorIndex("near", {
    vectorField: "vector",
    dimensions: 1024,
    filterFields: ["workspaceId"],
  }),

  members: defineTable({
    workspaceId: v.id("workspaces"),
    threadId: v.id("threads"),
    userId: v.id("users"),
    activeAt: v.number(),
    inbox: v.boolean(),
    unread: v.boolean(),
    bucketId: v.optional(v.id("buckets")),
  })
    .index("user", ["userId", "workspaceId", "activeAt"])
    .index("thread", ["threadId", "userId"]),

  buckets: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.string(),
  }).index("user", ["userId"]),
});
