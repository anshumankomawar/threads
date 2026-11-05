import {
  ClientModel,
  Computed,
  date,
  Ephemeral,
  Model,
  OneToMany,
  Property,
  Reference,
  type Collection,
} from "../src";

@ClientModel("User")
export class User extends Model {
  @Property() name!: string;
}

@ClientModel("Conversation", { syncGroup: (row) => [`team:${row.teamId as string}`] })
export class Conversation extends Model {
  @Property() title!: string;
  @Property({ enum: ["open", "resolved"], indexed: true }) state!: "open" | "resolved";
  @Property({ nullable: true, serializer: date }) dueAt?: Date;
  @Property({ indexed: true }) teamId!: string;
  @Reference(() => User, "ownedConversations", { nullable: true }) owner?: User;
  @OneToMany(() => Message, "conversation") messages!: Collection<Message>;
  @Ephemeral() typing?: boolean;
  declare ownerId?: string;

  @Computed get isOpen() {
    return this.state === "open";
  }
}

@ClientModel("Message")
export class Message extends Model {
  @Reference(() => Conversation, "messages") conversation!: Conversation;
  @Property() body!: string;
  declare conversationId: string;
}
