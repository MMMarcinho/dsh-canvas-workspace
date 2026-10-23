import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

// The installed DSH 0.2.0 gallery has no public component export. Its
// documented rules are a 240px long edge for one image and 64px multi tiles.

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
  server.stdout.on("data", (buffer) => {
    if (String(buffer).includes("5199")) {
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
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5199");
  await page.evaluate(async () => {
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { ChatCanvas } = await import("/src/ui/ChatCanvas.tsx");
    document.querySelector("#root").style.display = "none";
    const mount = document.createElement("div");
    mount.id = "media-test";
    Object.assign(mount.style, {
      position: "fixed",
      inset: "0",
      zIndex: "100",
    });
    document.body.append(mount);
    const root = createRoot(mount);
    const adapter = {
      kind: "mock",
      createSession: async () => "media-fixture",
      run: async () => {},
      cancel: async () => {},
    };
    const svg = (width, height, color) =>
      `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`)}`;
    window.renderMediaCase = (kind) => {
      const wide = {
        type: "image",
        image: {
          attachment: {
            attachmentId: "wide",
            mediaType: "image/png",
            bytes: 1,
            width: 888,
            height: 380,
            name: "wide.png",
          },
        },
      };
      const tall = {
        type: "image",
        image: {
          attachment: {
            attachmentId: "tall",
            mediaType: "image/png",
            bytes: 1,
            width: 380,
            height: 888,
            name: "tall.png",
          },
        },
      };
      const file = {
        type: "file",
        file: { attachmentId: "file", name: "notes.txt", bytes: 1200 },
      };
      const attachments =
        kind === "multi"
          ? [wide, tall]
          : kind === "file"
            ? [file]
            : [kind === "tall" ? tall : wide];
      const text = kind === "pure" || kind === "file" ? "" : "等一下，有点问题";
      const replies = [
        ...Array.from({ length: 3 }, (_, index) => ({
          id: `previous-${index}`,
          prompt: `先前消息 ${index + 1}`,
          body: `先前回复 ${index + 1}`,
          status: "done",
        })),
        {
          id: `answer-${kind}`,
          prompt: text,
          body: `图片回复 ${kind}`,
          status: "done",
          userMessages: [{ id: `case-${kind}`, text, attachments }],
        },
      ];
      localStorage.setItem(
        "dsh-canvas-conversation:v1:mock",
        JSON.stringify({
          version: 1,
          sessionId: "media-fixture",
          viewport: { x: 64, y: 104, zoom: 1 },
          replies,
        }),
      );
      root.render(
        React.createElement(ChatCanvas, {
          key: kind,
          adapter,
          mode: "mock",
          loadUserImage: async (attachment) =>
            attachment.attachmentId === "wide"
              ? svg(888, 380, "#da4c6a")
              : svg(380, 888, "#485bd3"),
          renderImagePreview: (src, alt, onClose) =>
            React.createElement(
              "div",
              { role: "dialog", "aria-label": alt },
              React.createElement("img", { src, alt }),
              React.createElement("button", { onClick: onClose }, "关闭"),
            ),
        }),
      );
    };
  });

  const render = async (kind) => {
    await page.evaluate((value) => window.renderMediaCase(value), kind);
    const row = page.locator(
      `#media-test [data-user-message-id="case-${kind}"]`,
    );
    await row.waitFor();
    await row.scrollIntoViewIfNeeded();
    if (kind !== "file")
      await row.locator(".chat-user-image-tile img").first().waitFor();
    return row;
  };
  const geometry = async (row) =>
    row
      .locator(".chat-user-image-tile")
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          variant: node.dataset.variant,
        };
      });

  let row = await render("wide");
  assert.deepEqual(await geometry(row), {
    width: 240,
    height: 103,
    variant: "single",
  });
  assert.equal(
    await row.locator(".chat-user-message-bubble").textContent(),
    "等一下，有点问题",
  );
  assert.equal((await row.textContent()).includes("[图片 1 张]"), false);
  const mixedLayout = await row.evaluate((node) => {
    const media = node.querySelector(".chat-user-media");
    const text = node.querySelector(".chat-user-message-bubble");
    const image = node.querySelector("img");
    const contextMenu = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    image.dispatchEvent(contextMenu);
    return {
      gap:
        text.getBoundingClientRect().top - media.getBoundingClientRect().bottom,
      selectable: getComputedStyle(text).userSelect,
      fit: getComputedStyle(image).objectFit,
      contextMenuAllowed: !contextMenu.defaultPrevented,
    };
  });
  assert.ok(
    mixedLayout.gap >= 0 && mixedLayout.gap <= 8,
    JSON.stringify(mixedLayout),
  );
  assert.equal(mixedLayout.selectable, "text");
  assert.equal(mixedLayout.fit, "cover");
  assert.equal(mixedLayout.contextMenuAllowed, true);
  await row.hover();
  assert.equal(
    await page
      .locator('#media-test .chat-reply[data-pair-state="matched"]')
      .count(),
    1,
  );
  const world = await page
    .locator("#media-test .chat-world")
    .evaluate((node) => node.style.transform);
  await row.locator(".chat-user-image-tile").click();
  assert.equal(await page.locator('#media-test [role="dialog"]').count(), 1);
  assert.equal(
    await page
      .locator("#media-test .chat-world")
      .evaluate((node) => node.style.transform),
    world,
  );
  // The production ImageLightbox portals to the document. This small test
  // dialog is inline, so close it without asserting its artificial stacking.
  await page
    .locator('#media-test [role="dialog"] button')
    .evaluate((node) => node.click());
  assert.equal(await page.locator('#media-test [role="dialog"]').count(), 0);
  await row.locator(".chat-user-message-copy").hover();
  const reachableCopy = await row
    .locator(".chat-user-message-copy")
    .evaluate((button) => {
      const rail = button.closest(".chat-user-history").getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      return rect.top >= rail.top && rect.bottom <= rail.bottom;
    });
  assert.equal(
    reachableCopy,
    true,
    "copy remains reachable in the bounded rail",
  );

  // The reference row uses the installed 0.2.0 MessageItem CSS values, with
  // the same fixture image and text as the Canvas row beside it.
  const nativeParity = await page.evaluate(() => {
    const row = document.querySelector('[data-user-message-id="case-wide"]');
    const reference = document.createElement("section");
    reference.id = "native-user-reference";
    reference.setAttribute("aria-label", "DSH native sent-message reference");
    reference.style.cssText =
      "position:fixed;left:24px;top:120px;z-index:1000;width:320px;padding:12px;pointer-events:none";
    const stack = document.createElement("div");
    stack.style.cssText =
      "display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:min(calc(var(--dsh-chat-content-width,748px)*.702),82%)";
    const image = document.createElement("img");
    image.src = row.querySelector("img").src;
    image.style.cssText =
      "display:block;width:240px;height:103px;object-fit:cover;border-radius:var(--dsw-radius-xl)";
    const bubble = document.createElement("div");
    bubble.className = "native-user-bubble-reference";
    bubble.style.cssText =
      "background:var(--dsw-specific-bubble);border-radius:var(--dsw-radius-xl);max-width:100%;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;padding:10px 16px";
    bubble.textContent = "等一下，有点问题";
    stack.append(image, bubble);
    reference.append(stack);
    document.body.append(reference);
    const canvasStyle = getComputedStyle(
      row.querySelector(".chat-user-message-bubble"),
    );
    const nativeStyle = getComputedStyle(bubble);
    const keys = [
      "backgroundColor",
      "borderRadius",
      "fontSize",
      "lineHeight",
      "color",
      "paddingTop",
      "paddingRight",
      "wordBreak",
      "whiteSpace",
    ];
    return {
      canvas: Object.fromEntries(keys.map((key) => [key, canvasStyle[key]])),
      native: Object.fromEntries(keys.map((key) => [key, nativeStyle[key]])),
    };
  });
  assert.deepEqual(nativeParity.canvas, nativeParity.native);
  if (process.env.MEDIA_COMPARE_SCREENSHOT)
    await page.screenshot({ path: process.env.MEDIA_COMPARE_SCREENSHOT });
  await page
    .locator("#native-user-reference")
    .evaluate((node) => node.remove());

  row = await render("pure");
  assert.equal(await row.locator(".chat-user-message-bubble").count(), 0);
  assert.equal(await row.locator(".chat-user-image-tile").count(), 1);
  assert.equal(
    (await row.getAttribute("aria-label")).includes("附件 1 个"),
    true,
  );
  row = await render("tall");
  assert.deepEqual(await geometry(row), {
    width: 103,
    height: 240,
    variant: "single",
  });
  row = await render("multi");
  assert.equal(await row.locator(".chat-user-image-tile").count(), 2);
  assert.deepEqual(await geometry(row), {
    width: 64,
    height: 64,
    variant: "tile",
  });
  row = await render("file");
  assert.equal(await row.locator(".chat-user-message-bubble").count(), 0);
  assert.equal(
    await row.locator(".chat-user-file-name").textContent(),
    "notes.txt",
  );
  assert.equal((await row.textContent()).includes("[文件 1 个]"), false);
  const fileRect = await row.locator(".chat-user-file-card").boundingBox();
  assert.equal(Math.round(fileRect.width), 240);
  assert.ok(fileRect.height >= 64);
  row = await render("multi");
  await page.setViewportSize({ width: 420, height: 650 });
  await row.scrollIntoViewIfNeeded();
  const narrow = await page
    .locator("#media-test .chat-user-history")
    .evaluate((rail) => ({
      clientWidth: rail.clientWidth,
      scrollWidth: rail.scrollWidth,
      clientHeight: rail.clientHeight,
      scrollHeight: rail.scrollHeight,
    }));
  assert.ok(
    narrow.scrollWidth <= narrow.clientWidth + 1,
    JSON.stringify(narrow),
  );
  assert.ok(
    narrow.scrollHeight > narrow.clientHeight,
    "the three-row rail still scrolls",
  );
  assert.deepEqual(errors, []);
  console.log(
    "native-size media, pure image, mixed text, multi image, file card and narrow rail: OK",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
