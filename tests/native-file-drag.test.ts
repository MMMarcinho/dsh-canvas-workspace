import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@deepseek-ai/cordis";
import type { FileDragActions } from "@deepseek-ai/dsh-client-ui-primitives";
import { createNativeFileDrag } from "../src/host/native-file-drag";

test("native file drag follows host service activation and disposal", async () => {
  let activate!: (scope: Context) => void;
  const callbacks = createNativeFileDrag({
    inject(names: string[], callback: (scope: Context) => void) {
      assert.deepEqual(names, ["fileDrag"]);
      activate = callback;
    },
  } as unknown as Context);
  const source = {
    kind: "url" as const,
    url: "http://localhost/api/file?path=a.png",
    name: "a.png",
    mediaType: "image/png",
  };
  const signal = new AbortController().signal;
  await assert.rejects(callbacks.prepare(source, signal), /unavailable/);
  callbacks.reportFailure();
  let release!: () => void;
  let failures = 0;
  const operation = { start: () => true, release() {} };
  const actions: FileDragActions = {
    async prepare(actual, actualSignal) {
      assert.equal(actual, source);
      assert.equal(actualSignal, signal);
      return operation;
    },
    reportFailure() {
      failures++;
    },
  };
  activate({
    fileDrag: { actions },
    effect(setup: () => () => void) {
      release = setup();
    },
  } as unknown as Context);
  assert.equal(await callbacks.prepare(source, signal), operation);
  callbacks.reportFailure();
  assert.equal(failures, 1);
  release();
  await assert.rejects(callbacks.prepare(source, signal), /unavailable/);
});
