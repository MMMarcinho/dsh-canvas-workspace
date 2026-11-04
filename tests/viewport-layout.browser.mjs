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
    "5207",
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite timeout")), 15000);
    server.stdout.on("data", (data) => {
      if (String(data).includes("5207")) {
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
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  for (const [width, zoom, sidebar] of [
    [1900, 0.75, 0],
    [1100, 1, 260],
    [900, 1.5, 0],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ zoom }) =>
        !localStorage.getItem("dsh-canvas-conversation:v1:mock") &&
        localStorage.setItem(
          "dsh-canvas-conversation:v1:mock",
          JSON.stringify({
            version: 1,
            sessionId: "layout-fixture",
            viewport: { x: -57, y: 70, zoom },
            replies: Array.from({ length: 6 }, (_, i) => ({
              id: `r${i}`,
              prompt: `问题 ${i}`,
              body: `## 回复 ${i}\n\n内容用于布局验证。`,
              status: "done",
              ...(i === 4
                ? {
                    position: {
                      x: 800,
                      y: 400,
                      slotHeight: 100,
                      kind: "manual",
                    },
                  }
                : {}),
            })),
          }),
        ),
      { zoom },
    );
    await page.goto("http://127.0.0.1:5207/tests/reply-layout.html");
    await page.locator('.chat-reply[data-reply-id="r5"]').waitFor();
    if (sidebar)
      await page.evaluate((sidebar) => {
        const root = document.getElementById("root");
        root.style.marginLeft = `${sidebar}px`;
        root.style.width = `calc(100% - ${sidebar}px)`;
      }, sidebar);
    const read = () =>
      page.evaluate(() => ({
        cards: Array.from(document.querySelectorAll(".chat-reply")).map(
          (card) => ({
            id: card.dataset.replyId,
            ...card.getBoundingClientRect().toJSON(),
          }),
        ),
        saved: JSON.parse(
          localStorage.getItem("dsh-canvas-conversation:v1:mock"),
        ),
      }));
    const original = await read();
    await page.getByRole("button", { name: "导航与工作区" }).click();
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page
      .getByRole("button", { name: "按视口自动排布", exact: true })
      .click();
    await page.waitForTimeout(300);
    const arranged = await read();
    assert.deepEqual(arranged.saved.viewport, original.saved.viewport);
    assert.deepEqual(arranged.saved.replies[4].position, {
      ...original.saved.replies[4].position,
      slotHeight: arranged.saved.replies[4].position.slotHeight,
    });
    assert.ok(arranged.cards[0].left >= sidebar + 23);
    assert.equal(arranged.saved.replies[0].position.kind, "viewport");
    if (width === 1900)
      assert.ok(
        arranged.cards[1].left > arranged.cards[0].right,
        "wide viewport creates two columns",
      );
    const noOverlap = ({ cards }) => {
      for (let i = 0; i < cards.length; i++)
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i],
            b = cards[j];
          assert.ok(
            a.right <= b.left + 1 ||
              b.right <= a.left + 1 ||
              a.bottom <= b.top + 1 ||
              b.bottom <= a.top + 1,
            `overlap: ${a.id}, ${b.id}`,
          );
        }
    };
    noOverlap(arranged);
    if (width === 1900)
      await page.screenshot({ path: "artifacts/viewport-layout-arranged.png" });
    await page.evaluate(() => {
      const image = document.createElement("img");
      image.alt = "late loaded large image";
      image.src =
        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="%236386b1"/></svg>';
      image.style.cssText =
        "display:block;width:600px;height:1000px;max-width:100%";
      document
        .querySelector('[data-reply-id="r0"] .chat-markdown')
        .append(image);
    });
    await page.waitForTimeout(350);
    const grown = await read();
    noOverlap(grown);
    if (width === 1900)
      await page.screenshot({ path: "artifacts/viewport-layout-grown.png" });
    assert.deepEqual(grown.saved.replies[4].position, {
      ...original.saved.replies[4].position,
      slotHeight: grown.saved.replies[4].position.slotHeight,
    });
    assert.ok(grown.cards[0].height > 900 * zoom);
    // Camera changes never trigger a fresh pack.
    await page.mouse.move(sidebar + 150, 600);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(300);
    const afterCamera = await read();
    assert.deepEqual(
      afterCamera.saved.replies.map((r) => r.position),
      grown.saved.replies.map((r) => r.position),
    );
    // Keyboard movement pins a formerly automatic card.
    await page
      .locator('.chat-reply[data-reply-id="r1"] [data-canvas-reply-handle]')
      .focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    const moved = await read();
    assert.equal(moved.saved.replies[1].position.kind, "manual");
    await page.reload();
    await page.locator('.chat-reply[data-reply-id="r5"]').waitFor();
    await page.waitForTimeout(300);
    const restored = await read();
    assert.deepEqual(
      restored.saved.replies[1].position,
      moved.saved.replies[1].position,
    );
    noOverlap(restored);
    assert.deepEqual(errors, []);
    if (width === 1900) {
      await page
        .getByRole("textbox", { name: "向 Agent 输入" })
        .fill("自动排布后继续");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await page.waitForFunction(() => {
        const state = JSON.parse(
          localStorage.getItem("dsh-canvas-conversation:v1:mock"),
        );
        return state.replies.length === 7 && state.replies[6].status === "done";
      });
      const continued = await read();
      assert.equal(continued.saved.replies[6].position.kind, "viewport");
      noOverlap(continued);
    }

    await page.close();
    console.log(`viewport ${width}, zoom ${zoom}, sidebar ${sidebar}: OK`);
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
