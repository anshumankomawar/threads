import { userInfo } from "node:os";
import { createApp } from "./app.ts";

// Seeded with the sample team, addressed to whoever runs it (the desktop app uses the same username).
export default createApp({ seed: { id: userInfo().username, name: "You" } });
