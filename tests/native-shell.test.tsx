import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { createNativeAccountActions } from "../src/host/native-account";

test("native account fallback explains what navigation actually does", () => {
  let exits = 0;
  const actions = createNativeAccountActions(() => {
    exits += 1;
  });
  assert.match(actions.settings.label, /返回原生界面/);
  assert.match(actions.settings.description, /侧栏底部/);
  assert.match(actions.version.label, /返回原生界面/);
  assert.match(actions.version.description, /通用页面/);
  assert.equal(exits, 0, "creating menu items must not navigate");
  actions.settings.run();
  actions.version.run();
  assert.equal(exits, 2);
});

test("native shell composes public shared UI without taking over host controls", async () => {
  const client = await readFile(
    new URL("../src/client.tsx", import.meta.url),
    "utf8",
  );
  const ui = await readFile(
    new URL("../src/host/native-ui.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /from "@deepseek-ai\/dsh-client-ui-primitives"/);
  assert.match(ui, /<BrandWordmark size=\{24\}/);
  assert.match(ui, /<IconUserOutlineMedium size=\{16\}/);
  assert.match(ui, /<IconPanelLeftOutlineRegular size=\{18\}/);
  assert.match(ui, /<IconSendOutlineMedium size=\{16\}/);
  assert.match(
    ui,
    /<MarkdownText[\s\S]*text=\{text\}[\s\S]*streaming=\{streaming\}[\s\S]*labels=\{markdownLabels\}[\s\S]*variant="body"/,
  );
  assert.match(client, /info\.activePanelId === PANEL_ID/);
  assert.match(client, /accountActions,/);
  assert.doesNotMatch(
    client,
    /toggleSidebar|ctx\.settings|settings\.launcher|appendChild|dispatchEvent/,
  );
  assert.doesNotMatch(ui, /\/src\/|\/lib\/|dangerouslySetInnerHTML/);
});

test("native primitive adapter preserves theme artwork, stable labels and streaming", async () => {
  const primitives = {
    BrandWordmark: () => null,
    IconUserOutlineMedium: () => null,
    IconPanelLeftOutlineRegular: () => null,
    IconSendOutlineMedium: () => null,
    MarkdownText: () => null,
    MarkdownDelegateProvider: () => null,
    ImageLightbox: () => null,
  };
  const compiled = await build({
    entryPoints: [
      new URL("../src/host/native-ui.tsx", import.meta.url).pathname,
    ],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    external: ["react/jsx-runtime", "@deepseek-ai/dsh-client-ui-primitives"],
  });
  const module = { exports: {} };
  const nodeRequire = createRequire(import.meta.url);
  runInNewContext(compiled.outputFiles[0].text, {
    URL,
    document: { baseURI: "dsh-app://app/" },
    module,
    exports: module.exports,
    require(specifier: string) {
      if (specifier === "@deepseek-ai/dsh-client-ui-primitives")
        return primitives;
      if (specifier === "react/jsx-runtime") return nodeRequire(specifier);
      throw new Error(`Unexpected native UI dependency: ${specifier}`);
    },
  });
  const ui = module.exports as typeof import("../src/host/native-ui");
  const brand = ui.NativeBrand();
  assert.equal(brand.type, primitives.BrandWordmark);
  assert.equal(brand.props.size, 24);
  assert.equal(
    brand.props.style,
    undefined,
    "native currentColor must not be inverted inline",
  );
  assert.equal(ui.NativeAvatar().type, primitives.IconUserOutlineMedium);
  assert.equal(
    ui.NativeNavigationIcon().type,
    primitives.IconPanelLeftOutlineRegular,
  );
  assert.equal(ui.NativeSendIcon().type, primitives.IconSendOutlineMedium);
  const streaming = ui.renderNativeMarkdown("**growing**", true);
  const settled = ui.renderNativeMarkdown("**complete**", false);
  assert.equal(streaming.type, primitives.MarkdownDelegateProvider);
  const streamingBody = streaming.props.children;
  const settledBody = settled.props.children;
  assert.equal(streamingBody.type, primitives.MarkdownText);
  assert.equal(streamingBody.props.streaming, true);
  assert.equal(settledBody.props.streaming, false);
  assert.equal(streamingBody.props.variant, "body");
  assert.equal(
    streamingBody.props.labels,
    settledBody.props.labels,
    "memoization labels must stay reference-stable",
  );
  assert.equal(settledBody.props.text, "**complete**");
  const local = ui.renderNativeMarkdown(
    "![封面](posters/cover.png)",
    false,
    "/art",
  );
  assert.equal(
    new URL(
      local.props.children.props.pathImages!.resolve("posters/cover.png")!,
    ).searchParams.get("path"),
    "/art/posters/cover.png",
  );
  assert.equal(
    new URL(
      local.props.fileImages!.resolve("posters/cover.png")!,
    ).searchParams.get("path"),
    "/art/posters/cover.png",
  );
  assert.equal(local.props.fileImages?.labels.open, "查看原图");
  const close = () => {};
  const preview = ui.renderNativeImagePreview(
    "https://example.com/a.png",
    "A",
    close,
  );
  assert.equal(preview.type, primitives.ImageLightbox);
  assert.equal(preview.props.onClose, close);
});
