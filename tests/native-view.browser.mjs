import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { constants, zstdCompressSync } from "node:zlib";
import { chromium } from "@playwright/test";
const root = resolve(".host-test/native-view");
const cwd = resolve(root, "workdir");
const executable =
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness";
const cli =
  "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js";
const env = {
  PATH: `${resolve(".research/pnpm/node_modules/.bin")}:${process.env.PATH}`,
  LANG: "zh_CN.UTF-8",
  HOME: resolve(root, "home"),
  DSH_HOME: resolve(root, "dsh"),
  XDG_DATA_HOME: resolve(root, "xdg-data"),
  XDG_CACHE_HOME: resolve(root, "xdg-cache"),
  XDG_CONFIG_HOME: resolve(root, "xdg-config"),
  ELECTRON_RUN_AS_NODE: "1",
};
await rm(root, { recursive: true, force: true });
await Promise.all(
  [cwd, env.HOME, env.DSH_HOME, "artifacts"].map((path) =>
    mkdir(path, { recursive: true }),
  ),
);
const redact = (text) => text.replace(/token=[^\s"'<>]+/g, "token=[redacted]");
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, ["--expose-internals", cli, ...args], {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(redact(output))),
    );
    child.once("error", reject);
  });
await run(["plugin", "--profile", "web", "add", `link:${process.cwd()}`]);
// Synthetic durable history gives the native header real nonblank Session scope;
// no real user history, credentials or model requests are used.
await rm(resolve(env.DSH_HOME, "sessions"), { recursive: true, force: true });
const id = `session-${randomUUID()}`;
const sessionDir = resolve(
  env.DSH_HOME,
  "sessions",
  `--${cwd.slice(1).replaceAll("/", "-")}--`,
  id,
);
await mkdir(sessionDir, { recursive: true });
const time = Date.now();
const event = (type, seq, data, surface = false) => ({
  type,
  seq,
  time: time + seq,
  data,
  ...(surface ? { surfaceOp: "append" } : {}),
});
const rows = [
  {
    type: "session",
    version: 4,
    id,
    createdAt: time,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: "standard",
  },
  event("turn/start", 0, { turn: 1 }),
  event("step/start", 1, { turn: 1, step: 1 }),
  event(
    "user/message",
    2,
    {
      role: "user",
      id: randomUUID(),
      source: { kind: "user", rpcId: randomUUID() },
      content: [{ type: "text", text: "原生画布视图隔离验证" }],
    },
    true,
  ),
  event(
    "assistant/message",
    3,
    {
      turn: 1,
      step: 1,
      stream: [],
      message: {
        role: "assistant",
        source: { kind: "model", provider: "fixture", model: "fixture" },
        id: randomUUID(),
        content: [
          {
            type: "text",
            text: "## 保留当前会话\n\n这条历史回复用于验证原生对话与画布切换，不发送模型请求。",
          },
        ],
      },
    },
    true,
  ),
  event("step/end", 4, { turn: 1, step: 1 }),
  event("turn/end", 5, { turn: 1, reason: { kind: "completed" } }),
];
const compress = (text) =>
  zstdCompressSync(Buffer.from(text), {
    params: { [constants.ZSTD_c_checksumFlag]: 1 },
  });
await writeFile(
  resolve(sessionDir, "session.v4.jsonl.zstd"),
  Buffer.concat([
    compress(JSON.stringify(rows[0]) + "\n"),
    compress(
      rows
        .slice(1)
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    ),
  ]),
);
const archiveId = `session-${randomUUID()}`;
const childId = `session-${randomUUID()}`;
const blankId = `session-${randomUUID()}`;
const extraId = `session-${randomUUID()}`;
for (const [extra, blank, child] of [
  [archiveId, false, false],
  [childId, false, true],
  [extraId, false, false],
]) {
  const extraCwd = extra === extraId ? resolve(root, "other-workdir") : cwd;
  const dir = resolve(
    env.DSH_HOME,
    "sessions",
    `--${extraCwd.slice(1).replaceAll("/", "-")}--`,
    extra,
  );
  await mkdir(dir, { recursive: true });
  const header = {
    ...rows[0],
    id: extra,
    ...(extra === extraId ? { cwd: resolve(root, "other-workdir") } : {}),
    ...(child
      ? { parentSession: id, delegationDepth: 1, origin: "subagent" }
      : {}),
  };
  await writeFile(
    resolve(dir, "session.v4.jsonl.zstd"),
    Buffer.concat([
      compress(JSON.stringify(header) + "\n"),
      ...(blank
        ? []
        : [
            compress(
              rows
                .slice(1)
                .map((row) => JSON.stringify(row))
                .join("\n") + "\n",
            ),
          ]),
    ]),
  );
}
await mkdir(resolve(root, "other-workdir"), { recursive: true });
const extraWorkspaceId = randomUUID();
const workspaceId = randomUUID();
await mkdir(resolve(env.DSH_HOME, "storages"), { recursive: true });
await writeFile(
  resolve(env.DSH_HOME, "storages/workspace.json"),
  JSON.stringify({
    unit: { name: "workspace", version: 2 },
    global: {
      initialized: true,
      workspaceIds: [workspaceId, extraWorkspaceId],
      archivedSessionIds: [archiveId],
      pinnedSessionIds: [],
      defaultWorkspaceId: workspaceId,
    },
    tables: {
      workspaces: {
        [extraWorkspaceId]: {
          path: resolve(root, "other-workdir"),
          title: "default-workspace",
          sessionIds: [extraId],
          createdAt: new Date(time).toISOString(),
          updatedAt: new Date(time).toISOString(),
        },
        [workspaceId]: {
          path: cwd,
          title: "隔离测试工作区",
          sessionIds: [id, archiveId, childId],
          createdAt: new Date(time).toISOString(),
          updatedAt: new Date(time).toISOString(),
        },
      },
    },
  }),
);
const server = spawn(
  executable,
  [
    "--expose-internals",
    cli,
    "web",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--no-open",
  ],
  { env, cwd, stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
let diagnostics = "";
server.stderr.on("data", (chunk) => (diagnostics += chunk));
try {
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(`Host timeout: ${redact(output)}`)),
      45000,
    );
    const onData = (data) => {
      output += data;
      const match = output.match(/https?:\/\/127\.0\.0\.1:\d+\/[^\s]*/);
      if (match && match[0].includes("token=")) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Host exited ${code}: ${redact(output)}`));
    });
  });
  browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForTimeout(1500);
  const proceed = page.getByRole("button", { name: "继续", exact: true });
  if (await proceed.count()) await proceed.click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const openSidebar = page.getByRole("button", {
    name: "打开侧边栏",
    exact: true,
  });
  if (await openSidebar.count()) await openSidebar.click();
  const workspace = page
    .getByRole("button", { name: "隔离测试工作区", exact: true })
    .first();
  if (await workspace.count()) {
    await workspace.click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1000);
  const closeWelcome = page
    .getByRole("button", { name: "关闭", exact: true })
    .first();
  if (await closeWelcome.isVisible()) await closeWelcome.click();
  await page.keyboard.press("Escape");
  const session = page.getByText("未命名", { exact: true }).first();
  if (!(await session.count())) {
    await page.screenshot({ path: "artifacts/native-view-before.png" });
    console.log((await page.locator("body").innerText()).slice(0, 2000));
  }
  await session.click();
  const canvasTab = page.getByRole("tab", { name: "画布", exact: true });
  if (!(await canvasTab.count())) {
    await page.screenshot({ path: "artifacts/native-view-before.png" });
    console.log((await page.locator("body").innerText()).slice(0, 2000));
  }
  const readFrame = () =>
    page.evaluate(() => {
      const frame = document.querySelector(
        "[data-shell-overlay]",
      ).parentElement;
      const sidebar = frame.querySelector(
        ":scope > div > [data-slot=sidebar]",
      ).parentElement;
      const main = frame.querySelector(
        ":scope > div > [data-slot=main]",
      ).parentElement;
      return {
        sidebar: sidebar.getBoundingClientRect().toJSON(),
        main: main.getBoundingClientRect().toJSON(),
        frame: frame.getBoundingClientRect().toJSON(),
        columns: frame.style.gridTemplateColumns,
      };
    });
  const defaultGroup = page.locator(
    `[data-row-key="workspace:${extraWorkspaceId}"]`,
  );
  await defaultGroup.click();
  const nativeSessionIds = await page
    .locator('[data-row-key^="session:"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-row-key").slice(8)).sort(),
    );
  assert.deepEqual(
    nativeSessionIds,
    [id, extraId].sort(),
    "native filters archive, subagent and inactive blank fixtures",
  );
  const before = await readFrame();
  assert.equal(
    await page
      .getByRole("button", { name: "Canvas · 画布", exact: true })
      .count(),
    0,
  );
  await canvasTab.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "artifacts/native-conversation-canvas.png" });
  await page
    .locator("[data-canvas-conversation-view] .chat-reply")
    .waitFor({ timeout: 8000 });
  await page.screenshot({ path: "artifacts/native-conversation-canvas.png" });
  assert.equal(await canvasTab.getAttribute("aria-selected"), "true");
  const active = await readFrame();
  assert.equal(
    active.sidebar.width,
    0,
    "native sidebar is hidden while Canvas is selected",
  );
  assert.ok(
    Math.abs(active.main.left - active.frame.left) < 1,
    JSON.stringify(active),
  );
  assert.equal(
    active.columns,
    before.columns,
    "host preferences are untouched",
  );
  // Native text selection must remain available; a background drag must never
  // start a browser selection, including the first sub-threshold frame.
  const paragraph = page.locator(".chat-reply .chat-markdown p").first();
  await paragraph.click({ clickCount: 3 });
  assert.ok(
    await page.evaluate(() => window.getSelection()?.toString().length > 0),
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.keyboard.press("ControlOrMeta+C");
  assert.ok(
    (await page.evaluate(() => navigator.clipboard.readText())).includes(
      "历史回复",
    ),
  );
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const stage = page.locator(".chat-stage");
  const stageBox = await stage.boundingBox();
  const point = {
    x: stageBox.x + stageBox.width / 2,
    y: stageBox.y + stageBox.height - 55,
  };
  await page.evaluate(() => {
    window.__selectionFlashes = [];
    window.__recordSelection = () => {
      const stage = document.querySelector(".chat-stage");
      if (
        stage?.hasAttribute("data-canvas-dragging") &&
        window.getSelection()?.toString()
      )
        window.__selectionFlashes.push(window.getSelection().toString());
    };
    document.addEventListener("selectionchange", window.__recordSelection);
  });
  for (const interrupt of ["up", "Escape", "blur", "cancel"]) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    assert.equal(await stage.getAttribute("data-canvas-dragging"), "");
    await page.mouse.move(point.x + 1, point.y + 1);
    assert.equal(
      await page.evaluate(() => window.getSelection()?.toString()),
      "",
    );
    await page.mouse.move(point.x + 65, point.y - 25, { steps: 12 });
    if (interrupt === "Escape") await page.keyboard.press("Escape");
    if (interrupt === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (interrupt === "cancel")
      await stage.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    assert.equal(await stage.getAttribute("data-canvas-dragging"), null);
  }
  assert.deepEqual(await page.evaluate(() => window.__selectionFlashes), []);
  // Return camera to its original position using the existing reset control.
  await page.evaluate(() =>
    document.removeEventListener("selectionchange", window.__recordSelection),
  );
  const menu = page.getByRole("button", { name: "导航与工作区", exact: true });
  await menu.click();
  await page
    .getByRole("dialog", { name: "导航与工作区", exact: true })
    .waitFor();
  assert.equal(
    (await readFrame()).main.width,
    active.main.width,
    "opening the floating menu never shrinks Canvas",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Canvas · 画布", exact: true })
      .count(),
    0,
  );
  const canvasDefault = page
    .locator(".chat-sidebar-project")
    .filter({ hasText: "默认工作区" });
  await canvasDefault.click();
  assert.deepEqual(
    await page
      .locator(".chat-sidebar-session")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-session-id")).sort(),
      ),
    nativeSessionIds,
  );
  assert.deepEqual(
    await page.locator(".chat-sidebar-session").allTextContents(),
    ["未命名", "未命名"],
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("dialog", { name: "导航与工作区", exact: true })
      .count(),
    0,
  );

  const layoutButton = page.getByRole("button", {
    name: "自动排布画布内容",
    exact: true,
  });
  await layoutButton.waitFor();
  const cameraBefore = await page
    .locator(".chat-world")
    .evaluate((node) => node.style.transform);
  await layoutButton.click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".chat-reply")].every(
      (node) => node.dataset.positioned === "true",
    ),
  );
  assert.equal(
    await page.locator(".chat-world").evaluate((node) => node.style.transform),
    cameraBefore,
  );
  const accountButton = page.getByRole("button", {
    name: "账户与版本",
    exact: true,
  });
  const checkAccount = async (width, height, exit) => {
    await accountButton.click();
    const account = page.getByRole("dialog", {
      name: "账户与版本",
      exact: true,
    });
    const bounds = await account.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= height,
      JSON.stringify(bounds),
    );
    const settings = account.getByRole("button", { name: /设置/ }).first();
    if (exit) {
      await settings.click();
      await page
        .locator("[data-canvas-conversation-view]")
        .waitFor({ state: "detached" });
      await canvasTab.click();
      await page.locator(".chat-reply").waitFor();
    } else {
      await settings.click({ trial: true });
      await page.screenshot({ path: `artifacts/native-account-${width}.png` });
      await page.keyboard.press("Escape");
    }
  };
  await checkAccount(1440, 1000, true);
  assert.equal(await page.locator(".chat-native-composer").count(), 0);
  assert.equal(await page.locator("[data-composer-seat]").count(), 1);
  const model = page
    .locator(
      '[data-composer-seat] [data-slot="conversation.input.model"] button[aria-haspopup="menu"]',
    )
    .first();
  await model.waitFor();
  await model.evaluate((button) => {
    const label = [...button.children].find((n) => n.tagName === "SPAN");
    label.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap"><span>DeepSeek-V4.1-Flash</span><span style="font-size:12px;padding:0 5px;border-radius:8px;background:#e7edff">1017</span></span>';
  });
  for (const width of [1440, 620, 375, 320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(250);
    const layout = await model.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const label = [...button.children].find((n) => n.tagName === "SPAN");
      const seat = button
        .closest("[data-composer-seat]")
        .getBoundingClientRect();
      return {
        hidden: getComputedStyle(label).display === "none",
        clipped: label.scrollWidth > label.clientWidth + 1,
        left: rect.left,
        right: rect.right,
        seatLeft: seat.left,
        seatRight: seat.right,
      };
    });
    assert.ok(
      layout.hidden || !layout.clipped,
      JSON.stringify({ width, ...layout }),
    );
    assert.ok(
      layout.left >= layout.seatLeft && layout.right <= layout.seatRight,
      JSON.stringify({ width, ...layout }),
    );
  }
  const editor = page
    .locator('[data-composer-seat] [contenteditable="true"]')
    .first();
  await editor.fill("未发送的草稿，用于验证视图切换");
  await page.locator('[data-composer-seat] input[type="file"]').setInputFiles({
    name: "canvas-fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("isolated attachment fixture"),
  });
  await page.getByText("canvas-fixture.txt", { exact: true }).first().waitFor();

  await page.locator(".chat-reply [data-canvas-reply-handle]").first().focus();
  await page.keyboard.press("ArrowRight");
  const manualLeft = await page
    .locator(".chat-reply")
    .first()
    .evaluate((node) => node.style.left);
  await page.locator(".chat-reply .chat-pin-reply").first().click();
  assert.equal(
    await page
      .locator(".chat-reply .chat-pin-reply")
      .first()
      .getAttribute("aria-pressed"),
    "true",
  );

  await page.getByRole("tab", { name: "对话", exact: true }).click();
  await page
    .locator("[data-canvas-conversation-view]")
    .waitFor({ state: "detached" });
  assert.ok((await editor.innerText()).includes("未发送的草稿"));
  const restored = await readFrame();
  assert.equal(restored.sidebar.width, before.sidebar.width);
  assert.equal(restored.columns, before.columns);
  await canvasTab.click();
  await page
    .locator("[data-canvas-conversation-view] .chat-reply")
    .waitFor({ timeout: 8000 });
  assert.ok((await editor.innerText()).includes("未发送的草稿"));
  assert.equal(
    await page
      .locator(".chat-reply")
      .first()
      .evaluate((node) => node.style.left),
    manualLeft,
  );
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector("[data-canvas-conversation-view]");
    const seat = document.querySelector("[data-composer-seat]");
    const rail = document.querySelector(".chat-user-history");
    return {
      canvas: canvas.getBoundingClientRect().toJSON(),
      composer: seat.getBoundingClientRect().toJSON(),
      rail: rail.getBoundingClientRect().toJSON(),
    };
  });
  assert.ok(geometry.canvas.height > 500, JSON.stringify(geometry));
  assert.ok(
    geometry.rail.bottom < geometry.composer.top,
    JSON.stringify(geometry),
  );
  await page.setViewportSize({ width: 620, height: 850 });
  await page.waitForTimeout(400);
  const narrow = await readFrame();
  assert.equal(narrow.sidebar.width, 0);
  assert.ok(Math.abs(narrow.main.left - narrow.frame.left) < 1);
  await menu.click();
  const popup = page.getByRole("dialog", { name: "导航与工作区", exact: true });
  const popupBounds = await popup.boundingBox();
  assert.ok(
    popupBounds.x >= 0 && popupBounds.x + popupBounds.width <= 620,
    JSON.stringify(popupBounds),
  );
  assert.ok(
    popupBounds.y >= 0 && popupBounds.y + popupBounds.height <= 850,
    JSON.stringify(popupBounds),
  );
  assert.equal((await readFrame()).main.width, narrow.main.width);
  await page.screenshot({ path: "artifacts/native-canvas-menu-narrow.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 375, height: 850 });
  await page.waitForTimeout(300);
  await checkAccount(375, 850, false);
  await layoutButton.click();
  assert.equal(
    await page
      .locator(".chat-reply")
      .first()
      .evaluate((node) => node.style.left),
    manualLeft,
    "automatic layout preserves explicitly pinned positions",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "artifacts/native-canvas-single-sidebar.png" });
  for (const [width, height, lines] of [
    [1440, 1000, 1],
    [620, 700, 8],
    [375, 600, 3],
    [620, 420, 1],
  ]) {
    await page.setViewportSize({ width, height });
    await editor.fill(
      Array.from({ length: lines }, (_, i) => `输入行 ${i}`).join("\n"),
    );
    await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
      const rail = document.querySelector(".chat-user-history");
      const frame = document.querySelector(".chat-user-history-frame");
      const seat = document.querySelector("[data-composer-seat]");
      const r = rail.getBoundingClientRect(),
        f = frame.getBoundingClientRect(),
        c = seat.getBoundingClientRect();
      return {
        gap: c.top - r.bottom,
        top: r.top,
        height: r.height,
        frameBottom: f.bottom,
        bottom: r.bottom,
        padding: getComputedStyle(rail).paddingBottom,
        bubbleGap:
          c.top -
          document
            .querySelector(".chat-user-message-stack")
            .getBoundingClientRect().bottom,
      };
    });
    assert.ok(
      layout.gap >= 3 && layout.gap <= 6,
      JSON.stringify({ width, height, layout }),
    );
    assert.ok(
      layout.top >= 70 && layout.height > 0,
      JSON.stringify({ width, height, layout }),
    );
    assert.equal(layout.padding, "0px");
    assert.ok(
      layout.bubbleGap >= 3 && layout.bubbleGap <= 6,
      JSON.stringify({ width, height, layout }),
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "artifacts/native-rail-gap-fixed.png" });
  await page.reload();
  await canvasTab.waitFor();
  if ((await canvasTab.getAttribute("aria-selected")) !== "true")
    await canvasTab.click();
  await page.locator(".chat-reply").first().waitFor();
  assert.equal(
    await page
      .locator(".chat-reply .chat-pin-reply")
      .first()
      .getAttribute("aria-pressed"),
    "true",
    "pin survives native host refresh",
  );
  await menu.click();
  const refreshedDefault = page
    .locator(".chat-sidebar-project")
    .filter({ hasText: "默认工作区" });
  if ((await refreshedDefault.getAttribute("aria-expanded")) !== "true")
    await refreshedDefault.click();
  assert.deepEqual(
    await page
      .locator(".chat-sidebar-session")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-session-id")).sort(),
      ),
    nativeSessionIds,
    "refresh keeps native membership",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "对话", exact: true }).click();
  const actions = page.locator(`[data-row-key="session:${id}"]`);
  await actions.hover();
  await actions.getByRole("button", { name: /会话.*的操作/ }).click();
  await page.getByText("在画布中打开", { exact: true }).click();
  await page.locator(".canvas-frame-overlay .chat-reply").waitFor();
  await page.getByRole("switch", { name: "画布模式", exact: true }).click();
  await page.locator(".canvas-frame-overlay").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log(
    "native View, account actions in viewport, visible layout button, single sidebar, draft and positions: OK",
  );
} finally {
  if (diagnostics) console.log(redact(diagnostics).slice(-8000));
  await browser?.close();
  server.kill("SIGTERM");
}
