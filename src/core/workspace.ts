import type { CanvasNode, Workspace } from "./types";
import { composeCanvasPrompt } from "./prompt";
export const MAX_NODES = 300;
export const MAX_TEXT = 100_000;
export const MAX_FILE_BYTES = 8_000_000;
export function createWorkspace(): Workspace {
  return {
    version: 1,
    id: crypto.randomUUID(),
    title: "画布，让想法一起发生",
    viewport: { x: 20, y: 20, zoom: 0.85 },
    nodes: [
      {
        id: "brief",
        type: "note",
        x: 90,
        y: 95,
        width: 300,
        height: 260,
        title: "从一个工作区出发",
        body: "不把一切塞进聊天框。\n\n让想法、任务、Agent 与产物，平铺在同一个空间里。\n\n先选中这张便笺，再把它交给 Agent。",
        contextIds: [],
      },
      {
        id: "plan",
        type: "task",
        x: 90,
        y: 395,
        width: 300,
        height: 240,
        title: "这次小实验",
        body: "探索画布交互\n把选中的节点作为上下文\n让两个 Agent 并行思考\n把结果留在画布上",
        contextIds: [],
        status: "idle",
      },
      {
        id: "agent-1",
        type: "agent",
        x: 495,
        y: 150,
        width: 400,
        height: 475,
        title: "设计伙伴",
        body: "",
        contextIds: ["brief"],
        status: "idle",
      },
      {
        id: "artifact-1",
        type: "artifact",
        x: 1000,
        y: 230,
        width: 320,
        height: 310,
        title: "留给新发现的空间",
        body: "Agent 的结果可以成为独立产物。\n\n继续编辑、重新组织，或者把它交给另一个 Agent。",
        contextIds: [],
      },
    ],
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, field: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${field} 必须是长度不超过 ${max} 的文本`);
  return value;
}
function number(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${field} 超出允许范围`);
  return value;
}
/** Validate untrusted imports and restore interrupted runs without resending. */
export function parseWorkspace(raw: string): Workspace {
  if (raw.length > MAX_FILE_BYTES) throw new Error("画布文件过大（上限 8 MB）");
  const value: unknown = JSON.parse(raw);
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.nodes) ||
    !record(value.viewport)
  )
    throw new Error("不是受支持的画布 v1 文件");
  if (value.nodes.length > MAX_NODES)
    throw new Error(`最多支持 ${MAX_NODES} 个节点`);
  const ids = new Set<string>();
  const nodes: CanvasNode[] = value.nodes.map((n, index) => {
    if (!record(n)) throw new Error(`节点 ${index} 无效`);
    const id = text(n.id, "节点 ID", 200);
    if (!id || ids.has(id)) throw new Error("节点 ID 为空或重复");
    ids.add(id);
    if (!["note", "task", "agent", "artifact"].includes(String(n.type)))
      throw new Error("未知节点类型");
    if (
      !Array.isArray(n.contextIds) ||
      n.contextIds.some((id) => typeof id !== "string")
    )
      throw new Error("上下文列表无效");
    if (
      n.status !== undefined &&
      !["idle", "running", "done", "error"].includes(String(n.status))
    )
      throw new Error("节点状态无效");
    return {
      id,
      type: n.type as CanvasNode["type"],
      x: number(n.x, "x", -100_000, 100_000),
      y: number(n.y, "y", -100_000, 100_000),
      width: number(n.width, "width", 180, 4000),
      height: number(n.height, "height", 120, 4000),
      title: text(n.title, "标题", 1000),
      body: text(n.body, "内容"),
      contextIds: [...new Set(n.contextIds as string[])],
      ...(n.sessionId === undefined
        ? {}
        : { sessionId: text(n.sessionId, "会话 ID", 300) }),
      ...(n.status === undefined
        ? {}
        : {
            status:
              n.status === "running"
                ? "idle"
                : (n.status as CanvasNode["status"]),
          }),
    };
  });
  for (const node of nodes)
    node.contextIds = node.contextIds.filter(
      (id) => ids.has(id) && id !== node.id,
    );
  return {
    version: 1,
    id: text(value.id, "画布 ID", 200),
    title: text(value.title, "画布标题", 1000),
    nodes,
    viewport: {
      x: number(value.viewport.x, "viewport.x", -1e6, 1e6),
      y: number(value.viewport.y, "viewport.y", -1e6, 1e6),
      zoom: number(value.viewport.zoom, "zoom", 0.15, 3),
    },
  };
}
export function serializeWorkspace(workspace: Workspace): string {
  return JSON.stringify(workspace, null, 2);
}
/** A run receives a snapshot of explicitly selected nodes only. */
export function buildContext(nodes: CanvasNode[], ids: string[]): CanvasNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return [...new Set(ids)].flatMap((id) => {
    const node = byId.get(id);
    return node ? [{ ...node, contextIds: [...node.contextIds] }] : [];
  });
}
/** Data is delimited and marked as content, never silently treated as instructions. */
export function composePrompt(prompt: string, nodes: CanvasNode[]): string {
  return composeCanvasPrompt(prompt, nodes);
}
