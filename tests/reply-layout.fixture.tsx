import React from "react";
import { createRoot } from "react-dom/client";
import { CanvasWorkspace } from "../src/ui/CanvasWorkspace";
import { ChatCanvas } from "../src/ui/ChatCanvas";
import { createMockAdapter } from "../src/adapters/mock";
import "../vendor/deepseek-harness/base.css";
import "../vendor/deepseek-harness/design-platform.css";
import "../src/styles.css";
import type { AgentAdapter, AgentSessionSnapshot } from "../src/core/types";
declare global {
  interface Window {
    __emitCanvasSnapshot?: (snapshot: AgentSessionSnapshot) => void;
  }
}
const mock = createMockAdapter();
const adapter: AgentAdapter = new URLSearchParams(location.search).has(
  "stability",
)
  ? {
      ...mock,
      observeSession(_id, listener) {
        const emit = (snapshot: AgentSessionSnapshot) => listener(snapshot);
        window.__emitCanvasSnapshot = emit;
        return () => {
          if (window.__emitCanvasSnapshot === emit)
            delete window.__emitCanvasSnapshot;
        };
      },
    }
  : mock;

createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).has("workspace") ? (
    <CanvasWorkspace adapter={adapter} mode="mock" />
  ) : (
    <ChatCanvas
      adapter={adapter}
      mode="mock"
      hostSessions={[
        { id: "layout-fixture", title: "图片布局测试" },
        { id: "another-fixture", title: "另一个会话" },
      ]}
      hostWorkspaces={[
        {
          id: "fixture-project",
          title: "测试工作区",
          sessionIds: ["layout-fixture", "another-fixture"],
        },
      ]}
      onNewSession={async () => "another-fixture"}
      onOpenWorkspace={async () => {}}
      onCreateWorkspace={async () => {}}
      onExit={() => {}}
    />
  ),
);
