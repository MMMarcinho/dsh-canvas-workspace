import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@deepseek-ai/cordis";
import type {
  SessionAssistantSettlementEntry,
  SessionEventChange,
  SessionEventLike,
  SessionEventLikeEntry,
  SessionEventWindow,
  SessionSnapshot,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionAssistantStreamFrame } from "@deepseek-ai/dsh-api-session-controller/types";
// Test-only integration with the pinned official implementation, not a copied
// imitation of its delayed publication decisions or fractional live seqs.
import { ClientAssistantStream } from "../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/assistant-stream.js";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ConnectionGeneration } from "@deepseek-ai/dsh-client-connection/client";
import type { SessionStatusSnapshot } from "@deepseek-ai/dsh-client-ui-session/client";
import type { LlmAttemptId } from "@deepseek-ai/dsh-llm";
import { createDshAdapter } from "../src/adapters/dsh";
import type { AgentRun, AgentSessionSnapshot } from "../src/core/types";

function source<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: T) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    get count() {
      return listeners.size;
    },
  };
}

function fixture(options: { openingError?: Error } = {}) {
  const id = "canvas-test" as SessionId;
  const sessionState = source<SessionSnapshot>({
    sessionId: id,
    pendingSubmissions: [],
    running: false,
    subagent: null,
    removed: false,
    openState: "open",
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: true,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  });
  const events = source<SessionEventWindow>({
    entries: [],
    hasMore: false,
    revision: 0,
    change: { kind: "replace", entries: [] },
  });
  const generation = source<ConnectionGeneration | undefined>({
    id: 1,
    host: { home: "/test" },
  });
  const status = source<SessionStatusSnapshot>(new Map());
  let seq = 0,
    released = 0,
    canceled = 0,
    prompts = 0,
    opened = "";
  let inputPhase: "plain" | "submitting" = "plain";
  const sent: {
    content: { type: string; text?: string }[];
    requestId?: string;
  }[] = [];
  const session = {
    ...sessionState,
    beginSubmission: () => ({ requestId: "own-rpc", abandon() {} }),
    prompt: async (
      content: { type: string; text?: string }[],
      _mode: string,
      _signal?: AbortSignal,
      requestId?: string,
    ) => {
      prompts++;
      sent.push({ content, requestId });
      return { ok: true, value: { accepted: true } };
    },
    cancel: async () => {
      canceled++;
      return { ok: true, value: { accepted: true } };
    },
  };
  const binding = { sessionId: id, session, eventSource: events };
  // Intentional test-only cast: this fixture supplies the exercised service face,
  // not a whole live Cordis plugin graph. Production uses the real Context type.
  const ctx = {
    get: () => ({ generation }),
    sessions: {
      create: async () => id,
      binding: () => binding,
      scope: () => ({}),
      retain: () => ({
        binding,
        ready:
          options.openingError === undefined
            ? Promise.resolve(binding)
            : Promise.reject(options.openingError),
        release: () => {
          released++;
        },
      }),
    },
    uiSession: { sessionStatus: status },
    conversation: {
      input: {
        for: () => ({ state: { getSnapshot: () => ({ phase: inputPhase }) } }),
      },
    },
    uiWorkspace: {
      openSession: (next: string) => {
        opened = next;
      },
    },
  } as unknown as Context;
  const adapter = createDshAdapter(ctx, { settlementTimeoutMs: 15 });
  const abort = new AbortController();
  const texts: string[] = [];
  const updates: { text: string; timestamp?: number; durable?: boolean }[] = [];
  const observations: {
    text: string;
    meta: Parameters<AgentRun["onText"]>[1];
  }[] = [];
  const run = () =>
    adapter.run({
      sessionId: id,
      prompt: "任务",
      context: [],
      signal: abort.signal,
      onText: (text, meta) => {
        observations.push({ text, meta });
        // The initial identity-only notification is tested separately; these
        // arrays retain the text/time publication assertions below.
        if (text !== "" || meta?.timestamp !== undefined) {
          texts.push(text);
          updates.push({
            text,
            timestamp: meta?.timestamp,
            durable: meta?.durable,
          });
        }
      },
    });
  const record = (
    type: string,
    data: object,
    transient = false,
    time?: number,
  ) => {
    // These deterministic records mirror DSH's verified wire event fields.
    const event = {
      type,
      data,
      seq: ++seq,
      time: time ?? seq,
      surfaceOp: "append",
    } as SessionEventLike;
    return {
      type: transient ? "transient" : "event",
      event,
    } as SessionEventLikeEntry;
  };
  const publish = (change: SessionEventChange) => {
    const previous = events.getSnapshot();
    let entries = previous.entries;
    if (change.kind === "append") entries = [...entries, ...change.entries];
    if (change.kind === "replace") entries = change.entries;
    if (change.kind === "prepend") entries = [...change.entries, ...entries];
    if (change.kind === "settle-assistant") {
      entries = entries.filter(
        (entry) =>
          entry.type !== "transient" ||
          entry.event.data.attemptId !== change.attemptId,
      );
      if (change.entry !== undefined)
        entries = [...entries, change.entry].sort(
          (a, b) => a.event.seq - b.event.seq,
        );
    }
    events.set({
      ...previous,
      entries,
      revision: previous.revision + 1,
      change,
    });
  };
  const emit = (
    type: string,
    data: object,
    transient = false,
    time?: number,
  ) => {
    const entry = record(type, data, transient, time);
    publish({ kind: "append", entries: [entry] });
    return entry;
  };
  const start = () => {
    emit("turn/start", { turn: 1 });
    emit("user/message", {
      id: "message",
      role: "user",
      source: { kind: "user", rpcId: "own-rpc" },
      content: [{ type: "text", text: "任务" }],
    });
    sessionState.set({ ...sessionState.getSnapshot(), running: true });
  };
  return {
    adapter,
    abort,
    id,
    texts,
    updates,
    observations,
    sent,
    events,
    generation,
    status,
    sessionState,
    run,
    emit,
    record,
    publish,
    start,
    setInputPhase(value: "plain" | "submitting") {
      inputPhase = value;
    },
    get released() {
      return released;
    },
    get canceled() {
      return canceled;
    },
    get prompts() {
      return prompts;
    },
    get opened() {
      return opened;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("DSH IUI actions see native input admission and running state before sending", () => {
  const f = fixture();
  assert.equal(f.adapter.isSessionBusy?.(f.id), false);
  f.setInputPhase("submitting");
  assert.equal(f.adapter.isSessionBusy?.(f.id), true);
  f.setInputPhase("plain");
  f.sessionState.set({ ...f.sessionState.getSnapshot(), running: true });
  assert.equal(f.adapter.isSessionBusy?.(f.id), true);
  f.sessionState.set({
    ...f.sessionState.getSnapshot(),
    running: false,
    awaitingFirstTurn: true,
  });
  assert.equal(f.adapter.isSessionBusy?.(f.id), true);
  assert.equal(f.prompts, 0);
});

test("DSH admission is not completion; live and final text replace rather than duplicate", async () => {
  const f = fixture();
  let complete = false;
  const result = f.run().then(() => {
    complete = true;
  });
  await tick();
  assert.equal(f.prompts, 1);
  assert.equal(complete, false);
  assert.equal(f.sent[0]!.content[0]!.text!, "任务");
  assert.equal(f.sent[0]!.requestId, "own-rpc");
  f.start();
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "a",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "Hello" },
    },
    true,
  );
  f.emit("assistant/message", {
    turn: 1,
    step: 0,
    message: { content: [{ type: "text", text: "Hello world" }] },
    stream: [],
  });
  assert.deepEqual(f.texts, ["Hello", "Hello world"]);
  assert.equal(complete, false);
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await result;
  assert.equal(f.released, 1);
  assert.equal(f.events.count, 0);
  assert.equal(f.status.count, 0);
  assert.equal(f.generation.count, 0);
});

test("DSH reasoning deltas and durable history stay separate from answer text", async () => {
  const f = fixture();
  const snapshots: AgentSessionSnapshot[] = [];
  const dispose = f.adapter.observeSession!(f.id, (snapshot) =>
    snapshots.push(snapshot),
  );
  const result = f.run();
  await tick();
  f.start();
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "reasoning-attempt",
      turn: 1,
      step: 0,
      chunk: { type: "reasoning-delta", index: 0, text: "Think" },
    },
    true,
  );
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "reasoning-attempt",
      turn: 1,
      step: 0,
      chunk: { type: "reasoning-delta", index: 0, text: " more" },
    },
    true,
  );
  assert.equal(f.observations.at(-1)?.text, "");
  assert.equal(f.observations.at(-1)?.meta?.reasoning, "Think more");
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "reasoning-attempt",
      turn: 1,
      step: 0,
      chunk: {
        type: "block-end",
        index: 0,
        block: { type: "reasoning", text: "Think more (complete)" },
      },
    },
    true,
  );
  assert.equal(f.observations.at(-1)?.meta?.reasoning, "Think more (complete)");
  f.emit("assistant/message", {
    turn: 1,
    step: 0,
    message: {
      content: [
        { type: "reasoning", text: "Think more and conclude" },
        { type: "text", text: "Answer" },
      ],
    },
    stream: [],
  });
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await result;
  await tick();
  assert.equal(f.observations.at(-1)?.text, "Answer");
  assert.equal(
    f.observations.at(-1)?.meta?.reasoning,
    "Think more and conclude",
  );
  assert.equal(snapshots.at(-1)?.turns[0]?.body, "Answer");
  assert.equal(
    snapshots.at(-1)?.turns[0]?.reasoning,
    "Think more and conclude",
  );
  assert.equal(f.sent[0]?.content[0]?.text, "任务");
  dispose();
});

test("DSH waits for durable settlement after turn/end before marking output complete", async () => {
  const f = fixture();
  let complete = false;
  const result = f.run().then(() => {
    complete = true;
  });
  await tick();
  f.start();
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "a",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "alpha" },
    },
    true,
  );
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await tick();
  assert.equal(complete, false);
  assert.equal(f.texts.at(-1), "alpha");
  const previous = f.events.getSnapshot();
  const event = {
    // Journal order precedes turn/end even though host publishes settlement later.
    type: "assistant/message",
    seq: 3,
    time: 3,
    surfaceOp: "append",
    data: {
      turn: 1,
      step: 0,
      message: { content: [{ type: "text", text: "alpha beta" }] },
    },
  } as unknown as SessionEventLike;
  f.events.set({
    ...previous,
    revision: previous.revision + 1,
    entries: [
      ...previous.entries,
      { type: "event", event } as SessionEventLikeEntry,
    ],
    change: {
      kind: "settle-assistant",
      attemptId: "a" as LlmAttemptId,
      entry: { type: "event", event } as never,
    },
  });
  await result;
  assert.equal(f.texts.at(-1), "alpha beta");
  assert.equal(f.events.count, 0);
});

test("DSH follows the official stream's delayed append after the durable turn end", async () => {
  const f = fixture();
  const stream = new ClientAssistantStream();
  stream.replace([]);
  const deliver = (
    decision: ReturnType<ClientAssistantStream["acceptFrame"]>,
  ) => {
    assert.notEqual(decision?.type, "rebaseline");
    if (decision?.type === "publish" || decision?.type === "transient") {
      f.publish({ kind: "append", entries: [decision.entry] });
      if (decision.type === "publish" && decision.retireAttemptId !== undefined)
        f.publish({
          kind: "settle-assistant",
          attemptId: decision.retireAttemptId,
        });
    } else if (
      decision?.type === "settlement" ||
      decision?.type === "abandonment"
    ) {
      f.publish({
        kind: "settle-assistant",
        attemptId: decision.attemptId,
        ...(decision.type === "settlement" ? { entry: decision.entry } : {}),
      });
    }
  };
  const durable = (type: string, data: object, time?: number) => {
    const entry = f.record(type, data, false, time);
    assert.equal(entry.type, "event");
    if (entry.type === "event") deliver(stream.acceptDurable(entry));
    return entry;
  };
  const frame = (value: object) =>
    deliver(stream.acceptFrame(value as SessionAssistantStreamFrame));
  let complete = false;
  const result = f.run().then(() => {
    complete = true;
  });
  await tick();
  durable("turn/start", { turn: 1 });
  durable("step/start", { turn: 1, step: 1 });
  durable("user/message", {
    source: { kind: "user", rpcId: "own-rpc" },
    content: [],
  });
  frame({
    type: "start",
    attemptId: "official",
    startedAfterSeq: 3,
    turn: 1,
    step: 1,
  });
  const liveTime = 1_760_000_000_000;
  const finalTime = liveTime + 4_000;
  frame({
    type: "chunk",
    attemptId: "official",
    index: 0,
    time: liveTime,
    chunk: { type: "text-delta", index: 0, text: "Hello" },
  });
  const full =
    "Hello! " + "This is the complete durable response, not a prefix.";
  const final = durable(
    "assistant/message",
    {
      turn: 1,
      step: 1,
      message: { content: [{ type: "text", text: full }] },
      stream: [],
    },
    finalTime,
  );
  durable("step/end", { turn: 1, step: 1 });
  durable("turn/end", { turn: 1, reason: { kind: "completed" } });
  await tick();
  assert.equal(complete, false);
  assert.equal(f.texts.at(-1), "Hello");
  assert.equal(f.events.count, 1);
  frame({
    type: "end",
    attemptId: "official",
    index: 1,
    outcome: {
      kind: "committed",
      seq: final.event.seq,
      eventType: "assistant/message",
    },
  });
  await result;
  assert.deepEqual(f.updates, [
    { text: "Hello", timestamp: liveTime, durable: false },
    { text: full, timestamp: finalTime, durable: true },
  ]);
  assert.equal(f.released, 1);
});

for (const endFirst of [true, false]) {
  test(`DSH folds an entire batch before completion (end first: ${endFirst})`, async () => {
    const f = fixture();
    const result = f.run();
    await tick();
    f.start();
    f.emit(
      "assistant/live-chunk",
      {
        attemptId: "batch",
        turn: 1,
        step: 0,
        chunk: { type: "text-delta", index: 0, text: "prefix" },
      },
      true,
    );
    const final = f.record("assistant/message", {
      turn: 1,
      step: 0,
      message: {
        content: [{ type: "text", text: "prefix plus durable suffix" }],
      },
    });
    const end = f.record("turn/end", {
      turn: 1,
      reason: { kind: "completed" },
    });
    f.publish({
      kind: "append",
      entries: endFirst ? [end, final] : [final, end],
    });
    await result;
    assert.equal(f.texts.at(-1), "prefix plus durable suffix");
    assert.equal(f.updates.at(-1)?.durable, true);
    assert.equal(f.events.count, 0);
  });
}

test("DSH waits for a later step with no live chunks instead of completing on earlier text", async () => {
  const f = fixture();
  let complete = false;
  const result = f.run().then(() => {
    complete = true;
  });
  await tick();
  f.emit("turn/start", { turn: 1 });
  f.emit("step/start", { turn: 1, step: 0 });
  f.emit("user/message", {
    source: { kind: "user", rpcId: "own-rpc" },
    content: [],
  });
  f.emit("assistant/message", {
    turn: 1,
    step: 0,
    message: { content: [{ type: "text", text: "Earlier step" }] },
  });
  f.emit("step/end", { turn: 1, step: 0 });
  f.emit("step/start", { turn: 1, step: 1 });
  const final = f.record("assistant/message", {
    turn: 1,
    step: 1,
    message: { content: [{ type: "text", text: "Final answer" }] },
  });
  f.emit("step/end", { turn: 1, step: 1 });
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await tick();
  assert.equal(complete, false);
  assert.equal(f.updates.at(-1)?.durable, false);
  f.publish({ kind: "append", entries: [final] });
  await result;
  assert.equal(f.texts.at(-1), "Earlier step\n\nFinal answer");
  assert.equal(f.updates.at(-1)?.durable, true);
});

test("DSH preserves journal order and event time when multi-step settlements arrive backwards", async () => {
  const f = fixture();
  let complete = false;
  const result = f.run().then(() => {
    complete = true;
  });
  await tick();
  f.start();
  f.emit("step/start", { turn: 1, step: 0 });
  const first = f.record(
    "assistant/message",
    {
      turn: 1,
      step: 0,
      message: { content: [{ type: "text", text: "First" }] },
    },
    false,
    1_760_000_000_100,
  );
  f.emit("step/end", { turn: 1, step: 0 });
  f.emit("step/start", { turn: 1, step: 1 });
  const second = f.record(
    "assistant/message",
    {
      turn: 1,
      step: 1,
      message: { content: [{ type: "text", text: "Second" }] },
    },
    false,
    1_760_000_000_200,
  );
  f.emit("step/end", { turn: 1, step: 1 });
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  f.publish({
    kind: "settle-assistant",
    attemptId: "second" as LlmAttemptId,
    entry: second as SessionAssistantSettlementEntry,
  });
  await tick();
  assert.equal(complete, false);
  f.publish({
    kind: "settle-assistant",
    attemptId: "first" as LlmAttemptId,
    entry: first as SessionAssistantSettlementEntry,
  });
  await result;
  const saved = JSON.parse(JSON.stringify(f.updates.at(-1)));
  assert.deepEqual(saved, {
    text: "First\n\nSecond",
    timestamp: 1_760_000_000_200,
    durable: true,
  });
});

test("DSH deduplicates replayed live/final entries and ignores late chunks after final", async () => {
  const f = fixture();
  const result = f.run();
  await tick();
  f.start();
  const live = f.emit(
    "assistant/live-chunk",
    {
      attemptId: "replay",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "Hello" },
    },
    true,
    100,
  );
  f.publish({ kind: "append", entries: [live, live] });
  const older = f.record(
    "assistant/message",
    {
      turn: 1,
      step: 0,
      message: { content: [{ type: "text", text: "Old final" }] },
    },
    false,
    200,
  );
  const final = f.emit(
    "assistant/message",
    {
      turn: 1,
      step: 0,
      message: { content: [{ type: "text", text: "Hello world" }] },
    },
    false,
    300,
  );
  f.publish({ kind: "append", entries: [final, older] });
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "late",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "duplicated suffix" },
    },
    true,
    400,
  );
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await result;
  f.emit("assistant/message", {
    turn: 2,
    step: 0,
    message: { content: [{ type: "text", text: "Another turn" }] },
  });
  assert.deepEqual(f.updates, [
    { text: "Hello", timestamp: 100, durable: false },
    { text: "Hello world", timestamp: 300, durable: true },
  ]);
});

test("DSH an abandoned later step cannot make an earlier durable response count as complete", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /执行结果未知/);
  await tick();
  f.start();
  f.emit("assistant/message", {
    turn: 1,
    step: 0,
    message: { content: [{ type: "text", text: "Earlier" }] },
  });
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "abandoned",
      turn: 1,
      step: 1,
      chunk: { type: "text-delta", index: 0, text: "Not committed" },
    },
    true,
  );
  f.publish({
    kind: "settle-assistant",
    attemptId: "abandoned" as LlmAttemptId,
  });
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await rejected;
  assert.equal(f.texts.at(-1), "Earlier");
  assert.equal(f.updates.at(-1)?.durable, false);
  assert.equal(f.canceled, 0);
});

test("DSH interrupted durable prefixes are not accepted as successful complete replies", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /执行结果未知/);
  await tick();
  f.start();
  f.emit("assistant/message", {
    turn: 1,
    step: 0,
    interrupted: true,
    message: { content: [{ type: "text", text: "Interrupted prefix" }] },
  });
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await rejected;
  assert.equal(f.updates.at(-1)?.durable, false);
});

test("DSH retries replace failed attempt text and a final with no text can settle", async () => {
  const f = fixture();
  const result = f.run();
  await tick();
  f.start();
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "failed",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "Failed attempt" },
    },
    true,
  );
  const failed = f.emit("assistant/attempt", { turn: 1, step: 0, stream: [] });
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "retried",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "Retry" },
    },
    true,
  );
  f.publish({ kind: "append", entries: [failed] });
  assert.equal(f.texts.at(-1), "Retry");
  f.emit("assistant/message", { turn: 1, step: 0, message: { content: [] } });
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await result;
  assert.equal(f.texts.at(-1), "");
  assert.equal(f.updates.at(-1)?.durable, true);
});

test("DSH stopping a settled turn awaiting text never cancels a newer foreign turn", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /已停止画布任务/);
  await tick();
  f.start();
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "pending",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "Pending final" },
    },
    true,
  );
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  f.emit("turn/start", { turn: 2 });
  f.emit("user/message", {
    source: { kind: "user", rpcId: "foreign-rpc" },
    content: [],
  });
  f.abort.abort();
  await rejected;
  assert.equal(f.canceled, 0);
  assert.equal(f.events.count, 0);
});

test("DSH reuses one session without importing earlier output or duplicating submission", async () => {
  const f = fixture();
  const first = f.run();
  await tick();
  await assert.rejects(f.run(), /已在运行/);
  f.start();
  f.emit("assistant/message", {
    turn: 1,
    step: 0,
    message: { content: [{ type: "text", text: "First answer" }] },
  });
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await first;
  f.sessionState.set({ ...f.sessionState.getSnapshot(), running: false });
  const second = f.run();
  await tick();
  f.emit("turn/start", { turn: 2 });
  f.emit("step/start", { turn: 2, step: 1 });
  f.emit("user/message", {
    source: { kind: "user", rpcId: "own-rpc" },
    content: [],
  });
  f.emit("assistant/message", {
    turn: 2,
    step: 1,
    message: { content: [{ type: "text", text: "Second answer" }] },
  });
  f.emit("step/end", { turn: 2, step: 1 });
  f.emit("turn/end", { turn: 2, reason: { kind: "completed" } });
  await second;
  assert.deepEqual(f.texts, ["First answer", "Second answer"]);
  assert.equal(f.prompts, 2);
  assert.equal(f.released, 2);
  assert.equal(f.canceled, 0);
});

test("DSH never marks provisional text complete when final settlement is missing", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /执行结果未知/);
  await tick();
  f.start();
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "a",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "partial" },
    },
    true,
  );
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await rejected;
  assert.equal(f.texts.at(-1), "partial");
  assert.equal(f.events.count, 0);
});

test("DSH refuses an externally busy session and never cancels it", async () => {
  const f = fixture();
  f.sessionState.set({ ...f.sessionState.getSnapshot(), running: true });
  await assert.rejects(f.run(), /不会接管/);
  await f.adapter.cancel(f.id);
  assert.equal(f.prompts, 0);
  assert.equal(f.canceled, 0);
  assert.equal(f.released, 1);
});

test("DSH abort only cancels a turn correlated with this request", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /已停止画布任务/);
  await tick();
  f.start();
  f.abort.abort();
  await rejected;
  assert.equal(f.canceled, 1);
  assert.equal(f.released, 1);
  await f.adapter.cancel("other-session");
  assert.equal(f.canceled, 1);
});

test("DSH early abort does not cancel an unowned turn", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /未停止其他任务/);
  await tick();
  f.abort.abort();
  await rejected;
  assert.equal(f.canceled, 0);
  assert.equal(f.released, 1);
});

test("DSH pending permission fails visibly and cancels only the owned run", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /不代替你批准/);
  await tick();
  f.start();
  f.status.set(
    new Map([
      [
        f.id,
        {
          running: true,
          completionUnread: false,
          pendingInteraction: {
            kind: "approval",
            key: "approval-1",
            sessionId: f.id,
          },
        },
      ],
    ]),
  );
  await rejected;
  assert.equal(f.canceled, 1);
  f.adapter.openSession(f.id);
  assert.equal(f.opened, f.id);
});

test("DSH disconnected generation reports uncertainty, never fabricated success", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /执行结果未知/);
  await tick();
  f.start();
  f.generation.set(undefined);
  await rejected;
  assert.equal(f.canceled, 0);
  assert.equal(f.events.count, 0);
});

test("DSH idle without a durable terminal event is an observation gap", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /执行结果未知/);
  await tick();
  f.start();
  f.sessionState.set({ ...f.sessionState.getSnapshot(), running: false });
  await rejected;
  assert.equal(f.released, 1);
});

test("DSH stale previous terminal events do not finish a new run", async () => {
  const f = fixture();
  f.emit("turn/end", { turn: 0, reason: { kind: "completed" } });
  let complete = false;
  const result = f.run().then(() => {
    complete = true;
  });
  await tick();
  assert.equal(complete, false);
  f.start();
  f.emit("assistant/message", {
    turn: 1,
    step: 0,
    message: { content: [{ type: "text", text: "new turn" }] },
  });
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await result;
});

test("DSH durable turn error remains an error and disposal stops owned work", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /QUOTA: exhausted/);
  await tick();
  f.start();
  f.emit("turn/end", {
    turn: 1,
    reason: { kind: "error", error: { code: "QUOTA", message: "exhausted" } },
  });
  await rejected;
  const second = fixture();
  const run = second.run();
  const stopped = assert.rejects(run, /插件已关闭/);
  await tick();
  second.start();
  second.adapter.dispose();
  await stopped;
  assert.equal(second.canceled, 1);
  await assert.rejects(second.adapter.createSession(), /插件已关闭/);
});

test("DSH shared turn input cannot be canceled as exclusive canvas work", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /不会停止共享运行/);
  await tick();
  f.start();
  f.emit("user/message", {
    source: { kind: "user", rpcId: "foreign-rpc" },
    content: [],
  });
  await rejected;
  f.abort.abort();
  await f.adapter.cancel(f.id);
  assert.equal(f.canceled, 0);
});

test("DSH stream abandonment clears provisional text and final settlement stays deduplicated", async () => {
  const f = fixture();
  const result = f.run();
  await tick();
  f.start();
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "a",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "partial" },
    },
    true,
  );
  let previous = f.events.getSnapshot();
  f.events.set({
    ...previous,
    revision: previous.revision + 1,
    change: { kind: "settle-assistant", attemptId: "a" as LlmAttemptId },
  });
  assert.deepEqual(f.texts, ["partial", ""]);
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "b",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "complete" },
    },
    true,
  );
  f.emit("assistant/message", {
    turn: 1,
    step: 0,
    message: { content: [{ type: "text", text: "complete" }] },
  });
  previous = f.events.getSnapshot();
  f.events.set({
    ...previous,
    revision: previous.revision + 1,
    change: { kind: "settle-assistant", attemptId: "b" as LlmAttemptId },
  });
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await result;
  assert.deepEqual(f.texts, ["partial", "", "complete", "complete"]);
});

test("DSH a replaced event window fails explicitly instead of guessing completion", async () => {
  const f = fixture();
  const result = f.run();
  const rejected = assert.rejects(result, /执行结果未知/);
  await tick();
  f.start();
  const previous = f.events.getSnapshot();
  f.events.set({
    ...previous,
    revision: previous.revision + 1,
    change: { kind: "replace", entries: previous.entries },
  });
  await rejected;
  assert.equal(f.canceled, 0);
  assert.equal(f.events.count, 0);
});

test("DSH attachment-only history keeps raw text empty and supplies a rail label", async () => {
  const f = fixture();
  f.emit("turn/start", { turn: 3 });
  const image = (id: string) => ({
    type: "image",
    attachment: {
      attachmentId: id,
      mediaType: "image/png",
      bytes: 68,
      width: 16,
      height: 16,
      name: `${id}.png`,
    },
  });
  f.emit("user/message", {
    id: "attachment-only",
    source: { kind: "user", rpcId: "attachment-rpc" },
    content: [
      image("first"),
      image("second"),
      {
        type: "file",
        attachment: { attachmentId: "file", name: "notes.txt", bytes: 12 },
      },
    ],
  });
  const snapshots: AgentSessionSnapshot[] = [];
  const stop = f.adapter.observeSession!(f.id, (snapshot) =>
    snapshots.push(snapshot),
  );
  await tick();
  assert.equal(snapshots.at(-1)?.turns[0]?.userMessages[0]?.text, "");
  assert.equal(
    snapshots.at(-1)?.turns[0]?.userMessages[0]?.displayText,
    undefined,
    "file cards use structured references instead of a synthetic count",
  );
  assert.deepEqual(
    snapshots
      .at(-1)
      ?.turns[0]?.userMessages[0]?.attachments?.map((item) => item.type),
    ["image", "image", "file"],
  );
  f.emit("user/message", {
    id: "literal-image-count",
    source: { kind: "user", rpcId: "literal-rpc" },
    content: [{ type: "text", text: "[图片 1 张]" }, image("third")],
  });
  await tick();
  assert.equal(
    snapshots.at(-1)?.turns[0]?.userMessages[1]?.text,
    "[图片 1 张]",
    "a user-authored count remains literal text",
  );
  assert.equal(
    snapshots.at(-1)?.turns[0]?.userMessages[1]?.displayText,
    undefined,
    "a structured image never adds a second count label",
  );
  f.emit("user/message", {
    id: "text-and-image",
    source: { kind: "user", rpcId: "text-image-rpc" },
    content: [image("fourth"), { type: "text", text: "等一下，有点问题" }],
  });
  await tick();
  assert.equal(
    snapshots.at(-1)?.turns[0]?.userMessages[2]?.text,
    "等一下，有点问题",
  );
  assert.equal(
    snapshots.at(-1)?.turns[0]?.userMessages[2]?.displayText,
    undefined,
  );
  assert.equal(f.prompts, 0);
  stop();
});

test("DSH read-only observation restores durable text, exact identity, and original event time", async () => {
  const f = fixture();
  f.emit("turn/start", { turn: 17 });
  f.emit("step/start", { turn: 17, step: 1 });
  f.emit(
    "user/message",
    {
      id: "native-message-id",
      source: { kind: "user", rpcId: "native-rpc-id" },
      content: [{ type: "text", text: "Native question" }],
    },
    false,
    1_760_000_000_000,
  );
  f.emit(
    "assistant/message",
    {
      turn: 17,
      step: 1,
      message: { content: [{ type: "text", text: "Full durable answer" }] },
    },
    false,
    1_760_000_002_000,
  );
  f.emit("step/end", { turn: 17, step: 1 });
  f.emit("turn/end", { turn: 17, reason: { kind: "completed" } });
  const snapshots: AgentSessionSnapshot[] = [];
  const stop = f.adapter.observeSession!(f.id, (snapshot) =>
    snapshots.push(snapshot),
  );
  await tick();
  assert.deepEqual(snapshots.at(-1), {
    sessionId: f.id,
    hasMore: false,
    turns: [
      {
        turnId: 17,
        userMessages: [
          {
            id: "native-message-id",
            requestId: "native-rpc-id",
            text: "Native question",
            timestamp: 1_760_000_000_000,
          },
        ],
        body: "Full durable answer",
        timestamp: 1_760_000_002_000,
        durable: true,
        status: "done",
      },
    ],
  });
  assert.equal(f.prompts, 0);
  stop();
  stop();
  assert.equal(f.canceled, 0);
  assert.equal(f.released, 1);
  assert.equal(f.events.count, 0);
  assert.equal(f.sessionState.count, 0);
  assert.equal(f.generation.count, 0);
});

test("DSH observation follows delayed settlements and native turns after the canvas run ends", async () => {
  const f = fixture();
  const snapshots: AgentSessionSnapshot[] = [];
  const stop = f.adapter.observeSession!(f.id, (snapshot) => {
    if (snapshot.turns.some((turn) => turn.turnId === 1)) {
      assert.equal(f.observations[0]?.meta?.turnId, 1);
      assert.equal(f.observations[0]?.meta?.requestId, "own-rpc");
    }
    snapshots.push(snapshot);
  });
  await tick();
  const result = f.run();
  await tick();
  f.start();
  f.emit(
    "assistant/live-chunk",
    {
      attemptId: "observed",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "Prefix" },
    },
    true,
    100,
  );
  const final = f.record(
    "assistant/message",
    {
      turn: 1,
      step: 0,
      message: {
        content: [{ type: "text", text: "Prefix and complete suffix" }],
      },
    },
    false,
    200,
  );
  f.emit("turn/end", { turn: 1, reason: { kind: "completed" } });
  await tick();
  assert.equal(snapshots.at(-1)?.turns[0]?.status, "running");
  assert.equal(snapshots.at(-1)?.turns[0]?.durable, false);
  f.publish({
    kind: "settle-assistant",
    attemptId: "observed" as LlmAttemptId,
    entry: final as SessionAssistantSettlementEntry,
  });
  await result;
  await tick();
  assert.equal(snapshots.at(-1)?.turns[0]?.status, "done");
  assert.equal(snapshots.at(-1)?.turns[0]?.body, "Prefix and complete suffix");
  assert.equal(f.events.count, 1);
  f.emit("turn/start", { turn: 2 });
  f.emit("step/start", { turn: 2, step: 0 });
  f.emit("user/message", {
    id: "native-2",
    source: { kind: "user", rpcId: "native-rpc-2" },
    content: [{ type: "text", text: "Continue natively" }],
  });
  f.emit(
    "assistant/message",
    {
      turn: 2,
      step: 0,
      message: { content: [{ type: "text", text: "Native continuation" }] },
    },
    false,
    300,
  );
  f.emit("step/end", { turn: 2, step: 0 });
  f.emit("turn/end", { turn: 2, reason: { kind: "completed" } });
  await tick();
  const turns = snapshots.at(-1)!.turns;
  assert.deepEqual(
    turns.map((turn) => turn.turnId),
    [1, 2],
  );
  assert.equal(turns[1]?.body, "Native continuation");
  assert.equal(turns[1]?.userMessages[0]?.requestId, "native-rpc-2");
  assert.equal(f.prompts, 1);
  stop();
  assert.equal(f.canceled, 0);
  assert.equal(f.released, 2);
});

test("DSH history observation rebaselines authoritatively and excludes incomplete oldest turns", async () => {
  const f = fixture();
  // A truncated older page has no owning turn/start and must not be imported.
  const older = f.record("assistant/message", {
    turn: 0,
    step: 0,
    message: { content: [{ type: "text", text: "Unattributed older tail" }] },
  });
  f.publish({ kind: "append", entries: [older] });
  f.start();
  const partial = f.emit(
    "assistant/live-chunk",
    {
      attemptId: "reload",
      turn: 1,
      step: 0,
      chunk: { type: "text-delta", index: 0, text: "Saved prefix" },
    },
    true,
    100,
  );
  const snapshots: AgentSessionSnapshot[] = [];
  const stop = f.adapter.observeSession!(f.id, (snapshot) =>
    snapshots.push(snapshot),
  );
  await tick();
  assert.deepEqual(
    snapshots.at(-1)?.turns.map((turn) => turn.turnId),
    [1],
  );
  const final = f.record(
    "assistant/message",
    {
      turn: 1,
      step: 0,
      message: {
        content: [{ type: "text", text: "Authoritative complete answer" }],
      },
    },
    false,
    200,
  );
  const end = f.record("turn/end", { turn: 1, reason: { kind: "completed" } });
  f.publish({
    kind: "replace",
    entries: [
      ...f.events.getSnapshot().entries.filter((entry) => entry !== partial),
      final,
      end,
    ],
  });
  await tick();
  assert.equal(
    snapshots.at(-1)?.turns[0]?.body,
    "Authoritative complete answer",
  );
  assert.equal(snapshots.at(-1)?.turns[0]?.timestamp, 200);
  assert.equal(snapshots.at(-1)?.turns[0]?.status, "done");
  assert.equal(snapshots.at(-1)?.error, undefined);
  stop();
});

test("DSH read-only observation survives reconnection and never cancels external work", async () => {
  const f = fixture();
  f.sessionState.set({ ...f.sessionState.getSnapshot(), running: true });
  const snapshots: AgentSessionSnapshot[] = [];
  const stop = f.adapter.observeSession!(f.id, (snapshot) =>
    snapshots.push(snapshot),
  );
  await tick();
  assert.equal(f.events.count, 1);
  f.generation.set(undefined);
  assert.match(snapshots.at(-1)?.error ?? "", /执行结果未知/);
  assert.equal(f.events.count, 0);
  assert.equal(f.released, 1);
  f.generation.set({ id: 2, host: { home: "/test" } });
  await tick();
  assert.equal(f.events.count, 1);
  assert.equal(snapshots.at(-1)?.error, undefined);
  stop();
  assert.equal(f.canceled, 0);
  assert.equal(f.prompts, 0);
  assert.equal(f.released, 2);
  assert.equal(f.generation.count, 0);
});

test("DSH observation cleanup prevents callbacks after pending retain or adapter disposal", async () => {
  const f = fixture();
  const snapshots: AgentSessionSnapshot[] = [];
  const stop = f.adapter.observeSession!(f.id, (snapshot) =>
    snapshots.push(snapshot),
  );
  stop();
  await tick();
  assert.equal(snapshots.length, 0);
  assert.equal(f.released, 1);
  assert.equal(f.events.count, 0);
  f.adapter.observeSession!(f.id, (snapshot) => snapshots.push(snapshot));
  await tick();
  const count = snapshots.length;
  f.emit("turn/start", { turn: 1 });
  f.adapter.dispose();
  await tick();
  assert.equal(snapshots.length, count);
  assert.equal(f.released, 2);
  assert.equal(f.events.count, 0);
  assert.equal(f.generation.count, 0);
  assert.equal(f.canceled, 0);
  assert.throws(() => f.adapter.observeSession!(f.id, () => {}), /插件已关闭/);
});

test("DSH observed native errors remain errors instead of fabricated completed text", async () => {
  const f = fixture();
  f.emit("turn/start", { turn: 8 });
  f.emit("step/start", { turn: 8, step: 0 });
  f.emit("user/message", {
    id: "native-error",
    source: { kind: "user" },
    content: [{ type: "text", text: "Native work" }],
  });
  f.emit(
    "assistant/message",
    {
      turn: 8,
      step: 0,
      interrupted: true,
      message: { content: [{ type: "text", text: "Interrupted" }] },
    },
    false,
    200,
  );
  f.emit("turn/end", {
    turn: 8,
    reason: { kind: "error", error: { code: "TEST", message: "Failure" } },
  });
  const snapshots: AgentSessionSnapshot[] = [];
  const stop = f.adapter.observeSession!(f.id, (snapshot) =>
    snapshots.push(snapshot),
  );
  await tick();
  const turn = snapshots.at(-1)?.turns[0];
  assert.equal(turn?.status, "error");
  assert.equal(turn?.durable, false);
  assert.equal(turn?.body, "Interrupted");
  assert.equal(turn?.error, "TEST: Failure");
  stop();
});

test("DSH observed history can prepend older covered turns without guessing identity", async () => {
  const f = fixture();
  const entries = (turn: number, requestId: string) => [
    f.record("turn/start", { turn }),
    f.record("user/message", {
      id: `message-${turn}`,
      source: { kind: "user", rpcId: requestId },
      content: [{ type: "text", text: "Identical question" }],
    }),
    f.record("assistant/message", {
      turn,
      step: 0,
      message: { content: [{ type: "text", text: `Answer ${turn}` }] },
    }),
    f.record("turn/end", { turn, reason: { kind: "completed" } }),
  ];
  const older = entries(1, "first-rpc");
  const newer = entries(2, "second-rpc");
  f.publish({ kind: "replace", entries: newer });
  f.events.set({ ...f.events.getSnapshot(), hasMore: true });
  const snapshots: AgentSessionSnapshot[] = [];
  const stop = f.adapter.observeSession!(f.id, (snapshot) =>
    snapshots.push(snapshot),
  );
  await tick();
  assert.equal(snapshots.at(-1)?.hasMore, true);
  assert.deepEqual(
    snapshots.at(-1)?.turns.map((turn) => turn.turnId),
    [2],
  );
  f.publish({ kind: "prepend", entries: older });
  await tick();
  const turns = snapshots.at(-1)!.turns;
  assert.deepEqual(
    turns.map((turn) => turn.turnId),
    [1, 2],
  );
  assert.deepEqual(
    turns.map((turn) => turn.userMessages[0]?.requestId),
    ["first-rpc", "second-rpc"],
  );
  assert.deepEqual(
    turns.map((turn) => turn.body),
    ["Answer 1", "Answer 2"],
  );
  stop();
});

test("DSH observation releases a failed history acquisition and reports the actual error", async () => {
  const f = fixture({ openingError: new Error("History unavailable") });
  const snapshots: AgentSessionSnapshot[] = [];
  const stop = f.adapter.observeSession!(f.id, (snapshot) =>
    snapshots.push(snapshot),
  );
  await tick();
  assert.equal(snapshots.at(-1)?.error, "History unavailable");
  assert.equal(f.released, 1);
  assert.equal(f.events.count, 0);
  stop();
  assert.equal(f.released, 1);
  assert.equal(f.canceled, 0);
});
