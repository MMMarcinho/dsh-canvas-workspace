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
    "5212",
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
const key = "dsh-canvas-conversation:v1:mock";
const read = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
const xy = (state) =>
  Object.fromEntries(
    state.replies.map((r) => [r.id, [r.position?.x, r.position?.y]]),
  );
const settle = (page) => page.waitForTimeout(280);
try {
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(Error("vite timeout")), 15000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("5212")) {
        clearTimeout(t);
        res();
      }
    });
    server.once("exit", (c) => rej(Error(`vite ${c}`)));
  });
  browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  for (const zoom of [1.13737, 1.1, 0.9, 1.2345, 0.8173, 1.0091]) {
    const page = await browser.newPage({
      viewport: { width: 2200, height: 1100 },
    });
    await page.addInitScript(
      ({ key, zoom }) => {
        if (!localStorage.getItem(key))
          localStorage.setItem(
            key,
            JSON.stringify({
              version: 1,
              sessionId: "layout-fixture",
              viewport: { x: 0, y: 0, zoom },
              replies: Array.from({ length: 4 }, (_, i) => ({
                id: `r${i}`,
                hostTurnId: i + 1,
                prompt: `input ${i}`,
                body: `reply ${i}`,
                status: "done",
                position: {
                  x: i < 3 ? i * 630 : 0,
                  y: i < 3 ? 100 : 230,
                  slotHeight: 100,
                  kind: "viewport",
                },
              })),
            }),
          );
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = ".chat-reply{height:100px!important}";
          document.head.append(style);
        });
      },
      { key, zoom },
    );
    await page.goto(
      "http://127.0.0.1:5212/tests/reply-layout.html?stability=1",
    );
    await page.locator(".chat-reply").first().waitFor();
    await settle(page);
    const before = await read(page);
    assert.deepEqual(
      xy(before),
      { r0: [0, 100], r1: [630, 100], r2: [1260, 100], r3: [0, 230] },
      `initial observer at zoom ${zoom}`,
    );
    await page.reload();
    await page.locator(".chat-reply").first().waitFor();
    await settle(page);
    assert.deepEqual(
      xy(await read(page)),
      xy(before),
      `reload at zoom ${zoom}`,
    );
    await page.mouse.move(1000, 400);
    await page.mouse.wheel(0, -23);
    await settle(page);
    assert.deepEqual(xy(await read(page)), xy(before), "zoom does not repack");
    await page.close();
  }
  const page = await browser.newPage({
    viewport: { width: 2200, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ key }) => {
      if (localStorage.getItem(key)) return;
      const positions = [
        [0, 100],
        [630, 100],
        [0, 400],
        [630, 700],
        [630, 600],
      ];
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          sessionId: "layout-fixture",
          viewport: { x: 0, y: 0, zoom: 1 },
          replies: positions.map(([x, y], i) => ({
            id: `r${i}`,
            hostTurnId: i + 1,
            prompt: `input ${i}`,
            body: `reply ${i}`,
            status: "done",
            ...(i === 4 ? { pinned: true } : {}),
            position: {
              x,
              y,
              slotHeight: 100,
              kind: i >= 3 ? "manual" : "viewport",
            },
          })),
        }),
      );
    },
    { key },
  );
  await page.goto("http://127.0.0.1:5212/tests/reply-layout.html?stability=1");
  await page.locator(".chat-reply").first().waitFor();
  await settle(page);
  const initial = await read(page);
  // A real manual drag must remain stable after observer and persistence turns.
  const handle = page.locator(
    '.chat-reply[data-reply-id="r3"] [data-canvas-reply-handle]',
  );
  const h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 40, h.y + h.height / 2 + 20, {
    steps: 5,
  });
  await page.mouse.up();
  await settle(page);
  const dragged = await read(page);
  assert.deepEqual(xy(dragged).r3, [670, 720]);
  for (const id of ["r0", "r1", "r2", "r4"])
    assert.deepEqual(xy(dragged)[id], xy(initial)[id]);
  const emit = async (overrides = {}, extra = false) => {
    await page.evaluate(
      ({ overrides, extra }) => {
        const turns = Array.from({ length: extra ? 6 : 5 }, (_, i) => ({
          turnId: i + 1,
          userMessages: [
            {
              id: `u${i}`,
              text: `input ${i}`,
              source: "user",
              timestamp: 1000 + i,
            },
          ],
          body: overrides[i] ?? `reply ${i}`,
          durable: true,
          status: "done",
        }));
        window.__emitCanvasSnapshot({
          sessionId: "layout-fixture",
          turns,
          hasMore: false,
        });
      },
      { overrides, extra },
    );
    await settle(page);
  };
  await emit({ 0: "reply 0 updated without wrapping" });
  assert.deepEqual(
    xy(await read(page)),
    xy(dragged),
    "same-height stream updates stay put",
  );
  await emit({}, true);
  const added = await read(page);
  const newCard = added.replies.find((r) => r.hostTurnId === 6),
    manual = added.replies.find((r) => r.id === "r3");
  assert.ok(
    newCard.position.y >= manual.position.y + manual.position.slotHeight + 29,
    "new reply avoids the existing manual obstacle without moving it",
  );
  for (const id of Object.keys(xy(dragged)))
    assert.deepEqual(
      xy(added)[id],
      xy(dragged)[id],
      "new-card observer does not normalize old cards",
    );
  // Real stream growth affects only the collision chain below that column.
  await emit({ 0: "stream line\n\n".repeat(22) }, true);
  const streamed = await read(page);
  const height = await page
    .locator('.chat-reply[data-reply-id="r0"]')
    .evaluate((n) => n.offsetHeight);
  assert.equal(xy(streamed).r2[1], 100 + height + 30);
  for (const id of ["r1", "r3", "r4"])
    assert.deepEqual(xy(streamed)[id], xy(added)[id]);
  // Shrink/metadata changes do not pull cards back or repack distant rows.
  await emit({}, true);
  let shrunk = await read(page);
  assert.deepEqual(xy(shrunk), xy(streamed));
  // A size change during a captured gesture is queued, then repaired on release.
  const held = await handle.boundingBox();
  await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2);
  await page.mouse.down();
  await emit({ 0: "growth during drag\n\n".repeat(45) }, true);
  assert.deepEqual(
    xy(await read(page)),
    xy(shrunk),
    "growth cannot move other cards during a pointer gesture",
  );
  await page.mouse.up();
  await settle(page);
  const released = await read(page);
  assert.ok(xy(released).r2[1] > xy(shrunk).r2[1]);
  for (const id of ["r1", "r3", "r4"])
    assert.deepEqual(xy(released)[id], xy(shrunk)[id]);
  await emit({}, true);
  shrunk = await read(page);
  assert.deepEqual(xy(shrunk), xy(released));
  // Load a real image in another column; a fixed obstacle must remain fixed.
  await page
    .locator('.chat-reply[data-reply-id="r1"] .chat-markdown')
    .evaluate(async (n) => {
      const image = document.createElement("img");
      image.alt = "late actual image";
      image.style.cssText =
        "display:block;width:600px;height:600px;max-width:100%";
      const loaded = new Promise((resolve) => (image.onload = resolve));
      image.src =
        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="%236386b1"/></svg>';
      n.append(image);
      await loaded;
    });
  await settle(page);
  const imageState = await read(page);
  assert.deepEqual(xy(imageState).r4, [630, 600]);
  assert.ok(xy(imageState).r1[1] > 600);
  for (const id of ["r0", "r2", "r3"])
    assert.deepEqual(xy(imageState)[id], xy(shrunk)[id]);
  const fresh = imageState.replies.find((r) => r.hostTurnId === 6);
  assert.ok(
    fresh.position.y >=
      imageState.replies.find((r) => r.id === "r1").position.y +
        imageState.replies.find((r) => r.id === "r1").position.slotHeight +
        29,
  );
  // Clicking either locate direction changes focus/camera, never saved card coordinates.
  await page.locator('.chat-user-message[data-reply-id="r0"]').click();
  await page.waitForTimeout(350);
  await settle(page);
  assert.deepEqual(xy(await read(page)), xy(imageState));
  await page
    .locator('.chat-reply[data-reply-id="r0"] .chat-locate-message')
    .click();
  await settle(page);
  assert.deepEqual(xy(await read(page)), xy(imageState));
  // Restore another session and come back; all existing coordinates and pins survive.
  await page.getByRole("button", { name: "导航与工作区", exact: true }).click();
  await page.getByRole("button", { name: "另一个会话", exact: true }).click();
  await page.getByRole("button", { name: "导航与工作区", exact: true }).click();
  await page.getByRole("button", { name: "图片布局测试", exact: true }).click();
  await settle(page);
  assert.deepEqual(xy(await read(page)), xy(imageState));
  await page.reload();
  await page.locator(".chat-reply").first().waitFor();
  await settle(page);
  assert.deepEqual(xy(await read(page)), xy(imageState));
  // Only the explicit command may redistribute every unpinned card.
  const camera = (await read(page)).viewport;
  await page.getByRole("button", { name: "导航与工作区", exact: true }).click();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page
    .getByRole("button", { name: "按视口自动排布", exact: true })
    .click();
  await page.waitForTimeout(420);
  const arranged = await read(page);
  assert.deepEqual(arranged.viewport, camera);
  assert.equal(
    arranged.replies.find((r) => r.id === "r3").position.kind,
    "viewport",
  );
  assert.deepEqual(xy(arranged).r4, [630, 600]);
  assert.deepEqual(errors, []);
  await page.close();
  console.log(
    "stability: fractional zoom/initial callbacks/reload, drag/wait, stream, image/fixed growth, shrink, new cards, locate, session restore and explicit layout OK",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
