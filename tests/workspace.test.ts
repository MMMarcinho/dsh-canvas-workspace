import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspace,
  parseWorkspace,
  serializeWorkspace,
  buildContext,
  composePrompt,
  MAX_NODES,
} from "../src/core/workspace";
import { createMockAdapter } from "../src/adapters/mock";
test("workspace round-trips without sharing mutable node context arrays", () => {
  const original = createWorkspace();
  const read = parseWorkspace(serializeWorkspace(original));
  assert.deepEqual(read, original);
  read.nodes[0].contextIds.push("changed");
  assert.equal(original.nodes[0].contextIds.length, 0);
});
test("interrupted run resets to idle without issuing any model request", () => {
  const w = createWorkspace();
  w.nodes[2].status = "running";
  assert.equal(parseWorkspace(serializeWorkspace(w)).nodes[2].status, "idle");
});
test("rejects invalid version, duplicate identities, excessive nodes and dangerous geometry", () => {
  const w = createWorkspace();
  for (const mutate of [
    (v: any) => (v.version = 2),
    (v: any) => v.nodes.push(v.nodes[0]),
    (v: any) => (v.nodes[0].x = Infinity),
    (v: any) => (v.viewport.zoom = 0),
    (v: any) => (v.nodes[0].width = -1),
    (v: any) => (v.nodes[0].type = "html"),
    (v: any) => (v.nodes = Array(MAX_NODES + 1).fill(v.nodes[0])),
  ]) {
    const copy = structuredClone(w);
    mutate(copy);
    assert.throws(() => parseWorkspace(JSON.stringify(copy)));
  }
});
test("drops dangling/self context and deduplicates explicit context IDs", () => {
  const w = createWorkspace();
  w.nodes[0].contextIds = ["missing", "brief", "plan", "plan"];
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).nodes[0].contextIds, [
    "plan",
  ]);
  assert.deepEqual(
    buildContext(w.nodes, ["plan", "plan", "missing"]).map((n) => n.id),
    ["plan"],
  );
});
test("selected context is a run snapshot, not implicit whole workspace", () => {
  const w = createWorkspace();
  const ctx = buildContext(w.nodes, ["brief"]);
  w.nodes[0].body = "later edit";
  assert.notEqual(ctx[0].body, "later edit");
  const sent = composePrompt("Compare", ctx);
  assert.match(sent, /Compare/);
  assert.match(sent, /<canvas_context>/);
  assert.ok(!sent.includes(w.nodes[3].body));
});
test("mock owns isolated sessions and emits accumulated visible output", async () => {
  const a = createMockAdapter(),
    id = await a.createSession(),
    other = await a.createSession();
  assert.notEqual(id, other);
  let last = "";
  let updates = 0;
  await a.run({
    sessionId: id,
    prompt: "你好",
    context: [],
    signal: new AbortController().signal,
    onText: (t) => {
      assert.ok(t.startsWith(last));
      last = t;
      updates++;
    },
  });
  assert.match(last, /本地演示/);
  assert.ok(updates > 2);
});
test("mock cancellation settles promptly and permits a later send", async () => {
  const a = createMockAdapter(),
    id = await a.createSession(),
    controller = new AbortController();
  const run = a.run({
    sessionId: id,
    prompt: "cancel",
    context: [],
    signal: controller.signal,
    onText: () => controller.abort(),
  });
  await assert.rejects(run);
  const again = new AbortController();
  again.abort();
  await assert.rejects(
    a.run({
      sessionId: id,
      prompt: "again",
      context: [],
      signal: again.signal,
      onText: () => {},
    }),
  );
});
test("mock prevents duplicate sends to one session", async () => {
  const a = createMockAdapter(),
    id = await a.createSession(),
    c = new AbortController();
  const run = a.run({
    sessionId: id,
    prompt: "one",
    context: [],
    signal: c.signal,
    onText: () => {},
  });
  await assert.rejects(
    a.run({
      sessionId: id,
      prompt: "two",
      context: [],
      signal: c.signal,
      onText: () => {},
    }),
    /已在运行/,
  );
  c.abort();
  await assert.rejects(run);
});
