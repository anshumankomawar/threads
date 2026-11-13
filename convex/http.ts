import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  pathPrefix: "/join/",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const link = `arc://join/${new URL(request.url).pathname
      .split("/")
      .pop()!
      .replace(/[^\w-]/g, "")}`;
    return new Response(
      `<!doctype html>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<title>Join on Arc</title>
<style>
  body { display: grid; place-content: center; height: 100vh; margin: 0; text-align: center;
    color: rgb(255 255 255 / 92%); background: #101010; font: 14px/1.45 -apple-system, sans-serif; }
  h1 { margin: 0; font: 300 36px/1.08 "Iowan Old Style", Georgia, serif; letter-spacing: -0.02em; }
  p { margin: 10px 0 0; color: rgb(255 255 255 / 62%); }
  a { color: inherit; }
</style>
<h1>You’re invited to Arc</h1>
<p><a href="${link}">Open Arc</a> to join. If it doesn’t open, paste this page’s address into Arc.</p>
<script>location.href = ${JSON.stringify(link)};</script>`,
      { headers: { "Content-Type": "text/html" } },
    );
  }),
});

export default http;
