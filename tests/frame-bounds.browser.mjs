/** Native frame geometry regression: rc.3 direct slot and rc.2.2 MainPanel wrapper. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
const css = await readFile("src/styles.css", "utf8");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1536, height: 786 },
  });
  await mkdir("artifacts", { recursive: true });
  const results = [];
  for (const wrapped of [false, true])
    for (const sidebar of [0, 280, 360])
      for (const rightbar of [0, 320]) {
        const main = `<div data-slot="main"><div data-conversation-content><div data-conversation-scroll><div data-canvas-conversation-view class="canvas-conversation-view"><div class="canvas-app chat-canvas"><div class="chat-stage"><div class="probe">LEFT EDGE CONTENT</div></div></div></div></div></div></div>`;
        await page.setContent(
          `<style>html,body{margin:0;height:100%}.frame{display:grid;position:relative;height:100%;grid-template-rows:minmax(0,1fr) auto}.sidebar{grid-area:1/1}.center{grid-area:1/2;display:flex;flex-direction:column;min-width:0;overflow:hidden}.main-panel,[data-slot=main]{flex:1;min-height:0;display:flex;flex-direction:column}[data-conversation-content]{flex:1;position:relative}[data-conversation-scroll]{position:absolute;inset:0}.right{grid-area:1/3}.overlay{position:absolute;inset:0;pointer-events:none}.probe{position:absolute;left:4px;top:10px;background:#e5f1ff;width:220px;height:60px}</style><style id=plugin>${css}</style><div class=frame style="grid-template-columns:${sidebar}px minmax(0,1fr) ${rightbar}px"><div class=sidebar><div data-slot=sidebar>Sidebar</div></div><div class=center>${wrapped ? `<div class=main-panel>${main}</div>` : main}</div><div class=right data-rightbar-col></div><div class=overlay data-shell-overlay></div></div>`,
        );
        const bounds = () =>
          page.evaluate(() => {
            const rect = (s) => {
              const r = document.querySelector(s).getBoundingClientRect();
              return { left: r.left, right: r.right, width: r.width };
            };
            return {
              frame: rect(".frame"),
              center: rect(".center"),
              stage: rect(".chat-stage"),
              right: rect(".right"),
              hit: document.elementFromPoint(10, 20)?.className,
              columns:
                document.querySelector(".frame").style.gridTemplateColumns,
            };
          });
        const fixed = await bounds();
        assert.equal(
          fixed.center.left,
          0,
          JSON.stringify({ wrapped, sidebar, rightbar, fixed }),
        );
        assert.equal(fixed.stage.left, 0);
        assert.equal(fixed.center.right, 1536 - rightbar);
        assert.equal(
          fixed.hit,
          "probe",
          "content in former sidebar track is visible/hittable",
        );
        if (wrapped && sidebar === 280 && rightbar === 0) {
          await page
            .locator("#plugin")
            .evaluate(
              (n, text) => (n.textContent = text),
              css.replace(
                '> :has([data-slot="main"]) {',
                '> :has(> [data-slot="main"]) {',
              ),
            );
          const broken = await bounds();
          assert.equal(
            broken.center.left,
            280,
            "old selector reproduces phantom sidebar boundary",
          );
          await page.screenshot({ path: "artifacts/frame-bounds-before.png" });
          await page
            .locator("#plugin")
            .evaluate((n, text) => (n.textContent = text), css);
          await page.screenshot({ path: "artifacts/frame-bounds-after.png" });
        }
        await page
          .locator("[data-canvas-conversation-view]")
          .evaluate((n) => n.remove());
          const normal = await page.locator(".center").boundingBox();
        assert.equal(normal.x, sidebar, "exit restores original sidebar track");
        results.push({ wrapped, sidebar, rightbar, passed: true });
      }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
