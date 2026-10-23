import type { AgentAdapter, AgentRun } from "../core/types";
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("已停止", "AbortError"));
      return;
    }
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("已停止", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Deterministic local demo. It never opens a network connection. */
export function createMockAdapter(): AgentAdapter {
  const active = new Set<string>();
  const history = new Map<string, string[]>();
  return {
    kind: "mock",
    async createSession() {
      return `mock-${crypto.randomUUID()}`;
    },
    async run({ sessionId, prompt, context, signal, onText }: AgentRun) {
      if (active.has(sessionId))
        throw new Error("这个 Agent 已在运行，请等待或停止");
      active.add(sessionId);
      try {
        const sources = context.length
          ? context
              .map(
                (n) =>
                  `• ${n.title}：${n.body.slice(0, 90).replaceAll("\n", " ")}`,
              )
              .join("\n")
          : "未选择其他节点。这里只使用你的任务描述。";
        let output = `这是本地演示结果，不是模型回答。\n\n收到任务：${prompt}\n\n本次明确选中的 ${context.length} 个上下文：\n${sources}\n\n可以继续尝试：\n1. 把这个结果留作独立产物。\n2. 添加另一位 Agent，并选择这份产物。\n3. 修改便笺后重新运行，比较两个上下文快照。\n\n每个 Agent 使用独立会话，未选中的节点不会发送。`;
        if (!context.length) {
          const previous = history.get(sessionId) ?? [];
          previous.push(prompt);
          history.set(sessionId, previous);
          output = /iui/i.test(prompt)
            ? `这是 **MOCK IUI**，控件使用与 IUI 插件相同的安全运行时。\n\n{@body const [topic, setTopic] = DIL.useState("下一步计划")}\n{@body const [count, setCount] = DIL.useState(0)}\n{@body const progress = "████████".slice(0, count + 1)}\n<card><title>IUI 交互预览</title><caption>本地状态，不会自动发送消息</caption><input value={topic} onChange={setTopic} placeholder="填写要继续的话题" /><row><button onClick={() => setCount(count + 1)}>计数 +1</button><text>已点击 {count} 次</text></row><text>{progress}</text><button onClick={() => GenUI.issueNewTurn(topic)}>在当前会话继续</button></card>\n\n这段是控件后的 **Markdown 说明**，仍按原始顺序显示。\n\n<box><text>第二个独立 IUI 区域</text></box>\n\n拖动画布请使用空白处、时间标记，或按住空格拖动；正文仍可选择复制。`
            : `收到：**${prompt.replace(/[<>]/g, "")}**\n\n这是本地演示回复，不是模型结果。当前会话已接收 ${previous.length} 条输入。\n\n- 回复保留在画布上，可以平移和缩放。\n- 你的消息固定在输入框上方，不再混入回复卡片。\n- 悬停或聚焦这张卡片会高亮。\n\n输入 \`IUI\` 可测试交互控件；代码、**粗体**和列表均按 Markdown 显示。`;
        }
        const timestamp = Date.now();
        let text = "";
        for (const token of output.match(/.{1,8}|\n/g) ?? []) {
          await delay(28, signal);
          text += token;
          onText(text, { timestamp, durable: false });
        }
        onText(text, { timestamp, durable: true });
      } finally {
        active.delete(sessionId);
      }
    },
    async cancel() {
      /* The UI owns and aborts the run's AbortController. */
    },
  };
}
