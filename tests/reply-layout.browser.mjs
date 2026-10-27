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
    "5201",
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Vite timeout")), 15000);
  server.stdout.on("data", (buffer) => {
    if (String(buffer).includes("5201")) {
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
  for (const fixture of ["legacy", "auto", "manual"]) {
    for (const [sidebarWidth, zoom] of [
      [0, 1],
      [260, 1],
      [0, 1.5],
    ]) {
      const page = await browser.newPage({
        viewport: { width: sidebarWidth ? 1100 : 1512, height: 900 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        ({ fixture, zoom }) => {
          localStorage.setItem(
            "dsh-canvas-conversation:v1:mock",
            JSON.stringify({
              version: 1,
              sessionId: "layout-fixture",
              viewport: { x: 64, y: 104, zoom },
              replies: [
                {
                  id: "first",
                  prompt: "两张大图",
                  body: "第一条回复的图文内容",
                  status: "done",
                },
                {
                  id: "second",
                  prompt: "继续",
                  body: "第二条回复的表格内容",
                  status: "done",
                  position: {
                    x: 0,
                    y: 240,
                    slotHeight: 90,
                    ...(fixture === "legacy"
                      ? {}
                      : fixture === "manual"
                        ? { kind: "manual" }
                        : { kind: "auto", anchorHeight: 210 }),
                  },
                },
              ],
            }),
          );
        },
        { fixture, zoom },
      );
      await page.goto("http://127.0.0.1:5201/tests/reply-layout.html");
      await page.locator('.chat-reply[data-reply-id="second"]').waitFor();
      if (sidebarWidth)
        await page.evaluate(() => {
          const root = document.getElementById("root");
          root.style.marginLeft = "260px";
          root.style.width = "calc(100% - 260px)";
        });
      await page.getByRole("button", { name: "导航与工作区" }).click();
      assert.equal(await page.locator(".chat-menu").count(), 1);
      await page.getByRole("button", { name: "导航与工作区" }).click();
      await page.evaluate(() => {
        const body = document.querySelector(
          '[data-reply-id="first"] .chat-markdown',
        );
        for (let index = 0; index < 2; index++) {
          const image = document.createElement("img");
          image.alt = `fixture poster ${index + 1}`;
          image.width = 600;
          image.height = 420;
          image.style.cssText =
            "display:block;width:600px;height:420px;max-width:100%;margin:10px 0";
          image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420"><rect width="600" height="420" fill="${index ? "#4455aa" : "#aa4455"}"/></svg>`)}`;
          body.append(image);
        }
      });
      if (fixture !== "manual")
        await page.waitForFunction(() => {
          const first = document.querySelector('[data-reply-id="first"]');
          const second = document.querySelector('[data-reply-id="second"]');
          return (
            second.getBoundingClientRect().top >=
            first.getBoundingClientRect().bottom + 25
          );
        });
      const metrics = await page.evaluate(() => {
        const first = document.querySelector('[data-reply-id="first"]');
        const second = document.querySelector('[data-reply-id="second"]');
        const topbar = document.querySelector(".chat-topbar");
        const dock = document.querySelector(".chat-dock");
        return {
          first: first.getBoundingClientRect().toJSON(),
          second: second.getBoundingClientRect().toJSON(),
          topbar: topbar.getBoundingClientRect().toJSON(),
          dock: dock.getBoundingClientRect().toJSON(),
          saved: JSON.parse(
            localStorage.getItem("dsh-canvas-conversation:v1:mock"),
          ),
        };
      });
      assert.ok(
        metrics.first.height > 800,
        "two images enlarge the first reply",
      );
      assert.ok(
        metrics.topbar.bottom < metrics.dock.top ||
          metrics.topbar.right < metrics.dock.left,
        `topbar and composer must not intersect: ${JSON.stringify(metrics)}`,
      );
      if (fixture === "manual") {
        assert.equal(
          metrics.second.top,
          104 + 240 * zoom,
          "manual placement is not moved",
        );
      } else {
        assert.ok(
          metrics.second.top - metrics.first.bottom >= 25,
          `${fixture} card overlaps after image load: ${JSON.stringify(metrics)}`,
        );
        await page.waitForTimeout(230);
        await page.reload();
        await page.locator('.chat-reply[data-reply-id="second"]').waitFor();
        await page.evaluate(() => {
          const body = document.querySelector(
            '[data-reply-id="first"] .chat-markdown',
          );
          for (let index = 0; index < 2; index++) {
            const image = document.createElement("img");
            image.width = 600;
            image.height = 420;
            image.style.cssText =
              "display:block;width:600px;height:420px;max-width:100%;margin:10px 0";
            image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420"><rect width="600" height="420" fill="#4455aa"/></svg>`)}`;
            body.append(image);
          }
        });
        await page.waitForFunction(() => {
          const first = document.querySelector('[data-reply-id="first"]');
          const second = document.querySelector('[data-reply-id="second"]');
          return (
            second.getBoundingClientRect().top >=
            first.getBoundingClientRect().bottom + 25
          );
        });
      }
      assert.deepEqual(errors, []);
      if (
        process.env.CANVAS_LAYOUT_SCREENSHOT &&
        fixture === "legacy" &&
        !sidebarWidth &&
        zoom === 1
      ) {
        await page.setViewportSize({ width: 1512, height: 1800 });
        await page.screenshot({ path: process.env.CANVAS_LAYOUT_SCREENSHOT });
      }
      await page.close();
    }
  }
  console.log(
    "rich image replies, late growth, legacy recovery, manual positions and sidebar widths: OK",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
