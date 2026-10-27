import test, { after } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { CANVAS_CONTEXT_LABEL } from "../src/core/prompt";
import type { ConversationReply } from "../src/core/conversation";
import { activeReplyPair, buildReplyPairs } from "../src/ui/reply-pairing";
import type {
  AgentAdapter,
  AgentRun,
  AgentSessionSnapshot,
} from "../src/core/types";

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "http://localhost/" },
);
for (const name of [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "localStorage",
  "MutationObserver",
  "navigator",
] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: dom.window[name],
  });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const captures = new WeakMap<HTMLElement, Set<number>>();
dom.window.HTMLElement.prototype.setPointerCapture = function (id) {
  const ids = captures.get(this) ?? new Set();
  ids.add(id);
  captures.set(this, ids);
};
dom.window.HTMLElement.prototype.hasPointerCapture = function (id) {
  return captures.get(this)?.has(id) ?? false;
};
dom.window.HTMLElement.prototype.releasePointerCapture = function (id) {
  captures.get(this)?.delete(id);
};
const { createRoot } = await import("react-dom/client");
const { ChatCanvas } = await import("../src/ui/ChatCanvas");
const { UserMessageMedia } = await import("../src/ui/UserMessageMedia");
let root: ReturnType<typeof createRoot> | undefined;
const key = "dsh-canvas-conversation:v1:mock";
const element = (selector: string) => {
  const result = document.querySelector<HTMLElement>(selector);
  assert.ok(result, `missing ${selector}`);
  return result;
};
const click = async (selector: string) => {
  await act(async () => element(selector).click());
};
const type = async (selector: string, value: string) => {
  await act(async () => {
    const target = element(selector) as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(target, value);
    target.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};
const wait = async (predicate: () => boolean) => {
  const start = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - start < 3500, "timed out");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  }
};
const deferredAdapter = () => {
  const runs: {
    sessionId: string;
    prompt: string;
    onText: AgentRun["onText"];
    resolve: () => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
  }[] = [];
  let creates = 0,
    cancels = 0;
  const adapter: AgentAdapter = {
    kind: "mock",
    async createSession() {
      creates++;
      return "session-one";
    },
    run({ sessionId, prompt, onText, signal }) {
      return new Promise<void>((resolve, reject) => {
        runs.push({ sessionId, prompt, onText, resolve, reject, signal });
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
    async cancel() {
      cancels++;
    },
  };
  return {
    adapter,
    runs,
    get creates() {
      return creates;
    },
    get cancels() {
      return cancels;
    },
  };
};
async function mount(
  adapter: AgentAdapter,
  clear = true,
  onExit?: () => void,
  mode: "mock" | "dsh" = "mock",
) {
  if (root) await act(async () => root!.unmount());
  if (clear) localStorage.clear();
  root = createRoot(element("#root"));
  await act(async () =>
    root!.render(<ChatCanvas adapter={adapter} mode={mode} onExit={onExit} />),
  );
}

test("single-session spatial chat streams, stops, persists, and restores", async (t) => {
  const control = deferredAdapter();
  await mount(control.adapter);
  assert.equal(document.querySelectorAll(".chat-reply").length, 0);
  await type('[aria-label="向 Agent 输入"]', "第一个问题");
  await click(".chat-send");
  await wait(() => control.runs.length === 1);
  assert.equal(control.creates, 1);
  await act(async () => control.runs[0].onText("部分"));
  assert.equal(element(".chat-reply .chat-markdown").textContent, "部分");
  await act(async () => {
    control.runs[0].onText("完整回答");
    control.runs[0].resolve();
  });
  await wait(() => Boolean(document.querySelector(".chat-reply-status.done")));
  assert.equal(element(".chat-reply .chat-markdown").textContent, "完整回答");
  await type('[aria-label="向 Agent 输入"]', "继续追问");
  await click(".chat-send");
  await wait(() => control.runs.length === 2);
  assert.equal(control.creates, 1, "later prompts must reuse the same session");
  assert.equal(control.runs[1].sessionId, "session-one");
  assert.equal(document.querySelectorAll(".chat-reply").length, 2);
  await act(async () => control.runs[1].onText("已输出的部分"));
  await click(".chat-stop");
  assert.equal(control.cancels, 1);
  assert.equal(
    element('[data-testid="chat-reply-1"] .chat-markdown').textContent,
    "已输出的部分",
  );
  assert.match(
    element('[data-testid="chat-reply-1"] .chat-reply-status').textContent ??
      "",
    /已停止/,
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 210)));
  const saved = JSON.parse(localStorage.getItem(key)!);
  assert.equal(saved.sessionId, "session-one");
  assert.equal(saved.replies.length, 2);
  assert.equal(saved.replies[1].status, "stopped");
  await mount(control.adapter, false);
  assert.equal(document.querySelectorAll(".chat-reply").length, 2);
  assert.equal(
    element('[data-testid="chat-reply-0"] .chat-markdown').textContent,
    "完整回答",
  );
  await type('[aria-label="向 Agent 输入"]', "第三次");
  await click(".chat-send");
  await wait(() => control.runs.length === 3);
  assert.equal(control.creates, 1);
  await act(async () => control.runs[2].reject(new Error("host unavailable")));
  await wait(() =>
    Boolean(
      document.querySelector(
        '[data-testid="chat-reply-2"] .chat-reply-status.error',
      ),
    ),
  );
  assert.match(
    element('[data-testid="chat-reply-2"] .chat-reply-error').textContent ?? "",
    /host unavailable/,
  );
});

test("new canvas sessions use a real workspace session and restore each canvas without leaving the panel", async () => {
  if (root) await act(async () => root!.unmount());
  localStorage.clear();
  const old = {
    version: 1,
    sessionId: "old-session",
    viewport: { x: 233, y: -44, zoom: 1.4 },
    replies: [
      {
        id: "old-reply",
        prompt: "旧问题",
        body: "旧回复",
        status: "done",
        position: { x: 120, y: 310, slotHeight: 180 },
      },
    ],
  };
  localStorage.setItem("dsh-canvas-conversation:v1:dsh", JSON.stringify(old));
  let calls = 0;
  let fail = true;
  let resolveNew!: (id: string) => void;
  const createdIn: (string | undefined)[] = [];
  const opened: string[] = [];
  const selected: (string | undefined)[] = [];
  const observers = new Map<string, (snapshot: AgentSessionSnapshot) => void>();
  const props = {
    adapter: {
      ...deferredAdapter().adapter,
      observeSession(
        id: string,
        listener: (snapshot: AgentSessionSnapshot) => void,
      ) {
        observers.set(id, listener);
        return () => observers.delete(id);
      },
    },
    mode: "dsh" as const,
    useNativeComposer: true,
    nativeComposer: <button data-native-input="">原生输入</button>,
    hostSessions: [
      { id: "old-session", title: "旧会话" },
      { id: "new-session", title: "新会话" },
    ],
    hostWorkspaces: [
      {
        id: "project-one",
        title: "项目一",
        sessionIds: ["old-session", "new-session"],
      },
      { id: "project-two", title: "项目二", sessionIds: [] },
    ],
    onOpenSession: (id: string) => opened.push(id),
    onSessionChange: (id: string | undefined) => selected.push(id),
    onNewSession: (workspaceId?: string) => {
      calls++;
      createdIn.push(workspaceId);
      if (fail) return Promise.reject(new Error("创建被拒绝"));
      return new Promise<string>((resolve) => {
        resolveNew = resolve;
      });
    },
  };
  root = createRoot(element("#root"));
  await act(async () => root!.render(<ChatCanvas {...props} />));
  assert.equal(element(".chat-reply .chat-markdown").textContent, "旧回复");
  await click('[aria-label="新建画布会话"]');
  await wait(() => Boolean(document.querySelector(".chat-nav-error")));
  assert.match(element(".chat-nav-error").textContent ?? "", /创建被拒绝/);
  assert.equal(element(".chat-reply .chat-markdown").textContent, "旧回复");
  assert.equal(selected.at(-1), "old-session");

  fail = false;
  await click('[aria-label="新建画布会话"]');
  await click('[aria-label="新建画布会话"]');
  assert.equal(calls, 2, "a repeated click cannot create a second session");
  assert.deepEqual(createdIn, ["project-one", "project-one"]);
  assert.equal(element(".chat-reply .chat-markdown").textContent, "旧回复");
  const staleOldObserver = observers.get("old-session");
  assert.ok(staleOldObserver);
  await act(async () => resolveNew("new-session"));
  assert.equal(selected.at(-1), "new-session");
  assert.equal(document.querySelectorAll(".chat-reply").length, 0);
  assert.equal(element("[data-native-input]").textContent, "原生输入");
  assert.equal(observers.has("old-session"), false);
  assert.equal(observers.has("new-session"), true);
  await act(async () =>
    staleOldObserver({
      sessionId: "old-session",
      turns: [],
      hasMore: false,
      error: "旧会话延迟错误",
    }),
  );
  assert.equal(document.querySelector(".chat-composer-notice"), null);
  const savedOld = JSON.parse(
    localStorage.getItem("dsh-canvas-conversation:v1:dsh:session:old-session")!,
  );
  assert.deepEqual(savedOld.viewport, old.viewport);
  assert.deepEqual(savedOld.replies[0].position, old.replies[0].position);

  await click('[aria-label="导航与工作区"]');
  await click('.chat-session-row[aria-current="page"]');
  assert.equal(selected.at(-1), "new-session");
  assert.deepEqual(opened, [], "canvas switching must not reveal native chat");

  await click('[aria-label="导航与工作区"]');
  const oldButton = [
    ...document.querySelectorAll<HTMLButtonElement>(".chat-session-row"),
  ].find((button) => button.textContent === "旧会话");
  assert.ok(oldButton);
  await act(async () => oldButton.click());
  assert.equal(selected.at(-1), "old-session");
  assert.equal(element(".chat-reply .chat-markdown").textContent, "旧回复");
  assert.equal(
    JSON.parse(localStorage.getItem("dsh-canvas-conversation:v1:dsh")!).viewport
      .x,
    233,
  );

  await act(async () => root!.unmount());
  root = createRoot(element("#root"));
  await act(async () => root!.render(<ChatCanvas {...props} />));
  assert.equal(element(".chat-reply .chat-markdown").textContent, "旧回复");
  await click('[aria-label="导航与工作区"]');
  const newButton = [
    ...document.querySelectorAll<HTMLButtonElement>(".chat-session-row"),
  ].find((button) => button.textContent === "新会话");
  assert.ok(newButton);
  await act(async () => newButton.click());
  assert.equal(selected.at(-1), "new-session");
  assert.equal(document.querySelectorAll(".chat-reply").length, 0);

  await click('[aria-label="导航与工作区"]');
  const otherWorkspace = [
    ...document.querySelectorAll<HTMLElement>(".chat-workspace-group"),
  ].find((group) => group.textContent?.includes("项目二"));
  assert.ok(otherWorkspace);
  const createInOther =
    otherWorkspace.querySelector<HTMLButtonElement>(".chat-session-row");
  assert.ok(createInOther);
  await act(async () => createInOther.click());
  assert.equal(createdIn.at(-1), "project-two");
  await act(async () => resolveNew("project-two-session"));
  assert.equal(selected.at(-1), "project-two-session");
  assert.equal(document.querySelectorAll(".chat-reply").length, 0);

  let handled = 0;
  const requestedSession = { sessionId: "old-session", token: 1 };
  await act(async () =>
    root!.render(
      <ChatCanvas
        {...props}
        requestedSession={requestedSession}
        onRequestHandled={() => handled++}
      />,
    ),
  );
  assert.equal(handled, 1);
  assert.equal(selected.at(-1), "old-session");
  assert.equal(element(".chat-reply .chat-markdown").textContent, "旧回复");
  await act(async () =>
    root!.render(
      <ChatCanvas
        {...props}
        requestedSession={requestedSession}
        onRequestHandled={() => handled++}
      />,
    ),
  );
  assert.equal(handled, 1, "a sidebar request is handled once");
});

test("native composer owns its input and observed attachment-only turns enter the canvas once", async () => {
  if (root) await act(async () => root!.unmount());
  localStorage.clear();
  const control = deferredAdapter();
  let observed: ((snapshot: AgentSessionSnapshot) => void) | undefined;
  const adapter: AgentAdapter = {
    ...control.adapter,
    observeSession(_id, listener) {
      observed = listener;
      return () => {
        observed = undefined;
      };
    },
  };
  const sessionIds: (string | undefined)[] = [];
  const image = (id: string) => ({
    type: "image" as const,
    image: {
      attachment: {
        attachmentId: id as never,
        mediaType: "image/png" as const,
        bytes: 68,
        width: id === "first" ? 888 : 16,
        height: id === "first" ? 380 : 16,
        name: `${id}.png`,
      },
    },
  });
  const loadedImages: string[] = [];
  root = createRoot(element("#root"));
  await act(async () =>
    root!.render(
      <ChatCanvas
        adapter={adapter}
        mode="dsh"
        useNativeComposer
        loadUserImage={async (attachment) => {
          loadedImages.push(String(attachment.attachmentId));
          return `https://example.com/${attachment.attachmentId}.png`;
        }}
        renderImagePreview={(src, alt, onClose) => (
          <div role="dialog" aria-label={alt}>
            <img src={src} alt={alt} />
            <button onClick={onClose}>关闭图片</button>
          </div>
        )}
        nativeComposer={
          <button type="button" data-native-input="">
            原生输入
          </button>
        }
        onSessionChange={(id) => sessionIds.push(id)}
      />,
    ),
  );
  await wait(
    () =>
      control.creates === 1 &&
      sessionIds.includes("session-one") &&
      Boolean(observed),
  );
  assert.equal(document.querySelector(".chat-composer textarea"), null);
  assert.equal(element("[data-native-input]").textContent, "原生输入");
  assert.ok(element(".chat-dock").classList.contains("is-native"));
  await act(async () =>
    observed!({
      sessionId: "session-one",
      hasMore: false,
      turns: [
        {
          turnId: 1,
          userMessages: [
            {
              id: "image-only",
              text: "",
              attachments: [image("first")],
              timestamp: 1000,
            },
          ],
          body: "已收到图片",
          status: "done",
          durable: true,
        },
      ],
    }),
  );
  assert.equal(
    control.runs.length,
    0,
    "native sending must not replay through CanvasRun",
  );
  assert.equal(document.querySelectorAll(".chat-reply").length, 1);
  assert.equal(document.querySelector(".chat-user-message-bubble"), null);
  assert.equal(document.querySelectorAll(".chat-user-message").length, 1);
  await wait(() =>
    Boolean(document.querySelector(".chat-user-image-tile img")),
  );
  assert.deepEqual(loadedImages, ["first"]);
  assert.equal(element(".chat-user-image-tile").style.width, "240px");
  assert.equal(element(".chat-user-image-tile").style.height, "103px");
  await click(".chat-user-image-tile");
  assert.equal(
    element('[role="dialog"][aria-label="first.png"] img').getAttribute("src"),
    "https://example.com/first.png",
  );
  await click('[role="dialog"] button');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  const rail = element(".chat-user-history");
  Object.defineProperties(rail, {
    scrollHeight: { configurable: true, value: 400 },
    clientHeight: { configurable: true, value: 120 },
  });
  assert.equal(
    rail.scrollTop,
    0,
    "initial native history does not steal scroll",
  );
  await act(async () =>
    observed!({
      sessionId: "session-one",
      hasMore: false,
      turns: [
        {
          turnId: 1,
          userMessages: [
            {
              id: "image-only",
              text: "",
              attachments: [image("first")],
              timestamp: 1000,
            },
          ],
          body: "已收到图片",
          status: "done",
          durable: true,
        },
      ],
    }),
  );
  assert.equal(document.querySelectorAll(".chat-reply").length, 1);
  assert.equal(
    rail.scrollTop,
    0,
    "assistant settlement does not scroll the rail",
  );
  const first = element('[data-testid="chat-reply-0"]');
  first.getBoundingClientRect = () => ({ height: 180 }) as DOMRect;
  await keyEvent(
    element('[data-testid="chat-reply-0"] .chat-pan-handle'),
    "keydown",
    "ArrowRight",
  );
  const firstX = Number.parseFloat(first.style.left);
  const firstY = Number.parseFloat(first.style.top);
  await act(async () =>
    observed!({
      sessionId: "session-one",
      hasMore: false,
      turns: [
        {
          turnId: 1,
          userMessages: [
            {
              id: "image-only",
              text: "",
              attachments: [image("first")],
              timestamp: 1000,
            },
          ],
          body: "已收到图片",
          status: "done",
          durable: true,
        },
        {
          turnId: 2,
          userMessages: [{ id: "follow-up", text: "继续", timestamp: 2000 }],
          body: "继续回答",
          status: "done",
          durable: true,
        },
      ],
    }),
  );
  const second = element('[data-testid="chat-reply-1"]');
  assert.equal(Number.parseFloat(second.style.left), firstX);
  assert.equal(Number.parseFloat(second.style.top), firstY + 180 + 30);
  assert.equal(rail.scrollTop, 280, "new native input reveals the latest row");
  rail.scrollTop = 0;
  await act(async () =>
    observed!({
      sessionId: "session-one",
      hasMore: false,
      turns: [
        {
          turnId: 1,
          userMessages: [
            {
              id: "image-only",
              text: "",
              attachments: [image("first")],
              timestamp: 1000,
            },
          ],
          body: "已收到图片",
          status: "done",
          durable: true,
        },
        {
          turnId: 2,
          userMessages: [
            { id: "follow-up", text: "继续", timestamp: 2000 },
            {
              id: "next-image",
              text: "",
              attachments: [image("second"), image("third")],
              timestamp: 3000,
            },
          ],
          body: "继续回答",
          status: "done",
          durable: true,
        },
      ],
    }),
  );
  assert.equal(document.querySelectorAll(".chat-reply").length, 2);
  assert.equal(
    rail.scrollTop,
    280,
    "attachment-only input works without a new reply card",
  );
  await wait(
    () => document.querySelectorAll(".chat-user-image-tile img").length === 3,
  );
  assert.deepEqual(loadedImages, ["first", "second", "third"]);
  rail.scrollTop = 0;
  await act(async () =>
    observed!({
      sessionId: "session-one",
      hasMore: false,
      turns: [
        {
          turnId: 1,
          userMessages: [
            {
              id: "image-only",
              text: "",
              attachments: [image("first")],
              timestamp: 1000,
            },
          ],
          body: "已收到图片",
          status: "done",
          durable: true,
        },
        {
          turnId: 2,
          userMessages: [
            { id: "follow-up", text: "继续", timestamp: 2000 },
            {
              id: "next-image",
              text: "",
              attachments: [image("second"), image("third")],
              timestamp: 3000,
            },
          ],
          body: "继续回答（流式更新）",
          status: "running",
          durable: false,
        },
      ],
    }),
  );
  assert.equal(
    rail.scrollTop,
    0,
    "assistant updates never pull history to the end",
  );
});

test("sent file-only messages keep native-style cards and text copy stays local", async () => {
  const file = {
    type: "file" as const,
    file: { attachmentId: "file-one", name: "notes.txt", bytes: 1200 },
  };
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      sessionId: "session-one",
      viewport: { x: 64, y: 104, zoom: 1 },
      replies: [
        {
          id: "file-reply",
          prompt: "",
          body: "文件已收到",
          status: "done",
          userMessages: [{ id: "file-message", text: "", attachments: [file] }],
        },
        {
          id: "text-reply",
          prompt: "复制我",
          body: "已收到文字",
          status: "done",
          userMessages: [{ id: "text-message", text: "复制我" }],
        },
      ],
    }),
  );
  const copied: string[] = [];
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => copied.push(text) },
  });
  try {
    await mount(deferredAdapter().adapter, false);
    const fileRow = element('[data-user-message-id="file-message"]');
    assert.equal(fileRow.querySelector(".chat-user-message-bubble"), null);
    assert.equal(
      fileRow.querySelector(".chat-user-file-name")?.textContent,
      "notes.txt",
    );
    assert.equal(fileRow.textContent?.includes("[文件 1 个]"), false);
    assert.equal(document.querySelectorAll(".chat-user-message").length, 2);
    const before = element(".chat-world").style.transform;
    await click(
      '[data-user-message-id="text-message"] .chat-user-message-copy',
    );
    await wait(() => copied.length === 1);
    assert.deepEqual(copied, ["复制我"]);
    assert.equal(element(".chat-world").style.transform, before);
    assert.equal(
      element(
        '[data-user-message-id="text-message"] .chat-user-message-copy',
      ).getAttribute("aria-label"),
      "已复制",
    );
  } finally {
    if (originalClipboard)
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  }
});

test("navigation menu is dismissible and canvas switch restores host", async () => {
  let exits = 0;
  await mount(deferredAdapter().adapter, true, () => exits++);
  await click('[aria-label="导航与工作区"]');
  assert.ok(
    document.querySelector('[role="dialog"][aria-label="导航与工作区"]'),
  );
  await act(async () =>
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(
    document.querySelector('[role="dialog"][aria-label="导航与工作区"]'),
    null,
  );
  assert.equal(
    document.activeElement?.getAttribute("aria-label"),
    "导航与工作区",
  );
  await click('[aria-label="导航与工作区"]');
  await act(async () =>
    document
      .querySelector(".chat-stage")!
      .dispatchEvent(
        new dom.window.MouseEvent("pointerdown", { bubbles: true }),
      ),
  );
  assert.equal(
    document.querySelector('[role="dialog"][aria-label="导航与工作区"]'),
    null,
  );
  await click('[aria-label="导航与工作区"]');
  await click('[aria-pressed="true"]');
  assert.equal(exits, 1);
});

after(async () => {
  if (root) await act(async () => root!.unmount());
  dom.window.close();
});

test("user input lives only in right rail and durable assistant time survives reload", async () => {
  const control = deferredAdapter();
  await mount(control.adapter);
  await type('[aria-label="向 Agent 输入"]', "rail-only prompt");
  await click(".chat-send");
  await wait(() => control.runs.length === 1);
  const stamp = Date.UTC(2026, 9, 22, 12, 40, 25);
  await act(async () => {
    control.runs[0].onText("**Full durable reply**", {
      timestamp: stamp,
      durable: true,
    });
    control.runs[0].resolve();
  });
  assert.equal(
    element(".chat-user-history").textContent?.includes("rail-only prompt"),
    true,
  );
  assert.equal(
    element(".chat-world").textContent?.includes("rail-only prompt"),
    false,
  );
  assert.equal(document.querySelector(".chat-reply-head"), null);
  assert.equal(document.querySelector(".chat-reply-surface time"), null);
  assert.equal(
    element(".chat-reply time").parentElement?.className,
    "chat-reply-meta",
  );
  assert.equal(
    element(".chat-reply-meta").textContent?.includes("Agent"),
    false,
  );
  assert.equal(
    element(".chat-markdown strong").textContent,
    "Full durable reply",
  );
  assert.equal(
    element(".chat-reply time").getAttribute("datetime"),
    new Date(stamp).toISOString(),
  );
  await mount(control.adapter, false);
  assert.equal(
    element(".chat-reply time").getAttribute("datetime"),
    new Date(stamp).toISOString(),
  );
  assert.equal(document.querySelector(".chat-mode.dsh"), null);
  assert.equal(element(".chat-reply").tabIndex, 0);
});

test("account popup Escape restores its own avatar focus", async () => {
  await mount(deferredAdapter().adapter);
  await click('[aria-label="账户与版本"]');
  assert.ok(document.querySelector('[role="dialog"][aria-label="账户与版本"]'));
  await act(async () =>
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(
    document.querySelector('[role="dialog"][aria-label="账户与版本"]'),
    null,
  );
  assert.equal(
    document.activeElement?.getAttribute("aria-label"),
    "账户与版本",
  );
});

test("more than 300 saved turns restore the exact session without clearing data", async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  const saved = {
    version: 1,
    sessionId: "long-session",
    viewport: { x: 64, y: 104, zoom: 1 },
    replies: Array.from({ length: 301 }, (_, i) => ({
      id: `r-${i}`,
      prompt: `p${i}`,
      body: `r${i}`,
      status: "done",
    })),
  };
  localStorage.setItem(key, JSON.stringify(saved));
  const control = deferredAdapter();
  await mount(control.adapter, false);
  assert.equal(document.querySelectorAll(".chat-reply").length, 301);
  assert.equal(document.querySelector('[role="alert"]'), null);
  await type('[aria-label="向 Agent 输入"]', "continue");
  await click(".chat-send");
  assert.equal(control.creates, 0);
  assert.equal(control.runs[0].sessionId, "long-session");
  await click(".chat-stop");
});

test("session identity is saved before submission and pagehide flushes durable content", async () => {
  const control = deferredAdapter();
  await mount(control.adapter);
  await type('[aria-label="向 Agent 输入"]', "persist immediately");
  await click(".chat-send");
  assert.equal(JSON.parse(localStorage.getItem(key)!).sessionId, "session-one");
  await act(async () =>
    control.runs[0].onText("latest durable tail", {
      timestamp: 1234567890000,
      durable: true,
    }),
  );
  await act(async () => window.dispatchEvent(new dom.window.Event("pagehide")));
  assert.equal(
    JSON.parse(localStorage.getItem(key)!).replies[0].body,
    "latest durable tail",
  );
  await click(".chat-stop");
});

test("read-only host observer repairs legacy truncation and later native inputs without duplicates", async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  const dshKey = "dsh-canvas-conversation:v1:dsh";
  localStorage.setItem(
    dshKey,
    JSON.stringify({
      version: 1,
      sessionId: "real-id",
      viewport: { x: 64, y: 104, zoom: 1 },
      replies: [
        { id: "old", prompt: "hello", body: "I'm ready to", status: "running" },
      ],
    }),
  );
  let observe: ((snapshot: AgentSessionSnapshot) => void) | undefined;
  let releases = 0;
  const control = deferredAdapter();
  const adapter: AgentAdapter = {
    ...control.adapter,
    kind: "dsh",
    observeSession(id, callback) {
      assert.equal(id, "real-id");
      observe = callback;
      return () => {
        releases++;
      };
    },
  };
  await mount(adapter, false, undefined, "dsh");
  const first = {
    turnId: 1,
    userMessages: [
      { id: "u1", requestId: "rpc1", text: "hello", timestamp: 1000 },
    ],
    body: "Hello! I'm ready to help you with the full durable tail.",
    timestamp: 1234567890000,
    durable: true,
    status: "done" as const,
  };
  const emit = async (turns: AgentSessionSnapshot["turns"]) =>
    act(async () => observe!({ sessionId: "real-id", turns, hasMore: false }));
  await emit([first]);
  assert.equal(document.querySelectorAll(".chat-reply").length, 1);
  assert.equal(element(".chat-markdown").textContent, first.body);
  const pending = {
    turnId: 2,
    userMessages: [],
    body: "",
    durable: false,
    status: "running" as const,
  };
  await emit([first, pending]);
  await emit([
    first,
    {
      ...pending,
      userMessages: [
        {
          id: "u2",
          requestId: "rpc2",
          text: "native continuation",
          timestamp: 2000,
        },
      ],
    },
  ]);
  assert.equal(document.querySelectorAll(".chat-reply").length, 2);
  assert.match(
    element(".chat-user-history").textContent!,
    /native continuation/,
  );
  await act(async () => window.dispatchEvent(new dom.window.Event("pagehide")));
  const persisted = JSON.parse(localStorage.getItem(dshKey)!);
  assert.equal(persisted.legacyReplies[0].body, "I'm ready to");
  await mount(control.adapter);
  assert.equal(releases, 1);
  assert.equal(control.creates, 0);
});

test("DSH stopping preserves cancel uncertainty instead of claiming confirmed cancellation", async () => {
  const control = deferredAdapter();
  const adapter: AgentAdapter = {
    ...control.adapter,
    kind: "dsh",
    run(input) {
      return new Promise<void>((_, reject) =>
        input.signal.addEventListener(
          "abort",
          () => reject(new Error("停止未确认：connection lost")),
          { once: true },
        ),
      );
    },
  };
  await mount(adapter, true, undefined, "dsh");
  await type('[aria-label="向 Agent 输入"]', "pending request");
  await click(".chat-send");
  await click(".chat-stop");
  assert.match(element(".chat-reply-status").textContent!, /已中断观察/);
  assert.match(element(".chat-reply-error").textContent!, /停止未确认/);
  assert.match(element(".chat-composer-error").textContent!, /connection lost/);
});

test("IUI explicit new turn reuses the session, preserves unrelated draft and rejects double-send", async () => {
  const control = deferredAdapter();
  await mount(control.adapter);
  await type('[aria-label="向 Agent 输入"]', "show UI");
  await click(".chat-send");
  await act(async () => {
    control.runs[0].onText(
      '<card><button onClick={() => GenUI.issueNewTurn("explicit follow-up")}>Continue</button></card>',
    );
    control.runs[0].resolve();
  });
  await type('[aria-label="向 Agent 输入"]', "unfinished personal draft");
  const button = element(
    "[data-canvas-iui-root]",
  ).shadowRoot?.querySelector<HTMLButtonElement>("button");
  assert.ok(button);
  await act(async () => {
    button.click();
    button.click();
  });
  assert.equal(control.runs.length, 2);
  assert.equal(control.runs[1].prompt, "explicit follow-up");
  assert.equal(control.runs[1].sessionId, "session-one");
  assert.equal(control.creates, 1);
  assert.equal(
    (element('[aria-label="向 Agent 输入"]') as HTMLTextAreaElement).value,
    "unfinished personal draft",
  );
  await click(".chat-stop");
});

test("popup focuses a control and traps Tab until Escape restores the anchor", async () => {
  await mount(deferredAdapter().adapter);
  await click('[aria-label="导航与工作区"]');
  const dialog = element('[role="dialog"][aria-label="导航与工作区"]');
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
  assert.equal(document.activeElement, buttons[0]);
  await act(async () =>
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    ),
  );
  assert.equal(document.activeElement, buttons.at(-1));
  await act(async () =>
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    ),
  );
  assert.equal(document.activeElement, buttons[0]);
  await act(async () =>
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  assert.equal(
    document.activeElement?.getAttribute("aria-label"),
    "导航与工作区",
  );
});

async function mountPanFixture(
  body = "Selectable **reply text** stays readable.",
) {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  localStorage.clear();
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      sessionId: "pan-fixture",
      viewport: { x: 64, y: 104, zoom: 1 },
      replies: [{ id: "pan-reply", prompt: "fixture", body, status: "done" }],
    }),
  );
  const control = deferredAdapter();
  await mount(control.adapter, false);
  return control;
}
async function pointer(
  target: Element,
  type: string,
  x = 100,
  y = 100,
  button = 0,
  pointerId = 1,
) {
  const event = new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button,
    buttons: type === "pointerup" ? 0 : button === 1 ? 4 : 1,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  await act(async () => target.dispatchEvent(event));
  return event;
}
async function keyEvent(
  target: EventTarget,
  type: string,
  key: string,
  shiftKey = false,
) {
  const event = new dom.window.KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    key,
    code: key === " " ? "Space" : key,
    shiftKey,
  });
  await act(async () => target.dispatchEvent(event));
  return event;
}
const viewportTransform = () => element(".chat-world").style.transform;
function selectReplyText() {
  const range = document.createRange();
  range.selectNodeContents(element(".chat-markdown"));
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}
function selectionStart() {
  const event = new dom.window.Event("selectstart", {
    bubbles: true,
    cancelable: true,
  });
  element(".chat-markdown").dispatchEvent(event);
  return event;
}

test("background and world-gap pan wait for threshold and suppress only active selection", async () => {
  const control = await mountPanFixture();
  const stage = element(".chat-stage");
  const before = viewportTransform();
  assert.equal((await pointer(stage, "pointerdown")).defaultPrevented, false);
  await pointer(stage, "pointermove", 102, 101);
  assert.equal(viewportTransform(), before);
  assert.equal(selectionStart().defaultPrevented, false);
  assert.equal(stage.classList.contains("is-chat-panning"), false);
  selectReplyText();
  await pointer(stage, "pointermove", 140, 120);
  assert.equal(viewportTransform(), "translate(104px, 124px) scale(1)");
  assert.equal(window.getSelection()!.toString(), "");
  assert.equal(selectionStart().defaultPrevented, true);
  assert.equal(stage.classList.contains("is-chat-panning"), true);
  await pointer(stage, "pointerup", 140, 120);
  assert.equal(stage.classList.contains("is-chat-panning"), false);
  assert.equal(stage.hasPointerCapture(1), false);
  assert.equal(selectionStart().defaultPrevented, false);
  await pointer(element(".chat-world"), "pointerdown");
  await pointer(stage, "pointermove", 110, 110);
  await pointer(stage, "pointerup", 110, 110);
  assert.equal(viewportTransform(), "translate(114px, 134px) scale(1)");
  assert.equal(control.creates, 0);
  assert.equal(control.runs.length, 0);
});

test("ordinary reply text drag keeps selection and never pans", async () => {
  await mountPanFixture();
  const before = viewportTransform();
  const text = element(".chat-markdown strong");
  assert.equal((await pointer(text, "pointerdown")).defaultPrevented, false);
  selectReplyText();
  assert.equal(
    (await pointer(text, "pointermove", 190, 140)).defaultPrevented,
    false,
  );
  await pointer(text, "pointerup", 190, 140);
  assert.equal(viewportTransform(), before);
  assert.match(window.getSelection()!.toString(), /reply text/);
  assert.equal(element(".chat-stage").hasPointerCapture(1), false);
  assert.equal(selectionStart().defaultPrevented, false);
});

test("paired reply image, link and text stay interactive after a canvas drag", async () => {
  await mountPanFixture(
    "Selectable **reply text** ![Poster](https://example.com/poster.png) [Open](https://example.com/)",
  );
  const stage = element(".chat-stage");
  await pointer(stage, "pointerdown");
  await pointer(stage, "pointermove", 150, 130);
  await pointer(stage, "pointerup", 150, 130);
  const reply = element(".chat-reply");
  await act(async () =>
    reply.dispatchEvent(
      new dom.window.MouseEvent("mouseover", { bubbles: true }),
    ),
  );
  assert.equal(reply.dataset.pairState, "matched");
  const image = element(".chat-markdown img");
  let imageClicks = 0;
  image.addEventListener("click", () => imageClicks++);
  assert.equal((await pointer(image, "pointerdown")).defaultPrevented, false);
  await pointer(image, "pointerup");
  await act(async () => image.click());
  assert.equal(imageClicks, 1);
  const contextMenu = new dom.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  });
  await act(async () => image.dispatchEvent(contextMenu));
  assert.equal(contextMenu.defaultPrevented, false);
  const link = element(".chat-markdown a");
  let linkClicks = 0;
  link.addEventListener("click", (event) => {
    linkClicks++;
    event.preventDefault(); // Keep this DOM test offline.
  });
  assert.equal((await pointer(link, "pointerdown")).defaultPrevented, false);
  await pointer(link, "pointerup");
  await act(async () => link.click());
  assert.equal(linkClicks, 1);
  const text = element(".chat-markdown strong");
  assert.equal((await pointer(text, "pointerdown")).defaultPrevented, false);
  selectReplyText();
  await pointer(text, "pointermove", 185, 145);
  await pointer(text, "pointerup", 185, 145);
  assert.match(window.getSelection()!.toString(), /reply text/);
  assert.equal(selectionStart().defaultPrevented, false);
  assert.equal((await pointer(reply, "pointerdown")).defaultPrevented, false);
  assert.equal(stage.hasPointerCapture(1), false);
});

test("reply handle moves only its reply; Space and middle drag still pan", async () => {
  await mountPanFixture();
  const stage = element(".chat-stage");
  const handle = element(".chat-pan-handle");
  assert.equal((await pointer(handle, "pointerdown")).defaultPrevented, true);
  assert.equal(selectionStart().defaultPrevented, true);
  await pointer(stage, "pointermove", 102, 101);
  assert.equal(viewportTransform(), "translate(64px, 104px) scale(1)");
  await pointer(stage, "pointermove", 120, 130);
  await pointer(stage, "pointerup", 120, 130);
  assert.equal(viewportTransform(), "translate(64px, 104px) scale(1)");
  assert.equal(element(".chat-reply").style.left, "-44px");
  assert.equal(element(".chat-reply").style.top, "-74px");
  assert.equal(selectionStart().defaultPrevented, false);
  assert.equal(
    (await keyEvent(handle, "keydown", "ArrowLeft")).defaultPrevented,
    true,
  );
  await keyEvent(handle, "keydown", "ArrowDown", true);
  assert.equal(viewportTransform(), "translate(64px, 104px) scale(1)");
  assert.equal(element(".chat-reply").style.left, "-68px");
  assert.equal(element(".chat-reply").style.top, "6px");
  assert.equal(
    (await keyEvent(document, "keydown", " ")).defaultPrevented,
    true,
  );
  assert.equal(stage.classList.contains("is-chat-pan-ready"), true);
  assert.equal(
    (await pointer(element(".chat-markdown"), "pointerdown")).defaultPrevented,
    true,
  );
  await pointer(stage, "pointermove", 150, 150);
  await pointer(stage, "pointerup", 150, 150);
  await keyEvent(document, "keyup", " ");
  assert.equal(viewportTransform(), "translate(114px, 154px) scale(1)");
  assert.equal(stage.classList.contains("is-chat-pan-ready"), false);
  assert.equal(
    (await pointer(element(".chat-markdown"), "pointerdown", 100, 100, 1))
      .defaultPrevented,
    true,
  );
  await pointer(stage, "pointermove", 120, 120, 1);
  await pointer(stage, "pointerup", 120, 120, 1);
  assert.equal(viewportTransform(), "translate(134px, 174px) scale(1)");
  const auxclick = new dom.window.MouseEvent("auxclick", {
    bubbles: true,
    cancelable: true,
    button: 1,
  });
  await act(async () => stage.dispatchEvent(auxclick));
  assert.equal(auxclick.defaultPrevented, true);
  assert.equal(selectionStart().defaultPrevented, false);
});

test("moved reply uses zoom-adjusted world coordinates and survives reload", async () => {
  if (root) await act(async () => root!.unmount());
  localStorage.clear();
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      sessionId: "zoom-fixture",
      viewport: { x: 64, y: 104, zoom: 2 },
      replies: [
        {
          id: "zoom-reply",
          prompt: "fixture",
          body: "answer",
          status: "done",
        },
      ],
    }),
  );
  const control = deferredAdapter();
  await mount(control.adapter, false);
  const handle = element(".chat-pan-handle");
  await pointer(handle, "pointerdown", 100, 100);
  await pointer(element(".chat-stage"), "pointermove", 120, 130);
  await pointer(element(".chat-stage"), "pointerup", 120, 130);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 210)));
  const saved = JSON.parse(localStorage.getItem(key)!);
  assert.deepEqual(saved.replies[0].position, {
    x: -22,
    y: -37,
    slotHeight: 24,
    kind: "manual",
  });
  assert.equal(saved.viewport.zoom, 2);
  await mount(control.adapter, false);
  assert.equal(element(".chat-reply").style.left, "-22px");
  assert.equal(element(".chat-reply").style.top, "-37px");
  await type('[aria-label="向 Agent 输入"]', "next");
  await click(".chat-send");
  await wait(() => control.runs.length === 1);
  await act(async () => control.runs[0].onText("streaming answer"));
  assert.equal(element('[data-reply-id="zoom-reply"]').style.left, "-22px");
  assert.equal(element('[data-reply-id="zoom-reply"]').style.top, "-37px");
});

test("new replies start below the moved predecessor using its live world height", async () => {
  if (root) await act(async () => root!.unmount());
  localStorage.clear();
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      sessionId: "placed-session",
      viewport: { x: 64, y: 104, zoom: 2 },
      replies: [
        {
          id: "placed-first",
          prompt: "first",
          body: "long image reply",
          status: "done",
          position: { x: 140, y: 260, slotHeight: 24 },
        },
      ],
    }),
  );
  const control = deferredAdapter();
  await mount(control.adapter, false);
  const first = element('[data-reply-id="placed-first"]');
  first.getBoundingClientRect = () => ({ height: 420 }) as DOMRect;
  await keyEvent(
    element('[data-reply-id="placed-first"] .chat-pan-handle'),
    "keydown",
    "ArrowRight",
  );
  await keyEvent(
    element('[data-reply-id="placed-first"] .chat-pan-handle'),
    "keydown",
    "ArrowDown",
    true,
  );
  assert.equal(first.style.left, "152px");
  assert.equal(first.style.top, "300px");
  await type('[aria-label="向 Agent 输入"]', "second");
  await click(".chat-send");
  await wait(() => control.runs.length === 1);
  const second = element('[data-testid="chat-reply-1"]');
  assert.equal(second.style.left, "152px");
  assert.equal(second.style.top, "540px");
  second.getBoundingClientRect = () => ({ height: 600 }) as DOMRect;
  await act(async () => control.runs[0].resolve());
  await wait(() => Boolean(document.querySelector(".chat-reply-status.done")));
  await type('[aria-label="向 Agent 输入"]', "third");
  await click(".chat-send");
  await wait(() => control.runs.length === 2);
  const third = element('[data-testid="chat-reply-2"]');
  assert.equal(third.style.left, "152px");
  assert.equal(third.style.top, "870px");
  await keyEvent(
    element('[data-reply-id="placed-first"] .chat-pan-handle'),
    "keydown",
    "ArrowDown",
  );
  assert.equal(
    second.style.top,
    "540px",
    "a later drag must not move placed replies",
  );
  await act(async () => control.runs[1].resolve());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 210)));
  const saved = JSON.parse(localStorage.getItem(key)!);
  assert.deepEqual(
    saved.replies.map((reply: ConversationReply) => reply.position?.y),
    [312, 540, 870],
  );
  await mount(control.adapter, false);
  assert.equal(element('[data-testid="chat-reply-1"]').style.top, "540px");
  assert.equal(element('[data-testid="chat-reply-2"]').style.top, "870px");
});

test("provider reasoning streams in one line and finishes in a collapsed scrollable section", async () => {
  const control = deferredAdapter();
  await mount(control.adapter);
  await type('[aria-label="向 Agent 输入"]', "question");
  await click(".chat-send");
  await wait(() => control.runs.length === 1);
  assert.equal(document.querySelector(".chat-reasoning-live"), null);
  await act(async () =>
    control.runs[0].onText("", { reasoning: "first\nlatest" }),
  );
  assert.equal(
    element(".chat-reasoning-live > div").textContent,
    "first\nlatest",
  );
  assert.equal(document.querySelector(".chat-reasoning-done"), null);
  await act(async () => {
    control.runs[0].onText("answer", { reasoning: "first\nlatest thought" });
    control.runs[0].resolve();
  });
  await wait(() => Boolean(document.querySelector(".chat-reasoning-done")));
  const details = element(".chat-reasoning-done");
  assert.equal(details.hidden, true);
  assert.equal(
    element(
      '.chat-reply-disclosure-actions button[aria-controls="' +
        details.id +
        '"]',
    ).textContent,
    "查看思考内容",
  );
  assert.equal(
    element(".chat-reasoning-done pre").textContent,
    "first\nlatest thought",
  );
  assert.equal(control.runs[0].prompt, "question");
});

test("IUI shadow controls and composer retain pointer and Space ownership", async () => {
  const control = await mountPanFixture();
  const host = document.createElement("div");
  host.setAttribute("data-canvas-iui-root", "");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML =
    '<input aria-label="IUI input"><button>Local action</button><div contenteditable="true">Editable text</div>';
  element(".chat-reply-surface").append(host);
  const input = shadow.querySelector("input")!;
  const button = shadow.querySelector("button")!;
  const editable = shadow.querySelector("div")!;
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  const before = viewportTransform();
  for (const target of [
    input,
    button,
    editable,
    element(".chat-composer textarea"),
  ]) {
    assert.equal(
      (await keyEvent(target, "keydown", " ")).defaultPrevented,
      false,
    );
    assert.equal(
      element(".chat-stage").classList.contains("is-chat-pan-ready"),
      false,
    );
    await keyEvent(document, "keydown", " ");
    for (const mouseButton of [0, 1]) {
      assert.equal(
        (await pointer(target, "pointerdown", 100, 100, mouseButton))
          .defaultPrevented,
        false,
      );
      await pointer(target, "pointermove", 150, 150, mouseButton);
      await pointer(target, "pointerup", 150, 150, mouseButton);
      assert.equal(element(".chat-stage").hasPointerCapture(1), false);
    }
    await keyEvent(document, "keyup", " ");
  }
  await act(async () => button.click());
  assert.equal(clicks, 1);
  assert.equal(viewportTransform(), before);
  await type('[aria-label="向 Agent 输入"]', "draft remains editable");
  assert.equal(
    (element(".chat-composer textarea") as HTMLTextAreaElement).value,
    "draft remains editable",
  );
  assert.equal(control.runs.length, 0);
});

test("pan release cannot activate IUI controls or submit the composer accidentally", async () => {
  const control = await mountPanFixture();
  const stage = element(".chat-stage");
  await type('[aria-label="向 Agent 输入"]', "do not send while panning");
  await pointer(stage, "pointerdown");
  await pointer(stage, "pointermove", 150, 150);
  await pointer(stage, "pointerup", 150, 150);
  await click(".chat-send");
  assert.equal(control.runs.length, 0);
  assert.equal(control.creates, 0);
  const button = document.createElement("button");
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  element(".chat-reply-surface").append(button);
  await pointer(stage, "pointerdown");
  await pointer(stage, "pointermove", 120, 120);
  await pointer(stage, "pointerup", 120, 120);
  await act(async () => button.click());
  assert.equal(clicks, 0);
  // A separate intentional press must work immediately after a pan.
  await pointer(button, "pointerdown");
  await pointer(button, "pointerup");
  await act(async () => button.click());
  assert.equal(clicks, 1);
});

test("cancel, lost capture, Escape and window blur always release pan state", async () => {
  await mountPanFixture();
  const stage = element(".chat-stage");
  for (const interrupt of [
    "pointercancel",
    "lostpointercapture",
    "Escape",
    "blur",
  ]) {
    await keyEvent(document, "keydown", " ");
    await pointer(element(".chat-markdown"), "pointerdown", 100, 100, 0, 7);
    await pointer(stage, "pointermove", 120, 120, 0, 7);
    const before = viewportTransform();
    // A different pointer cannot move or end the active gesture.
    await pointer(stage, "pointermove", 500, 500, 0, 8);
    await pointer(stage, "pointerup", 500, 500, 0, 8);
    assert.equal(viewportTransform(), before);
    assert.equal(stage.classList.contains("is-chat-panning"), true);
    if (interrupt === "Escape") await keyEvent(document, "keydown", "Escape");
    else if (interrupt === "blur")
      await act(async () => window.dispatchEvent(new dom.window.Event("blur")));
    else await pointer(stage, interrupt, 120, 120, 0, 7);
    assert.equal(stage.classList.contains("is-chat-panning"), false);
    assert.equal(stage.classList.contains("is-chat-pan-armed"), false);
    assert.equal(stage.hasPointerCapture(7), false);
    assert.equal(selectionStart().defaultPrevented, false);
    await pointer(stage, "pointermove", 900, 900, 0, 7);
    assert.equal(viewportTransform(), before);
    await keyEvent(document, "keyup", " ");
  }
});

test("restored rail hides only the known injected context without rewriting stored prompts", async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  const prompt = "请保留这条原始输入";
  const rawPrompt = `${prompt}\n\n${CANVAS_CONTEXT_LABEL}\n<canvas_context>\n[]\n</canvas_context>`;
  localStorage.clear();
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      sessionId: "legacy-context-session",
      viewport: { x: 64, y: 104, zoom: 1 },
      replies: [
        {
          id: "legacy-context",
          prompt: rawPrompt,
          body: "Legacy reply",
          status: "done",
        },
      ],
    }),
  );
  const control = deferredAdapter();
  await mount(control.adapter, false);
  assert.equal(element(".chat-user-message-bubble").textContent, prompt);
  assert.equal(
    element(".chat-user-history").textContent!.includes("canvas_context"),
    false,
  );
  await act(async () => window.dispatchEvent(new dom.window.Event("pagehide")));
  assert.equal(
    JSON.parse(localStorage.getItem(key)!).replies[0].prompt,
    rawPrompt,
  );
  assert.equal(control.runs.length, 0);
  // User-authored literal markup is not an injected suffix and must stay visible.
  await type('[aria-label="向 Agent 输入"]', rawPrompt);
  await click(".chat-send");
  assert.equal(
    [...document.querySelectorAll(".chat-user-message-bubble")].at(-1)
      ?.textContent,
    rawPrompt,
  );
  assert.equal(
    JSON.parse(localStorage.getItem(key)!).replies.at(-1).promptSource,
    "user",
  );
  await act(async () => control.runs[0].resolve());
});

const pairingReplies = (): ConversationReply[] => [
  {
    id: "pair-b",
    hostTurnId: 20,
    requestId: "request-b",
    prompt: "The same words",
    userMessages: [{ id: "message-b", text: "The same words" }],
    body: "Second answer",
    status: "done",
  },
  {
    id: "pair-a",
    hostTurnId: 10,
    requestId: "request-a",
    prompt: "The same words",
    userMessages: [{ id: "message-a", text: "The same words" }],
    body: "First **selectable** answer",
    status: "done",
  },
  {
    id: "pair-c",
    hostTurnId: 30,
    requestId: "request-c",
    prompt: "Third input",
    userMessages: [{ id: "message-c", text: "Third input" }],
    body: "Third answer",
    status: "done",
  },
  {
    id: "pair-a-extra",
    hostTurnId: 11,
    requestId: "request-a",
    prompt: "The same words",
    userMessages: [{ id: "message-a", text: "The same words" }],
    body: "Additional output for the first input",
    status: "done",
  },
];

async function mountPairingFixture() {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  localStorage.clear();
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      sessionId: "pair-session",
      viewport: { x: 64, y: 104, zoom: 1 },
      replies: pairingReplies(),
    }),
  );
  let observe: ((snapshot: AgentSessionSnapshot) => void) | undefined;
  const control = deferredAdapter();
  control.adapter.observeSession = (_id, callback) => {
    observe = callback;
    return () => {
      observe = undefined;
    };
  };
  await mount(control.adapter, false);
  return {
    ...control,
    snapshot: (value: AgentSessionSnapshot) => act(async () => observe!(value)),
  };
}
const replyNode = (id: string) => element(`.chat-reply[data-reply-id="${id}"]`);
const userNode = (id: string) =>
  element(`.chat-user-message[data-user-message-id="${id}"]`);
const matchedReplies = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '.chat-reply[data-pair-state="matched"]',
    ),
  ]
    .map((node) => node.dataset.replyId)
    .sort();
const matchedUsers = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '.chat-user-message[data-pair-state="matched"]',
    ),
  ]
    .map((node) => node.dataset.userMessageId)
    .sort();
function mockRect(
  node: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  node.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    }) as DOMRect;
}
function mockLocateGeometry() {
  mockRect(element(".chat-stage"), 0, 0, 1200, 800);
  mockRect(element(".chat-dock"), 850, 500, 330, 280);
  mockRect(replyNode("pair-a"), 100, -400, 300, 160);
  mockRect(replyNode("pair-a-extra"), 700, 500, 300, 160);
  mockRect(replyNode("pair-b"), 220, 180, 300, 160);
  mockRect(replyNode("pair-c"), 300, 400, 300, 160);
}
async function hoverPair(target: Element, entering = true) {
  const event = new dom.window.MouseEvent(entering ? "mouseover" : "mouseout", {
    bubbles: true,
    cancelable: true,
    relatedTarget: document.body,
  });
  await act(async () => target.dispatchEvent(event));
  assert.equal(event.defaultPrevented, false);
}

test("user click locates the first reply in its stable pair without changing zoom or hover panning", async () => {
  await mountPairingFixture();
  mockLocateGeometry();
  window.getSelection()?.removeAllRanges();
  const row = userNode("message-a");
  assert.equal(row.getAttribute("role"), "button");
  const before = viewportTransform();
  await hoverPair(row);
  assert.equal(viewportTransform(), before, "hover must never move the view");
  await pointer(row, "pointerdown", 300, 300);
  await pointer(row, "pointerup", 300, 300);
  await act(async () => row.click());
  assert.equal(
    viewportTransform(),
    "translate(241px, 856px) scale(1)",
    "the first reply is centered left of the composer and rail",
  );
  assert.deepEqual(matchedReplies(), ["pair-a", "pair-a-extra"]);
  assert.deepEqual(matchedUsers(), ["message-a"]);
});

test("selecting or dragging user text does not locate; keyboard activation does", async () => {
  await mountPairingFixture();
  mockLocateGeometry();
  const row = userNode("message-b");
  const before = viewportTransform();
  await pointer(row, "pointerdown", 300, 300);
  await pointer(element(".chat-canvas"), "pointermove", 340, 350);
  await pointer(row, "pointerup", 340, 350);
  await act(async () => row.click());
  assert.equal(viewportTransform(), before);
  const range = document.createRange();
  range.selectNodeContents(row.querySelector(".chat-user-message-bubble")!);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(async () => row.click());
  assert.equal(
    viewportTransform(),
    before,
    "selection must not trigger locate",
  );
  window.getSelection()!.removeAllRanges();
  const enter = await keyEvent(row, "keydown", "Enter");
  assert.equal(enter.defaultPrevented, true);
  assert.notEqual(viewportTransform(), before);
  assert.ok(viewportTransform().endsWith("scale(1)"));
  const afterEnter = viewportTransform();
  mockRect(replyNode("pair-b"), 277, 352, 300, 160);
  const space = await keyEvent(row, "keydown", " ");
  assert.equal(space.defaultPrevented, true);
  assert.equal(viewportTransform(), afterEnter);
});

test("paired hover connects three turns in both directions and all outputs without matching text", async () => {
  const control = await mountPairingFixture();
  assert.equal(
    document.querySelectorAll(".chat-user-message").length,
    3,
    "one native input is not duplicated for multiple outputs",
  );
  const transform = viewportTransform();
  const rail = element(".chat-user-history");
  rail.scrollTop = 37;
  await hoverPair(userNode("message-a"));
  assert.deepEqual(matchedReplies(), ["pair-a", "pair-a-extra"]);
  assert.deepEqual(matchedUsers(), ["message-a"]);
  assert.equal(
    replyNode("pair-b").dataset.pairState,
    "dimmed",
    "identical text is not an identity",
  );
  assert.equal(replyNode("pair-c").dataset.pairState, "dimmed");
  assert.equal(userNode("message-b").dataset.pairState, "dimmed");
  assert.equal(viewportTransform(), transform);
  assert.equal(rail.scrollTop, 37, "pairing never scrolls the rail");
  await hoverPair(userNode("message-a"), false);
  assert.equal(document.querySelector("[data-pair-state]"), null);
  await hoverPair(replyNode("pair-a-extra"));
  assert.deepEqual(matchedUsers(), ["message-a"]);
  assert.deepEqual(matchedReplies(), ["pair-a", "pair-a-extra"]);
  await hoverPair(replyNode("pair-a-extra"), false);
  await hoverPair(replyNode("pair-c"));
  assert.deepEqual(matchedUsers(), ["message-c"]);
  assert.deepEqual(matchedReplies(), ["pair-c"]);
  await hoverPair(replyNode("pair-c"), false);
  assert.equal(document.querySelector("[data-pair-state]"), null);
  assert.equal(control.runs.length, 0);
});

test("pairing survives host reorder and clears across workspace changes and navigation", async () => {
  const control = await mountPairingFixture();
  const row = userNode("message-a");
  await hoverPair(row);
  await control.snapshot({
    sessionId: "pair-session",
    turns: [],
    hasMore: false,
  });
  assert.equal(
    element(".chat-reply").dataset.replyId,
    "pair-a",
    "host reconciliation reordered the cards",
  );
  assert.equal(
    userNode("message-a"),
    row,
    "stable native input keys preserve the hovered row",
  );
  assert.deepEqual(matchedReplies(), ["pair-a", "pair-a-extra"]);
  assert.deepEqual(matchedUsers(), ["message-a"]);
  await act(async () =>
    root!.render(
      <ChatCanvas
        adapter={control.adapter}
        mode="mock"
        hostWorkspaces={[
          {
            id: "different-workspace",
            title: "Elsewhere",
            sessionIds: ["pair-session"],
          },
        ]}
      />,
    ),
  );
  assert.equal(document.querySelector("[data-pair-state]"), null);
  await hoverPair(replyNode("pair-b"));
  assert.deepEqual(matchedUsers(), ["message-b"]);
  await click('[aria-label="导航与工作区"]');
  assert.equal(document.querySelector("[data-pair-state]"), null);
  await act(async () => window.dispatchEvent(new dom.window.Event("blur")));
  assert.equal(document.querySelector("[data-pair-state]"), null);
});

test("keyboard pairing follows focus within controls, hover overrides it, and pointer clicks do not stick", async () => {
  const control = await mountPairingFixture();
  const row = userNode("message-a");
  assert.equal(row.tabIndex, 0);
  assert.equal(row.getAttribute("role"), "button");
  await act(async () => row.focus());
  assert.deepEqual(matchedReplies(), ["pair-a", "pair-a-extra"]);
  await hoverPair(replyNode("pair-c"));
  assert.deepEqual(matchedUsers(), ["message-c"]);
  await hoverPair(replyNode("pair-c"), false);
  assert.deepEqual(
    matchedUsers(),
    ["message-a"],
    "leaving hover restores keyboard focus pairing",
  );
  await act(async () => element(".chat-composer textarea").focus());
  assert.equal(
    document.querySelector("[data-pair-state]"),
    null,
    "focusout clears pairing",
  );
  const host = document.createElement("div");
  host.setAttribute("data-canvas-iui-root", "");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML =
    '<input aria-label="Paired IUI input"><button>Local action</button>';
  replyNode("pair-b").querySelector(".chat-reply-surface")!.append(host);
  const input = shadow.querySelector("input")!;
  const button = shadow.querySelector("button")!;
  const before = viewportTransform();
  await keyEvent(element(".chat-composer textarea"), "keydown", "Tab");
  await act(async () => input.focus());
  assert.deepEqual(matchedUsers(), ["message-b"]);
  assert.equal((await keyEvent(input, "keydown", " ")).defaultPrevented, false);
  await act(async () => button.focus());
  assert.deepEqual(
    matchedUsers(),
    ["message-b"],
    "focus movement within IUI retains pairing",
  );
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  await pointer(button, "pointerdown");
  await pointer(button, "pointerup");
  await act(async () => button.click());
  assert.equal(clicks, 1);
  assert.equal(
    document.querySelector("[data-pair-state]"),
    null,
    "pointer activation does not retain keyboard pairing",
  );
  await hoverPair(row);
  await pointer(row, "pointerdown");
  await act(async () => row.focus());
  await pointer(row, "pointerup");
  await hoverPair(row, false);
  assert.equal(
    document.querySelector("[data-pair-state]"),
    null,
    "pointer-focused message does not stay paired after mouseleave",
  );
  await act(async () => row.blur());
  await keyEvent(document.body, "keydown", "Tab");
  await act(async () => row.focus());
  assert.deepEqual(
    matchedReplies(),
    ["pair-a", "pair-a-extra"],
    "Tab from outside the canvas restores keyboard pairing",
  );
  await act(async () => row.blur());
  assert.equal(document.querySelector("[data-pair-state]"), null);
  assert.equal(viewportTransform(), before);
  assert.equal(control.runs.length, 0);
});

test("pair projection uses actual scoped IDs through one-to-many, deletion, reload and session changes", () => {
  const replies = pairingReplies();
  const pairs = buildReplyPairs(replies, "workspace-a/session-a");
  const target = {
    scope: pairs.scope,
    source: "reply" as const,
    id: "pair-a-extra",
  };
  const active = activeReplyPair(pairs, target);
  assert.equal(active, pairs.replyPairs.get("pair-a"));
  assert.equal(
    activeReplyPair(
      buildReplyPairs([...replies].reverse(), pairs.scope),
      target,
    ),
    active,
  );
  assert.equal(
    activeReplyPair(
      buildReplyPairs(
        replies.filter((reply) => reply.id !== target.id),
        pairs.scope,
      ),
      target,
    ),
    undefined,
  );
  assert.equal(
    activeReplyPair(buildReplyPairs(replies, "workspace-a/session-b"), target),
    undefined,
  );
  assert.equal(
    activeReplyPair(buildReplyPairs(replies, "workspace-b/session-a"), target),
    undefined,
  );
  const sameTurn = buildReplyPairs(
    [
      {
        id: "output-one",
        prompt: "One",
        body: "one",
        hostTurnId: 91,
        status: "done",
      },
      {
        id: "output-two",
        prompt: "One",
        body: "two",
        hostTurnId: 91,
        status: "done",
      },
    ],
    pairs.scope,
  );
  assert.equal(
    sameTurn.replyPairs.get("output-one"),
    sameTurn.replyPairs.get("output-two"),
  );
  assert.equal(sameTurn.userMessages.length, 1);
  const mock: ConversationReply[] = [
    { id: "persisted-first", prompt: "identical", body: "one", status: "done" },
    {
      id: "persisted-second",
      prompt: "identical",
      body: "two",
      status: "done",
    },
  ];
  const restored = buildReplyPairs(
    JSON.parse(JSON.stringify(mock)).reverse(),
    "mock/session",
  );
  const original = buildReplyPairs(mock, "mock/session");
  assert.deepEqual(
    [...original.replyPairs].sort(),
    [...restored.replyPairs].sort(),
  );
  assert.notEqual(
    original.replyPairs.get(mock[0].id),
    original.replyPairs.get(mock[1].id),
  );
});

test("matched mixed replies outline the whole message, never individual IUI roots", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.chat-reply\[data-pair-state="matched"\]\s*> \.chat-reply-surface:has\(\.chat-iui-content\)\s*\{[^}]*outline: 2px solid var\(--chat-pair-accent\)/,
  );
  assert.doesNotMatch(
    css,
    /\.chat-reply\[data-pair-state="matched"\][^{]*\[data-canvas-iui-root\]\s*\{/,
  );
});

test("user rail glass shares the native composer inset and leaves the scroll rail interactive", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.chat-native-composer \[data-conversation-content\]\s*\{[^}]*--dsh-composer-side-clearance: var\(--chat-composer-side-clearance\)/,
  );
  assert.match(
    css,
    /\.chat-user-history-frame\s*\{[^}]*width: calc\([^)]+--chat-composer-side-clearance/,
  );
  const glass = css.match(/\.chat-user-history-glass\s*\{([^}]*)\}/)?.[1];
  assert.ok(glass);
  assert.match(glass, /backdrop-filter: blur\(/);
  assert.match(glass, /mask-image:/);
  assert.match(glass, /pointer-events: none/);
  assert.doesNotMatch(glass, /\bborder\s*:/);
  assert.doesNotMatch(glass, /\bbox-shadow\s*:/);
  await mountPanFixture();
  const rail = element(".chat-user-history");
  assert.equal(rail.parentElement?.className, "chat-user-history-frame");
  assert.ok(
    rail.previousElementSibling?.classList.contains("chat-user-history-glass"),
  );
});

test("steered inputs stay one visual group and each locates their shared reply", async () => {
  if (root) await act(async () => root!.unmount());
  localStorage.clear();
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      sessionId: "steer-session",
      viewport: { x: 64, y: 104, zoom: 1 },
      replies: [
        {
          id: "steer-answer",
          hostTurnId: 4,
          prompt: "先做轮播",
          userMessages: [
            { id: "steer-first", text: "先做轮播" },
            { id: "steer-second", text: "等一下，改成图片轮播" },
          ],
          body: "已完成",
          status: "done",
        },
      ],
    }),
  );
  await mount(deferredAdapter().adapter, false);
  const group = element('.chat-user-message-group[data-grouped="true"]');
  assert.equal(group.querySelectorAll(".chat-user-message").length, 2);
  const first = userNode("steer-first");
  const second = userNode("steer-second");
  assert.equal(first.dataset.pairId === second.dataset.pairId, false);
  await hoverPair(first);
  assert.deepEqual(matchedUsers(), ["steer-first", "steer-second"]);
  assert.deepEqual(matchedReplies(), ["steer-answer"]);
  await hoverPair(first, false);
  await hoverPair(second);
  assert.deepEqual(matchedUsers(), ["steer-first", "steer-second"]);
  assert.deepEqual(matchedReplies(), ["steer-answer"]);
  await hoverPair(second, false);

  mockRect(element(".chat-stage"), 0, 0, 1200, 800);
  mockRect(element(".chat-dock"), 850, 500, 330, 280);
  mockRect(replyNode("steer-answer"), 200, 180, 300, 160);
  const before = viewportTransform();
  const range = document.createRange();
  range.selectNodeContents(second.querySelector(".chat-user-message-bubble")!);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(async () => second.click());
  assert.equal(
    viewportTransform(),
    before,
    "selecting the steer text never locates",
  );
  window.getSelection()!.removeAllRanges();
  await act(async () => second.click());
  assert.notEqual(viewportTransform(), before);
  assert.equal(
    second.dataset.pairState,
    first.dataset.pairState,
    "both rows retain the same pairing state",
  );
});

test("a stale user image result cannot cross a native session switch", async () => {
  if (root) await act(async () => root!.unmount());
  root = createRoot(element("#root"));
  const attachment = {
    type: "image" as const,
    image: {
      attachment: {
        attachmentId: "shared-attachment" as never,
        mediaType: "image/png" as const,
        bytes: 68,
        width: 16,
        height: 16,
        name: "shared.png",
      },
    },
  };
  let resolveOld!: (value: string) => void;
  const load = (_attachment: unknown, sessionId: string) =>
    sessionId === "old-session"
      ? new Promise<string>((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve("https://example.com/new.png");
  await act(async () =>
    root!.render(
      <UserMessageMedia
        attachments={[attachment]}
        sessionId="old-session"
        loadImage={load}
      />,
    ),
  );
  assert.equal(document.querySelector(".chat-user-image-tile img"), null);
  await act(async () =>
    root!.render(
      <UserMessageMedia
        attachments={[attachment]}
        sessionId="new-session"
        loadImage={load}
      />,
    ),
  );
  await act(async () => resolveOld("https://example.com/old.png"));
  assert.equal(
    element(".chat-user-image-tile img").getAttribute("src"),
    "https://example.com/new.png",
  );
});

test("a retired rail resize callback cannot scroll a different session", async () => {
  const original = globalThis.ResizeObserver;
  const observers: {
    node?: Element;
    callback: ResizeObserverCallback;
  }[] = [];
  class RailObserver {
    readonly entry: (typeof observers)[number];
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback };
      observers.push(this.entry);
    }
    observe(node: Element) {
      this.entry.node = node;
    }
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: RailObserver,
  });
  try {
    if (root) await act(async () => root!.unmount());
    localStorage.clear();
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        sessionId: "old-rail-session",
        viewport: { x: 64, y: 104, zoom: 1 },
        replies: [
          { id: "old-answer", prompt: "旧消息", body: "已答", status: "done" },
        ],
      }),
    );
    await mount(deferredAdapter().adapter, false);
    await type('[aria-label="向 Agent 输入"]', "新消息");
    await click(".chat-send");
    const oldRail = element(".chat-user-history");
    Object.defineProperties(oldRail, {
      scrollHeight: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 120 },
    });
    Object.defineProperty(oldRail, "scrollTo", {
      configurable: true,
      value: ({ top }: ScrollToOptions) => {
        oldRail.scrollTop = top ?? oldRail.scrollTop;
      },
    });
    const resize = [...observers]
      .reverse()
      .find((observer) => observer.node && oldRail.contains(observer.node))!;
    assert.ok(resize.node);
    resize.node.getBoundingClientRect = () => ({ height: 90 }) as DOMRect;
    oldRail.scrollTop = 0;
    await act(async () => resize.callback([], {} as ResizeObserver));
    assert.equal(
      oldRail.scrollTop,
      280,
      "late media growth follows the new row",
    );

    await act(async () => root!.unmount());
    root = undefined;
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        sessionId: "new-rail-session",
        viewport: { x: 64, y: 104, zoom: 1 },
        replies: [
          {
            id: "new-answer",
            prompt: "另一个会话",
            body: "已答",
            status: "done",
          },
        ],
      }),
    );
    await mount(deferredAdapter().adapter, false);
    const newRail = element(".chat-user-history");
    newRail.scrollTop = 17;
    oldRail.scrollTop = 5;
    resize.node.getBoundingClientRect = () => ({ height: 140 }) as DOMRect;
    await act(async () => resize.callback([], {} as ResizeObserver));
    assert.equal(newRail.scrollTop, 17);
    assert.equal(oldRail.scrollTop, 5);
  } finally {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: original,
    });
  }
});
