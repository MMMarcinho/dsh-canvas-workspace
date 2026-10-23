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
    "5198",
    "--strictPort",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Vite timeout")), 15000);
  server.stdout.on("data", (buffer) => {
    if (String(buffer).includes("5198")) {
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
  const page = await browser.newPage({
    viewport: { width: 1200, height: 780 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const fixture = new URL(location.href).searchParams;
    const count = Number(fixture.get("railCount") ?? 7);
    localStorage.setItem(
      "dsh-canvas-conversation:v1:mock",
      JSON.stringify({
        version: 1,
        sessionId: "rail-browser-fixture",
        // Replies extend beneath the fixed rail, matching the App failure.
        viewport: { x: 650, y: 104, zoom: 1 },
        replies: Array.from({ length: count }, (_, index) => ({
          id: `reply-${index}`,
          prompt:
            fixture.has("shortLast") && index === count - 1
              ? "cool"
              : index === 6 ||
                  fixture.has("long") ||
                  (fixture.has("mixed") && index === 0)
                ? "Long user input ".repeat(30)
                : `Prompt ${index + 1}`,
          body: `Assistant reply ${index + 1}`,
          status: "done",
          ...(fixture.has("steer") && index === count - 1
            ? {
                userMessages: [
                  { id: "steer-original", text: "Original request" },
                  { id: "steer-followup", text: "Wait, use these images" },
                ],
              }
            : {}),
        })),
      }),
    );
  });
  await page.goto("http://127.0.0.1:5198");
  const rail = page.locator(".chat-user-history");
  await rail.waitFor();
  const metrics = await page.evaluate(() => {
    const rail = document.querySelector(".chat-user-history");
    const dock = document.querySelector(".chat-dock");
    const topbar = document.querySelector(".chat-topbar");
    const railStyle = getComputedStyle(rail);
    const topbarStyle = getComputedStyle(topbar);
    return {
      height: rail.getBoundingClientRect().height,
      scrollHeight: rail.scrollHeight,
      clientHeight: rail.clientHeight,
      pointerEvents: railStyle.pointerEvents,
      dockWidth: dock.getBoundingClientRect().width,
      topbarWidth: topbar.getBoundingClientRect().width,
      backdrop: topbarStyle.backdropFilter || topbarStyle.webkitBackdropFilter,
    };
  });
  assert.ok(metrics.height <= 153, JSON.stringify(metrics));
  assert.ok(
    metrics.scrollHeight > metrics.clientHeight,
    JSON.stringify(metrics),
  );
  assert.equal(metrics.pointerEvents, "auto");
  assert.ok(metrics.topbarWidth < 600, "glass only covers the tool group");
  assert.notEqual(metrics.backdrop, "none");

  await rail.evaluate((element) => (element.scrollTop = 0));
  const firstRow = page.locator(".chat-user-message").first();
  await firstRow.hover();
  await page.mouse.wheel(0, 150);
  await page.waitForFunction(
    () => document.querySelector(".chat-user-history").scrollTop > 0,
  );
  await rail.evaluate((element) => (element.scrollTop = 0));

  const gap = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".chat-user-message")];
    const a = rows[0].getBoundingClientRect();
    const b = rows[1].getBoundingClientRect();
    const x = a.left + 4;
    const y = (a.bottom + b.top) / 2;
    return { x, y, hit: document.elementFromPoint(x, y)?.className };
  });
  assert.ok(String(gap.hit).includes("chat-user-history"), JSON.stringify(gap));
  const beforePan = await page
    .locator(".chat-world")
    .evaluate((node) => node.style.transform);
  await page.mouse.move(gap.x, gap.y);
  await page.mouse.down();
  await page.mouse.move(gap.x - 28, gap.y - 25, { steps: 4 });
  await page.mouse.up();
  const afterPan = await page
    .locator(".chat-world")
    .evaluate((node) => node.style.transform);
  assert.notEqual(afterPan, beforePan, "blank rail area pans the canvas");
  assert.equal(await page.evaluate(() => getSelection()?.toString()), "");

  const lastRow = page.locator(".chat-user-message").last();
  await lastRow.hover();
  const beforeHover = await page
    .locator(".chat-world")
    .evaluate((node) => node.style.transform);
  assert.equal(beforeHover, afterPan, "hover never locates");
  await lastRow.click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const inFlight = await page
    .locator(".chat-world")
    .evaluate((node) => node.style.transform);
  assert.notEqual(inFlight, beforeHover, "click begins camera motion");
  await page.waitForTimeout(320);
  const settled = await page
    .locator(".chat-world")
    .evaluate((node) => node.style.transform);
  assert.notEqual(settled, inFlight, "camera eases over several frames");
  assert.ok(settled.endsWith("scale(1)"), "locate preserves zoom");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await firstRow.click();
  const reduced = await page
    .locator(".chat-world")
    .evaluate((node) => node.style.transform);
  assert.notEqual(reduced, settled, "reduced motion locates immediately");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await lastRow.click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.mouse.move(900, 200);
  await page.mouse.down();
  await page.mouse.move(935, 230, { steps: 4 });
  await page.mouse.up();
  const afterManualPan = await page
    .locator(".chat-world")
    .evaluate((node) => node.style.transform);
  await page.waitForTimeout(320);
  assert.equal(
    await page.locator(".chat-world").evaluate((node) => node.style.transform),
    afterManualPan,
    "manual pan cancels the old camera animation",
  );
  await firstRow.click();
  await page.waitForTimeout(320);
  await lastRow.click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await firstRow.click();
  await page.waitForTimeout(320);
  const firstReply = await page
    .locator('article.chat-reply[data-reply-id="reply-0"]')
    .evaluate((node) => node.getBoundingClientRect().toJSON());
  assert.ok(
    firstReply.left > 20 && firstReply.right < 830,
    "a second locate interrupts the first and centers the new target",
  );
  await lastRow.click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.mouse.move(900, 200);
  await page.mouse.wheel(0, 90);
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".chat-world")
        .style.transform.endsWith("scale(1)"),
  );
  const afterWheel = await page
    .locator(".chat-world")
    .evaluate((node) => node.style.transform);
  await page.waitForTimeout(320);
  assert.equal(
    await page.locator(".chat-world").evaluate((node) => node.style.transform),
    afterWheel,
    "manual wheel zoom cancels the old camera animation",
  );
  // Exercise actual browser layout, including the empty rail, a taller-than-rail
  // bubble, the nominal three-row case, and overflow at a narrow viewport.
  for (const { count, query, width, height } of [
    { count: 0, query: "", width: 1200, height: 780 },
    { count: 1, query: "&long=1", width: 1200, height: 780 },
    { count: 3, query: "&shortLast=1", width: 1200, height: 780 },
    { count: 3, query: "&mixed=1&shortLast=1", width: 560, height: 480 },
    { count: 7, query: "", width: 1200, height: 780 },
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:5198/?railCount=${count}${query}`);
    if (!count) {
      assert.equal(await page.locator(".chat-user-history-frame").count(), 0);
      continue;
    }
    const rows = page.locator(".chat-user-message");
    await rows.last().waitFor();
    assert.equal(await rows.count(), count);
    await page.locator(".chat-user-history").evaluate((node) => {
      node.scrollTop = 0;
    });
    const layout = await page.evaluate(() => {
      const frame = document.querySelector(".chat-user-history-frame");
      const glass = document.querySelector(".chat-user-history-glass");
      const rail = document.querySelector(".chat-user-history");
      const composer = document.querySelector(".chat-composer");
      const first = rail.querySelector(".chat-user-message");
      const rect = (node) => node.getBoundingClientRect().toJSON();
      return {
        frame: rect(frame),
        rail: rect(rail),
        composer: rect(composer),
        first: rect(first),
        glass: rect(glass),
        glassZ: Number(getComputedStyle(glass).zIndex),
        railZ: Number(getComputedStyle(rail).zIndex),
        mask: getComputedStyle(glass).maskImage,
        maskComposite: getComputedStyle(glass).maskComposite,
        text: first.querySelector(".chat-user-message-bubble").textContent,
        scrollHeight: rail.scrollHeight,
        clientHeight: rail.clientHeight,
      };
    });
    assert.ok(layout.frame.height > 30, JSON.stringify(layout));
    assert.ok(layout.railZ > layout.glassZ, "messages paint above blur");
    assert.ok(layout.mask.includes("linear-gradient"), "blur fades at edges");
    assert.ok(
      layout.maskComposite.includes("intersect"),
      JSON.stringify(layout),
    );
    assert.ok(layout.glass.top <= layout.rail.top - 23);
    assert.ok(layout.glass.bottom >= layout.rail.bottom + 23);
    assert.ok(
      layout.text.startsWith("Prompt") || layout.text.startsWith("Long"),
    );
    assert.ok(layout.first.top - layout.rail.top >= 11, JSON.stringify(layout));
    assert.ok(
      Math.abs(layout.frame.left - layout.composer.left) < 1 &&
        Math.abs(layout.frame.width - layout.composer.width) < 1,
      "the rail and visible composer share both side edges",
    );
    if (count === 1 || count === 7)
      assert.ok(
        layout.scrollHeight > layout.clientHeight,
        JSON.stringify(layout),
      );
    await page.locator(".chat-user-history").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const bottom = await page.evaluate(() => {
      const rail = document.querySelector(".chat-user-history");
      const last = rail.lastElementChild;
      const glass = document.querySelector(".chat-user-history-glass");
      const railRect = rail.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();
      const glassRect = glass.getBoundingClientRect();
      return {
        inset: railRect.bottom - lastRect.bottom,
        centerX: (lastRect.left + lastRect.right) / 2,
        bubbleBottom: lastRect.bottom,
        blurCoreLeft: glassRect.left + 8,
        blurCoreRight: glassRect.right - 8,
        blurCoreBottom: glassRect.bottom - 8,
      };
    });
    assert.ok(
      bottom.inset >= 11,
      `last bubble needs breathing room: ${JSON.stringify(bottom)}`,
    );
    assert.ok(
      bottom.centerX > bottom.blurCoreLeft &&
        bottom.centerX < bottom.blurCoreRight &&
        bottom.bubbleBottom < bottom.blurCoreBottom,
      `last bubble must sit in the blur's solid area: ${JSON.stringify(bottom)}`,
    );
    if (count === 3 && width === 1200 && process.env.RAIL_SCREENSHOT) {
      const coverage = await page.evaluate(() => {
        const glass = document.querySelector(".chat-user-history-glass");
        const rect = glass.getBoundingClientRect();
        const backdrop = document.createElement("div");
        backdrop.setAttribute("data-rail-test-backdrop", "");
        backdrop.style.cssText =
          "position:absolute;inset:0;overflow:hidden;pointer-events:none;background:#d6e7fa;color:#102238;font:600 13px/17px Arial;word-break:break-all;";
        backdrop.textContent =
          "A.保持现状 B.继续优化 C.完整消息区域 blur text glyphs 0123456789 ".repeat(
            650,
          );
        document.querySelector(".chat-stage").prepend(backdrop);
        return {
          width: rect.width,
          height: rect.height,
          feather: 8,
          effectiveWidth: rect.width - 16,
          effectiveHeight: rect.height - 16,
        };
      });
      console.log("rail blur coverage", JSON.stringify(coverage));
      const glass = page.locator(".chat-user-history-glass");
      await glass.evaluate((node) => (node.style.visibility = "hidden"));
      await page.screenshot({
        path: process.env.RAIL_SCREENSHOT.replace(/\.png$/, "-baseline.png"),
      });
      await glass.evaluate((node) => (node.style.visibility = "visible"));
      await page.screenshot({ path: process.env.RAIL_SCREENSHOT });
    }
  }
  // An actual mock send changes the stable user-message ID. Two quick sends
  // supersede the first smooth destination; stream tokens and manual wheel
  // scrolling never pull the viewer back down.
  await page.locator(".chat-user-history").evaluate((node) => {
    node.scrollTop = 0;
  });
  assert.equal(
    await page.locator(".chat-user-history").evaluate((node) => node.scrollTop),
    0,
  );
  await page.locator(".chat-composer textarea").fill("first new input");
  await page.locator(".chat-send").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".chat-user-message").length === 8,
  );
  if (await page.locator(".chat-stop").count())
    await page.locator(".chat-stop").click();
  await page.locator(".chat-composer textarea").fill("second new input");
  await page.locator(".chat-send").click();
  await page.waitForFunction(() => {
    const rail = document.querySelector(".chat-user-history");
    return (
      rail.querySelectorAll(".chat-user-message").length === 9 &&
      rail.scrollTop >= rail.scrollHeight - rail.clientHeight - 2
    );
  });
  // A native image attachment may enlarge the newest input after its row is
  // present. The rail follows that late growth while the user is reading it.
  await page.evaluate(() => {
    const body = document.querySelector(
      ".chat-user-history .chat-user-message-group:last-child .chat-user-message:last-child .chat-user-message-stack",
    );
    const imagePlaceholder = document.createElement("div");
    imagePlaceholder.style.height = "90px";
    imagePlaceholder.style.flex = "none";
    imagePlaceholder.dataset.lateImage = "";
    body.append(imagePlaceholder);
  });
  await page.waitForFunction(() => {
    const rail = document.querySelector(".chat-user-history");
    return rail.scrollTop >= rail.scrollHeight - rail.clientHeight - 2;
  });
  await page.locator(".chat-user-history").hover();
  await page.mouse.wheel(0, -3000);
  await page.waitForFunction(
    () => document.querySelector(".chat-user-history").scrollTop < 4,
  );
  await page.evaluate(() => {
    const body = document.querySelector(
      ".chat-user-history .chat-user-message-group:last-child .chat-user-message:last-child .chat-user-message-stack",
    );
    body.querySelector("[data-late-image]").style.height = "140px";
  });
  await page.waitForTimeout(350);
  assert.ok(
    (await page
      .locator(".chat-user-history")
      .evaluate((node) => node.scrollTop)) < 4,
    "assistant streaming and the old smooth scroll do not override manual history browsing",
  );
  if (await page.locator(".chat-stop").count())
    await page.locator(".chat-stop").click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".chat-composer textarea").fill("long input ".repeat(45));
  await page.locator(".chat-send").click();
  await page.waitForFunction(() => {
    const rail = document.querySelector(".chat-user-history");
    return (
      rail.querySelectorAll(".chat-user-message").length === 10 &&
      rail.scrollTop >= rail.scrollHeight - rail.clientHeight - 2
    );
  });
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  if (await page.locator(".chat-stop").count())
    await page.locator(".chat-stop").click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("http://127.0.0.1:5198/?railCount=3&steer=1");
  const steerGroup = page.locator(
    '.chat-user-message-group[data-grouped="true"]',
  );
  assert.equal(await steerGroup.locator(".chat-user-message").count(), 2);
  await steerGroup
    .locator('[data-user-message-id="steer-followup"]')
    .scrollIntoViewIfNeeded();
  const steerHit = await steerGroup
    .locator('[data-user-message-id="steer-followup"]')
    .evaluate((node) => {
      const rect = node
        .querySelector(".chat-user-message-bubble")
        .getBoundingClientRect();
      return document
        .elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        )
        ?.closest(".chat-user-message")?.dataset.userMessageId;
    });
  assert.equal(
    steerHit,
    "steer-followup",
    "group paint never blocks row input",
  );
  await steerGroup.locator('[data-user-message-id="steer-original"]').hover();
  assert.equal(
    await steerGroup.locator('[data-pair-state="matched"]').count(),
    2,
    "both steer inputs highlight with one reply",
  );
  assert.equal(
    await page.locator('.chat-reply[data-pair-state="matched"]').count(),
    1,
  );
  await page.setViewportSize({ width: 1200, height: 780 });
  await page.goto("http://127.0.0.1:5198");
  const lightGlass = await page
    .locator(".chat-topbar")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.ok(
    Number(lightGlass.match(/\/ ([\d.]+)\)/)?.[1]) <= 0.5,
    `light glass should reveal content behind it: ${lightGlass}`,
  );
  await page.goto("http://127.0.0.1:5198/?theme=dark");
  await page.locator(".chat-topbar").waitFor();
  assert.ok(
    await page
      .locator("body")
      .evaluate((node) => node.hasAttribute("data-ds-dark-theme")),
  );
  const darkGlass = await page
    .locator(".chat-topbar")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.notEqual(darkGlass, lightGlass, "glass follows the host theme");
  assert.ok(
    Number(darkGlass.match(/\/ ([\d.]+)\)/)?.[1]) <= 0.6,
    `dark glass should reveal content behind it: ${darkGlass}`,
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });
  const reducedGlass = await page.locator(".chat-topbar").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      media: matchMedia("(prefers-reduced-transparency: reduce)").matches,
      background: style.backgroundColor,
      filter: style.backdropFilter,
    };
  });
  assert.equal(reducedGlass.media, true);
  assert.equal(reducedGlass.filter, "none");
  assert.ok(!reducedGlass.background.includes(" / "));
  assert.deepEqual(errors, []);
  console.log("rail hit area, three-row scroll, glass and click locate: OK");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
