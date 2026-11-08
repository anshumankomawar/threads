// The build's second half, as a Vite plugin: after the client build, it builds src/entry-server.tsx for the server,
// renders the page to HTML, inlines its CSS and its few lines of script (the theme toggle and the waitlist form), and
// writes that over the client build's index.html. The client build is then the finished static site: one HTML file
// that paints in a single request, its fonts and the field preloaded, which `cf build` takes as the Worker's assets.
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Plugin, ResolvedConfig } from "vite";

export function prerender(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "arc:prerender",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      // Only the client build renders; the server build this starts has its own (shorter) plugin list. The client
      // build's own output directory is where the Cloudflare plugin collects the Worker's assets from.
      if (this.environment.name !== "client" || process.env.ARC_PRERENDERING) return;
      const outDir = this.environment.config.build.outDir;
      const { build } = await import("vite");
      const serverDir = `${config.root}/.prerender`;
      process.env.ARC_PRERENDERING = "1";
      try {
        await build({
          root: config.root,
          configFile: config.configFile,
          logLevel: "warn",
          build: { ssr: "src/entry-server.tsx", outDir: serverDir, emptyOutDir: true },
        });
      } finally {
        delete process.env.ARC_PRERENDERING;
      }

      const { render, pageScript } = (await import(
        pathToFileURL(`${serverDir}/entry-server.js`).href
      )) as { render: () => string; pageScript: string };
      const assets = await readdir(`${serverDir}/assets`).catch(() => [] as string[]);
      const css = (
        await Promise.all(
          assets
            .filter((file) => file.endsWith(".css"))
            .map((file) => readFile(`${serverDir}/assets/${file}`, "utf8")),
        )
      ).join("\n");
      if (!css) throw new Error("The server build wrote no CSS: is the StyleX plugin running?");

      const template = await readFile(`${config.root}/index.html`, "utf8");
      const html = template
        .replace(/\s*<script type="module" src="\/src\/index.tsx"><\/script>/, "")
        .replace(
          "</head>",
          `    <style>${css.trim()}</style>\n    <script>${pageScript}</script>\n  </head>`,
        )
        .replace("<!--app-->", render());
      await writeFile(`${outDir}/index.html`, html);
      // The client build's own bundle isn't served: the page has no module script left.
      await rm(`${outDir}/assets`, { recursive: true, force: true });
      await rm(serverDir, { recursive: true, force: true });

      const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} kB`;
      config.logger.info(
        `prerendered index.html  ${kb(Buffer.byteLength(html))} (${kb(Buffer.byteLength(css))} CSS, ${kb(Buffer.byteLength(pageScript))} script)`,
      );
    },
  };
}
