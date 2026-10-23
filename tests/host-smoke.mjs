/** Optional real-browser smoke test. Run only where browser launch is allowed. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import {
  officialHostOptions,
  installOfficialPlugin,
  launchOfficialHost,
} from "../scripts/start-host-preview.mjs";

// Fresh per-version test profiles, filtered environment, no user provider keys.
// The helper rejects DSH_TEST_HOME values outside this project's .host-test.
const options = await officialHostOptions({
  runtime: process.env.DSH_TEST_RUNTIME || ".research/runtime",
  home: process.env.DSH_TEST_HOME,
});
await mkdir("artifacts", { recursive: true });
await installOfficialPlugin(options);
const running = await launchOfficialHost(options);
let browser;
try {
  // No fallback launcher, no browser-security bypass, and no automatic retry.
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    chromiumSandbox: true,
    env: options.env,
  });
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // This test never fills or submits the composer. The explicit query flag
  // additionally prevents canvas actions from using a live model adapter.
  const target = new URL(running.url);
  target.searchParams.set("canvasMock", "1");
  await page.goto(target.toString());
  const entry = page.getByRole("button", {
    name: "Canvas · 画布",
    exact: true,
  });
  await entry.waitFor({ timeout: 45000 });
  await entry.click();
  const canvas = page.getByTestId("chat-canvas");
  await canvas.waitFor({ state: "visible" });
  await canvas
    .getByLabel("向 Agent 输入", { exact: true })
    .waitFor({ state: "visible" });
  await canvas.locator(".chat-mode.mock").waitFor({ state: "visible" });
  const brand = canvas.locator(".chat-brand svg");
  if ((await brand.getAttribute("height")) !== "24") {
    throw new Error("Native 24px brand artwork did not mount");
  }
  const screenshot = `artifacts/dsh-${options.version}-canvas.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  if (errors.length) throw new Error("Browser errors: " + errors.join("\n"));
  const bundle = await readFile(resolve(options.projectRoot, "dist/client.js"));
  const result = {
    version: options.version,
    isolatedTestHome: true,
    inheritedProviderCredentials: false,
    officialPluginInstall: true,
    hostStarted: true,
    pluginLoaded: true,
    browserRendered: true,
    canvasMounted: true,
    nativeBrandMounted: true,
    canvasMock: true,
    promptSubmitted: false,
    modelRequestsSent: 0,
    bundleSha256: createHash("sha256").update(bundle).digest("hex"),
    screenshot,
    errors,
  };
  await writeFile(
    `artifacts/host-${options.version}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  running.stop();
}
