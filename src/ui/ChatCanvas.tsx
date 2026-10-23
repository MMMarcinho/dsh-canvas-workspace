import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { AgentAdapter } from "../core/types";
import {
  reconcileConversation,
  type ConversationState as State,
} from "../core/conversation";
import {
  activeReplyPair,
  buildReplyPairs,
  type PairTarget,
} from "./reply-pairing";
import { Icon } from "./icons";
import { Brand } from "./brand";
import { formatReplyTime } from "./reply-time";
import {
  ReplyContent,
  type IuiActionHandler,
  type ReplyMarkdownRenderer,
  type IuiResourceHandler,
  type ReplyImagePreviewRenderer,
} from "./ReplyContent";
import { UserMessageMedia, type UserImageLoader } from "./UserMessageMedia";
import { UserMessageActions } from "./UserMessageActions";

const KEY = "dsh-canvas-conversation:v1";
type ActiveRun = {
  id: string;
  controller: AbortController;
  sessionId?: string;
  stopping?: boolean;
};
const fresh = (): State => ({
  version: 1,
  viewport: { x: 64, y: 104, zoom: 1 },
  replies: [],
});
function restore(mode: "mock" | "dsh"): { state: State; error: string } {
  try {
    const raw = localStorage.getItem(`${KEY}:${mode}`);
    if (!raw) return { state: fresh(), error: "" };
    const value = JSON.parse(raw) as State;
    if (
      value.version !== 1 ||
      !Array.isArray(value.replies) ||
      !value.viewport ||
      !Number.isFinite(value.viewport.x) ||
      !Number.isFinite(value.viewport.y) ||
      !Number.isFinite(value.viewport.zoom) ||
      value.viewport.zoom < 0.25 ||
      value.viewport.zoom > 2 ||
      value.replies.some(
        (reply) =>
          !reply.id ||
          typeof reply.prompt !== "string" ||
          typeof reply.body !== "string",
      )
    ) {
      throw new Error("存档格式无效");
    }
    return {
      state: {
        ...value,
        replies: value.replies.map((reply) => ({
          ...reply,
          ...(reply.position &&
          (!Number.isFinite(reply.position.x) ||
            !Number.isFinite(reply.position.y) ||
            !Number.isFinite(reply.position.slotHeight) ||
            reply.position.slotHeight < 0)
            ? { position: undefined }
            : {}),
          ...(reply.status === "running"
            ? {
                status: "error" as const,
                error: "上次运行已中断，请在 DSH 会话中核对状态。",
              }
            : {}),
        })),
      },
      error: "",
    };
  } catch (error) {
    return {
      state: fresh(),
      error: `无法恢复画布存档，原数据未覆盖：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
const PAN_THRESHOLD = 4;
const PAN_CONTROLS =
  'input,textarea,select,button,a,label,summary,iframe,video,audio,[role="button"],[role="textbox"],[role="slider"],[role="checkbox"],[role="radio"],[role="switch"],[contenteditable]:not([contenteditable="false"]),[data-canvas-pan-exclude]';
// Use the composed path so controls inside an IUI shadow root retain ownership.
function isPanControl(event: Event): boolean {
  return event
    .composedPath()
    .some(
      (target) =>
        target instanceof HTMLElement &&
        !target.hasAttribute("data-canvas-pan-handle") &&
        target.matches(PAN_CONTROLS),
    );
}
const clamp = (value: number) => Math.max(0.25, Math.min(2, value));
function ReasoningView({ text, running }: { text: string; running: boolean }) {
  const live = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live.current) live.current.scrollTop = live.current.scrollHeight;
  }, [text]);
  if (!text.trim()) return null;
  return running ? (
    <div className="chat-reasoning-live" role="status" aria-live="polite">
      <span aria-hidden="true">思考中</span>
      <div ref={live} aria-label="最新思考内容">
        {text}
      </div>
    </div>
  ) : null;
}
function useCalendarNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(
        tick,
        Math.max(1_000, midnight.getTime() - Date.now() + 50),
      );
    }
    function tick() {
      setNow(Date.now());
      schedule();
    }
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      tick();
    }
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  return now;
}
export function ChatCanvas({
  adapter,
  mode,
  onExit,
  hostSessions = [],
  hostWorkspaces = [],
  onOpenSession,
  onNewSession,
  onOpenWorkspace,
  onCreateWorkspace,
  onPlugins,
  onLegacy,
  NativeBrand,
  avatar,
  navIcon,
  sendIcon,
  renderMarkdown,
  renderImagePreview,
  loadUserImage,
  userChrome,
  resolveImage,
  useNativeComposer = false,
  nativeComposer,
  onSessionChange,
  accountActions,
}: {
  adapter: AgentAdapter;
  mode: "mock" | "dsh";
  onExit?: () => void;
  hostSessions?: { id: string; title: string; cwd?: string }[];
  hostWorkspaces?: { id: string; title: string; sessionIds: string[] }[];
  onOpenSession?: (id: string) => void;
  onNewSession?: () => void;
  onOpenWorkspace?: (id: string) => Promise<void>;
  onCreateWorkspace?: () => Promise<void>;
  onPlugins?: () => void;
  onLegacy?: () => void;
  NativeBrand?: ReactNode;
  avatar?: ReactNode;
  navIcon?: ReactNode;
  sendIcon?: ReactNode;
  renderMarkdown?: ReplyMarkdownRenderer;
  renderImagePreview?: ReplyImagePreviewRenderer;
  loadUserImage?: UserImageLoader;
  userChrome?: {
    renderFileIcon: (name: string) => ReactNode;
    formatFileMeta: (name: string, bytes: number) => string;
    copyText: (text: string) => Promise<boolean>;
    renderCopyIcon: (copied: boolean) => ReactNode;
    wrapCopyButton: (button: ReactElement, label: string) => ReactNode;
  };
  resolveImage?: (
    request: Parameters<IuiResourceHandler>[0],
    sessionId?: string,
  ) => ReturnType<IuiResourceHandler>;
  useNativeComposer?: boolean;
  nativeComposer?: ReactNode;
  onSessionChange?: (sessionId: string | undefined) => void;
  accountActions?: {
    settings: { label: string; description: string; run: () => void };
    version: { label: string; description: string; run: () => void };
  };
}) {
  const [initial] = useState(() => restore(mode));
  const calendarNow = useCalendarNow();
  const [state, setState] = useState(initial.state);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [storageError, setStorageError] = useState(initial.error);
  const storageErrorRef = useRef(storageError);
  storageErrorRef.current = storageError;
  const [draft, setDraft] = useState("");
  const [iuiEnabled, setIuiEnabled] = useState(true);
  const [menu, setMenu] = useState<"nav" | "account" | null>(null);
  const [search, setSearch] = useState("");
  const [navError, setNavError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const creatingSession = useRef(false);
  const [hoveredPair, setHoveredPair] = useState<PairTarget | null>(null);
  const [focusedPair, setFocusedPair] = useState<PairTarget | null>(null);
  const keyboardPairing = useRef(true);
  const workspaceId = hostWorkspaces.find((workspace) =>
    workspace.sessionIds.includes(state.sessionId ?? ""),
  )?.id;
  const pairScope = JSON.stringify([
    mode,
    workspaceId ?? null,
    state.sessionId ?? null,
  ]);
  const pairs = useMemo(
    () => buildReplyPairs(state.replies, pairScope),
    [state.replies, pairScope],
  );
  const userGroups = useMemo(() => {
    const groups: {
      pairKey: string;
      messages: { message: (typeof pairs.userMessages)[number] }[];
    }[] = [];
    pairs.userMessages.forEach((message) => {
      const last = groups.at(-1);
      if (last?.pairKey === message.pairKey) last.messages.push({ message });
      else
        groups.push({
          pairKey: message.pairKey,
          messages: [{ message }],
        });
    });
    return groups;
  }, [pairs]);
  const activePair =
    activeReplyPair(pairs, hoveredPair) ?? activeReplyPair(pairs, focusedPair);
  const clearPairing = useCallback(() => {
    setHoveredPair(null);
    setFocusedPair(null);
  }, []);
  useEffect(() => {
    // Removed sources and navigation must not revive an old hover if IDs recur later.
    setHoveredPair((target) =>
      activeReplyPair(pairs, target) ? target : null,
    );
    setFocusedPair((target) =>
      activeReplyPair(pairs, target) ? target : null,
    );
  }, [pairs]);
  useEffect(() => {
    const keyboard = () => {
      keyboardPairing.current = true;
    };
    // Tab may enter the canvas from a native host control outside this subtree.
    document.addEventListener("keydown", keyboard, true);
    window.addEventListener("blur", clearPairing);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("blur", clearPairing);
    };
  }, [clearPairing]);
  const pairingProps = (
    source: PairTarget["source"],
    id: string,
    pairKey?: string,
  ) => {
    const target: PairTarget = { scope: pairScope, source, id };
    const isTarget = (value: PairTarget | null) =>
      value?.scope === pairScope && value.source === source && value.id === id;
    return {
      "data-pair-source": source,
      "data-pair-id": id,
      "data-pair-state": activePair
        ? pairKey === activePair
          ? "matched"
          : "dimmed"
        : undefined,
      onMouseEnter: () => setHoveredPair(target),
      onMouseLeave: () =>
        setHoveredPair((value) => (isTarget(value) ? null : value)),
      onFocusCapture: () => {
        if (keyboardPairing.current) setFocusedPair(target);
      },
      onBlurCapture: (event: React.FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocusedPair((value) => (isTarget(value) ? null : value));
      },
    };
  };
  const mounted = useRef(true);
  const running = useRef<ActiveRun | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const userRail = useRef<HTMLElement>(null);
  const seenRailMessages = useRef<{
    scope: string;
    ids: Set<string>;
    tail?: string;
  } | null>(null);
  const railScrollAnimating = useRef(false);
  const railFollowTail = useRef<string | null>(null);
  const userPress = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const previousReplyCount = useRef(state.replies.length);
  const newReplyIds = useRef(new Set<string>());
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const iuiActions = useRef(new Map<string, ReturnType<IuiActionHandler>>());
  const userMessageIds = JSON.stringify(
    pairs.userMessages.map((message) => message.id),
  );
  const stopRailScroll = () => {
    railFollowTail.current = null;
    if (!railScrollAnimating.current) return;
    railScrollAnimating.current = false;
    const rail = userRail.current;
    if (rail && typeof window.requestAnimationFrame === "function")
      rail.scrollTo({ top: rail.scrollTop, behavior: "instant" });
  };
  useLayoutEffect(() => {
    const ids = pairs.userMessages.map((message) => message.id);
    const previous = seenRailMessages.current;
    seenRailMessages.current = {
      scope: pairScope,
      ids: new Set(ids),
      tail: ids.at(-1),
    };
    if (!previous || previous.scope !== pairScope) {
      stopRailScroll();
      return;
    }
    // A new tail after a known message is a fresh input. Historical prepends,
    // initial restoration and assistant streaming keep the viewer's scroll.
    const tail = ids.at(-1);
    if (
      !previous.tail ||
      !tail ||
      previous.ids.has(tail) ||
      ids.indexOf(previous.tail) < 0
    )
      return;
    const rail = userRail.current;
    if (!rail) return;
    railFollowTail.current = JSON.stringify([pairScope, tail]);
    const bottom = Math.max(0, rail.scrollHeight - rail.clientHeight);
    if (
      typeof window.requestAnimationFrame !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      railScrollAnimating.current = false;
      rail.scrollTop = bottom;
    } else {
      railScrollAnimating.current = true;
      rail.scrollTo({ top: bottom, behavior: "smooth" });
    }
  }, [pairScope, userMessageIds]);
  useLayoutEffect(() => {
    const rail = userRail.current;
    const last = rail?.lastElementChild;
    if (!rail || !last || typeof ResizeObserver === "undefined") return;
    let height = last.getBoundingClientRect().height;
    const observedTail = JSON.stringify([
      pairScope,
      pairs.userMessages.at(-1)?.id,
    ]);
    const observer = new ResizeObserver(() => {
      const nextHeight = last.getBoundingClientRect().height;
      if (nextHeight <= height) {
        height = nextHeight;
        return;
      }
      height = nextHeight;
      // Media can arrive after the message row was inserted. Keep only the
      // newest sent input visible; a manual scroll or session switch opts out.
      if (railFollowTail.current !== observedTail || userRail.current !== rail)
        return;
      railScrollAnimating.current = false;
      rail.scrollTo({
        top: Math.max(0, rail.scrollHeight - rail.clientHeight),
        behavior: "instant",
      });
    });
    observer.observe(last);
    return () => observer.disconnect();
  }, [pairScope, userMessageIds]);
  useEffect(() => () => stopRailScroll(), []);
  useEffect(() => {
    const input = composerInput.current;
    if (input) {
      input.style.height = "36px";
      input.style.height = `${Math.min(176, Math.max(36, input.scrollHeight))}px`;
    }
  }, [draft]);
  const menuRoot = useRef<HTMLDivElement>(null);
  const navButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panArmed, setPanArmed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isMovingReply, setIsMovingReply] = useState(false);
  const spaceHeld = useRef(false);
  const suppressPanClick = useRef(false);
  const dragging = useRef<{
    kind: "pan" | "reply";
    replyId?: string;
    slotHeight?: number;
    pointerId: number;
    captureTarget: HTMLElement;
    x: number;
    y: number;
    originX: number;
    originY: number;
    active: boolean;
    explicit: boolean;
  } | null>(null);
  const update = useCallback((fn: (previous: State) => State) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);
  useEffect(() => {
    onSessionChange?.(state.sessionId);
  }, [onSessionChange, state.sessionId]);
  useEffect(() => {
    if (
      !useNativeComposer ||
      mode !== "dsh" ||
      state.sessionId ||
      creatingSession.current
    )
      return;
    creatingSession.current = true;
    void adapter
      .createSession()
      .then((id) => {
        if (!mounted.current) return;
        update((current) =>
          current.sessionId ? current : { ...current, sessionId: id },
        );
        setRunError("");
      })
      .catch((error) => {
        if (mounted.current)
          setRunError(
            `无法准备 DSH 会话：${error instanceof Error ? error.message : String(error)}`,
          );
      })
      .finally(() => {
        creatingSession.current = false;
      });
  }, [
    adapter,
    mode,
    state.sessionId,
    sessionAttempt,
    update,
    useNativeComposer,
  ]);
  const cameraFrame = useRef<number | null>(null);
  const cameraRun = useRef(0);
  const stopCamera = useCallback(() => {
    cameraRun.current++;
    if (cameraFrame.current !== null)
      window.cancelAnimationFrame?.(cameraFrame.current);
    cameraFrame.current = null;
  }, []);
  const replyGeometry = (replyId: string) => {
    const reply = stateRef.current.replies.find((item) => item.id === replyId);
    const canvas = stage.current;
    const card = [
      ...(canvas?.querySelectorAll<HTMLElement>(".chat-reply") ?? []),
    ].find((node) => node.dataset.replyId === replyId);
    if (!canvas || !card)
      return reply?.position
        ? {
            x: reply.position.x,
            y: reply.position.y,
            height: reply.position.slotHeight,
          }
        : null;
    const view = canvas.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    const { x, y, zoom } = stateRef.current.viewport;
    return {
      x: reply?.position?.x ?? (bounds.left - view.left - x) / zoom,
      y: reply?.position?.y ?? (bounds.top - view.top - y) / zoom,
      height: Math.max(
        24,
        bounds.height / zoom ||
          card.offsetHeight ||
          reply?.position?.slotHeight ||
          0,
      ),
    };
  };
  const replyPosition = (replyId: string) => {
    const reply = stateRef.current.replies.find((item) => item.id === replyId);
    if (reply?.position) return reply.position;
    const geometry = replyGeometry(replyId);
    return geometry
      ? { x: geometry.x, y: geometry.y, slotHeight: geometry.height }
      : null;
  };
  useLayoutEffect(() => {
    if (!newReplyIds.current.size) return;
    const positions = new Map<
      string,
      { x: number; y: number; slotHeight: number }
    >();
    for (const [index, reply] of state.replies.entries()) {
      if (!newReplyIds.current.delete(reply.id) || reply.position || !index)
        continue;
      const previous = state.replies[index - 1];
      const anchor = positions.get(previous.id) ?? replyGeometry(previous.id);
      if (!anchor) continue;
      positions.set(reply.id, {
        x: anchor.x,
        y:
          anchor.y +
          ("height" in anchor ? anchor.height : anchor.slotHeight) +
          30,
        slotHeight: Math.max(24, replyGeometry(reply.id)?.height ?? 24),
      });
    }
    if (!positions.size) return;
    update((current) => ({
      ...current,
      replies: current.replies.map((reply) =>
        !reply.position && positions.has(reply.id)
          ? { ...reply, position: positions.get(reply.id) }
          : reply,
      ),
    }));
  }, [state.replies, update]);
  const moveReply = (replyId: string, dx: number, dy: number) => {
    const origin = replyPosition(replyId);
    if (!origin) return;
    stopCamera();
    update((current) => ({
      ...current,
      replies: current.replies.map((reply) =>
        reply.id === replyId
          ? {
              ...reply,
              position: { ...origin, x: origin.x + dx, y: origin.y + dy },
            }
          : reply,
      ),
    }));
  };
  const locatePair = (pairKey: string) => {
    // Pair identities come from host turn/request/message IDs, not row numbers.
    const reply = stateRef.current.replies.find(
      (candidate) => pairs.replyPairs.get(candidate.id) === pairKey,
    );
    const canvas = stage.current;
    if (!reply || !canvas) return;
    const card = [...canvas.querySelectorAll<HTMLElement>(".chat-reply")].find(
      (node) => node.dataset.replyId === reply.id,
    );
    if (!card) return;
    stopCamera();
    const view = canvas.getBoundingClientRect();
    const target = card.getBoundingClientRect();
    if (!view.width || !view.height || !target.width || !target.height) return;

    const left = view.left + 24;
    let right = view.right - 24;
    const top = view.top + Math.min(88, view.height * 0.12);
    let bottom = view.bottom - 24;
    const overlay = dock.current?.getBoundingClientRect();
    if (overlay && overlay.width && overlay.height) {
      if (overlay.left - left > 360) right = Math.min(right, overlay.left - 20);
      else if (overlay.top - top > 180)
        bottom = Math.min(bottom, overlay.top - 20);
    }
    const width = Math.max(80, right - left);
    const height = Math.max(100, bottom - top);
    const tall = target.height > height;
    const anchorY = tall
      ? target.top + Math.min(72, height / 3)
      : target.top + target.height / 2;
    const destinationY = tall
      ? top + Math.min(72, height / 3)
      : top + height / 2;
    const from = stateRef.current.viewport;
    const toX = from.x + left + width / 2 - (target.left + target.width / 2);
    const toY = from.y + destinationY - anchorY;
    if (
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      !window.requestAnimationFrame
    ) {
      update((current) => ({
        ...current,
        viewport: { ...current.viewport, x: toX, y: toY },
      }));
      return;
    }
    const run = cameraRun.current;
    const started = window.performance.now();
    const frame = (time: number) => {
      if (cameraRun.current !== run) return;
      const progress = Math.max(0, Math.min(1, (time - started) / 280));
      const eased = 1 - (1 - progress) ** 3;
      update((current) => ({
        ...current,
        viewport: {
          ...current.viewport,
          x: from.x + (toX - from.x) * eased,
          y: from.y + (toY - from.y) * eased,
        },
      }));
      cameraFrame.current =
        progress < 1 ? window.requestAnimationFrame(frame) : null;
    };
    cameraFrame.current = window.requestAnimationFrame(frame);
  };
  useEffect(() => {
    const added = state.replies.length > previousReplyCount.current;
    previousReplyCount.current = state.replies.length;
    if (!added || !running.current || !stage.current) return;
    const card = [
      ...stage.current.querySelectorAll<HTMLElement>(".chat-reply"),
    ].find((node) => node.dataset.replyId === running.current?.id);
    if (!card) return;
    const bounds = stage.current.getBoundingClientRect();
    const replyBounds = card.getBoundingClientRect();
    if (
      bounds.height > 0 &&
      (replyBounds.top > bounds.bottom - 160 ||
        replyBounds.bottom < bounds.top + 80)
    ) {
      stopCamera();
      update((current) => ({
        ...current,
        viewport: {
          ...current.viewport,
          y: current.viewport.y + bounds.top + 104 - replyBounds.top,
        },
      }));
    }
  }, [state.replies.length, stopCamera, update]);
  useEffect(() => {
    if (!state.sessionId || !adapter.observeSession) return;
    return adapter.observeSession(state.sessionId, (snapshot) => {
      if (!mounted.current) return;
      setHistoryNotice(snapshot.error ?? "");
      update((current) => {
        const next = reconcileConversation(
          current,
          snapshot,
          running.current?.id,
        );
        const existing = new Set(current.replies.map((reply) => reply.id));
        const lastId = current.replies.at(-1)?.id;
        const lastIndex = lastId
          ? next.replies.findIndex((reply) => reply.id === lastId)
          : -1;
        if (lastIndex >= 0)
          for (const reply of next.replies.slice(lastIndex + 1))
            if (!existing.has(reply.id)) newReplyIds.current.add(reply.id);
        return next;
      });
    });
  }, [adapter, state.sessionId, update]);
  const save = useCallback(() => {
    if (storageError) return;
    try {
      localStorage.setItem(`${KEY}:${mode}`, JSON.stringify(stateRef.current));
    } catch (error) {
      setStorageError(
        `本地保存失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [storageError, mode]);
  useEffect(() => {
    const flush = () => save();
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [save]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopCamera();
      const active = running.current;
      if (active) {
        active.controller.abort();
        if (active.sessionId)
          void adapter.cancel(active.sessionId).catch(() => {});
      }
      if (!storageErrorRef.current) {
        try {
          localStorage.setItem(
            `${KEY}:${mode}`,
            JSON.stringify(stateRef.current),
          );
        } catch {
          /* warning was visible before leaving */
        }
      }
    };
  }, [adapter, mode, stopCamera]);
  useEffect(() => {
    const timer = setTimeout(save, 180);
    return () => clearTimeout(timer);
  }, [state, save]);
  useEffect(() => {
    if (!menu) return;
    const dialog =
      menuRoot.current?.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]',
      ) ?? []),
    ];
    controls()[0]?.focus();
    const outside = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const items = controls();
        const first = items[0],
          last = items.at(-1);
        if (!first) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialog?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu(null);
      (menu === "nav" ? navButton.current : accountButton.current)?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [menu]);
  const zoom = useCallback(
    (next: number, x: number, y: number) => {
      stopCamera();
      update((current) => {
        const old = current.viewport;
        const value = clamp(next);
        return {
          ...current,
          viewport: {
            zoom: value,
            x: x - ((x - old.x) * value) / old.zoom,
            y: y - ((y - old.y) * value) / old.zoom,
          },
        };
      });
    },
    [stopCamera, update],
  );
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input,textarea,select,pre,[data-canvas-iui-root]",
        )
      )
        return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoom(
        stateRef.current.viewport.zoom * Math.exp(-event.deltaY * 0.0015),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom]);
  const finishPan = useCallback(() => {
    const drag = dragging.current;
    dragging.current = null;
    if (drag && (drag.active || drag.explicit)) suppressPanClick.current = true;
    setIsPanning(false);
    setIsMovingReply(false);
    setPanArmed(false);
    if (drag?.captureTarget.hasPointerCapture(drag.pointerId))
      drag.captureTarget.releasePointerCapture(drag.pointerId);
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      suppressPanClick.current = false;
      if (event.key === "Escape") {
        stopCamera();
        finishPan();
        spaceHeld.current = false;
        setSpacePressed(false);
        return;
      }
      if (
        (event.code !== "Space" && event.key !== " ") ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isPanControl(event)
      )
        return;
      event.preventDefault();
      spaceHeld.current = true;
      setSpacePressed(true);
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      spaceHeld.current = false;
      setSpacePressed(false);
    };
    const blur = () => {
      stopCamera();
      finishPan();
      spaceHeld.current = false;
      setSpacePressed(false);
      suppressPanClick.current = false;
    };
    const selectstart = (event: Event) => {
      const drag = dragging.current;
      if (drag && (drag.active || drag.explicit)) event.preventDefault();
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup);
    document.addEventListener("selectstart", selectstart, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", keyup);
      document.removeEventListener("selectstart", selectstart, true);
      window.removeEventListener("blur", blur);
      const drag = dragging.current;
      dragging.current = null;
      if (drag?.captureTarget.hasPointerCapture(drag.pointerId))
        drag.captureTarget.releasePointerCapture(drag.pointerId);
    };
  }, [finishPan, stopCamera]);
  const panStart = (event: ReactPointerEvent<HTMLElement>) => {
    // A captured drag may not synthesize a click. A fresh press must never
    // inherit its suppression and swallow an image or link activation.
    if (!dragging.current) suppressPanClick.current = false;
    const target = event.target as HTMLElement;
    const replyHandle = target.closest<HTMLElement>(
      "[data-canvas-reply-handle]",
    );
    if (
      dragging.current ||
      (event.button !== 0 && event.button !== 1) ||
      (!replyHandle && isPanControl(event.nativeEvent))
    )
      return;
    if (replyHandle && event.button === 0 && !spaceHeld.current) {
      const replyId =
        replyHandle.closest<HTMLElement>(".chat-reply")?.dataset.replyId;
      const position = replyId && replyPosition(replyId);
      if (!replyId || !position) return;
      stopCamera();
      event.preventDefault();
      event.stopPropagation();
      suppressPanClick.current = true;
      dragging.current = {
        kind: "reply",
        replyId,
        slotHeight: position.slotHeight,
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        x: event.clientX,
        y: event.clientY,
        originX: position.x,
        originY: position.y,
        active: false,
        explicit: true,
      };
      setPanArmed(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const handle = Boolean(target.closest("[data-canvas-pan-handle]"));
    const explicit = event.button === 1 || spaceHeld.current || handle;
    const blankRail =
      target === event.currentTarget &&
      target.classList.contains("chat-user-history");
    const background =
      blankRail || target.matches(".chat-stage,.chat-world,.chat-reply-slot");
    if (!explicit && !background) return;
    if (blankRail) event.preventDefault();
    stopCamera();
    const { x, y } = stateRef.current.viewport;
    dragging.current = {
      kind: "pan",
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      originX: x,
      originY: y,
      active: false,
      explicit,
    };
    if (explicit) {
      event.preventDefault();
      event.stopPropagation();
      setPanArmed(true);
      suppressPanClick.current = true;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const panMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      drag.active = true;
      if (drag.kind === "reply") setIsMovingReply(true);
      else setIsPanning(true);
      suppressPanClick.current = true;
      // A background press may have begun native selection before the threshold.
      window.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    event.stopPropagation();
    if (drag.kind === "reply") {
      const zoom = stateRef.current.viewport.zoom;
      update((current) => ({
        ...current,
        replies: current.replies.map((reply) =>
          reply.id === drag.replyId
            ? {
                ...reply,
                position: {
                  x: drag.originX + dx / zoom,
                  y: drag.originY + dy / zoom,
                  slotHeight: drag.slotHeight ?? 24,
                },
              }
            : reply,
        ),
      }));
    } else
      update((current) => ({
        ...current,
        viewport: {
          ...current.viewport,
          x: drag.originX + dx,
          y: drag.originY + dy,
        },
      }));
  };
  const panEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current?.pointerId === event.pointerId) finishPan();
  };
  const suppressPanActivation = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressPanClick.current) return;
    suppressPanClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const send = async (
    input = draft,
    clearDraft = true,
  ): Promise<{ ok: boolean; message?: string }> => {
    const prompt = input.trim();
    if (!prompt) return { ok: false, message: "请输入内容" };
    if (running.current)
      return { ok: false, message: "当前会话正在生成，请等待或停止后重试" };
    if (
      stateRef.current.sessionId &&
      adapter.isSessionBusy?.(stateRef.current.sessionId)
    )
      return { ok: false, message: "当前会话正在生成，请等待或停止后重试" };
    const id = crypto.randomUUID();
    const active: ActiveRun = {
      id,
      controller: new AbortController(),
      sessionId: stateRef.current.sessionId,
    };
    running.current = active;
    setBusy(true);
    setRunError("");
    if (clearDraft) setDraft("");
    newReplyIds.current.add(id);
    update((current) => ({
      ...current,
      replies: [
        ...current.replies,
        {
          id,
          prompt,
          localPrompt: prompt,
          promptSource: "user",
          body: "",
          status: "running",
        },
      ],
    }));
    try {
      const sessionId = active.sessionId ?? (await adapter.createSession());
      active.sessionId = sessionId;
      if (active.controller.signal.aborted || !mounted.current)
        return { ok: false, message: "已停止" };
      update((current) => ({ ...current, sessionId }));
      // Preserve the exact session before any prompt can reach the host.
      save();
      await adapter.run({
        sessionId,
        prompt,
        context: [],
        signal: active.controller.signal,
        onText: (body, meta) => {
          if (
            running.current !== active ||
            active.controller.signal.aborted ||
            !mounted.current
          )
            return;
          update((current) => ({
            ...current,
            replies: current.replies.map((reply) =>
              reply.id === id
                ? {
                    ...reply,
                    body,
                    reasoning: meta?.reasoning ?? reply.reasoning,
                    hostTurnId: meta?.turnId ?? reply.hostTurnId,
                    requestId: meta?.requestId ?? reply.requestId,
                    timestamp:
                      meta?.timestamp !== undefined &&
                      (meta.durable || !reply.durableTime)
                        ? meta.timestamp
                        : reply.timestamp,
                    durableTime: Boolean(meta?.durable),
                  }
                : reply,
            ),
          }));
        },
      });
      if (
        running.current === active &&
        !active.controller.signal.aborted &&
        mounted.current
      ) {
        update((current) => ({
          ...current,
          replies: current.replies.map((reply) =>
            reply.id === id ? { ...reply, status: "done" } : reply,
          ),
        }));
      }
      return { ok: true };
    } catch (error) {
      if (!mounted.current) return { ok: false, message: "已离开画布" };
      const message = error instanceof Error ? error.message : String(error);
      if (active.controller.signal.aborted) {
        if (mode === "dsh") {
          update((current) => ({
            ...current,
            replies: current.replies.map((reply) =>
              reply.id === id
                ? { ...reply, status: "stopped", error: message }
                : reply,
            ),
          }));
          if (!running.current || running.current === active)
            setRunError(message);
        }
        return { ok: false, message };
      }
      update((current) => ({
        ...current,
        replies: current.replies.map((reply) =>
          reply.id === id
            ? { ...reply, status: "error", error: message }
            : reply,
        ),
      }));
      setRunError(message);
      return { ok: false, message };
    } finally {
      if (running.current === active && !active.stopping)
        running.current = null;
      if (mounted.current && !active.stopping) setBusy(false);
    }
  };
  const onIuiAction: IuiActionHandler = (action) => {
    const key = `${action.messageId}:${action.id}`;
    const previous = iuiActions.current.get(key);
    if (previous) return previous;
    const pending =
      action.kind === "issueNewTurn"
        ? send(action.payload, false)
        : (async () => {
            try {
              if (!navigator.clipboard?.writeText)
                return {
                  ok: false,
                  message: "当前环境不支持剪贴板，请手动复制",
                };
              await navigator.clipboard.writeText(action.payload);
              return { ok: true };
            } catch (error) {
              return {
                ok: false,
                message: error instanceof Error ? error.message : String(error),
              };
            }
          })();
    iuiActions.current.set(key, pending);
    return pending;
  };
  const stop = async () => {
    const active = running.current;
    if (!active) return;
    active.stopping = true;
    active.controller.abort();
    update((current) => ({
      ...current,
      replies: current.replies.map((reply) =>
        reply.id === active.id ? { ...reply, status: "stopped" } : reply,
      ),
    }));
    try {
      if (active.sessionId) await adapter.cancel(active.sessionId);
    } catch (error) {
      setRunError(
        `停止未确认：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (running.current === active) running.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const v = state.viewport;
  return (
    <div
      className="canvas-app chat-canvas"
      data-testid="chat-canvas"
      onPointerMoveCapture={(event) => {
        const press = userPress.current;
        if (
          press?.pointerId === event.pointerId &&
          Math.hypot(event.clientX - press.x, event.clientY - press.y) >
            PAN_THRESHOLD
        )
          press.moved = true;
      }}
      onPointerCancelCapture={() => {
        userPress.current = null;
      }}
      onPointerDownCapture={(event) => {
        keyboardPairing.current = false;
        setFocusedPair(null);
        if (!(event.target as HTMLElement).closest(".chat-user-message"))
          userPress.current = null;
        if (!dragging.current) suppressPanClick.current = false;
      }}
      onKeyDownCapture={(event) => {
        keyboardPairing.current = true;
        const source = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-pair-source]",
        );
        if (source)
          setFocusedPair({
            scope: pairScope,
            source: source.dataset.pairSource as PairTarget["source"],
            id: source.dataset.pairId!,
          });
      }}
      onClickCapture={suppressPanActivation}
      onAuxClickCapture={suppressPanActivation}
    >
      <div className="chat-topbar" ref={menuRoot} onClickCapture={clearPairing}>
        <div className="chat-brand" aria-label="DeepSeek Harness">
          {NativeBrand ?? <Brand />}
        </div>
        <button
          ref={navButton}
          className="chat-float-button"
          aria-label="导航与工作区"
          aria-haspopup="dialog"
          aria-expanded={menu === "nav"}
          onClick={() => setMenu(menu === "nav" ? null : "nav")}
        >
          {navIcon ?? <Icon name="grid" size={18} />}
        </button>
        <button
          ref={accountButton}
          className="chat-float-button chat-avatar"
          aria-label="账户与版本"
          aria-haspopup="dialog"
          aria-expanded={menu === "account"}
          onClick={() => setMenu(menu === "account" ? null : "account")}
        >
          {avatar ?? <Icon name="user" size={18} />}
        </button>
        {mode === "mock" && (
          <span className="chat-mode mock" title="本地模拟，不发送模型请求">
            MOCK
          </span>
        )}
        {menu === "nav" && (
          <div className="chat-menu" role="dialog" aria-label="导航与工作区">
            <div className="chat-menu-title">导航</div>
            {onNewSession && (
              <button onClick={onNewSession}>
                <Icon name="plus" size={15} />
                新建 DSH 会话
              </button>
            )}
            {onExit && (
              <button onClick={onExit} aria-pressed="true">
                <Icon name="grid" size={15} />
                画布模式 <span className="chat-switch-on">开启</span>
              </button>
            )}
            {onPlugins && (
              <button onClick={onPlugins}>
                <Icon name="artifact" size={15} />
                插件
              </button>
            )}
            {(onCreateWorkspace ||
              hostWorkspaces.length > 0 ||
              hostSessions.length > 0) && (
              <>
                <div className="chat-menu-title divider">工作区</div>
                <div className="chat-nav-tools">
                  <input
                    aria-label="搜索会话"
                    placeholder="搜索会话"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {onCreateWorkspace && (
                    <button
                      aria-label="添加工作区"
                      title="添加工作区"
                      onClick={() =>
                        void onCreateWorkspace().catch((error) =>
                          setNavError(
                            error instanceof Error
                              ? error.message
                              : String(error),
                          ),
                        )
                      }
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  )}
                </div>
                <div className="chat-session-list">
                  {hostWorkspaces.map((workspace) => {
                    const sessions = workspace.sessionIds
                      .map((id) =>
                        hostSessions.find((session) => session.id === id),
                      )
                      .filter(
                        (session): session is { id: string; title: string } =>
                          Boolean(session),
                      );
                    const matching = sessions.filter((session) =>
                      session.title
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase()),
                    );
                    if (
                      search &&
                      !matching.length &&
                      !workspace.title
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase())
                    )
                      return null;
                    return (
                      <div className="chat-workspace-group" key={workspace.id}>
                        <button
                          onClick={() =>
                            void onOpenWorkspace?.(workspace.id).catch(
                              (error) =>
                                setNavError(
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                                ),
                            )
                          }
                        >
                          <Icon name="home" size={15} />
                          <span>{workspace.title}</span>
                        </button>
                        {(search ? matching : sessions).map((session) => (
                          <button
                            className="chat-session-row"
                            key={session.id}
                            onClick={() => onOpenSession?.(session.id)}
                          >
                            <span>{session.title}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                  {hostSessions
                    .filter(
                      (session) =>
                        !hostWorkspaces.some((workspace) =>
                          workspace.sessionIds.includes(session.id),
                        ) &&
                        session.title
                          .toLocaleLowerCase()
                          .includes(search.toLocaleLowerCase()),
                    )
                    .map((session) => (
                      <button
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
            {navError && (
              <p className="chat-nav-error" role="alert">
                {navError}
              </p>
            )}
            {onLegacy && (
              <>
                <div className="chat-menu-title divider">旧画布</div>
                <button onClick={onLegacy}>打开节点画布</button>
              </>
            )}
            {state.legacyReplies?.length ? (
              <button
                onClick={() => {
                  const blob = new Blob(
                    [JSON.stringify(state.legacyReplies, null, 2)],
                    { type: "application/json" },
                  );
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "canvas-before-history-repair.json";
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                导出升级前原文（{state.legacyReplies.length} 条）
              </button>
            ) : null}
            <div className="chat-menu-title divider">视图</div>
            <button
              aria-pressed={iuiEnabled}
              onClick={() => setIuiEnabled((value) => !value)}
            >
              <Icon name="artifact" size={15} />
              画布 IUI 渲染{" "}
              <span className="chat-switch-on">
                {iuiEnabled ? "开启" : "关闭"}
              </span>
            </button>
            <div className="chat-zoom">
              <button
                aria-label="缩小"
                onClick={() =>
                  zoom(
                    v.zoom / 1.2,
                    stage.current?.clientWidth ?? 600,
                    stage.current?.clientHeight ?? 400,
                  )
                }
              >
                <Icon name="minus" size={15} />
              </button>
              <span>{Math.round(v.zoom * 100)}%</span>
              <button
                aria-label="放大"
                onClick={() =>
                  zoom(
                    v.zoom * 1.2,
                    stage.current?.clientWidth ?? 600,
                    stage.current?.clientHeight ?? 400,
                  )
                }
              >
                <Icon name="plus" size={15} />
              </button>
            </div>
            <button
              onClick={() => {
                stopCamera();
                update((current) => ({
                  ...current,
                  viewport: { x: 64, y: 104, zoom: 1 },
                }));
              }}
            >
              <Icon name="fit" size={15} />
              重置视图
            </button>
          </div>
        )}
        {menu === "account" && (
          <div
            className="chat-menu account"
            role="dialog"
            aria-label="账户与版本"
          >
            <div className="chat-menu-title">账户</div>
            {accountActions ? (
              <>
                <button
                  onClick={accountActions.settings.run}
                  title={accountActions.settings.description}
                >
                  {accountActions.settings.label}
                </button>
                <button
                  onClick={accountActions.version.run}
                  title={accountActions.version.description}
                >
                  {accountActions.version.label}
                </button>
                <p className="chat-menu-note">
                  账户信息和应用版本由 DSH 原生设置管理。
                </p>
              </>
            ) : (
              <p className="chat-menu-note">
                MOCK 演示没有账户，不会读取或配置任何密钥。
              </p>
            )}
            <div className="chat-menu-title divider">
              Canvas 0.2.4-experimental.1
            </div>
          </div>
        )}
      </div>
      <div
        ref={stage}
        className={`chat-stage${spacePressed ? " is-chat-pan-ready" : ""}${panArmed ? " is-chat-pan-armed" : ""}${isPanning ? " is-chat-panning" : ""}${isMovingReply ? " is-chat-moving-reply" : ""}`}
        aria-label="可平移缩放的回复画布"
        onPointerDownCapture={panStart}
        onPointerMove={panMove}
        onPointerUp={panEnd}
        onPointerCancel={panEnd}
        onLostPointerCapture={panEnd}
        onDragStartCapture={(event) => {
          if (dragging.current) event.preventDefault();
        }}
        style={
          {
            "--chat-grid-size": `${24 * v.zoom}px`,
            "--chat-grid-x": `${v.x}px`,
            "--chat-grid-y": `${v.y}px`,
          } as CSSProperties
        }
      >
        <div
          className="chat-world"
          style={{
            transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`,
          }}
        >
          {state.replies.map((reply, index) => {
            const replyTime = formatReplyTime(reply.timestamp, calendarNow);
            return (
              <div
                className="chat-reply-slot"
                key={reply.id}
                style={
                  reply.position
                    ? { height: reply.position.slotHeight }
                    : undefined
                }
              >
                <article
                  className="chat-reply"
                  data-positioned={reply.position ? "true" : undefined}
                  data-testid={`chat-reply-${index}`}
                  data-reply-id={reply.id}
                  {...pairingProps(
                    "reply",
                    reply.id,
                    pairs.replyPairs.get(reply.id),
                  )}
                  style={
                    reply.position
                      ? { left: reply.position.x, top: reply.position.y }
                      : undefined
                  }
                  tabIndex={0}
                  aria-label={replyTime ? `回复 · ${replyTime.full}` : "回复"}
                >
                  <div
                    className="chat-reply-meta"
                    title="使用回复手柄移动；按住空格或使用鼠标中键可平移画布"
                  >
                    <button
                      type="button"
                      className="chat-pan-handle"
                      data-canvas-reply-handle
                      aria-label="移动这条回复"
                      title="拖动移动这条回复；方向键微调，Shift + 方向键加速"
                      onKeyDown={(event) => {
                        const direction = {
                          ArrowLeft: [-1, 0],
                          ArrowRight: [1, 0],
                          ArrowUp: [0, -1],
                          ArrowDown: [0, 1],
                        }[event.key];
                        if (!direction) return;
                        event.preventDefault();
                        const step = event.shiftKey ? 80 : 24;
                        moveReply(
                          reply.id,
                          (direction[0] * step) / v.zoom,
                          (direction[1] * step) / v.zoom,
                        );
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <circle cx="4" cy="2" r="1" />
                        <circle cx="8" cy="2" r="1" />
                        <circle cx="4" cy="6" r="1" />
                        <circle cx="8" cy="6" r="1" />
                        <circle cx="4" cy="10" r="1" />
                        <circle cx="8" cy="10" r="1" />
                      </svg>
                    </button>
                    {replyTime && (
                      <time
                        dateTime={new Date(reply.timestamp!).toISOString()}
                        title={replyTime.full}
                      >
                        {replyTime.short}
                      </time>
                    )}
                    <span className={`chat-reply-status ${reply.status}`}>
                      {reply.status === "running"
                        ? "生成中"
                        : reply.status === "done"
                          ? "完成"
                          : reply.status === "stopped"
                            ? mode === "dsh"
                              ? "已中断观察"
                              : "已停止"
                            : "失败"}
                    </span>
                  </div>
                  <div className="chat-reply-surface">
                    {reply.status === "running" && (
                      <ReasoningView text={reply.reasoning ?? ""} running />
                    )}
                    {(reply.body ||
                      (reply.status !== "running" && reply.reasoning)) && (
                      <ReplyContent
                        text={reply.body}
                        messageId={reply.id}
                        reasoning={reply.reasoning}
                        sessionId={state.sessionId}
                        resourceScopeKey={JSON.stringify([
                          state.sessionId ?? "",
                          hostSessions.find(
                            (session) => session.id === state.sessionId,
                          )?.cwd ?? "",
                        ])}
                        streaming={reply.status === "running"}
                        iuiEnabled={iuiEnabled}
                        renderMarkdown={renderMarkdown}
                        renderImagePreview={renderImagePreview}
                        onIuiAction={onIuiAction}
                        onIuiResource={
                          resolveImage
                            ? (request) =>
                                resolveImage(request, state.sessionId)
                            : undefined
                        }
                      />
                    )}
                    {reply.status === "running" && (
                      <div
                        className="chat-stream-indicator"
                        aria-label="正在流式输出"
                      />
                    )}
                    {reply.error && (
                      <p className="chat-reply-error" role="alert">
                        {reply.error}
                      </p>
                    )}
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>
      <div
        className={`chat-dock${useNativeComposer ? " is-native" : ""}`}
        ref={dock}
      >
        {state.replies.length > 0 && (
          <div className="chat-user-history-frame">
            <div className="chat-user-history-glass" aria-hidden="true" />
            <aside
              ref={userRail}
              className="chat-user-history"
              aria-label="已发送的用户消息"
              onWheelCapture={stopRailScroll}
              onTouchStartCapture={stopRailScroll}
              onKeyDownCapture={(event) => {
                if (
                  [
                    "ArrowUp",
                    "ArrowDown",
                    "PageUp",
                    "PageDown",
                    "Home",
                    "End",
                  ].includes(event.key)
                )
                  stopRailScroll();
              }}
              onPointerDownCapture={(event) => {
                stopRailScroll();
                panStart(event);
              }}
              onPointerMove={panMove}
              onPointerUp={panEnd}
              onPointerCancel={panEnd}
              onLostPointerCapture={panEnd}
            >
              {userGroups.map((group) => (
                <div
                  className="chat-user-message-group"
                  key={JSON.stringify([
                    pairScope,
                    group.messages[0].message.id,
                  ])}
                  data-grouped={group.messages.length > 1 ? "true" : undefined}
                  aria-label={
                    group.messages.length > 1
                      ? "对应同一回复的多条消息"
                      : undefined
                  }
                >
                  {group.messages.map(({ message }) => {
                    const messageTime = formatReplyTime(
                      message.timestamp,
                      calendarNow,
                    );
                    return (
                      <div
                        className="chat-user-message"
                        key={JSON.stringify([pairScope, message.id])}
                        data-reply-id={message.replyId}
                        data-user-message-id={message.messageId}
                        tabIndex={0}
                        role="button"
                        aria-label={`定位到对应回复：${message.text.slice(0, 80) || `附件 ${message.attachments?.length ?? 0} 个`}${messageTime ? `，发送于 ${messageTime.full}` : ""}`}
                        {...pairingProps("user", message.id, message.pairKey)}
                        onPointerDown={(event) => {
                          if (event.button === 0)
                            userPress.current = {
                              pointerId: event.pointerId,
                              x: event.clientX,
                              y: event.clientY,
                              moved: false,
                            };
                        }}
                        onWheel={(event) => event.stopPropagation()}
                        onClick={() => {
                          const moved = userPress.current?.moved;
                          userPress.current = null;
                          if (
                            moved ||
                            window.getSelection()?.isCollapsed === false
                          )
                            return;
                          locatePair(message.pairKey);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ")
                            return;
                          event.preventDefault();
                          locatePair(message.pairKey);
                        }}
                      >
                        <div className="chat-user-message-stack">
                          <UserMessageMedia
                            attachments={message.attachments}
                            sessionId={state.sessionId}
                            loadImage={loadUserImage}
                            renderPreview={renderImagePreview}
                            renderFileIcon={userChrome?.renderFileIcon}
                            formatFileMeta={userChrome?.formatFileMeta}
                          />
                          {message.text && (
                            <div className="chat-user-message-bubble">
                              {message.text}
                            </div>
                          )}
                        </div>
                        <UserMessageActions
                          text={message.text}
                          time={messageTime}
                          copyText={userChrome?.copyText}
                          renderCopyIcon={userChrome?.renderCopyIcon}
                          wrapCopyButton={userChrome?.wrapCopyButton}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </aside>
          </div>
        )}
        {useNativeComposer ? (
          <div className="chat-native-composer" aria-label="画布输入">
            {nativeComposer ?? (
              <div className="chat-native-composer-wait" role="status">
                {runError || "正在准备 DSH 输入…"}
                {runError && (
                  <button
                    type="button"
                    onClick={() => setSessionAttempt((attempt) => attempt + 1)}
                  >
                    重试
                  </button>
                )}
              </div>
            )}
            {storageError && (
              <p className="chat-composer-error" role="alert">
                {storageError}
              </p>
            )}
            {historyNotice && (
              <p className="chat-composer-notice" role="status">
                {historyNotice}
              </p>
            )}
          </div>
        ) : (
          <div className="chat-composer" aria-label="画布输入">
            <textarea
              ref={composerInput}
              rows={1}
              aria-label="向 Agent 输入"
              placeholder="向 Agent 输入…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  !event.nativeEvent.isComposing &&
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="chat-composer-footer">
              <span>
                {mode === "mock"
                  ? "不发送模型请求"
                  : state.sessionId
                    ? ""
                    : "首次发送将创建 DSH 会话"}
              </span>
              {busy ? (
                <button
                  className="chat-stop"
                  aria-label="停止生成"
                  title="停止生成"
                  onClick={() => void stop()}
                >
                  <Icon name="stop" size={16} />
                </button>
              ) : (
                <button
                  className="chat-send"
                  aria-label="发送消息"
                  title="发送 · ⌘/Ctrl + Enter"
                  disabled={!draft.trim()}
                  onClick={() => void send()}
                >
                  {sendIcon ?? <Icon name="arrow-up" size={18} />}
                </button>
              )}
            </div>
            {runError && (
              <p className="chat-composer-error" role="alert">
                {runError}
              </p>
            )}
            {historyNotice && (
              <p className="chat-composer-notice" role="status">
                {historyNotice}
              </p>
            )}
            {storageError && (
              <p className="chat-composer-error" role="alert">
                {storageError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
