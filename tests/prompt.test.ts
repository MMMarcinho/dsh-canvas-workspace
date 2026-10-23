import test from "node:test";
import assert from "node:assert/strict";
import {
  composeCanvasPrompt,
  visibleCanvasPrompt,
  CANVAS_CONTEXT_LABEL,
} from "../src/core/prompt";
import { createWorkspace } from "../src/core/workspace";
const legacy = (prompt: string, json = "[]") =>
  `${prompt}\n\n${CANVAS_CONTEXT_LABEL}\n<canvas_context>\n${json}\n</canvas_context>`;

test("empty context sends exact user text with no scaffolding", () => {
  for (const text of [
    "你好",
    "",
    "  whitespace\n",
    "<canvas_context>\n[]\n</canvas_context>",
  ])
    assert.equal(composeCanvasPrompt(text, []), text);
});

test("selected context has explicit plugin/version boundaries and display never exposes the suffix", () => {
  const nodes = createWorkspace().nodes.slice(0, 2),
    prompt = "比较这些内容";
  const sent = composeCanvasPrompt(prompt, nodes);
  assert.match(sent, /<!-- dsh-canvas-workspace:context:v1 -->/);
  assert.match(sent, /<canvas_context>/);
  assert.ok(sent.includes(nodes[0]!.body.replace(/\n/g, "\\n")));
  assert.equal(visibleCanvasPrompt(sent), prompt);
});

test("recognizes only the exact canonical legacy suffix, including nonempty selected nodes", () => {
  const nodes = createWorkspace()
    .nodes.slice(0, 1)
    .map(({ id, type, title, body }) => ({ id, type, title, body }));
  assert.equal(visibleCanvasPrompt(legacy("真正的问题")), "真正的问题");
  assert.equal(
    visibleCanvasPrompt(
      legacy("有上下文的问题", JSON.stringify(nodes, null, 2)),
    ),
    "有上下文的问题",
  );
});

test("ordinary tags, malformed JSON, foreign schema and nonterminal content remain verbatim", () => {
  const examples = [
    "<canvas_context>\n[]\n</canvas_context>",
    legacy("problem", "not JSON"),
    legacy("problem", '[{"foo":1}]'),
    legacy("problem") + "\n后续用户文字",
    legacy("problem", '{"id":1}'),
    legacy("problem").replace(CANVAS_CONTEXT_LABEL, "用户自己写的说明"),
    legacy("problem").replace("[]", "[ ]"),
  ];
  for (const text of examples) assert.equal(visibleCanvasPrompt(text), text);
});

test("literal envelopes inside fenced code are not stripped or executed", () => {
  for (const fence of ["```text", "~~~~"]) {
    const open = fence + "\n" + legacy("example");
    assert.equal(visibleCanvasPrompt(open), open);
    const closed = open + "\n" + (fence.startsWith("`") ? "```" : "~~~~");
    assert.equal(visibleCanvasPrompt(closed), closed);
  }
  const priorCode = "```text\ncode\n```\n用户问题";
  assert.equal(visibleCanvasPrompt(legacy(priorCode)), priorCode);
});

test("strips only one owned terminal suffix and preserves the exact user prefix", () => {
  const input = "  文本\n\n<canvas_context>custom</canvas_context>\n ";
  assert.equal(visibleCanvasPrompt(legacy(input)), input);
});
