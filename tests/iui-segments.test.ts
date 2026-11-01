import test from "node:test";
import assert from "node:assert/strict";
import { splitCanvasReply } from "../src/adapters/iui";
import { limits, Runtime } from "../vendor/open-intelligent-ui/protocol/index";

function split(text: string, streaming = false) {
  const result = splitCanvasReply(text, "mixed-regression", streaming);
  assert.ok(result);
  return result;
}

test("Mac minimal slice reproduction is a safe IUI root between exact Markdown slices", () => {
  const before = "**之前**\n\n";
  const declarations = '{@body const k=1}\n{@body const bar="██".slice(0,k)}\n';
  const ui = "<box><text>{bar}</text></box>";
  const after = "\n\n- 之后";
  const result = split(before + declarations + ui + after);
  assert.deepEqual(
    result.segments.map((item) => item.kind),
    ["markdown", "ui", "markdown"],
  );
  assert.equal(result.segments[0].text.replace(/\n+$/, ""), "**之前**");
  assert.equal(result.segments[1].text, ui);
  assert.equal(result.segments[2].text, after);
  assert.equal(new Runtime(result.document).scope().bar, "█");
});

test("unsafe declaration and dependent root fail locally, independent later root survives", () => {
  const declaration = '{@body const bad = "abc".replace("a", "z")}';
  const bad = "<box><text>{bad}</text></box>";
  const good = "<card><text>仍然可见</text></card>";
  const result = split(
    `**之前**\n\n${declaration}\n${bad}\n\n- 之间\n\n${good}\n\n**之后**`,
  );
  assert.deepEqual(
    result.segments
      .filter((item) => item.kind === "error")
      .map((item) => item.text),
    [declaration, bad],
  );
  assert.deepEqual(
    result.segments
      .filter((item) => item.kind === "ui")
      .map((item) => item.text),
    [good],
  );
  assert.deepEqual(result.document.declarations, []);
  assert.ok(
    result.segments.some(
      (item) => item.kind === "markdown" && item.text.includes("**之后**"),
    ),
  );
});

test("malformed declaration syntax cannot suppress surrounding Markdown and valid roots", () => {
  const bad = "{@body let x = 1}";
  const good = "<card><text>完整组件</text></card>";
  const result = split(`before\n\n${bad}\n\n${good}\n\nafter`);
  assert.equal(
    result.segments.find((item) => item.kind === "error")?.text,
    bad,
  );
  assert.equal(result.segments.find((item) => item.kind === "ui")?.text, good);
  assert.equal(result.segments.at(-1)?.text, "\n\nafter");
});

test("explicit malformed closing root preserves later Markdown and subsequent UI", () => {
  const declaration = '{@body const title = "后一组件"}';
  const bad = "<card><text>坏的嵌套</card>";
  const good = "<box><text>{title}</text></box>";
  const result = split(
    `${declaration}\n\n**之前**\n\n${bad}\n\n**中间**\n\n${good}\n\n**之后**`,
  );
  assert.equal(
    result.segments.find((item) => item.kind === "error")?.text,
    bad,
  );
  assert.equal(result.segments.find((item) => item.kind === "ui")?.text, good);
  assert.equal(new Runtime(result.document).scope().title, "后一组件");
  const prose = result.segments
    .filter((item) => item.kind === "markdown")
    .map((item) => item.text.trim())
    .filter(Boolean);
  assert.deepEqual(prose, ["**之前**", "**中间**", "**之后**"]);
});

test("empty or unfinished declarations remain readable, never disappear", () => {
  const declaration = "{@body const x = 1}";
  const result = split(`before\n\n${declaration}\n\nafter`, true);
  assert.equal(
    result.segments.find((item) => item.kind === "error")?.text,
    declaration,
  );
  assert.equal(result.segments.at(-1)?.text, "\n\nafter");
  const partial = split("before\n\n{@body const x =", true);
  assert.equal(partial.segments[0].text, "before\n\n");
  assert.equal(partial.segments[1].text, "{@body const x =");
});

test("fences, inline code, escaped roots and foreign HTML stay opaque", () => {
  for (const text of [
    "```iui\n<box><text>code</text></box>\n```",
    "~~~iui\n{@body const x = 1}\n<box><text>code</text></box>\n~~~",
    "`<box><text>code</text></box>`",
    "\\<box><text>escaped</text></box>",
    "<section><box><text>foreign</text></box></section>",
    "Mention <box>inline</box> in prose.",
  ])
    assert.equal(splitCanvasReply(text, "opaque", false), null, text);
});

test("a completed prefix remains safe across unfinished trailing tag/expression revisions", () => {
  const prefix =
    "**before**\n\n<card><text>done</text></card>\n\n**between**\n\n";
  for (const suffix of [
    "<card>",
    "<card><title>partial</title>",
    "<card><title>partial</title><text>{",
    "<card><title>partial</title><text color={",
  ]) {
    const result = split(prefix + suffix, true);
    assert.equal(result.segments[0].text, "**before**\n\n");
    assert.equal(result.segments[1].kind, "ui");
    assert.equal(result.segments[2].text, "\n\n**between**\n\n");
    assert.equal(result.segments[3].text, suffix);
  }
});

test("global parser resource limits are not bypassed by per-root recovery", () => {
  const source = `<box>${"x".repeat(limits.sourceBytes)}</box>`;
  const result = split(source);
  assert.equal(result.document.children.length, 0);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].kind, "error");
  assert.equal(result.segments[0].text, source);
});

test("long fences, embedded fence-like text and top-level indented code never become live UI", () => {
  for (const text of [
    "````\n```\n<card><text>code</text></card>\n````",
    "~~~~\n~~~\n<card><text>code</text></card>\n~~~~",
    "```iui\ntext ``` is not a closing line\n<card><text>code</text></card>\n```",
    "````iui\n<card><text>code</text></card>\n```",
    "    <card><text>code</text></card>",
    "\t<card><text>code</text></card>",
    "    {@body const x = 1}\n    <box><text>{x}</text></box>",
    "text\n\n    <card>\n      <text>code</text>\n    </card>\n\nafter",
    "``<card><text>code</text></card>``` still code ``",
  ])
    assert.equal(splitCanvasReply(text, "markdown-code", false), null, text);
  const result = split(
    "````\n```\n<card><text>code</text></card>\n````\n\n<card><text>real</text></card>",
  );
  assert.equal(result.document.children.length, 1);
  assert.equal(result.segments[0].kind, "markdown");
  assert.equal(result.segments[1].text, "<card><text>real</text></card>");
  const indented = split(
    "    <card><text>code</text></card>\n\n<box>\n    <text>real indented child</text>\n</box>",
  );
  assert.equal(indented.document.children.length, 1);
  assert.equal(indented.document.children[0].kind, "element");
  assert.ok(indented.segments[0].text.includes("code"));
});

test("legacy Boolean predicate and cross-segment declarations render as one safe IUI reply", () => {
  const declaration = `{@body const [sel,setSel]=DIL.useState([false,true,false])}
{@body const onCount=sel.filter(Boolean).length}`;
  const first = `<box><badge>选中 {onCount} 台</badge><button onClick={()=>setSel(v=>v.map((b,i)=>i===2?!b:b))}>选择</button></box>`;
  const second = `<card><text>{onCount}</text></card>`;
  const result = split(
    `之前\n\n${declaration}\n${first}\n\n中间\n\n${second}\n\n之后`,
  );
  assert.equal(result.segments.filter((item) => item.kind === "ui").length, 2);
  assert.equal(
    result.segments.filter((item) => item.kind === "error").length,
    0,
  );
  const runtime = new Runtime(result.document);
  assert.equal(runtime.scope().onCount, 1);
});

test("a declared Boolean shadows the shorthand; unresolved globals stay source-only", () => {
  const local = split(
    "{@body const Boolean=x=>x>1}{@body const kept=[0,1,2].filter(Boolean)}<box><text>{kept.length}</text></box>",
  );
  assert.equal(local.segments.filter((item) => item.kind === "ui").length, 1);
  assert.deepEqual(new Runtime(local.document).scope().kept, [2]);
  const unsafe = split(
    "<box><text>{Boolean(1)}</text></box><card><text>仍可显示</text></card>",
  );
  assert.equal(
    unsafe.segments.filter((item) => item.kind === "error").length,
    1,
  );
  assert.equal(unsafe.segments.filter((item) => item.kind === "ui").length, 1);
});
