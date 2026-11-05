import type { Row } from "protocol";
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
const ROLES = ["admin", "member"] as const;
type State = (typeof STATES)[number];
type Priority = (typeof PRIORITIES)[number];
type Role = (typeof ROLES)[number];

const inWorkspace = (row: Row): string[] => [`workspace:${String(row.workspaceId)}`];

@ClientModel("Workspace", { syncGroup: (row) => [`workspace:${row.id}`] })
export class Workspace extends Model {
  @Property() name!: string;
}

// A person, seen in every workspace they're a member of. The server keeps `workspaceIds` from their memberships.
@ClientModel("User", {
  syncGroup: (row) => (row.workspaceIds as string[]).map((id) => `workspace:${id}`),
})
export class User extends Model {
  @Property() name!: string;
  @Property({ nullable: true }) email?: string;
  @Property({ nullable: true }) avatarUrl?: string;
  @Property() workspaceIds!: string[];
  @OneToMany(() => WorkspaceMember, "user") memberships!: Collection<WorkspaceMember>;
}

// A person's place in a workspace, and their role there.
@ClientModel("WorkspaceMember", { syncGroup: inWorkspace })
export class WorkspaceMember extends Model {
  @Reference(() => Workspace, "members") workspace!: Workspace;
  @Reference(() => User, "memberships") user!: User;
  @Property({ enum: ROLES }) role!: Role;
  declare workspaceId: string;
  declare userId: string;
}

@ClientModel("Label", { syncGroup: inWorkspace })
export class Label extends Model {
  @Reference(() => Workspace, "labels") workspace!: Workspace;
  @Property() name!: string;
  // Who's in it, so a label is also a group: @mentioning it assigns them all and puts the label on the thread.
  @Property() memberIds!: string[];
  declare workspaceId: string;
}

@ClientModel("Thread", { syncGroup: inWorkspace })
export class Thread extends Model {
  @Property() title!: string;
  @Property({ nullable: true }) description?: string;
  @Property({ enum: STATES, indexed: true }) state!: State;
  @Reference(() => User, "ownedThreads", { nullable: true }) owner?: User;
  @Reference(() => Workspace, "threads") workspace!: Workspace;
  @Property({ nullable: true, serializer: date }) dueAt?: Date;
  @Property({ enum: PRIORITIES }) priority!: Priority;
  @Property() labelIds!: string[];
  // Who's involved: an @mention adds someone, and it stays in their inbox until they mark it done or it's resolved.
  @Property() assigneeIds!: string[];
  @Reference(() => Thread, "branches", { nullable: true }) branchedFrom?: Thread;
  // Made with /blocked: that thread stays blocked until this one is resolved.
  @Reference(() => Thread, "blockers", { nullable: true }) blocks?: Thread;
  @OneToMany(() => Message, "thread") messages!: Collection<Message>;
  @OneToMany(() => InboxItem, "thread") inboxItems!: Collection<InboxItem>;
  @OneToMany(() => Thread, "blocks") blockers!: Collection<Thread>;
  @OneToMany(() => Activity, "thread") activity!: Collection<Activity>;
  declare ownerId?: string;
  declare workspaceId: string;
  declare branchedFromId?: string;
  declare blocksId?: string;

  @Computed get isOpen() {
    return this.state !== "resolved";
  }
}

// Created once, never edited. It carries its thread's `workspaceId` because a row computes its own sync group.
@ClientModel("Message", { syncGroup: inWorkspace })
export class Message extends Model {
  @Reference(() => Thread, "messages") thread!: Thread;
  @Reference(() => User, "messages") author!: User;
  @Property() body!: string;
  @Property() workspaceId!: string;
  declare threadId: string;
  declare authorId: string;
}

// A line in a thread saying what someone did to it. Only the server writes these, as the changes happen.
@ClientModel("Activity", { syncGroup: inWorkspace })
export class Activity extends Model {
  @Reference(() => Thread, "activity") thread!: Thread;
  @Reference(() => User, "activity", { nullable: true }) actor?: User;
  @Property() text!: string;
  @Property() workspaceId!: string;
  declare threadId: string;
  declare actorId?: string;
}

// One person's place for a thread in their inbox: which of their buckets it's in, done, snoozed, last seen.
@ClientModel("InboxItem", { syncGroup: (row) => [`user:${String(row.userId)}`] })
export class InboxItem extends Model {
  @Reference(() => User, "inboxItems") user!: User;
  @Reference(() => Thread, "inboxItems") thread!: Thread;
  @Reference(() => Bucket, "items", { nullable: true }) bucket?: Bucket;
  @Property({ nullable: true, serializer: date }) doneAt?: Date;
  @Property({ nullable: true, serializer: date }) snoozedUntil?: Date;
  @Property({ nullable: true, serializer: date }) seenAt?: Date;
  // Why the model sorted it where it is; `manual` when you placed it yourself.
  @Property({ nullable: true }) reason?: string;
  @Property() manual!: boolean;
  declare userId: string;
  declare threadId: string;
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
