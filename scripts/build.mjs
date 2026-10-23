import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { readFile, mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
});
await build({
  entryPoints: ["src/client.tsx"],
  outfile: "dist/client.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: [
    "react",
    "react/jsx-runtime",
    "react-dom",
    "react-dom/client",
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-client-ui-primitives",
  ],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-canvas-workspace", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: "return module.exports; } });" },
  plugins: [
    {
      name: "raw-css",
      setup(b) {
        b.onResolve({ filter: /\.css\?raw$/ }, (args) => ({
          path: relative(
            process.cwd(),
            resolve(args.resolveDir, args.path.slice(0, -4)),
          ),
          namespace: "raw-css",
        }));
        b.onLoad({ filter: /.*/, namespace: "raw-css" }, async ({ path }) => ({
          contents: `export default ${JSON.stringify(await readFile(path, "utf8"))}`,
          loader: "js",
        }));
      },
    },
  ],
  define: { "process.env.NODE_ENV": '"production"' },
  sourcemap: true,
});
await viteBuild({ build: { outDir: "site", emptyOutDir: true } });
// A genuinely offline, single-file MOCK demo for opening without a dev server.
const { readdir, writeFile } = await import("node:fs/promises");
const assets = await readdir("site/assets");
const demoJs = await readFile(
  `site/assets/${assets.find((n) => n.endsWith(".js"))}`,
  "utf8",
);
const demoCss = await readFile(
  `site/assets/${assets.find((n) => n.endsWith(".css"))}`,
  "utf8",
);
await writeFile(
  "site/canvas-demo.html",
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Canvas Workspace · Offline Mock</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}${demoCss}</style></head><body><div id="root"></div><script type="module">${demoJs.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
);
