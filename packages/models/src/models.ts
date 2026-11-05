import {
  ClientModel,
  Computed,
  date,
  Model,
  OneToMany,
  Property,
  Reference,
  type Collection,
} from "sync";
import type { ComposeDraft } from "./compose";

export const STATES = ["open", "resolved", "blocked"] as const;
export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type State = (typeof STATES)[number];
export type Priority = (typeof PRIORITIES)[number];

@ClientModel("Workspace", { syncGroup: (row) => [`workspace:${row.id}`] })
export class Workspace extends Model {
  @Property() name!: string;
}

@ClientModel("User", { syncGroup: (row) => [`workspace:${String(row.workspaceId)}`] })
export class User extends Model {
  @Property() name!: string;
  @Property({ nullable: true }) email?: string;
  @Property({ nullable: true }) avatarUrl?: string;
  @Reference(() => Workspace, "users") workspace!: Workspace;
  @Property({ nullable: true }) level?: string;
  @Property({ nullable: true }) role?: string;
  @Reference(() => User, "reports", { nullable: true }) manager?: User;
  @OneToMany(() => User, "manager") reports!: Collection<User>;
  declare workspaceId: string;
  declare managerId?: string;
}

@ClientModel("Team", { syncGroup: (row) => [`workspace:${String(row.workspaceId)}`] })
export class Team extends Model {
  @Property() name!: string;
  @Reference(() => Workspace, "teams") workspace!: Workspace;
  @Property() memberIds!: string[];
  @OneToMany(() => Conversation, "team") conversations!: Collection<Conversation>;
  declare workspaceId: string;
}

@ClientModel("Conversation", { syncGroup: (row) => [`team:${String(row.teamId)}`] })
export class Conversation extends Model {
  @Property() title!: string;
  @Property({ enum: STATES, indexed: true }) state!: State;
  @Reference(() => User, "ownedConversations", { nullable: true }) owner?: User;
  @Reference(() => Team, "conversations") team!: Team;
  @Property({ nullable: true, serializer: date }) dueAt?: Date;
  @Property({ enum: PRIORITIES }) priority!: Priority;
  @Reference(() => Conversation, "branches", { nullable: true }) branchedFrom?: Conversation;
  // Made with /blocked: that conversation stays blocked until this one is resolved.
  @Reference(() => Conversation, "blockers", { nullable: true }) blocks?: Conversation;
  @OneToMany(() => Message, "conversation") messages!: Collection<Message>;
  @OneToMany(() => InboxItem, "conversation") inboxItems!: Collection<InboxItem>;
  @OneToMany(() => Conversation, "blocks") blockers!: Collection<Conversation>;
  declare ownerId?: string;
  declare teamId: string;
  declare branchedFromId?: string;
  declare blocksId?: string;

  @Computed get isOpen() {
    return this.state !== "resolved";
  }
}

// Created once, never edited. `toIds` is who it was sent to (none: a note); `teamId` is its conversation's, so the row
// knows its sync group.
@ClientModel("Message", { syncGroup: (row) => [`team:${String(row.teamId)}`] })
export class Message extends Model {
  @Reference(() => Conversation, "messages") conversation!: Conversation;
  @Reference(() => User, "messages") author!: User;
  @Property() body!: string;
  @Property() toIds!: string[];
  @Property() teamId!: string;
  declare conversationId: string;
  declare authorId: string;
}

// One person's place for a conversation in their inbox: which of their buckets it's in, done, snoozed, last seen.
@ClientModel("InboxItem", { syncGroup: (row) => [`user:${String(row.userId)}`] })
export class InboxItem extends Model {
  @Reference(() => User, "inboxItems") user!: User;
  @Reference(() => Conversation, "inboxItems") conversation!: Conversation;
  @Reference(() => Bucket, "items", { nullable: true }) bucket?: Bucket;
  @Property({ nullable: true, serializer: date }) doneAt?: Date;
  @Property({ nullable: true, serializer: date }) snoozedUntil?: Date;
  @Property({ nullable: true, serializer: date }) seenAt?: Date;
  // Why the model sorted it where it is; `manual` when you placed it yourself.
  @Property({ nullable: true }) reason?: string;
  @Property() manual!: boolean;
  declare userId: string;
  declare conversationId: string;
  declare bucketId?: string;
}

// One of a person's inbox buckets: the model sorts their inbox into them by description.
@ClientModel("Bucket", { syncGroup: (row) => [`user:${String(row.userId)}`] })
export class Bucket extends Model {
  @Reference(() => User, "buckets") user!: User;
  @Property() name!: string;
  @Property() description!: string;
  @Property() position!: number;
  @OneToMany(() => InboxItem, "bucket") items!: Collection<InboxItem>;
  declare userId: string;
}

// An unsent ⌘⇧N message: what was typed, and the model's draft of it.
@ClientModel("Draft", { syncGroup: (row) => [`user:${String(row.userId)}`] })
export class Draft extends Model {
  @Reference(() => User, "drafts") user!: User;
  @Property() text!: string;
  @Property({ nullable: true }) draft?: ComposeDraft;
  declare userId: string;
}
