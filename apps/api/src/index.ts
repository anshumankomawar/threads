import { userInfo } from "node:os";
import { createApp } from "./app.ts";

// You are whoever runs it (the desktop app uses the same username), so the sample threads are addressed to you.
export default createApp({ me: { id: userInfo().username, name: "You" } });
