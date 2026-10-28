import React from "react";
import { createRoot } from "react-dom/client";
import { ChatCanvas } from "../src/ui/ChatCanvas";
import { createMockAdapter } from "../src/adapters/mock";
import "../vendor/deepseek-harness/base.css";
import "../vendor/deepseek-harness/design-platform.css";
import "../src/styles.css";

createRoot(document.getElementById("root")!).render(
  <ChatCanvas
    adapter={createMockAdapter()}
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
  />,
);
