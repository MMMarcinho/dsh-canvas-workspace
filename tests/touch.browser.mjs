import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
const port = 5213;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Vite timeout")), 15000);
    server.stdout.on("data", (data) => {
      if (String(data).includes(String(port))) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timeout);
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
  for (const [width, height] of [
    [844, 390],
    [390, 844],
    [198, 242],
    [1440, 900],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: true,
      isMobile: true,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        "dsh-canvas-conversation:v1:mock",
        JSON.stringify({
          version: 1,
          viewport: { x: 20, y: 55, zoom: 0.7 },
          replies: [
            {
              id: "touch",
              prompt: "触摸回归",
              body: "## 双指缩放\n\n" + "可选择的回复正文。".repeat(100),
              status: "done",
            },
          ],
        }),
      );
    });
    await page.goto(`http://127.0.0.1:${port}/tests/reply-layout.html`);
    await page.locator(".chat-markdown").waitFor();
    const client = await page.context().newCDPSession(page);
    const touch = (type, points) =>
      client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([id, x, y]) => ({
          id,
          x,
          y,
          radiusX: 1,
          radiusY: 1,
        })),
      });
    const camera = () =>
      page.locator(".chat-world").evaluate((element) => {
        const m = new DOMMatrix(getComputedStyle(element).transform);
        return { x: m.e, y: m.f, zoom: m.a };
      });
    const close = (a, b, label) => {
      for (const key of ["x", "y", "zoom"])
        assert.ok(
          Math.abs(a[key] - b[key]) < 0.1,
          `${label}: ${key}: ${JSON.stringify({ a, b })}`,
        );
    };
    const points = await page.evaluate(() => {
      for (let y = 60; y < innerHeight - 30; y += 10)
        for (let x = 40; x < innerWidth - 70; x += 10) {
          const valid = (x) =>
            document.elementFromPoint(x, y)?.closest(".chat-markdown");
          if (valid(x - 15) && valid(x + 15) && valid(x - 25) && valid(x + 25))
            return { x, y };
        }
      throw new Error("No visible reply body for touch test");
    });
    const { x, y } = points;
    const before = await camera();
    await touch("touchStart", [[1, x - 15, y]]);
    await touch("touchStart", [
      [1, x - 15, y],
      [2, x + 15, y],
    ]);
    close(await camera(), before, "second finger does not jump");
    await touch("touchMove", [
      [1, x - 25, y],
      [2, x + 25, y],
    ]);
    const scaled = await camera();
    assert.ok(
      Math.abs(scaled.zoom - (before.zoom * 50) / 30) < 0.01,
      "real touch scales reply body",
    );
    assert.ok(
      Math.abs((x - before.x) / before.zoom - (x - scaled.x) / scaled.zoom) <
        0.1,
      "pinch midpoint stays anchored",
    );
    await touch("touchMove", [
      [1, x - 20, y + 10],
      [2, x + 30, y + 10],
    ]);
    close(
      await camera(),
      { ...scaled, x: scaled.x + 5, y: scaled.y + 10 },
      "two fingers pan",
    );
    const two = await camera();
    await touch("touchEnd", [[1, x - 20, y + 10]]);
    close(await camera(), two, "2 to 1 does not jump");
    await touch("touchMove", [[2, x + 35, y + 15]]);
    close(
      await camera(),
      { ...two, x: two.x + 5, y: two.y + 5 },
      "remaining finger continues pan",
    );
    const one = await camera();
    await touch("touchStart", [
      [2, x + 35, y + 15],
      [3, x - 15, y + 15],
    ]);
    close(await camera(), one, "1 to 2 rebases");
    await touch("touchStart", [
      [2, x + 35, y + 15],
      [3, x - 15, y + 15],
      [4, x + 20, y + 40],
    ]);
    close(await camera(), one, "third finger does not jump");
    await touch("touchEnd", [[2, x + 35, y + 15]]);
    close(await camera(), one, "pair replacement does not jump");
    await touch("touchCancel", []);
    await page.getByRole("button", { name: "导航与工作区" }).tap();
    await page.locator(".chat-menu").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".chat-menu").count(), 0);
    assert.equal(await page.locator("[data-canvas-dragging]").count(), 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `artifacts/touch-${width}x${height}.png` });
    await page.close();
    console.log(
      `Real Chromium touch reply pinch/pan/transitions/cancel: ${width}x${height}`,
    );
  }
  // Both user-facing canvas components share the same gesture ownership. A
  // scrollable HOST ancestor must not disable the reserved background surface.
  for (const workspace of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
    });
    await page.goto(
      `http://127.0.0.1:${port}/tests/reply-layout.html${workspace ? "?workspace" : ""}`,
    );
    const stage = workspace ? ".canvas-stage" : ".chat-stage";
    const world = workspace ? ".world" : ".chat-world";
    await page.locator(stage).waitFor();
    await page.evaluate(() => {
      const root = document.getElementById("root");
      const outer = document.createElement("div");
      outer.style.cssText = "height:180px;overflow:auto";
      root.before(outer);
      outer.append(root);
      root.style.height = "320px";
    });
    const surface = await page.locator(".canvas-touch-surface").boundingBox();
    const client = await page.context().newCDPSession(page);
    const input = (type, points) =>
      client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([id, x, y]) => ({ id, x, y })),
      });
    // Right edge is blank in both fixtures and remains inside the short host.
    const x = surface.x + surface.width - 70;
    const y = Math.max(surface.y + 25, 110);
    const read = () =>
      page
        .locator(world)
        .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
    const before = await read();
    await input("touchStart", [
      [1, x - 20, y],
      [2, x + 20, y],
    ]);
    await input("touchMove", [
      [1, x - 30, y],
      [2, x + 30, y],
    ]);
    assert.ok(
      Math.abs((await read()) - before * 1.5) < 0.01,
      `scrollable host allows ${workspace ? "workspace" : "chat"} background pinch`,
    );
    await input("touchEnd", []);
    // A fresh single-finger background drag still belongs to the canvas.
    const position = () =>
      page
        .locator(world)
        .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).e);
    // Exercise sustained drags, not only one move: pointer capture must keep
    // ownership when the finger crosses reply content, without camera rebounds.
    for (let run = 0; run < 3; run++) {
      const previous = await position();
      await input("touchStart", [[5, x, y]]);
      for (let step = 1; step <= 30; step++) {
        await input("touchMove", [[5, x - step * 5, y + step / 3]]);
        // CDP acknowledgement can precede the coalesced PointerEvent/React
        // paint. Wait for this sample instead of mistaking one-frame latency
        // for a broken gesture. An ownership loss never reaches the target.
        await page.waitForFunction(
          ({ world, expected }) =>
            Math.abs(
              new DOMMatrix(
                getComputedStyle(document.querySelector(world)).transform,
              ).e - expected,
            ) < 0.1,
          { world, expected: previous - step * 5 },
          { timeout: 1500 },
        );
      }
      await input("touchEnd", []);
      await page.waitForTimeout(50);
      assert.ok(
        Math.abs((await position()) - previous + 150) < 0.1,
        "single-finger pan neither rebounds nor restarts after release",
      );
    }
    await page.close();
  }
  console.log(
    "Real Chromium touch both canvas paths inside a short scrollable host: passed",
  );
  // Native controls and scroll ownership, using trusted browser touch input.
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
    hasTouch: true,
  });
  await page.goto(`http://127.0.0.1:${port}/tests/reply-layout.html`);
  await page.locator(".chat-stage").waitFor();
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.style.cssText =
      "position:absolute;left:100px;top:160px;width:500px;height:350px;background:white";
    fixture.innerHTML =
      '<p id="native-text">Selectable text stays selectable.</p><button id="native-button"><svg width="32" height="32"><path d="M0 0H32V32H0Z" fill="red" /></svg></button><a id="native-link" href="#native-link">Link</a><input id="native-input" value="editable"><div id="native-scroll" style="overflow:auto;height:100px;width:150px"><div style="height:600px">Native scroll</div></div>';
    document.querySelector(".chat-stage").append(fixture);
    const iui = document.createElement("div");
    iui.setAttribute("data-canvas-iui-root", "");
    iui.id = "native-iui";
    iui.style.cssText =
      "position:absolute;left:350px;top:90px;width:120px;height:80px";
    iui.attachShadow({ mode: "open" }).innerHTML =
      '<div style="width:120px;height:80px;background:#ddd">IUI surface</div>';
    fixture.append(iui);
    window.fixtureClicks = 0;
    document.getElementById("native-button").onclick = () =>
      window.fixtureClicks++;
  });
  const client = await page.context().newCDPSession(page);
  const touch = (type, points) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([id, x, y]) => ({ id, x, y })),
    });
  const camera = () => page.locator(".chat-world").getAttribute("style");
  for (const selector of [
    "#native-button path",
    "#native-link",
    "#native-input",
    "#native-scroll",
    "#native-iui",
  ]) {
    const box = await page.locator(selector).boundingBox();
    const before = await camera();
    await touch("touchStart", [
      [1, box.x + 5, box.y + 5],
      [2, 450, 190],
    ]);
    await touch("touchMove", [
      [1, box.x + 10, box.y + 10],
      [2, 475, 200],
    ]);
    assert.equal(await camera(), before, `${selector} retains ownership`);
    await touch("touchEnd", []);
  }
  const scroll = await page.locator("#native-scroll").boundingBox();
  await touch("touchStart", [[1, scroll.x + 40, scroll.y + 80]]);
  for (let delta = 10; delta <= 65; delta += 10)
    await touch("touchMove", [[1, scroll.x + 40, scroll.y + 80 - delta]]);
  await page.waitForTimeout(100);
  assert.ok(
    (await page.locator("#native-scroll").evaluate((e) => e.scrollTop)) > 0,
    "one-finger native scrolling works",
  );
  const before = await camera();
  await touch("touchStart", [
    [1, scroll.x + 40, scroll.y + 20],
    [2, 450, 190],
  ]);
  await touch("touchMove", [
    [1, scroll.x + 40, scroll.y + 10],
    [2, 475, 200],
  ]);
  assert.equal(
    await camera(),
    before,
    "started native scroll is not stolen by a second finger",
  );
  await touch("touchEnd", []);
  await page.locator("#native-button").tap();
  assert.equal(
    await page.evaluate(() => window.fixtureClicks),
    1,
    "SVG button taps work after cancelled gestures",
  );
  for (const event of ["blur", "orientationchange", "resize"]) {
    await touch("touchStart", [
      [1, 350, 190],
      [2, 400, 190],
    ]);
    await touch("touchMove", [
      [1, 340, 190],
      [2, 410, 190],
    ]);
    await page.evaluate(
      (event) => window.dispatchEvent(new Event(event)),
      event,
    );
    await touch("touchEnd", []);
    await page.locator("#native-button").focus();
    const clicks = await page.evaluate(() => window.fixtureClicks);
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => window.fixtureClicks),
      clicks + 1,
      `${event} restores keyboard activation`,
    );
    assert.equal(await page.locator("[data-canvas-dragging]").count(), 0);
  }
  // Real mouse selection remains native after touch gesture cleanup.
  const textBox = await page.locator("#native-text").boundingBox();
  await page.mouse.move(textBox.x + 2, textBox.y + textBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(textBox.x + 170, textBox.y + textBox.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  assert.ok(
    (await page.evaluate(() => getSelection()?.toString() ?? "")).includes(
      "Selectable",
    ),
    "mouse text selection remains native",
  );
  const clicks = await page.evaluate(() => window.fixtureClicks);
  await page.locator("#native-button").click();
  assert.equal(
    await page.evaluate(() => window.fixtureClicks),
    clicks + 1,
    "mouse controls remain clickable after pinch",
  );
  assert.equal(
    await page
      .locator(".chat-stage")
      .evaluate((e) => getComputedStyle(e).touchAction),
    "auto",
  );
  await page.close();
  console.log(
    "Real Chromium touch controls, SVG buttons, native scroll, mixed starts and lifecycle cleanup: passed",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
