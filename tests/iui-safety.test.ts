import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SafeEvaluator,
  Runtime,
  parseDsl,
  limits,
} from "../vendor/open-intelligent-ui/protocol/index";
import iuiStyles from "../src/ui/iui-styles";

test("vendored IUI stylesheet matches the licensed upstream source", () => {
  assert.equal(
    iuiStyles,
    readFileSync(
      new URL("../vendor/open-intelligent-ui/ui/styles.css", import.meta.url),
      "utf8",
    ),
  );
});

test("safe evaluator never opens browser or JavaScript escape hatches", () => {
  const evaluator = new SafeEvaluator();
  for (const expression of [
    "globalThis",
    "window",
    "document",
    'fetch("https://example.com")',
    'eval("1")',
    'Function("return 1")',
    'new Function("return 1")',
    "({}).constructor",
    '({})["__proto__"]',
    "({}).prototype",
    '"text".substring(0, 1)',
    '"text".replace("t", "x")',
    '"text".toUpperCase()',
    '"text".constructor',
    '"text"["__proto__"]',
    '"text".prototype',
    '"text".slice.constructor("return globalThis")()',
    '"text".slice.call("other", 0)',
    '"text".slice.apply("other", [0])',
    '({slice: () => "bad"}).slice()',
  ])
    assert.throws(() => evaluator.evaluate(expression), expression);
  assert.equal(evaluator.evaluate('"text".includes("ex")'), true);
  assert.deepEqual(evaluator.evaluate("[1, 2, 3].slice(0, 2)"), [1, 2]);
});

test("declared host-name locals work while globals and dangerous members remain blocked", () => {
  const evaluator = new SafeEvaluator();
  const runtime = new Runtime(
    parseDsl(
      '{@body const top="reflex"}{@body const build=top==="reflex"?"Reflex":"Other"}<text>{build}</text>',
      "local-top",
    ),
  );
  assert.equal(runtime.scope().build, "Reflex");
  for (const name of [
    "top",
    "parent",
    "window",
    "globalThis",
    "document",
    "self",
  ]) {
    assert.equal(evaluator.evaluate(name, { [name]: "local" }), "local");
    assert.throws(() => evaluator.evaluate(name), /blocked identifier/);
  }
  for (const name of [
    "constructor",
    "prototype",
    "__proto__",
    "Function",
    "eval",
    "fetch",
  ])
    assert.throws(
      () => evaluator.evaluate(name, { [name]: "local" }),
      /blocked identifier/,
    );
  for (const expression of [
    "value.top",
    'value["parent"]',
    "value.constructor",
    'value["__proto__"]',
  ])
    assert.throws(
      () =>
        evaluator.evaluate(expression, { value: { top: "x", parent: "x" } }),
      /blocked property/,
    );
  assert.throws(
    () => evaluator.evaluate("[1].map(x=>top)"),
    /blocked identifier: top/,
  );
});

test("IUI parser and evaluator retain source and expression resource limits", () => {
  const result = parseDsl("x".repeat(limits.sourceBytes + 1));
  assert.equal(result.complete, false);
  assert.equal(result.diagnostics[0].code, "source_budget");
  assert.throws(
    () =>
      new SafeEvaluator().evaluate('"' + "x".repeat(limits.stringLength) + '"'),
    /source budget/,
  );
  assert.throws(
    () =>
      new SafeEvaluator().evaluate(
        Array.from({ length: 35 }, () => "!").join("") + "true",
      ),
    /expression budget/,
  );
});

test("pure primitive string slice is bounded and preserves array slice behavior", () => {
  const evaluator = new SafeEvaluator();
  assert.equal(evaluator.evaluate('"abcd".slice(0, 2)'), "ab");
  assert.equal(evaluator.evaluate('"abcd".slice(2)'), "cd");
  assert.equal(evaluator.evaluate('"abcd".slice(-2)'), "cd");
  assert.equal(evaluator.evaluate('"abcd".slice(1, -1)'), "bc");
  assert.equal(evaluator.evaluate('"abcd".slice(3, 1)'), "");
  assert.equal(evaluator.evaluate('"abcd"["slice"]()'), "abcd");
  assert.equal(
    evaluator.evaluate('"████".slice(0, 2) + "░░░░".slice(2)'),
    "██░░",
  );
  assert.deepEqual(evaluator.evaluate("[1, 2, 3].slice(-2)"), [2, 3]);
  assert.throws(
    () =>
      evaluator.evaluate("text.slice()", {
        text: "x".repeat(limits.stringLength + 1),
      }),
    /string budget/,
  );
  assert.equal(
    evaluator.evaluate("text.slice(0, 2)", {
      text: "x".repeat(limits.stringLength + 1),
    }),
    "xx",
  );
});
