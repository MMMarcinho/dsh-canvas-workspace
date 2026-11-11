import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { constants, zstdCompressSync } from "node:zlib";
import { chromium } from "@playwright/test";
const root = resolve(".host-test/frame-bounds");
const cwd = resolve(root, "workdir");
const executable =
  process.env.DSH_TEST_NODE ||
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness";
const cli =
  process.env.DSH_TEST_CLI ||
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
      process.env.CHROMIUM_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
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
      const center = [...frame.children].find((n) =>
        n.querySelector('[data-slot="main"]'),
      );
      const sidebar = [...frame.children].find((n) =>
        n.querySelector('[data-slot="sidebar"]'),
      );
      return {
        left: center.getBoundingClientRect().left,
        frameLeft: frame.getBoundingClientRect().left,
        columns: frame.style.gridTemplateColumns,
        sidebarWidth: sidebar.getBoundingClientRect().width,
        collapsed: frame.hasAttribute("data-sidebar-collapsed"),
      };
    });
  const result = [];
  const editor = page
    .locator('[data-composer-seat] [contenteditable="true"]')
    .first();
  await editor.fill("未发送的边界回归草稿");
  for (const collapsed of [false, true, false]) {
    const current = await readFrame();
    if (current.collapsed !== collapsed) {
      await page
        .getByRole("button", {
          name: collapsed ? "收起侧边栏" : "打开侧边栏",
          exact: true,
        })
        .click();
      await page.waitForTimeout(500);
    }
    const before = await readFrame();
    await canvasTab.click();
    await page.locator("[data-canvas-conversation-view] .chat-reply").waitFor();
    await page.waitForTimeout(500);
    const active = await readFrame();
    assert.equal(active.left, active.frameLeft, JSON.stringify(active));
    assert.equal(active.sidebarWidth, 0);
    assert.equal(
      active.columns,
      before.columns,
      "saved native tracks unchanged",
    );
    await page.screenshot({
      path: `artifacts/host-frame-${collapsed ? "collapsed" : "expanded"}.png`,
    });
    await page.getByRole("tab", { name: "对话", exact: true }).click();
    await page
      .locator("[data-canvas-conversation-view]")
      .waitFor({ state: "detached" });
    const after = await readFrame();
    assert.deepEqual(
      after,
      before,
      "exit restores native sidebar state and width",
    );
    assert.ok((await editor.innerText()).includes("未发送的边界回归草稿"));
    result.push({ collapsed, before, active, after });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (diagnostics) console.log(redact(diagnostics).slice(-8000));
  await browser?.close();
  server.kill("SIGTERM");
}
