import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
await mkdir("artifacts", { recursive: true });
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5212",
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite timeout")), 15000);
    server.stdout.on("data", (data) => {
      if (String(data).includes("5212")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Vite exit ${code}`));
    });
  });
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/chromium"),
    headless: true,
    args: ["--no-sandbox"],
  });
  for (const width of [1200, 560, 375])
    for (const native of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() =>
        localStorage.setItem(
          "dsh-canvas-conversation:v1:mock",
          JSON.stringify({
            version: 1,
            sessionId: "layout-fixture",
            viewport: { x: 64, y: 104, zoom: 1 },
            replies: [
              {
                id: "question-reply",
                prompt: "你会 iui 吗？",
                body: "<card><title>IUI 验证</title><text>显示正常</text></card>",
                status: "done",
                userMessages: [
                  { id: "original", source: "user", text: "你会 iui 吗？" },
                  {
                    id: "ask:call:q",
                    source: "user",
                    text: "我之前做的那个 open-intelligent-ui",
                  },
                  {
                    id: "long",
                    source: "user",
                    text:
                      "这是用于验证长消息仍然按可用宽度换行的内容。".repeat(
                        12,
                      ) + "x".repeat(160),
                  },
                ],
              },
            ],
          }),
        ),
      );
      await page.goto("http://127.0.0.1:5212/tests/reply-layout.html");
      await page.locator(".chat-user-message").first().waitFor();
      await page.evaluate(
        (native) =>
          document
            .querySelector(".chat-dock")
            .classList.toggle("is-native", native),
        native,
      );
      const metrics = await page.evaluate(() => {
        const rail = document.querySelector(".chat-user-history");
        const bubbles = [
          ...document.querySelectorAll(".chat-user-message-bubble"),
        ];
        const first = bubbles[0];
        const range = document.createRange();
        range.selectNodeContents(first);
        return {
          lines: range.getClientRects().length,
          height: first.getBoundingClientRect().height,
          longWidth: bubbles[2].getBoundingClientRect().width,
          railWidth: rail.getBoundingClientRect().width,
          overflow: rail.scrollWidth > rail.clientWidth + 1,
          texts: bubbles.map((b) => b.textContent),
        };
      });
      assert.equal(
        metrics.lines,
        1,
        JSON.stringify({ width, native, metrics }),
      );
      assert.ok(metrics.height <= 45, JSON.stringify(metrics));
      assert.ok(metrics.longWidth > 200, JSON.stringify(metrics));
      assert.ok(
        metrics.longWidth <= metrics.railWidth,
        JSON.stringify(metrics),
      );
      assert.equal(metrics.overflow, false);
      assert.equal(metrics.texts[1], "我之前做的那个 open-intelligent-ui");
      await page.getByRole("button", { name: "导航与工作区" }).click();
      await page.getByRole("button", { name: "更多", exact: true }).click();
      const toggle = page.getByRole("button", { name: /画布 IUI 渲染/ });
      assert.equal(await toggle.getAttribute("aria-pressed"), "true");
      await page.locator("[data-canvas-iui-root]").waitFor();
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      assert.equal(await page.locator("[data-canvas-iui-root]").count(), 0);
      assert.deepEqual(
        await page.locator(".chat-user-message-bubble").allTextContents(),
        metrics.texts,
      );
      await toggle.click();
      await page.locator("[data-canvas-iui-root]").waitFor();
      await page.getByRole("button", { name: "导航与工作区" }).click();
      if (width === 1200 && native)
        await page.screenshot({ path: "artifacts/rail-width-fixed.png" });
      assert.deepEqual(errors, []);
      console.log(
        `message width, answers and IUI toggle ${width}, native=${native}: OK`,
      );
      await page.close();
    }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
