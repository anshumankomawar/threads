import type { Person } from "model";

// The local user, as an author of messages.
export const me: Person = { id: window.user.username, name: "You" };
