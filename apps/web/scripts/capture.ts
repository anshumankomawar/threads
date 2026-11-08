// Captures the running Arc desktop app for the landing page, through Chrome's debugging protocol, which the app's
// Electron window serves in development (http://127.0.0.1:<port>/json). It photographs the page as it is: open the
// thread you want shown first.
//
//   vpx scripts/capture.ts [port] [out.png]    defaults: 9333, ./capture.png
import { writeFile } from "node:fs/promises";

const port = process.argv[2] ?? "9333";
const out = process.argv[3] ?? "capture.png";

type Target = { type: string; url: string; webSocketDebuggerUrl: string };
const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Target[];
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error(`No page on port ${port}: is the app running?`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let id = 0;
const send = <T>(method: string, params: object = {}): Promise<T> =>
  new Promise((resolve, reject) => {
    const mine = ++id;
    const listen = (event: MessageEvent): void => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: T;
        error?: { message: string };
      };
      if (message.id !== mine) return;
      socket.removeEventListener("message", listen);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result as T);
    };
    socket.addEventListener("message", listen);
    socket.send(JSON.stringify({ id: mine, method, params }));
  });

const { data } = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
await writeFile(out, Buffer.from(data, "base64"));
socket.close();
console.log(`${out} from ${page.url}`);
