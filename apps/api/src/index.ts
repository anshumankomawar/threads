import { userInfo } from "node:os";
import { createApp } from "./app.ts";

// You are whoever runs it (the desktop app uses the same username): alone in "local", with the sample team in "sample".
export default createApp({ me: { id: userInfo().username, name: "You" } });
