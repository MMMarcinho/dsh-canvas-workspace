/** Cloud-only DOM tests: no model requests, external navigation, or host modifications. */
import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { ReplyContentProps } from "../src/ui/ReplyContent";

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "http://localhost/" },
);
for (const name of [
  "window",
  "document",
  "HTMLElement",
  "Event",
  "MouseEvent",
  "MutationObserver",
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// Import only after the DOM exists so React's delegated events detect the DOM correctly.
const { createRoot } = await import("react-dom/client");
const { ReplyContent } = await import("../src/ui/ReplyContent");
const root = createRoot(document.querySelector("#root")!);
let current: ReplyContentProps;
async function render(
  props: Partial<ReplyContentProps> & { text: string },
  reset = true,
) {
  current = {
    messageId: reset ? String(++messageNumber) : current.messageId,
    streaming: false,
    iuiEnabled: true,
    ...props,
  };
  await act(async () => {
    root.render(
      <React.StrictMode>
        <ReplyContent {...current} />
      </React.StrictMode>,
    );
  });
}
let messageNumber = 0;
function shadows() {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-canvas-iui-root]"),
  ].map((node) => node.shadowRoot!);
}
function shadow(selector: string, index = 0) {
  const result = shadows()[index]?.querySelector<HTMLElement>(selector);
  assert.ok(result, `missing shadow ${selector}`);
  return result;
}
async function click(selector: string, index = 0) {
  await act(async () => {
    shadow(selector, index).click();
  });
}
const stateful = `{@body const [count, setCount] = DIL.useState(0)}
<card><title>安全计数器</title><text>当前：{count}</text><button onClick={() => setCount(count + 1)}>增加</button></card>`;
const actions = `<card><button onClick={() => GenUI.issueNewTurn("继续这段会话")}>继续</button></card>`;

test("safe reply rendering, actions, streaming and recovery", async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });

  await t.test(
    "source and reasoning controls share one row and expand exclusively",
    async () => {
      await render({
        text: "<card><text>内容</text></card>",
        reasoning: "模型返回的思考",
      });
      const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".chat-reply-disclosure-actions button",
        ),
      ];
      assert.deepEqual(
        buttons.map((button) => button.textContent?.trim()),
        ["查看原文", "查看思考内容"],
      );
      const source = document.querySelector<HTMLElement>(".chat-iui-source")!;
      const reasoning = document.querySelector<HTMLElement>(
        ".chat-reasoning-done",
      )!;
      assert.equal(source.hidden, true);
      assert.equal(reasoning.hidden, true);
      await act(async () => buttons[0].click());
      assert.equal(source.hidden, false);
      assert.equal(reasoning.hidden, true);
      await act(async () => buttons[1].click());
      assert.equal(source.hidden, true);
      assert.equal(reasoning.hidden, false);
      assert.equal(buttons[0].getAttribute("aria-expanded"), "false");
      assert.equal(buttons[1].getAttribute("aria-expanded"), "true");
    },
  );

  await t.test(
    "IUI images use host resources and accept only the exact Desktop file endpoint",
    async () => {
      for (const src of [
        "https://example.com/a.png",
        "dsh-app://app/api/file?path=%2Fart%2Fa.png",
      ]) {
        await render({
          text: '<AsyncImage query="a.png" />',
          onIuiResource: async () => ({
            ok: true,
            value: { src, alt: "封面" },
          }),
        });
        assert.equal(shadow("img").getAttribute("src"), src);
      }
      for (const src of [
        "dsh-app://shell/api/file?path=%2Fa.png",
        "dsh-app://app/assets/a.png",
        "dsh-app://app/api/file-other?path=%2Fa.png",
        "dsh-app://app.evil/api/file?path=%2Fa.png",
        "dsh-app://app/api/file?path=relative.png",
        "dsh-app://app/api/file?path=%2F%2Fhost%2Fa.png",
        "dsh-app://app/api/file?path=%2Fa.png&cmd=x",
        "javascript:alert(1)",
        "file:///tmp/a.png",
      ]) {
        await render({
          text: '<AsyncImage query="a.png" />',
          onIuiResource: async () => ({
            ok: true,
            value: { src, alt: "封面" },
          }),
        });
        assert.equal(shadows()[0].querySelector("img"), null, src);
        assert.ok(shadow('[data-image-status="error"]'));
      }
    },
  );
  await t.test(
    "streaming IUI image revisions update without freezing the first parsed root",
    async () => {
      const resource = async (request: { query?: unknown }) => ({
        ok: true,
        value: {
          src: "https://example.com/" + request.query,
          alt: "Image",
        },
      });
      await render({
        text: '<AsyncImage query="first.png" />',
        streaming: true,
        onIuiResource: resource,
      });
      assert.equal(
        shadow("img").getAttribute("src"),
        "https://example.com/first.png",
      );
      await render(
        {
          text: '<AsyncImage query="second.png" />',
          streaming: false,
          onIuiResource: resource,
        },
        false,
      );
      assert.equal(
        shadow("img").getAttribute("src"),
        "https://example.com/second.png",
      );
    },
  );
  await t.test(
    "ready IUI images open the host viewer without taking over context menus",
    async () => {
      await render({
        text: '<AsyncImage query="cover.png" />',
        onIuiResource: async () => ({
          ok: true,
          value: { src: "https://example.com/cover.png", alt: "封面" },
        }),
        renderImagePreview: (src, alt, onClose) => (
          <div
            role="dialog"
            aria-label="图片预览"
            data-src={src}
            data-alt={alt}
          >
            <button onClick={onClose}>关闭</button>
          </div>
        ),
      });
      await act(async () =>
        shadow("img").dispatchEvent(new dom.window.Event("load")),
      );
      const image = shadow("img");
      assert.equal(image.getAttribute("role"), "button");
      assert.equal(image.getAttribute("tabindex"), "0");
      const contextMenu = new dom.window.MouseEvent("contextmenu", {
        bubbles: true,
        composed: true,
        cancelable: true,
        button: 2,
      });
      await act(async () => image.dispatchEvent(contextMenu));
      assert.equal(contextMenu.defaultPrevented, false);
      assert.equal(document.querySelector('[role="dialog"]'), null);
      await act(async () => image.click());
      assert.equal(
        document.querySelector('[role="dialog"]')?.getAttribute("data-src"),
        "https://example.com/cover.png",
      );
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>('[role="dialog"] button')!
          .click(),
      );
      assert.equal(document.querySelector('[role="dialog"]'), null);
      await act(async () =>
        image.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            composed: true,
            cancelable: true,
          }),
        ),
      );
      assert.ok(document.querySelector('[role="dialog"]'));
    },
  );
  await t.test(
    "image groups retain distinct dimensions and ignore stale session resolutions",
    async () => {
      let old!: (result: {
        ok: boolean;
        value: { src: string; alt: string };
      }) => void;
      await render({
        text: '<AsyncImage query="a.png" />',
        resourceScopeKey: "old",
        onIuiResource: () =>
          new Promise((resolve) => {
            old = resolve;
          }),
      });
      await render(
        {
          text: '<AsyncImage query="a.png" />',
          resourceScopeKey: "new",
          onIuiResource: async () => ({
            ok: true,
            value: { src: "https://example.com/new.png", alt: "New" },
          }),
        },
        false,
      );
      await act(async () =>
        old({
          ok: true,
          value: { src: "https://example.com/old.png", alt: "Old" },
        }),
      );
      assert.equal(
        shadow("img").getAttribute("src"),
        "https://example.com/new.png",
      );
      await render({
        text: '<AsyncImageGroup query={["portrait.png", "landscape.png"]} />',
        onIuiResource: async (request) => ({
          ok: true,
          value: {
            src: "https://example.com/" + request.query,
            alt: String(request.query),
            width: request.query === "portrait.png" ? 1080 : 1920,
            height: request.query === "portrait.png" ? 1350 : 1080,
          },
        }),
      });
      const images = shadows()[0].querySelectorAll("img");
      assert.equal(images.length, 2);
      assert.equal(images[0].getAttribute("height"), "1350");
      assert.equal(images[1].getAttribute("width"), "1920");
    },
  );
  await t.test(
    "every Markdown segment receives its owning session identity",
    async () => {
      const seen: (string | undefined)[] = [];
      await render({
        text: "Before\n\n<card>Middle</card>\n\nAfter",
        sessionId: "owned-session",
        renderMarkdown: (text, _streaming, session) => {
          seen.push(session);
          return <p>{text}</p>;
        },
      });
      assert.ok(seen.length >= 2);
      assert.ok(seen.every((value) => value === "owned-session"));
    },
  );

  await t.test(
    "Markdown bold, lists and code render; HTML and unsafe links never execute",
    async () => {
      const source =
        '**重点**\n\n- 第一项\n- 第二项\n\n```js\nwindow.alert("not executed")\n```\n\n<script>globalThis.executed = true</script>\n\n<img src=x onerror="globalThis.executed = true">\n\n[坏链接](javascript:alert(1))';
      await render({ text: source });
      assert.equal(document.querySelector("strong")?.textContent, "重点");
      assert.equal(document.querySelectorAll("li").length, 2);
      assert.match(
        document.querySelector("pre code")?.textContent ?? "",
        /window.alert/,
      );
      assert.equal(document.querySelectorAll("script,img").length, 0);
      assert.equal(document.querySelector("a")?.getAttribute("href"), "");
      assert.equal((globalThis as any).executed, undefined);
      assert.match(
        document.querySelector("#root")?.textContent ?? "",
        /<script>/,
      );
    },
  );

  await t.test(
    "native Markdown injection receives exact source and streaming flag",
    async () => {
      const calls: [string, boolean][] = [];
      await render({
        text: "**原生**",
        streaming: true,
        renderMarkdown: (text, streaming) => {
          calls.push([text, streaming]);
          return <span data-native-markdown="">{text}</span>;
        },
      });
      assert.equal(
        document.querySelector("[data-native-markdown]")?.textContent,
        "**原生**",
      );
      assert.ok(
        calls.length > 0 &&
          calls.every(([text, stream]) => text === "**原生**" && stream),
      );
    },
  );

  await t.test(
    "valid DSL renders inside a shadow root and local actions apply once per click",
    async () => {
      await render({ text: stateful });
      assert.match(shadow(".iui-root").textContent ?? "", /当前：0/);
      assert.equal(document.querySelectorAll(".chat-markdown").length, 0);
      assert.equal(
        document
          .querySelector(".chat-iui-content")
          ?.getAttribute("data-iui-layout"),
        "standalone",
      );
      assert.equal(
        shadows()[0].querySelectorAll("style").length,
        1,
        "StrictMode leaves exactly one stylesheet",
      );
      await click("button");
      assert.match(shadow(".iui-root").textContent ?? "", /当前：1/);
      await click("button");
      assert.match(shadow(".iui-root").textContent ?? "", /当前：2/);
      await render({ text: `${stateful}\n\n已补充说明` }, false);
      assert.match(
        shadow(".iui-root").textContent ?? "",
        /当前：2/,
        "stream revisions retain local state",
      );
      await render({ text: stateful });
      assert.match(
        shadow(".iui-root").textContent ?? "",
        /当前：0/,
        "another message does not inherit state",
      );
    },
  );

  await t.test(
    "input state updates without replaying any host action",
    async () => {
      const text =
        '{@body const [topic, setTopic] = DIL.useState("起始话题")}\n<card><input value={topic} onChange={setTopic} /><text>{topic}</text><button onClick={() => GenUI.issueNewTurn(topic)}>继续</button></card>';
      const received: string[] = [];
      await render({
        text,
        onIuiAction: async (request) => {
          received.push(request.payload);
          return { ok: true };
        },
      });
      const input = shadow("input") as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          dom.window.HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "更新后的话题");
        input.dispatchEvent(
          new dom.window.Event("input", { bubbles: true, composed: true }),
        );
      });
      assert.match(shadow(".iui-root").textContent ?? "", /更新后的话题/);
      assert.equal(received.length, 0);
      await click("button");
      assert.deepEqual(received, ["更新后的话题"]);
    },
  );

  await t.test(
    "host action callback runs once per click, never on render, replay, or theme changes",
    async () => {
      const received: Parameters<
        NonNullable<ReplyContentProps["onIuiAction"]>
      >[0][] = [];
      const onIuiAction: NonNullable<ReplyContentProps["onIuiAction"]> = async (
        request,
      ) => {
        received.push(request);
        return { ok: true, message: "已发送到当前会话" };
      };
      await render({ text: actions, onIuiAction });
      assert.equal(received.length, 0);
      await click("button");
      assert.equal(received.length, 1);
      assert.equal(received[0].kind, "issueNewTurn");
      assert.equal(received[0].payload, "继续这段会话");
      assert.equal(received[0].messageId, current.messageId);
      assert.match(
        document.querySelector('[role="status"]')?.textContent ?? "",
        /已发送/,
      );
      await render({ text: actions, onIuiAction }, false);
      await act(async () => {
        document.body.setAttribute("data-ds-dark-theme", "");
      });
      assert.equal(received.length, 1);
      await click("button");
      assert.equal(
        received.length,
        2,
        "a distinct intentional click works again",
      );
      assert.notEqual(received[1].id, received[0].id);
      await act(async () => {
        document.body.removeAttribute("data-ds-dark-theme");
      });
    },
  );

  await t.test(
    "latest action owner is used without remounting or replaying actions",
    async () => {
      let old = 0,
        latest = 0;
      await render({
        text: actions,
        onIuiAction: async () => {
          old++;
          return { ok: true };
        },
      });
      await render(
        {
          text: actions,
          onIuiAction: async () => {
            latest++;
            return { ok: true };
          },
        },
        false,
      );
      await click("button");
      assert.equal(old, 0);
      assert.equal(latest, 1);
    },
  );

  await t.test(
    "remounting the same reply never reuses a completed action id",
    async () => {
      const ids: string[] = [];
      const onIuiAction: NonNullable<ReplyContentProps["onIuiAction"]> = async (
        request,
      ) => {
        ids.push(request.id);
        return { ok: true };
      };
      await render({ text: actions, onIuiAction });
      await click("button");
      await render({ text: actions, iuiEnabled: false, onIuiAction }, false);
      await render({ text: actions, iuiEnabled: true, onIuiAction }, false);
      assert.equal(ids.length, 1, "restoring UI does not replay an action");
      await click("button");
      assert.equal(ids.length, 2);
      assert.notEqual(ids[0], ids[1]);
    },
  );

  await t.test(
    "missing and rejected action handlers produce visible feedback",
    async () => {
      await render({ text: actions });
      await click("button");
      assert.match(
        document.querySelector('[role="status"]')?.textContent ?? "",
        /未执行任何操作/,
      );
      await render({
        text: actions,
        onIuiAction: async () => {
          throw new Error("连接已断开");
        },
      });
      await click("button");
      assert.match(
        document.querySelector('[role="status"]')?.textContent ?? "",
        /连接已断开/,
      );
    },
  );

  await t.test(
    "unsupported string method fails visibly and preserves source",
    async () => {
      const text =
        '{@body const bar = "abcd".replace("a", "z")}\n<card><text>{bar}</text></card>';
      await render({ text });
      assert.equal(shadows().length, 0);
      assert.match(
        document.querySelector('[role="status"]')?.textContent ?? "",
        /string method forbidden/,
      );
      assert.equal(
        document.querySelector(".chat-iui-source pre")?.textContent,
        text,
      );
      await render({ text: stateful }, false);
      assert.match(shadow(".iui-root").textContent ?? "", /安全计数器/);
    },
  );

  await t.test(
    "forbidden expressions in user events stay blocked and disclose the failure",
    async () => {
      let called = 0;
      const text =
        '<card><button onClick={() => GenUI.issueNewTurn("abcd".replace("a", "z"))}>不安全事件</button></card>';
      await render({
        text,
        onIuiAction: async () => {
          called++;
          return { ok: true };
        },
      });
      await click("button");
      assert.equal(called, 0);
      assert.match(
        document.querySelector('[role="status"]')?.textContent ?? "",
        /string method forbidden/,
      );
      assert.equal(
        document.querySelector(".chat-iui-source pre")?.textContent,
        text,
      );
    },
  );

  await t.test(
    "mixed Markdown and multiple roots remain ordered and share local state",
    async () => {
      const text = `**之前**\n\n{@body const [n, setN] = DIL.useState(0)}\n<card><button onClick={() => setN(n + 1)}>增加</button></card>\n\n- 之间\n\n<card><text>总数：{n}</text></card>\n\n**之后**`;
      await render({ text });
      const sequence = [
        ...document.querySelector(".chat-iui-content")!.children,
      ]
        .slice(0, 5)
        .map((node) =>
          node.hasAttribute("data-canvas-iui-root")
            ? "ui"
            : node.textContent?.trim(),
        );
      assert.deepEqual(sequence, ["之前", "ui", "之间", "ui", "之后"]);
      await click("button", 0);
      assert.match(shadow(".iui-root", 1).textContent ?? "", /总数：1/);
    },
  );

  await t.test(
    "Mac slice progress bar renders between Markdown with local slider and tab state",
    async () => {
      const text = `**组件之前**\n\n{@body const [steps, setSteps] = DIL.useState(6500)}
{@body const [tab, setTab] = DIL.useState("今日")}
{@body const pct = Math.round(steps / 10000 * 100)}
{@body const k = Math.min(20, Math.round(pct / 5))}
{@body const bar = "████████████████████".slice(0, k) + "░░░░░░░░░░░░░░░░░░░░".slice(k)}
<box><title>本地状态演示</title><button onClick={() => setTab("目标")}>目标</button>
{#if tab === "今日"}<text>步数：{steps}</text><text>{bar}</text><slider value={steps} min={0} max={15000} step={500} onChange={setSteps} />{/if}
{#if tab === "目标"}<text>目标页</text>{/if}</box>\n\n- 组件之后`;
      let hostActions = 0;
      await render({
        text,
        onIuiAction: async () => {
          hostActions++;
          return { ok: true };
        },
      });
      const content = document.querySelector(".chat-iui-content")!;
      assert.equal(content.getAttribute("data-iui-layout"), "mixed");
      assert.deepEqual(
        [...content.children]
          .slice(0, 3)
          .map((node) =>
            node.hasAttribute("data-canvas-iui-root")
              ? "ui"
              : node.textContent?.trim(),
          ),
        ["组件之前", "ui", "组件之后"],
      );
      assert.equal(
        document.querySelector(".chat-markdown strong")?.textContent,
        "组件之前",
      );
      assert.equal(
        document.querySelector(".chat-markdown li")?.textContent,
        "组件之后",
      );
      assert.match(
        shadow(".iui-root").textContent ?? "",
        /█████████████░░░░░░░/,
      );
      const slider = shadow('input[type="range"]') as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          dom.window.HTMLInputElement.prototype,
          "value",
        )!.set!.call(slider, "10000");
        slider.dispatchEvent(
          new dom.window.Event("input", { bubbles: true, composed: true }),
        );
      });
      assert.match(shadow(".iui-root").textContent ?? "", /步数：10000/);
      assert.match(
        shadow(".iui-root").textContent ?? "",
        /████████████████████/,
      );
      await click("button");
      assert.match(shadow(".iui-root").textContent ?? "", /目标页/);
      assert.equal(hostActions, 0);
      assert.equal(document.querySelector('[data-iui-state="error"]'), null);
    },
  );

  await t.test(
    "one unsafe block leaves surrounding Markdown and other IUI roots visible",
    async () => {
      const invalid = '<card><text>{"blocked".replace("b", "x")}</text></card>';
      const text = `**之前**\n\n<card><text>第一个组件</text></card>\n\n- 中间\n\n${invalid}\n\n**之后**\n\n<card><text>最后组件</text></card>`;
      await render({ text });
      assert.equal(shadows().length, 2);
      assert.match(shadow(".iui-root", 0).textContent ?? "", /第一个组件/);
      assert.match(shadow(".iui-root", 1).textContent ?? "", /最后组件/);
      assert.deepEqual(
        [...document.querySelectorAll(".chat-markdown")].map((node) =>
          node.textContent?.trim(),
        ),
        ["之前", "中间", "之后"],
      );
      assert.equal(
        document.querySelector('[data-iui-state="error"] pre')?.textContent,
        invalid,
      );
    },
  );

  await t.test(
    "streaming unfinished tail never swallows completed Markdown or IUI",
    async () => {
      const prefix =
        "**之前**\n\n<card><text>已完成组件</text></card>\n\n- 中间\n\n";
      const tail = "<card><title>正在生成</title><text>{";
      await render({ text: prefix + tail, streaming: true });
      assert.equal(shadows().length, 2);
      assert.match(shadow(".iui-root", 0).textContent ?? "", /已完成组件/);
      assert.match(shadow(".iui-root", 1).textContent ?? "", /正在生成/);
      assert.deepEqual(
        [...document.querySelectorAll(".chat-markdown")].map((node) =>
          node.textContent?.trim(),
        ),
        ["之前", "中间"],
      );
      await render({ text: prefix + tail, streaming: false }, false);
      assert.equal(shadows().length, 1);
      assert.match(shadow(".iui-root", 0).textContent ?? "", /已完成组件/);
      assert.equal(
        document.querySelector('[data-iui-state="error"] pre')?.textContent,
        tail,
      );
      assert.equal(
        document.querySelector(".chat-markdown li")?.textContent,
        "中间",
      );
    },
  );

  await t.test(
    "a throwing Markdown segment cannot remove adjacent UI or later Markdown",
    async () => {
      const originalError = console.error;
      console.error = () => {};
      try {
        await render({
          text: "bad\n\n<card><text>独立组件</text></card>\n\ngood",
          renderMarkdown: (text) => {
            if (text.includes("bad")) throw new Error("one segment failed");
            return <strong>{text.trim()}</strong>;
          },
        });
        assert.match(shadow(".iui-root").textContent ?? "", /独立组件/);
        assert.equal(
          document.querySelector(".chat-markdown strong")?.textContent,
          "good",
        );
        assert.match(
          document.querySelector('[data-iui-state="error"] pre')?.textContent ??
            "",
          /bad/,
        );
      } finally {
        console.error = originalError;
      }
    },
  );

  await t.test(
    "partial fences and fenced DSL stay literal, even when IUI is enabled",
    async () => {
      for (const fence of ["```", "~~~"]) {
        for (const suffix of ["", "\n", `\n${fence}`]) {
          await render({
            text: `${fence}iui\n${stateful}${suffix}`,
            streaming: true,
          });
          assert.equal(shadows().length, 0);
          assert.match(
            document.querySelector("pre code")?.textContent ?? "",
            /DIL.useState/,
          );
          assert.equal(
            document.querySelector('[data-iui-state="error"]'),
            null,
          );
        }
      }
    },
  );

  await t.test(
    "long Markdown fences and indented code stay code, never interactive UI",
    async () => {
      for (const text of [
        "````\n```\n<card><button>代码按钮</button></card>\n````",
        "    <card><button>代码按钮</button></card>",
      ]) {
        await render({ text });
        assert.equal(shadows().length, 0);
        assert.equal(document.querySelector("button"), null);
        assert.match(
          document.querySelector("pre code")?.textContent ?? "",
          /代码按钮/,
        );
        assert.equal(document.querySelector('[data-iui-state="error"]'), null);
      }
    },
  );

  await t.test(
    "streamed IUI previews safely, final unclosed syntax is not claimed valid",
    async () => {
      await render({
        text: "<card><title>逐步出现</title><text>",
        streaming: true,
      });
      assert.match(shadow(".iui-root").textContent ?? "", /逐步出现/);
      assert.equal(
        document
          .querySelector(".chat-iui-content")
          ?.getAttribute("data-iui-state"),
        "preview",
      );
      await render(
        { text: "<card><title>逐步出现</title><text>{", streaming: true },
        false,
      );
      assert.match(shadow(".iui-root").textContent ?? "", /逐步出现/);
      await render(
        { text: "<card><title>逐步出现</title><text>{", streaming: false },
        false,
      );
      assert.equal(shadows().length, 0);
      assert.equal(
        document.querySelector('[data-iui-state="error"] pre')?.textContent,
        current.text,
      );
      await render({ text: "<card><title>完整出现</title></card>" }, false);
      assert.match(shadow(".iui-root").textContent ?? "", /完整出现/);
    },
  );

  await t.test(
    "switching messages while streaming never leaks a prior preview",
    async () => {
      await render({ text: stateful, streaming: true });
      const text = '<card><text>{"bad".replace("a", "z")}</text></card>';
      await render({ text, streaming: true });
      assert.equal(shadows().length, 0);
      assert.equal(
        document.querySelector('[data-iui-state="pending"] pre')?.textContent,
        text,
      );
    },
  );

  await t.test(
    "IUI toggle-off removes live UI and host actions while preserving source",
    async () => {
      let called = 0;
      await render({
        text: actions,
        onIuiAction: async () => {
          called++;
          return { ok: true };
        },
      });
      await render({ text: actions, iuiEnabled: false }, false);
      assert.equal(shadows().length, 0);
      assert.equal(document.querySelector("button"), null);
      assert.equal(called, 0);
      assert.match(
        document.querySelector("#root")?.textContent ?? "",
        /GenUI.issueNewTurn/,
      );
    },
  );

  await t.test(
    "raw AppBlock HTML cannot run or request external resources",
    async () => {
      await render({
        text: '<AppBlock app_block_id="untrusted" title="受限应用">\n<script>globalThis.executed=true</script>\n</AppBlock>',
      });
      await click("button");
      assert.equal(shadows()[0].querySelector("iframe,script"), null);
      assert.match(shadow('[role="status"]').textContent ?? "", /宿主未配置/);
      assert.equal((globalThis as any).executed, undefined);
    },
  );

  await t.test(
    "renderer boundary preserves source and resets when a corrected reply arrives",
    async () => {
      const errors: unknown[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };
      try {
        await render({
          text: "保留这段内容",
          renderMarkdown: () => {
            throw new Error("synthetic renderer failure");
          },
        });
        assert.equal(
          document.querySelector('[data-iui-state="error"] pre')?.textContent,
          "保留这段内容",
        );
        assert.match(
          document.querySelector('[role="status"]')?.textContent ?? "",
          /渲染失败/,
        );
        await render({ text: "**恢复正常**" }, false);
        assert.equal(document.querySelector("strong")?.textContent, "恢复正常");
        assert.ok(
          errors.length > 0,
          "React reported the controlled renderer exception",
        );
      } finally {
        console.error = originalError;
      }
    },
  );
});
