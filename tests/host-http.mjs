/** Official host boot/serve evidence, NOT browser rendering or factory execution. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";
import {
  officialHostOptions,
  installOfficialPlugin,
  launchOfficialHost,
} from "../scripts/start-host-preview.mjs";

const options = await officialHostOptions({
  runtime: process.env.DSH_TEST_RUNTIME || ".research/runtime",
  home: process.env.DSH_TEST_HOME,
});
await mkdir("artifacts", { recursive: true });
await installOfficialPlugin(options);
const running = await launchOfficialHost(options);
try {
  const entry = await fetch(running.url, { redirect: "manual" });
  const cookies = entry.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  const root = new URL("/", running.url);
  const response =
    entry.status >= 300 && entry.status < 400
      ? await fetch(new URL(entry.headers.get("location"), running.url), {
          headers: { cookie: cookies },
        })
      : entry;
  const html = await response.text();
  if (response.status !== 200)
    throw new Error("Host HTML status " + response.status);
  if (!html.includes("dsh-canvas-workspace"))
    throw new Error("Canvas missing from official host boot graph");
  const bootScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((source) => source.includes("__DSH_BOOT__"));
  if (!bootScript) throw new Error("Boot script not found");
  const globals = { window: {} };
  vm.runInNewContext(bootScript, globals, { timeout: 1000 });
  const graph = globals.window.__DSH_BOOT__ ?? globals.__DSH_BOOT__;
  const entryRow = graph.entries.find(
    (entry) => entry.id === "dsh-canvas-workspace",
  );
  if (!entryRow?.rev) throw new Error("Plugin entry revision missing");
  const bundle = await fetch(new URL(entryRow.url, root), {
    headers: { cookie: cookies },
  });
  if (bundle.status !== 200)
    throw new Error("Plugin bundle HTTP status " + bundle.status);
  const code = await bundle.text();
  const builtClient = await readFile(
    resolve(options.projectRoot, "dist/client.js"),
    "utf8",
  );
  // The official asset route adds an empty statement and rewrites only the
  // trailing source-map URL. Compare every executable source byte otherwise.
  const withoutSourceMap = (source) =>
    source.replace(/\n\/\/# sourceMappingURL=[^\n]+\n?$/, "\n");
  const servedBody = withoutSourceMap(code).replace(/\n;\n?$/, "\n");
  if (servedBody !== withoutSourceMap(builtClient))
    throw new Error(
      "Served plugin executable source differs from current dist/client.js",
    );
  let registration;
  vm.runInNewContext(
    code,
    {
      window: {
        __ModuleLoader__: {
          load: (entry) => {
            registration = entry;
          },
        },
      },
    },
    { timeout: 1000 },
  );
  if (
    registration?.id !== "dsh-canvas-workspace" ||
    typeof registration.factory !== "function"
  ) {
    throw new Error("Incorrect official module registration");
  }
  // Do not substitute Node require or fake shared primitives for the browser's
  // module table: that cannot prove this factory works in the official web UI.
  const sharedModuleRequests = [
    ...new Set(
      [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
  if (!sharedModuleRequests.includes("@deepseek-ai/dsh-client-ui-primitives")) {
    throw new Error(
      "Current bundle must request the official shared UI primitives",
    );
  }
  const result = {
    version: options.version,
    isolatedTestHome: true,
    inheritedProviderCredentials: false,
    officialPluginInstall: true,
    hostStarted: true,
    hostHtmlStatus: response.status,
    pluginInBootGraph: true,
    pluginBundleStatus: bundle.status,
    bundleMatchesBuiltClientExceptSourceMapFooter: true,
    bundleSha256: createHash("sha256").update(builtClient).digest("hex"),
    servedBundleSha256: createHash("sha256").update(code).digest("hex"),
    officialModuleRegistrationValid: true,
    officialModuleFactoryExecuted: false,
    clientExportsVerified: false,
    sharedModuleRequests,
    browserRendered: false,
    modelRequestsSent: 0,
    limitation:
      "HTTP checks verify installation, boot graph, served bytes and registration only. Factory execution and UI rendering require the official browser shared-module table.",
  };
  await writeFile(
    `artifacts/host-http-${options.version}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  running.stop();
}
