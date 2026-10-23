/** React DOM + jsdom integration checks. These are not browser/visual tests. */
import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createMockAdapter } from "../src/adapters/mock";
import { CanvasWorkspace } from "../src/ui/CanvasWorkspace";
import type { AgentAdapter } from "../src/core/types";

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "http://localhost/" },
);
for (const name of [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "DOMException",
  "localStorage",
  "File",
] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: dom.window[name],
  });
}
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    constructor(private callback: (entries: unknown[]) => void) {}
    observe() {
      this.callback([{ contentRect: { width: 1200, height: 760 } }]);
    }
    disconnect() {}
  },
});
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
let root: ReturnType<typeof createRoot> | undefined;
const key = "dsh-canvas-workspace:v1:mock";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const el = (selector: string) => {
  const node = document.querySelector<HTMLElement>(selector);
  assert.ok(node, `missing ${selector}`);
  return node;
};
const click = async (selector: string) => {
  await act(async () => {
    el(selector).click();
  });
};
const pointer = async (
  selector: string,
  type: string,
  x: number,
  y: number,
  extra: MouseEventInit = {},
) => {
  await act(async () => {
    const event = new dom.window.MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      ...extra,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    el(selector).dispatchEvent(event);
  });
};
const type = async (selector: string, value: string) => {
  await act(async () => {
    const target = el(selector) as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(target, value);
    target.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};
async function mount(
  adapter: AgentAdapter = createMockAdapter(),
  clear = true,
) {
  if (root) await act(async () => root!.unmount());
  if (clear) localStorage.clear();
  root = createRoot(el("#root"));
  await act(async () => {
    root!.render(
      <React.StrictMode>
        <CanvasWorkspace adapter={adapter} mode="mock" />
      </React.StrictMode>,
    );
  });
}
async function settle(ms = 340) {
  await act(async () => {
    await sleep(ms);
  });
}
async function until(predicate: () => boolean, timeout = 6000) {
  const start = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - start < timeout, "timed out waiting for UI state");
    await settle(40);
  }
}

test("React DOM/jsdom spatial workspace integration", async (t) => {
  t.after(async () => {
    if (root) await act(async () => root!.unmount());
    dom.window.close();
  });
  await t.test("adds a real spatial node and persists layout", async () => {
    await mount();
    assert.equal(document.querySelectorAll(".canvas-node").length, 4);
    await click('[aria-label="添加节点"]');
    await click('[aria-label="添加笔记"]');
    assert.equal(document.querySelectorAll(".canvas-node").length, 5);
    await settle();
    const saved = JSON.parse(localStorage.getItem(key)!);
    assert.equal(saved.nodes.length, 5);
    assert.equal(saved.nodes.at(-1).type, "note");
    assert.ok(saved.nodes.at(-1).width > 0);
  });
  await t.test(
    "selected task can be attached without losing selection on the Agent button",
    async () => {
      await mount();
      await pointer('[data-testid="node-drag-plan"]', "pointerdown", 100, 400);
      await pointer(".canvas-stage", "pointerup", 100, 400);
      assert.ok(el('[data-node-id="plan"]').classList.contains("selected"));
      await pointer(".attach-selection", "pointerdown", 500, 300);
      await click(".attach-selection");
      await settle();
      const saved = JSON.parse(localStorage.getItem(key)!);
      assert.deepEqual(
        saved.nodes.find((n: { id: string }) => n.id === "agent-1").contextIds,
        ["brief", "plan"],
      );
    },
  );
  await t.test(
    "mock completion creates separate artifact and preserves input",
    async () => {
      await mount();
      await type(
        '[data-testid="agent-prompt-agent-1"]',
        "给出三条清晰的行动建议",
      );
      await click('[data-testid="agent-run-agent-1"]');
      assert.equal(document.querySelectorAll(".node-artifact").length, 2);
      await until(() =>
        Boolean(document.querySelector(".agent-work-state.done")),
      );
      await settle();
      const saved = JSON.parse(localStorage.getItem(key)!);
      const result = saved.nodes.find(
        (n: { type: string; contextIds: string[] }) =>
          n.type === "artifact" && n.contextIds.includes("agent-1"),
      );
      assert.match(result.body, /本地演示结果/);
      assert.match(result.body, /给出三条清晰的行动建议/);
      assert.equal(result.status, "done");
      assert.deepEqual(result.contextIds, ["agent-1"]);
      assert.equal(
        (el('[data-testid="agent-prompt-agent-1"]') as HTMLTextAreaElement)
          .value,
        "给出三条清晰的行动建议",
      );
    },
  );
  await t.test(
    "drag and zoom update persisted geometry; reload restores it",
    async () => {
      await mount();
      await pointer('[data-testid="node-drag-brief"]', "pointerdown", 100, 150);
      await pointer(".canvas-stage", "pointermove", 134, 167);
      await pointer(".canvas-stage", "pointerup", 134, 167);
      await click('[aria-label="视图与更多"]');
      await click('[aria-label="放大"]');
      await settle();
      const saved = JSON.parse(localStorage.getItem(key)!);
      const note = saved.nodes.find((n: { id: string }) => n.id === "brief");
      assert.equal(note.x, 130);
      assert.equal(note.y, 115);
      assert.ok(saved.viewport.zoom > 0.85);
      await mount(createMockAdapter(), false);
      assert.equal(el('[data-node-id="brief"]').style.left, "130px");
      await click('[aria-label="视图与更多"]');
      assert.equal(el(".zoom-label").textContent, "102%");
    },
  );
  await t.test(
    "cancel retains prompt and partial artifact, and blocks duplicate runs",
    async () => {
      let starts = 0,
        cancels = 0;
      const adapter: AgentAdapter = {
        kind: "mock",
        async createSession() {
          return "mock-test";
        },
        async run({ signal, onText }) {
          starts++;
          onText("保留的部分结果");
          await new Promise<void>((resolve, reject) => {
            if (signal.aborted) reject(new Error("aborted"));
            else
              signal.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true },
              );
          });
        },
        async cancel() {
          cancels++;
        },
      };
      await mount(adapter);
      await type('[data-testid="agent-prompt-agent-1"]', "不要丢失我的输入");
      await click('[data-testid="agent-run-agent-1"]');
      await act(async () => {
        el('[data-testid="agent-prompt-agent-1"]').dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey: true,
            bubbles: true,
          }),
        );
      });
      assert.equal(starts, 1);
      await click('[data-testid="agent-cancel-agent-1"]');
      await settle();
      assert.equal(cancels, 1);
      assert.equal(
        (el('[data-testid="agent-prompt-agent-1"]') as HTMLTextAreaElement)
          .value,
        "不要丢失我的输入",
      );
      const saved = JSON.parse(localStorage.getItem(key)!);
      assert.ok(
        saved.nodes.some(
          (n: { type: string; body: string; status: string }) =>
            n.type === "artifact" &&
            n.body === "保留的部分结果" &&
            n.status === "idle",
        ),
      );
    },
  );
});
