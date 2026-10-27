import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5203",
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Vite timeout")), 15000);
  server.stdout.on("data", (buffer) => {
    if (String(buffer).includes("5203")) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.once("exit", (code) => reject(new Error(`Vite exit ${code}`)));
});

let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/chromium"),
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5203/tests/iui-boolean.html");
  const fleet = page.locator("[data-canvas-iui-root]").nth(0);
  const totals = page.locator("[data-canvas-iui-root]").nth(1);
  await fleet.getByText("机队控制台").waitFor();
  assert.equal(
    await page.locator('.chat-iui-fallback[data-iui-state="error"]').count(),
    0,
  );
  assert.match(await totals.locator(".iui-root").innerText(), /选中 0 台/);
  await fleet.locator('input[type="checkbox"]').nth(1).click();
  await page.waitForFunction(() =>
    document
      .querySelectorAll("[data-canvas-iui-root]")[1]
      ?.shadowRoot?.textContent?.includes("选中 1 台"),
  );
  await fleet.getByRole("button", { name: "启动" }).click();
  for (let i = 0; i < 3; i++)
    await fleet.getByRole("button", { name: "下一步" }).click();
  await page.waitForFunction(() =>
    document
      .querySelectorAll("[data-canvas-iui-root]")[1]
      ?.shadowRoot?.textContent?.includes("已上线 1 / 3"),
  );
  await fleet.locator('input[type="checkbox"]').nth(2).click();
  await fleet.getByRole("button", { name: "启动" }).click();
  await fleet.getByRole("button", { name: "失败" }).click();
  assert.match(await fleet.locator(".iui-root").innerText(), /失败/);
  await fleet.getByRole("button", { name: "重置" }).click();
  await page.waitForFunction(() =>
    document
      .querySelectorAll("[data-canvas-iui-root]")[1]
      ?.shadowRoot?.textContent?.includes("已上线 0 / 3"),
  );
  assert.match(await totals.locator(".iui-root").innerText(), /选中 2 台/);
  assert.deepEqual(errors, []);
  console.log(
    "legacy Boolean predicate, two IUI roots, each, checkbox and four setter actions: OK",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
