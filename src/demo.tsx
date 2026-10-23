import React from "react";
import { createRoot } from "react-dom/client";
import { ChatCanvas } from "./ui/ChatCanvas";
import { createMockAdapter } from "./adapters/mock";
// Only the standalone demo supplies native tokens. The plugin inherits them from its host.
import "../vendor/deepseek-harness/base.css";
import "../vendor/deepseek-harness/design-platform.css";
import "../vendor/deepseek-harness/gradient-shadow-text.css";
import "./styles.css";
const theme = new URLSearchParams(location.search).get("theme");
if (
  theme === "dark" ||
  (!theme && matchMedia("(prefers-color-scheme: dark)").matches)
)
  document.body.setAttribute("data-ds-dark-theme", "");
const adapter = createMockAdapter();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ChatCanvas adapter={adapter} mode="mock" />
  </React.StrictMode>,
);
