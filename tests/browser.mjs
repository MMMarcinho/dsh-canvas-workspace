import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5199",
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Vite timeout")), 15000);
  server.stdout.on("data", (buf) => {
    if (String(buf).includes("5199")) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.once("exit", (code) => reject(new Error("Vite exit " + code)));
});
let browser;
try {
  await mkdir("artifacts", { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5199");
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "artifacts/canvas-overview.png",
    fullPage: true,
  });
  console.log(await page.locator("body").innerText());
  await writeFile(
    "artifacts/browser-initial.json",
    JSON.stringify({ errors }, null, 2),
  );
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
