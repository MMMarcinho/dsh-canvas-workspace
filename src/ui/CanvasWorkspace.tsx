import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as PE,
} from "react";
import type { AgentAdapter, CanvasNode, Workspace } from "../core/types";
import {
  buildContext,
  createWorkspace,
  parseWorkspace,
  serializeWorkspace,
} from "../core/workspace";
import { Icon } from "./icons";
const LABELS = { note: "笔记", task: "任务", agent: "Agent", artifact: "成果" };
const STORAGE_KEY = "dsh-canvas-workspace:v1";
const uid = () => crypto.randomUUID();
const clamp = (z: number) => Math.min(2, Math.max(0.25, z));
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));
const recover = (w: Workspace): Workspace => ({
  ...w,
  nodes: w.nodes.map((n) =>
    n.status === "running" ? { ...n, status: "idle" } : n,
  ),
});
function load(mode: "mock" | "dsh") {
  try {
    const saved = localStorage.getItem(`${STORAGE_KEY}:${mode}`);
    return {
      workspace: saved ? recover(parseWorkspace(saved)) : createWorkspace(),
      error: "",
    };
  } catch (e) {
    return {
      workspace: createWorkspace(),
      error: `无法恢复本地存档，已保留原始数据并暂停自动保存。${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
type Drag = {
  kind: "pan" | "nodes" | "resize";
  pointerId: number;
  cx: number;
  cy: number;
  x?: number;
  y?: number;
  id?: string;
  width?: number;
  height?: number;
  nodes?: { id: string; x: number; y: number }[];
};
type Run = {
  controller: AbortController;
  artifactId: string;
  sessionId?: string;
  stopped: boolean;
};
export function CanvasWorkspace({
  adapter,
  mode,
  onExit,
  hostSessions = [],
  onOpenSession,
  onNewSession,
  onBackToChat,
}: {
  adapter: AgentAdapter;
  mode: "mock" | "dsh";
  onExit?: () => void;
  hostSessions?: { id: string; title: string }[];
  onOpenSession?: (id: string) => void;
  onNewSession?: () => void;
  onBackToChat?: () => void;
}) {
  const [initial] = useState(() => load(mode)),
    [workspace, setWorkspace] = useState(initial.workspace),
    [selected, setSelected] = useState<string[]>([]),
    [contextEditor, setContextEditor] = useState<string | null>(null),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [editing, setEditing] = useState<Record<string, boolean>>({}),
    [saveState, setSaveState] = useState(initial.error ? "error" : "saved"),
    [storageError, setStorageError] = useState(initial.error),
    [storagePaused, setStoragePaused] = useState(Boolean(initial.error)),
    [notice, setNotice] = useState(""),
    [help, setHelp] = useState(false),
    [menu, setMenu] = useState<"navigation" | "add" | "view" | null>(null),
    [panning, setPanning] = useState(false),
    [space, setSpace] = useState(false),
    [size, setSize] = useState({ width: 1200, height: 760 }),
    [undo, setUndo] = useState<Workspace | null>(null);
  const ws = useRef(workspace),
    selectedRef = useRef(selected),
    stage = useRef<HTMLDivElement>(null),
    menuRoot = useRef<HTMLDivElement>(null),
    menuButtons = useRef<Record<string, HTMLButtonElement | null>>({}),
    fileInput = useRef<HTMLInputElement>(null),
    drag = useRef<Drag | null>(null),
    spaceRef = useRef(false),
    runs = useRef(new Map<string, Run>()),
    mounted = useRef(true);
  selectedRef.current = selected;
  const update = useCallback((fn: (w: Workspace) => Workspace) => {
    const next = fn(ws.current);
    ws.current = next;
    if (mounted.current) setWorkspace(next);
  }, []);
  const patch = useCallback(
    (id: string, p: Partial<CanvasNode>) =>
      update((w) => ({
        ...w,
        nodes: w.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)),
      })),
    [update],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runs.current.forEach((r) => {
        r.controller.abort();
        if (r.sessionId) void adapter.cancel(r.sessionId).catch(() => {});
      });
    };
  }, [adapter]);
  useEffect(() => {
    if (!stage.current) return;
    const o = new ResizeObserver((e) =>
      setSize({
        width: e[0].contentRect.width,
        height: e[0].contentRect.height,
      }),
    );
    o.observe(stage.current);
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    if (storagePaused) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          `${STORAGE_KEY}:${mode}`,
          serializeWorkspace(workspace),
        );
        setSaveState("saved");
        setStorageError("");
      } catch (e) {
        setSaveState("error");
        setStorageError(
          `本地保存失败，请导出 JSON 备份。${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }, 300);
    return () => clearTimeout(t);
  }, [workspace, storagePaused, mode]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu(null);
      menuButtons.current[menu]?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [menu]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const zoomAt = useCallback(
    (z: number, x?: number, y?: number) =>
      update((w) => {
        const v = w.viewport,
          zoom = clamp(z),
          cx = x ?? size.width / 2,
          cy = y ?? size.height / 2;
        return {
          ...w,
          viewport: {
            zoom,
            x: cx - ((cx - v.x) * zoom) / v.zoom,
            y: cy - ((cy - v.y) * zoom) / v.zoom,
          },
        };
      }),
    [size, update],
  );
  const fit = useCallback(() => {
    const ns = ws.current.nodes;
    if (!ns.length) return;
    const left = Math.min(...ns.map((n) => n.x)),
      top = Math.min(...ns.map((n) => n.y)),
      right = Math.max(...ns.map((n) => n.x + n.width)),
      bottom = Math.max(...ns.map((n) => n.y + n.height)),
      zoom = clamp(
        Math.min(
          (size.width - 150) / (right - left),
          (size.height - 180) / (bottom - top),
          1,
        ),
      );
    update((w) => ({
      ...w,
      viewport: {
        x: (size.width - (right - left) * zoom) / 2 - left * zoom,
        y: (size.height - (bottom - top) * zoom) / 2 - top * zoom - 15,
        zoom,
      },
    }));
  }, [size, update]);
  const focus = (n: CanvasNode) => {
    const zoom = Math.max(0.65, ws.current.viewport.zoom);
    update((w) => ({
      ...w,
      viewport: {
        zoom,
        x: size.width / 2 - (n.x + n.width / 2) * zoom,
        y: size.height / 2 - (n.y + n.height / 2) * zoom,
      },
    }));
    setSelected([n.id]);
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "textarea,.node-scroll,.context-popover",
        ) &&
        !e.ctrlKey &&
        !e.metaKey
      )
        return;
      e.preventDefault();
      if (e.shiftKey)
        update((w) => ({
          ...w,
          viewport: { ...w.viewport, x: w.viewport.x - e.deltaY - e.deltaX },
        }));
      else {
        const rect = el.getBoundingClientRect();
        zoomAt(
          ws.current.viewport.zoom * Math.exp(-e.deltaY * 0.0015),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [update, zoomAt]);
  const remove = useCallback(() => {
    const ids = selectedRef.current;
    if (!ids.length) return;
    if (
      ids.some(
        (id) =>
          runs.current.has(id) ||
          [...runs.current.values()].some((r) => r.artifactId === id),
      )
    ) {
      setNotice("请先停止正在运行的 Agent，再删除卡片。");
      return;
    }
    setUndo(ws.current);
    update((w) => ({
      ...w,
      nodes: w.nodes
        .filter((n) => !ids.includes(n.id))
        .map((n) => ({
          ...n,
          contextIds: n.contextIds.filter((id) => !ids.includes(id)),
        })),
    }));
    setSelected([]);
    setContextEditor(null);
    setNotice(`已移除 ${ids.length} 张卡片`);
  }, [update]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (editable(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        spaceRef.current = true;
        setSpace(true);
      }
      if (e.key === "Escape") {
        setSelected([]);
        setContextEditor(null);
        setHelp(false);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        fit();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && undo) {
        e.preventDefault();
        if (runs.current.size) {
          setNotice("请先停止运行，再撤销画布变更。");
          return;
        }
        update(() => undo);
        setUndo(null);
        setNotice("已恢复之前的画布");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        try {
          localStorage.setItem(
            `${STORAGE_KEY}:${mode}`,
            serializeWorkspace(ws.current),
          );
          setStoragePaused(false);
          setStorageError("");
          setSaveState("saved");
          setNotice("画布已保存到此浏览器");
        } catch {
          setStorageError("保存失败，请导出 JSON 备份。");
          setSaveState("error");
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpace(false);
      }
    };
    const blur = () => {
      spaceRef.current = false;
      setSpace(false);
      drag.current = null;
      setPanning(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [remove, fit, undo, update, mode]);
  const pan = (e: PE) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target !== stage.current && !spaceRef.current && e.button !== 1)
      return;
    e.preventDefault();
    setSelected([]);
    setContextEditor(null);
    drag.current = {
      kind: "pan",
      pointerId: e.pointerId,
      cx: e.clientX,
      cy: e.clientY,
      x: ws.current.viewport.x,
      y: ws.current.viewport.y,
    };
    stage.current?.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const select = (id: string, e: PE) => {
    if (e.button !== 0 || spaceRef.current) return;
    e.stopPropagation();
    if ((e.target as HTMLElement).closest("button,input,textarea,select"))
      return;
    if (e.shiftKey || e.metaKey || e.ctrlKey)
      setSelected((s) =>
        s.includes(id) ? s.filter((v) => v !== id) : [...s, id],
      );
    else if (!selected.includes(id)) setSelected([id]);
  };
  const startDrag = (n: CanvasNode, e: PE) => {
    if (
      e.button !== 0 ||
      spaceRef.current ||
      (e.target as HTMLElement).closest("button,input,textarea")
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    let ids = selectedRef.current;
    if (!ids.includes(n.id)) {
      ids = e.shiftKey ? [...ids, n.id] : [n.id];
      setSelected(ids);
    }
    drag.current = {
      kind: "nodes",
      pointerId: e.pointerId,
      cx: e.clientX,
      cy: e.clientY,
      nodes: ws.current.nodes
        .filter((n) => ids.includes(n.id))
        .map((n) => ({ id: n.id, x: n.x, y: n.y })),
    };
    stage.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: PE) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.cx,
      dy = e.clientY - d.cy,
      z = ws.current.viewport.zoom;
    if (d.kind === "pan")
      update((w) => ({
        ...w,
        viewport: { ...w.viewport, x: d.x! + dx, y: d.y! + dy },
      }));
    else if (d.kind === "resize")
      patch(d.id!, {
        width: Math.max(260, Math.round(d.width! + dx / z)),
        height: Math.max(
          ws.current.nodes.find((n) => n.id === d.id)?.type === "agent"
            ? 415
            : 190,
          Math.round(d.height! + dy / z),
        ),
      });
    else
      update((w) => ({
        ...w,
        nodes: w.nodes.map((n) => {
          const old = d.nodes!.find((o) => o.id === n.id);
          return old
            ? {
                ...n,
                x: Math.round(old.x + dx / z),
                y: Math.round(old.y + dy / z),
              }
            : n;
        }),
      }));
  };
  const end = (e: PE) => {
    if (drag.current?.pointerId === e.pointerId) {
      drag.current = null;
      setPanning(false);
      if (stage.current?.hasPointerCapture(e.pointerId))
        stage.current.releasePointerCapture(e.pointerId);
    }
  };
  const add = (type: CanvasNode["type"]) => {
    const v = ws.current.viewport,
      width = type === "agent" ? 400 : 310,
      height = type === "agent" ? 470 : 265,
      n: CanvasNode = {
        id: uid(),
        type,
        x: Math.round((size.width / 2 - v.x) / v.zoom - width / 2),
        y: Math.round((size.height / 2 - v.y) / v.zoom - height / 2),
        width,
        height,
        title: {
          note: "新的想法",
          task: "下一步行动",
          agent: "研究助手",
          artifact: "未命名成果",
        }[type],
        body: type === "task" ? "- [ ] 添加你的第一项任务" : "",
        contextIds: [],
        status: "idle",
      };
    update((w) => ({ ...w, nodes: [...w.nodes, n] }));
    setSelected([n.id]);
    setNotice(`已添加${LABELS[type]}，拖动标题栏调整位置`);
  };
  const toggleContext = (id: string, cid: string) => {
    const n = ws.current.nodes.find((n) => n.id === id);
    if (n)
      patch(id, {
        contextIds: n.contextIds.includes(cid)
          ? n.contextIds.filter((i) => i !== cid)
          : [...n.contextIds, cid],
      });
  };
  const attachSelected = (id: string) => {
    const n = ws.current.nodes.find((n) => n.id === id),
      ids = selectedRef.current.filter((i) => i !== id);
    if (n && ids.length) {
      patch(id, { contextIds: [...new Set([...n.contextIds, ...ids])] });
      setNotice(`已连接 ${ids.length} 张上下文卡片`);
    } else setContextEditor(id);
  };
  const runAgent = async (id: string) => {
    const prompt = (drafts[id] ?? "").trim();
    if (!prompt || runs.current.has(id)) return;
    const n = ws.current.nodes.find((n) => n.id === id);
    if (!n) return;
    const context = buildContext(ws.current.nodes, n.contextIds),
      artifactId = uid(),
      count = ws.current.nodes.filter(
        (n) => n.type === "artifact" && n.contextIds.includes(id),
      ).length,
      artifact: CanvasNode = {
        id: artifactId,
        type: "artifact",
        x: n.x + n.width + 95 + count * 30,
        y: n.y + 50 + count * 35,
        width: 340,
        height: 380,
        title: `${n.title} · 运行结果`,
        body: "",
        contextIds: [id],
        status: "running",
      },
      r: Run = {
        controller: new AbortController(),
        artifactId,
        sessionId: n.sessionId,
        stopped: false,
      };
    runs.current.set(id, r);
    setErrors((e) => ({ ...e, [id]: "" }));
    update((w) => ({
      ...w,
      nodes: [
        ...w.nodes.map((n) =>
          n.id === id ? { ...n, status: "running" as const } : n,
        ),
        artifact,
      ],
    }));
    try {
      const sessionId = r.sessionId ?? (await adapter.createSession());
      r.sessionId = sessionId;
      if (r.stopped || r.controller.signal.aborted || !mounted.current) {
        void adapter.cancel(sessionId).catch(() => {});
        return;
      }
      patch(id, { sessionId });
      await adapter.run({
        sessionId,
        prompt,
        context,
        signal: r.controller.signal,
        onText: (text) => {
          if (runs.current.get(id) === r && !r.stopped && mounted.current)
            patch(artifactId, { body: text });
        },
      });
      if (r.stopped || r.controller.signal.aborted || !mounted.current) return;
      update((w) => ({
        ...w,
        nodes: w.nodes.map((n) =>
          n.id === id || n.id === artifactId
            ? { ...n, status: "done" as const }
            : n,
        ),
      }));
      setNotice("运行完成，输出已保留在独立成果卡片中");
    } catch (e) {
      if (r.stopped || r.controller.signal.aborted || !mounted.current) return;
      const message = e instanceof Error ? e.message : String(e);
      setErrors((prev) => ({
        ...prev,
        [id]:
          message +
          (/permission|approval|confirm|授权|确认/i.test(message)
            ? " 请在 DSH 宿主中处理授权后重试。"
            : ""),
      }));
      update((w) => ({
        ...w,
        nodes: w.nodes.map((n) =>
          n.id === id || n.id === artifactId
            ? { ...n, status: "error" as const }
            : n,
        ),
      }));
    } finally {
      if (runs.current.get(id) === r) runs.current.delete(id);
    }
  };
  const cancel = async (id: string) => {
    const r = runs.current.get(id);
    if (!r || r.stopped) return;
    r.stopped = true;
    r.controller.abort();
    update((w) => ({
      ...w,
      nodes: w.nodes.map((n) =>
        n.id === id || n.id === r.artifactId
          ? { ...n, status: "idle" as const }
          : n,
      ),
    }));
    setNotice("已停止运行，输入和已生成内容均已保留");
    try {
      if (r.sessionId) await adapter.cancel(r.sessionId);
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [id]: `本地输出已停止，宿主取消未确认：${e instanceof Error ? e.message : String(e)}`,
      }));
    } finally {
      if (runs.current.get(id) === r) runs.current.delete(id);
    }
  };
  const exportFile = () => {
    try {
      const url = URL.createObjectURL(
          new Blob([serializeWorkspace(ws.current)], {
            type: "application/json",
          }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = `dsh-canvas-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("已导出画布，包含卡片、连接与视角");
    } catch (e) {
      setNotice(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (runs.current.size) {
      setNotice("请先停止正在运行的 Agent，再导入画布。");
      return;
    }
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("文件超过 5 MB。");
      const parsed = recover(parseWorkspace(await file.text())),
        next = {
          ...parsed,
          nodes: parsed.nodes.map((n) => ({ ...n, sessionId: undefined })),
        };
      setUndo(ws.current);
      update(() => next);
      setSelected([]);
      setDrafts({});
      setErrors({});
      setContextEditor(null);
      setStoragePaused(false);
      setNotice("导入成功，Agent 将使用全新会话。原画布可撤销恢复。");
    } catch (e) {
      setNotice(
        `导入失败，原画布未变动：${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const { nodes, viewport: v } = workspace,
    active = nodes.filter(
      (n) => n.type === "agent" && n.status === "running",
    ).length,
    selectedAgent = nodes.find(
      (n) => n.type === "agent" && selected.includes(n.id),
    );
  return (
    <div className="canvas-app" data-testid="canvas-workspace">
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      <div className="workspace-shell">
        <div className="canvas-topbar" ref={menuRoot}>
          <div
            className="canvas-topbar-buttons"
            role="group"
            aria-label="画布操作"
          >
            {(["navigation", "add", "view"] as const).map((entry) => (
              <button
                key={entry}
                ref={(element) => {
                  menuButtons.current[entry] = element;
                }}
                className={`canvas-float-button ${menu === entry ? "open" : ""}`}
                aria-label={
                  entry === "navigation"
                    ? "导航与工作区"
                    : entry === "add"
                      ? "添加节点"
                      : "视图与更多"
                }
                aria-haspopup="dialog"
                aria-expanded={menu === entry}
                onClick={() => setMenu(menu === entry ? null : entry)}
              >
                <Icon
                  name={
                    entry === "navigation"
                      ? "grid"
                      : entry === "add"
                        ? "plus"
                        : "fit"
                  }
                  size={17}
                />
              </button>
            ))}
          </div>
          <span className={`mode-badge ${mode}`}>
            <i />
            {mode === "mock" ? "MOCK · 本地演示" : "LIVE · DSH"}
          </span>
          {menu === "navigation" && (
            <div
              className="canvas-menu canvas-navigation"
              role="dialog"
              aria-label="导航与工作区"
            >
              <div className="canvas-menu-heading">工作区</div>
              <input
                className="canvas-workspace-name"
                aria-label="工作空间名称"
                value={workspace.title}
                onChange={(e) =>
                  update((w) => ({ ...w, title: e.target.value }))
                }
                onBlur={() => {
                  if (!ws.current.title.trim())
                    update((w) => ({ ...w, title: "Untitled workspace" }));
                }}
              />
              <div className={`save-status ${saveState}`}>
                <span className="status-dot" />
                {saveState === "saved"
                  ? "已保存到此浏览器"
                  : saveState === "saving"
                    ? "正在保存…"
                    : "本地保存异常"}
                <span>·</span>
                {nodes.length} 张卡片
              </div>
              {onExit && (
                <button className="canvas-menu-row" onClick={onExit}>
                  <Icon name="home" size={16} />
                  返回 DSH
                </button>
              )}
              {onBackToChat && (
                <button className="canvas-menu-row" onClick={onBackToChat}>
                  <Icon name="grid" size={16} />
                  单会话画布
                </button>
              )}
              {onNewSession && (
                <button className="canvas-menu-row" onClick={onNewSession}>
                  <Icon name="plus" size={16} />
                  新建 DSH 会话
                </button>
              )}
              {hostSessions.length > 0 && (
                <>
                  <div className="canvas-menu-heading canvas-menu-divider">
                    最近会话
                  </div>
                  <div className="canvas-session-list">
                    {hostSessions.map((session) => (
                      <button
                        className="canvas-menu-row"
                        key={session.id}
                        onClick={() => onOpenSession?.(session.id)}
                      >
                        <Icon name="agent" size={15} />
                        <span>{session.title}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {onExit && (
                <button
                  className="canvas-menu-row canvas-menu-subtle"
                  onClick={onExit}
                >
                  设置（返回 DSH 后打开）
                </button>
              )}
            </div>
          )}
          {menu === "add" && (
            <div className="canvas-menu" role="dialog" aria-label="添加节点">
              <div className="canvas-menu-heading">添加节点</div>
              {(["note", "task", "agent", "artifact"] as const).map((type) => (
                <button
                  key={type}
                  className="canvas-menu-row"
                  aria-label={`添加${LABELS[type]}`}
                  onClick={() => {
                    add(type);
                    setMenu(null);
                  }}
                >
                  <Icon name={type} size={16} />
                  {LABELS[type]}
                </button>
              ))}
            </div>
          )}
          {menu === "view" && (
            <div
              className="canvas-menu canvas-view-menu"
              role="dialog"
              aria-label="视图与更多"
            >
              <div className="canvas-menu-heading">视图</div>
              <div className="canvas-zoom-controls">
                <button aria-label="缩小" onClick={() => zoomAt(v.zoom / 1.2)}>
                  <Icon name="minus" size={15} />
                </button>
                <button
                  className="zoom-label"
                  title="还原 100%"
                  onClick={() => zoomAt(1)}
                >
                  {Math.round(v.zoom * 100)}%
                </button>
                <button aria-label="放大" onClick={() => zoomAt(v.zoom * 1.2)}>
                  <Icon name="plus" size={15} />
                </button>
                <button aria-label="适应画布" onClick={fit}>
                  <Icon name="fit" size={15} />
                </button>
              </div>
              <div className="canvas-menu-heading canvas-menu-divider">
                文件
              </div>
              <button
                className="canvas-menu-row"
                onClick={() => {
                  fileInput.current?.click();
                  setMenu(null);
                }}
              >
                <Icon name="upload" size={16} />
                导入画布
              </button>
              <button
                className="canvas-menu-row"
                onClick={() => {
                  exportFile();
                  setMenu(null);
                }}
              >
                <Icon name="download" size={16} />
                导出画布
              </button>
              <button
                className="canvas-menu-row"
                onClick={() => {
                  setHelp(!help);
                  setMenu(null);
                }}
              >
                <Icon name="help" size={16} />
                操作指南
              </button>
            </div>
          )}
        </div>
        <main
          ref={stage}
          className={`canvas-stage ${panning ? "is-panning" : ""} ${space ? "space-panning" : ""}`}
          aria-label="可拖动缩放的工作画布"
          style={
            {
              "--grid-size": `${24 * v.zoom}px`,
              "--grid-x": `${v.x}px`,
              "--grid-y": `${v.y}px`,
            } as CSSProperties
          }
          onPointerDown={pan}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          {storageError && (
            <div className="storage-alert" role="alert">
              <span>{storageError}</span>
              <button onClick={exportFile}>导出备份</button>
              {storagePaused && (
                <button
                  onClick={() => {
                    setStoragePaused(false);
                    setStorageError("");
                  }}
                >
                  使用当前画布
                </button>
              )}
            </div>
          )}
          <div
            className="world"
            style={{
              transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`,
            }}
          >
            <svg className="connections" aria-hidden="true">
              {nodes.flatMap((target) =>
                target.contextIds.map((id) => {
                  const source = nodes.find((n) => n.id === id);
                  if (!source) return null;
                  const right = target.x >= source.x + source.width / 2,
                    x1 = right ? source.x + source.width : source.x,
                    y1 = source.y + source.height / 2,
                    x2 = right ? target.x : target.x + target.width,
                    y2 = target.y + target.height / 2,
                    bend =
                      Math.max(55, Math.abs(x2 - x1) * 0.45) * (right ? 1 : -1);
                  return (
                    <g
                      key={`${id}-${target.id}`}
                      className={`connection ${target.status === "running" ? "running" : ""}`}
                    >
                      <path
                        d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`}
                      />
                      <circle cx={x1} cy={y1} r="4" />
                      <circle cx={x2} cy={y2} r="4" />
                    </g>
                  );
                }),
              )}
            </svg>
            {nodes.map((n, index) => {
              const running = n.status === "running",
                contexts = n.contextIds
                  .map((id) => nodes.find((n) => n.id === id))
                  .filter((n): n is CanvasNode => Boolean(n)),
                lines = n.body.split("\n").filter((l) => l.trim()),
                completed = lines.filter((l) =>
                  /^\s*-?\s*\[x\]/i.test(l),
                ).length,
                results = nodes.filter(
                  (a) => a.type === "artifact" && a.contextIds.includes(n.id),
                ),
                latest = results[results.length - 1];
              return (
                <article
                  key={n.id}
                  data-testid={`canvas-node-${n.id}`}
                  data-node-id={n.id}
                  className={`canvas-node node-${n.type} ${selected.includes(n.id) ? "selected" : ""}`}
                  style={{
                    left: n.x,
                    top: n.y,
                    width: n.width,
                    height: n.height,
                    zIndex:
                      contextEditor === n.id
                        ? 30
                        : selected.includes(n.id)
                          ? 10
                          : 2,
                  }}
                  onPointerDown={(e) => select(n.id, e)}
                  aria-label={`${LABELS[n.type]}：${n.title}`}
                >
                  <div
                    className="node-head"
                    data-testid={`node-drag-${n.id}`}
                    onPointerDown={(e) => startDrag(n, e)}
                  >
                    <span className="node-type-icon">
                      <Icon name={n.type} size={16} />
                    </span>
                    <span className="node-type-label">{LABELS[n.type]}</span>
                    {n.type === "agent" && (
                      <span className="agent-flavor">独立会话</span>
                    )}
                    <span className="node-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <button
                      className="node-menu icon-button"
                      title="选择此卡片"
                      onClick={() => setSelected([n.id])}
                    >
                      ···
                    </button>
                  </div>
                  <div className="node-content">
                    <input
                      className="node-title"
                      value={n.title}
                      aria-label={`${LABELS[n.type]}标题`}
                      onChange={(e) => patch(n.id, { title: e.target.value })}
                    />
                    {n.type === "note" && (
                      <>
                        <textarea
                          className="note-body node-scroll"
                          aria-label="笔记内容"
                          placeholder="写下背景、灵感，或一个值得探索的问题…"
                          value={n.body}
                          onChange={(e) =>
                            patch(n.id, { body: e.target.value })
                          }
                        />
                        <div className="note-footer">
                          <span className="tiny-label">
                            CONTEXT / 灵感与背景
                          </span>
                          <span className="note-fold" />
                        </div>
                      </>
                    )}
                    {n.type === "task" && (
                      <>
                        <div className="task-progress">
                          <div>
                            <span
                              style={{
                                width: `${lines.length ? (completed / lines.length) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span>
                            {completed} / {lines.length}
                          </span>
                          <button
                            className="icon-button"
                            title="编辑清单"
                            onClick={() =>
                              setEditing((e) => ({ ...e, [n.id]: !e[n.id] }))
                            }
                          >
                            <Icon
                              name={editing[n.id] ? "check" : "edit"}
                              size={13}
                            />
                          </button>
                        </div>
                        {editing[n.id] ? (
                          <textarea
                            className="task-editor node-scroll"
                            aria-label="任务清单，每行一项"
                            value={n.body}
                            onChange={(e) =>
                              patch(n.id, { body: e.target.value })
                            }
                          />
                        ) : (
                          <div className="task-list node-scroll">
                            {lines.map((line, i) => {
                              const checked = /^\s*-?\s*\[x\]/i.test(line),
                                label = line.replace(
                                  /^\s*(?:[-*]\s*)?(?:\[[ x]\]\s*)?/i,
                                  "",
                                );
                              return (
                                <button
                                  key={i}
                                  className={`task-line ${checked ? "checked" : ""}`}
                                  onClick={() =>
                                    patch(n.id, {
                                      body: lines
                                        .map((l, j) =>
                                          j === i
                                            ? `- [${checked ? " " : "x"}] ${label}`
                                            : l,
                                        )
                                        .join("\n"),
                                    })
                                  }
                                >
                                  <span className="task-checkbox">
                                    {checked && <Icon name="check" size={12} />}
                                  </span>
                                  <span>{label}</span>
                                </button>
                              );
                            })}
                            <button
                              className="add-task"
                              onClick={() => {
                                patch(n.id, {
                                  body: `${n.body}${n.body ? "\n" : ""}- [ ] 新任务`,
                                });
                                setEditing((e) => ({ ...e, [n.id]: true }));
                              }}
                            >
                              <Icon name="plus" size={13} />
                              添加一项
                            </button>
                          </div>
                        )}
                        <div className="task-footer">
                          <span className="tiny-label">PLAN / 下一步行动</span>
                          <span className="task-state">
                            {lines.length && completed === lines.length
                              ? "全部完成"
                              : "进行中"}
                          </span>
                        </div>
                      </>
                    )}
                    {n.type === "agent" && (
                      <>
                        <p className="agent-description">
                          连接上下文，把一个目标变成可继续使用的成果。
                        </p>
                        <div className="context-section">
                          <div className="context-section-top">
                            <span>
                              上下文{" "}
                              <b>{String(contexts.length).padStart(2, "0")}</b>
                            </span>
                            <button
                              className="text-button"
                              onClick={() =>
                                setContextEditor(
                                  contextEditor === n.id ? null : n.id,
                                )
                              }
                            >
                              <Icon name="link" size={12} />
                              管理连接
                            </button>
                          </div>
                          <div className="context-chips">
                            {contexts.length ? (
                              contexts.map((c) => (
                                <span
                                  className={`context-chip chip-${c.type}`}
                                  key={c.id}
                                >
                                  <Icon name={c.type} size={12} />
                                  <span>{c.title || LABELS[c.type]}</span>
                                  <button
                                    aria-label={`移除上下文 ${c.title}`}
                                    onClick={() => toggleContext(n.id, c.id)}
                                  >
                                    <Icon name="close" size={10} />
                                  </button>
                                </span>
                              ))
                            ) : (
                              <button
                                className="empty-context"
                                onClick={() => setContextEditor(n.id)}
                              >
                                <Icon name="plus" size={13} />
                                连接画布上的笔记、任务或成果
                              </button>
                            )}
                          </div>
                          {selected.some((id) => id !== n.id) && (
                            <button
                              className="attach-selection"
                              onClick={() => attachSelected(n.id)}
                            >
                              <Icon name="plus" size={12} />
                              接入所选{" "}
                              {selected.filter((id) => id !== n.id).length}{" "}
                              张卡片
                            </button>
                          )}
                        </div>
                        <div
                          className={`agent-work-state ${n.status ?? "idle"}`}
                        >
                          <span className="agent-status-icon">
                            {running ? (
                              <span className="loader" />
                            ) : (
                              <Icon
                                name={
                                  n.status === "done"
                                    ? "check"
                                    : n.status === "error"
                                      ? "close"
                                      : "agent"
                                }
                                size={16}
                              />
                            )}
                          </span>
                          <div>
                            <strong>
                              {running
                                ? "正在把线索连接起来…"
                                : n.status === "done"
                                  ? "成果已就绪"
                                  : n.status === "error"
                                    ? "运行未完成"
                                    : "准备好开始一项工作"}
                            </strong>
                            <span>
                              {running
                                ? "输出正在写入右侧成果卡片"
                                : mode === "mock"
                                  ? "演示适配器 · 不调用真实模型"
                                  : n.sessionId
                                    ? "已保留独立会话"
                                    : "首次运行时创建独立会话"}
                            </span>
                          </div>
                          {latest && (
                            <button
                              className="icon-button"
                              title="定位最新成果"
                              onClick={() => focus(latest)}
                            >
                              <Icon name="arrow" size={16} />
                            </button>
                          )}
                        </div>
                        {errors[n.id] && (
                          <div className="agent-error node-scroll" role="alert">
                            {errors[n.id]}
                          </div>
                        )}
                        {mode === "dsh" &&
                          n.sessionId &&
                          adapter.openSession && (
                            <button
                              className="host-open text-button"
                              onClick={() =>
                                adapter.openSession?.(n.sessionId!)
                              }
                            >
                              在 DSH 中打开 <Icon name="arrow" size={12} />
                            </button>
                          )}
                        <div className="agent-composer">
                          <textarea
                            data-testid={`agent-prompt-${n.id}`}
                            aria-label={`${n.title} 的指令`}
                            placeholder="给这个 Agent 一个明确的目标…"
                            value={drafts[n.id] ?? ""}
                            onChange={(e) =>
                              setDrafts((d) => ({
                                ...d,
                                [n.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (
                                e.key === "Enter" &&
                                (e.metaKey || e.ctrlKey)
                              ) {
                                e.preventDefault();
                                void runAgent(n.id);
                              }
                            }}
                          />
                          <div className="composer-bottom">
                            <span>
                              <i />
                              {mode === "mock" ? "Mock adapter" : "DSH Runtime"}
                            </span>
                            {running ? (
                              <button
                                data-testid={`agent-cancel-${n.id}`}
                                className="run-button stop-button"
                                onClick={() => void cancel(n.id)}
                              >
                                <Icon name="stop" size={12} />
                                停止
                              </button>
                            ) : (
                              <button
                                data-testid={`agent-run-${n.id}`}
                                className="run-button"
                                disabled={!(drafts[n.id] ?? "").trim()}
                                onClick={() => void runAgent(n.id)}
                              >
                                运行
                                <Icon name="arrow" size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="agent-footer">
                          <span>输出 → 独立成果卡片</span>
                          <kbd>⌘ / Ctrl ↵</kbd>
                        </div>
                      </>
                    )}
                    {n.type === "artifact" && (
                      <>
                        {n.body ? (
                          <>
                            <div className="artifact-meta">
                              <span className={`artifact-status ${n.status}`}>
                                {running
                                  ? "正在生成"
                                  : n.status === "error"
                                    ? "部分输出"
                                    : n.status === "done"
                                      ? "已完成"
                                      : "可继续编辑"}
                              </span>
                              <button
                                className="text-button"
                                disabled={running}
                                onClick={() =>
                                  setEditing((e) => ({
                                    ...e,
                                    [n.id]: !e[n.id],
                                  }))
                                }
                              >
                                <Icon
                                  name={editing[n.id] ? "check" : "edit"}
                                  size={12}
                                />
                                {editing[n.id] ? "完成" : "编辑"}
                              </button>
                            </div>
                            {editing[n.id] ? (
                              <textarea
                                className="artifact-editor node-scroll"
                                aria-label="成果内容"
                                value={n.body}
                                onChange={(e) =>
                                  patch(n.id, { body: e.target.value })
                                }
                              />
                            ) : (
                              <div className="artifact-output node-scroll">
                                {n.body}
                                {running && <span className="stream-caret" />}
                              </div>
                            )}
                          </>
                        ) : (
                          <div
                            className={`artifact-empty ${running ? "generating" : ""}`}
                          >
                            <div className="artifact-illustration">
                              <span className="artifact-sheet sheet-back" />
                              <span className="artifact-sheet sheet-front">
                                <i />
                                <i />
                                <i />
                                <Icon name="artifact" size={20} />
                              </span>
                              <span className="artifact-spark spark-one">
                                +
                              </span>
                              <span className="artifact-spark spark-two">
                                +
                              </span>
                            </div>
                            <strong>
                              {running
                                ? "你的成果正在这里形成"
                                : n.status === "error"
                                  ? "本次运行未生成内容"
                                  : "给想法一个落点"}
                            </strong>
                            <p>
                              {running
                                ? "流式内容会实时出现在这张卡片中。"
                                : "运行 Agent，或写下你的结论。\n成果可以成为下一轮工作的上下文。"}
                            </p>
                            {!running && (
                              <button
                                className="text-button"
                                onClick={() => {
                                  patch(n.id, { body: "在这里记录你的成果。" });
                                  setEditing((e) => ({ ...e, [n.id]: true }));
                                }}
                              >
                                开始记录
                                <Icon name="arrow" size={13} />
                              </button>
                            )}
                          </div>
                        )}
                        <div className="artifact-footer">
                          <span>
                            <Icon name="artifact" size={12} />
                            {contexts.find((c) => c.type === "agent")?.title ??
                              "OUTPUT / 可复用的成果"}
                          </span>
                          {running ? (
                            <span className="live-dot" />
                          ) : (
                            <span>↗</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {contextEditor === n.id && n.type === "agent" && (
                    <div
                      className="context-popover"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div className="popover-heading">
                        <strong>选择上下文</strong>
                        <button
                          className="icon-button"
                          aria-label="关闭上下文选择"
                          onClick={() => setContextEditor(null)}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                      <p>仅在运行时发送这些卡片的快照。</p>
                      <div className="context-options">
                        {nodes
                          .filter((c) => c.id !== n.id)
                          .map((c) => (
                            <button
                              key={c.id}
                              className={
                                n.contextIds.includes(c.id) ? "chosen" : ""
                              }
                              onClick={() => toggleContext(n.id, c.id)}
                            >
                              <span className="option-check">
                                {n.contextIds.includes(c.id) && (
                                  <Icon name="check" size={11} />
                                )}
                              </span>
                              <Icon name={c.type} size={14} />
                              <span>{c.title || LABELS[c.type]}</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                  <button
                    data-testid={`node-resize-${n.id}`}
                    className="node-resize"
                    aria-label={`调整${n.title}大小`}
                    title="拖动调整大小"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      drag.current = {
                        kind: "resize",
                        pointerId: e.pointerId,
                        cx: e.clientX,
                        cy: e.clientY,
                        id: n.id,
                        width: n.width,
                        height: n.height,
                      };
                      stage.current?.setPointerCapture(e.pointerId);
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <path d="M2 8 8 2M6 8l2-2" stroke="currentColor" />
                    </svg>
                  </button>
                </article>
              );
            })}
          </div>
          {!nodes.length && (
            <div className="empty-workspace">
              <span>
                <Icon name="grid" size={34} />
              </span>
              <h2>空白画布</h2>
              <button className="primary-button" onClick={() => add("note")}>
                <Icon name="plus" size={16} />
                添加第一张笔记
              </button>
            </div>
          )}
          {selected.length > 0 && (
            <div className="selection-toolbar">
              <span>{selected.length} 张已选</span>
              <i />
              {selectedAgent && (
                <button onClick={() => attachSelected(selectedAgent.id)}>
                  <Icon name="link" size={14} />
                  连接上下文
                </button>
              )}
              <button onClick={remove}>
                <Icon name="trash" size={14} />
                删除
              </button>
              <button
                className="icon-button"
                aria-label="取消选择"
                onClick={() => setSelected([])}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {help && (
            <div className="help-panel">
              <div className="popover-heading">
                <strong>你的空间工作台</strong>
                <button
                  className="icon-button"
                  aria-label="关闭指南"
                  onClick={() => setHelp(false)}
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
              <ol>
                <li>
                  <b>放下想法</b>
                  <span>使用左上角的添加按钮。</span>
                </li>
                <li>
                  <b>连接上下文</b>
                  <span>在 Agent 中选择卡片，或多选后接入。</span>
                </li>
                <li>
                  <b>让工作向前</b>
                  <span>输入目标并运行，输出保留为新成果。</span>
                </li>
              </ol>
              <div className="help-shortcuts">
                <span>
                  拖动标题栏 <b>移动卡片</b>
                </span>
                <span>
                  滚轮 <b>缩放画布</b>
                </span>
                <span>
                  空白处拖动 / Space <b>平移画布</b>
                </span>
                <span>
                  Shift + 点击 <b>多选卡片</b>
                </span>
                <span>
                  ⌘ / Ctrl + S <b>保存到浏览器</b>
                </span>
              </div>
              <p>
                {mode === "mock"
                  ? "当前为本地演示，不会调用模型或发送网络请求。"
                  : "运行时通过 DSH 宿主创建会话并发送选定上下文。"}
              </p>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <span>{notice}</span>
              {undo && (
                <button
                  onClick={() => {
                    if (runs.current.size) {
                      setNotice("请先停止运行，再撤销画布变更。");
                      return;
                    }
                    update(() => undo);
                    setUndo(null);
                    setNotice("已恢复之前的画布");
                  }}
                >
                  撤销
                </button>
              )}
              <button
                className="icon-button"
                aria-label="关闭提示"
                onClick={() => setNotice("")}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
