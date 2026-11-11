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
import { useTouchViewport } from "./use-touch-viewport";
import { arrangeReplies, repairReplyGrowth } from "./reply-layout";
import { Brand } from "./brand";
import { CanvasSidebar, type SidebarIcons } from "./CanvasSidebar";
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
const sessionKey = (mode: "mock" | "dsh", id: string) =>
  `${KEY}:${mode}:session:${encodeURIComponent(id)}`;
type ActiveRun = {
  id: string;
  controller: AbortController;
  sessionId?: string;
  stopping?: boolean;
};
const fresh = (sessionId?: string): State => ({
  version: 1,
  ...(sessionId ? { sessionId } : {}),
  viewport: { x: 64, y: 104, zoom: 1 },
  replies: [],
});
function restore(
  mode: "mock" | "dsh",
  sessionId?: string,
): { state: State; error: string } {
  try {
    const raw = localStorage.getItem(
      sessionId ? sessionKey(mode, sessionId) : `${KEY}:${mode}`,
    );
    if (!raw) return { state: fresh(sessionId), error: "" };
    const value = JSON.parse(raw) as State;
    if (
      value.version !== 1 ||
      (sessionId !== undefined && value.sessionId !== sessionId) ||
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
          pinned: reply.pinned === true || undefined,
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
      state: fresh(sessionId),
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
  externalComposer = false,
  onNativeTurn,
  onSessionChange,
  requestedSession,
  onRequestHandled,
  accountActions,
  sidebarIcons,
  onSchedules,
}: {
  adapter: AgentAdapter;
  mode: "mock" | "dsh";
  onExit?: () => void;
  hostSessions?: { id: string; title: string; cwd?: string }[];
  hostWorkspaces?: { id: string; title: string; sessionIds: string[] }[];
  onOpenSession?: (id: string) => void;
  onNewSession?: (workspaceId?: string) => Promise<string>;
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
  /** The native Conversation view keeps its existing composer mounted. */
  externalComposer?: boolean;
  onNativeTurn?: (sessionId: string, text: string) => Promise<void>;
  onSessionChange?: (sessionId: string | undefined) => void;
  requestedSession?: { sessionId: string; token: number } | null;
  onRequestHandled?: () => void;
  accountActions?: {
    settings: { label: string; description: string; run: () => void };
    version: { label: string; description: string; run: () => void };
  };
  sidebarIcons?: SidebarIcons;
  onSchedules?: () => void;
}) {
  const [initial] = useState(() => restore(mode, requestedSession?.sessionId));
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
  const [navError, setNavError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const creatingSession = useRef(false);
  const nativeTurnPending = useRef(false);
  const creatingNewSession = useRef(false);
  const [newSessionPending, setNewSessionPending] = useState(false);
  const sessionStates = useRef(new Map<string, State>());
  const sessionDrafts = useRef(new Map<string, string>());
  const handledRequest = useRef(0);
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
  const [railLocate, setRailLocate] = useState<{
    scope: string;
    replyId: string;
  } | null>(null);
  const [railLocateRevision, setRailLocateRevision] = useState(0);
  const [railLocateStatus, setRailLocateStatus] = useState({
    text: "",
    quiet: true,
  });

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
  const measuredReplyHeights = useRef(new Map<string, number>());
  const flushReplyResize = useRef<(() => void) | null>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const iuiActions = useRef(new Map<string, ReturnType<IuiActionHandler>>());
  const userMessageIds = JSON.stringify(
    pairs.userMessages.map((message) => message.id),
  );
  const replyIds = JSON.stringify(state.replies.map((reply) => reply.id));
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
  useLayoutEffect(() => {
    if (!railLocate) return;
    if (railLocate.scope !== pairScope) {
      setRailLocate(null);
      setRailLocateStatus({ text: "", quiet: true });
      return;
    }
    const pairKey = pairs.replyPairs.get(railLocate.replyId);
    const message =
      pairs.userMessages.find((item) => item.replyId === railLocate.replyId) ??
      pairs.userMessages.find((item) => pairKey && item.pairKey === pairKey);
    const rail = userRail.current;
    const row =
      message &&
      [
        ...(rail?.querySelectorAll<HTMLElement>("[data-user-message-id]") ??
          []),
      ].find((node) => node.dataset.userMessageId === message.messageId);
    if (!row || !rail) {
      setRailLocateStatus({
        text: "对应消息尚未加载，加载后会自动定位。",
        quiet: false,
      });
      return;
    }
    if (
      !rail.clientHeight ||
      !rail.clientWidth ||
      rail.getClientRects().length === 0
    ) {
      setRailLocateStatus({
        text: "消息列表空间不足，请收起输入框或增大窗口；恢复显示后会自动定位。",
        quiet: false,
      });
      return;
    }
    stopRailScroll();
    const bounds = rail.getBoundingClientRect();
    const target = row.getBoundingClientRect();
    const top = Math.max(
      0,
      rail.scrollTop +
        target.top -
        bounds.top -
        Math.max(0, (rail.clientHeight - target.height) / 2),
    );
    railScrollAnimating.current = true;
    rail.scrollTo({
      top,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    row.focus({ preventScroll: true });
    setFocusedPair({ scope: pairScope, source: "user", id: message!.id });
    setRailLocateStatus({ text: "已定位到对应消息。", quiet: true });
    setRailLocate(null);
  }, [railLocate, railLocateRevision, pairScope, pairs]);
  useEffect(() => {
    const rail = userRail.current;
    if (!railLocate || !rail || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setRailLocateRevision((value) => value + 1),
    );
    observer.observe(rail);
    return () => observer.disconnect();
  }, [railLocate]);

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
  useLayoutEffect(() => {
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
  const layoutAnimations = useRef(new Set<Animation>());
  const pendingLayoutRects = useRef<Map<string, DOMRect> | null>(null);
  const [layoutRequest, setLayoutRequest] = useState(0);
  const cancelLayoutMotion = useCallback(() => {
    pendingLayoutRects.current = null;
    for (const animation of layoutAnimations.current) animation.cancel();
    layoutAnimations.current.clear();
  }, []);
  useLayoutEffect(() => {
    const previous = pendingLayoutRects.current;
    pendingLayoutRects.current = null;
    if (
      !previous ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const zoom = stateRef.current.viewport.zoom;
    for (const card of stage.current?.querySelectorAll<HTMLElement>(
      ".chat-reply",
    ) ?? []) {
      const before = previous.get(card.dataset.replyId!);
      if (!before || typeof card.animate !== "function") continue;
      const after = card.getBoundingClientRect();
      const dx = (before.left - after.left) / zoom;
      const dy = (before.top - after.top) / zoom;
      if (Math.hypot(dx, dy) < 0.5) continue;
      const animation = card.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 320, easing: "cubic-bezier(0.2, 0.75, 0.25, 1)" },
      );
      layoutAnimations.current.add(animation);
      const settle = () => layoutAnimations.current.delete(animation);
      animation.onfinish = settle;
      animation.oncancel = settle;
    }
  }, [layoutRequest]);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const change = () => {
      if (media?.matches) cancelLayoutMotion();
    };
    media?.addEventListener?.("change", change);
    return () => {
      media?.removeEventListener?.("change", change);
      cancelLayoutMotion();
    };
  }, [cancelLayoutMotion]);
  const cameraFrame = useRef<number | null>(null);
  const cameraRun = useRef(0);
  const stopCamera = useCallback(() => {
    cancelLayoutMotion();
    cameraRun.current++;
    if (cameraFrame.current !== null)
      window.cancelAnimationFrame?.(cameraFrame.current);
    cameraFrame.current = null;
  }, [cancelLayoutMotion]);
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
            width: 600,
          }
        : null;
    const view = canvas.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    const { x, y, zoom } = stateRef.current.viewport;
    return {
      x: reply?.position?.x ?? (bounds.left - view.left - x) / zoom,
      y: reply?.position?.y ?? (bounds.top - view.top - y) / zoom,
      width: card.offsetWidth || bounds.width / zoom || 600,
      height: Math.max(
        24,
        card.offsetHeight ||
          bounds.height / zoom ||
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
  const togglePin = (replyId: string) => {
    const canvas = stage.current;
    const card = [
      ...(canvas?.querySelectorAll<HTMLElement>(".chat-reply") ?? []),
    ].find((node) => node.dataset.replyId === replyId);
    const geometry = replyGeometry(replyId);
    if (!canvas || !card || !geometry) return;
    // Pin the visible presentation, including an in-flight layout animation.
    const rect = card.getBoundingClientRect();
    const view = canvas.getBoundingClientRect();
    const camera = stateRef.current.viewport;
    const moving = card
      .getAnimations?.()
      .some((animation) => layoutAnimations.current.has(animation));
    const position = {
      x: moving ? (rect.left - view.left - camera.x) / camera.zoom : geometry.x,
      y: moving ? (rect.top - view.top - camera.y) / camera.zoom : geometry.y,
      slotHeight: geometry.height,
      kind: "manual" as const,
    };
    stopCamera();
    update((current) => ({
      ...current,
      replies: current.replies.map((reply) =>
        reply.id === replyId
          ? {
              ...reply,
              pinned: reply.pinned ? undefined : true,
              position,
            }
          : reply,
      ),
    }));
  };
  const layoutReplies = (
    current: State,
    area: { x: number; y: number; width: number },
  ) => {
    const cards = current.replies.flatMap((reply) => {
      const geometry = replyGeometry(reply.id);
      return geometry
        ? [
            {
              id: reply.id,
              ...geometry,
              fixed: reply.pinned === true,
            },
          ]
        : [];
    });
    const positions = new Map(
      arrangeReplies(cards, area).map((card) => [card.id, card]),
    );
    let changed = false;
    const replies = current.replies.map((reply) => {
      const card = positions.get(reply.id);
      if (!card) return reply;
      if (card.fixed) {
        if (
          reply.pinned &&
          reply.position &&
          Math.abs(reply.position.slotHeight - card.height) > 1
        ) {
          changed = true;
          return {
            ...reply,
            position: { ...reply.position, slotHeight: card.height },
          };
        }
        return reply;
      }
      const old = reply.position;
      if (
        old?.kind === "viewport" &&
        Math.abs(old.x - card.x) < 0.5 &&
        Math.abs(old.y - card.y) < 0.5 &&
        Math.abs(old.slotHeight - card.height) < 0.5
      )
        return reply;
      changed = true;
      return {
        ...reply,
        position: {
          x: card.x,
          y: card.y,
          slotHeight: card.height,
          kind: "viewport" as const,
        },
      };
    });
    return changed ? { ...current, replies } : current;
  };
  const arrangeViewport = () => {
    const canvas = stage.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const { x, y, zoom } = stateRef.current.viewport;
    // Floating messages and input may cover cards; packing uses the full stage.
    const width = Math.max(80, bounds.width - 48) / zoom;
    // Measure the current presentation before cancelling an earlier animation;
    // repeated clicks then continue from the visible position without jumping.
    const previous = new Map<string, DOMRect>();
    const pinned = new Set(
      stateRef.current.replies
        .filter((reply) => reply.pinned === true)
        .map((reply) => reply.id),
    );
    for (const card of canvas.querySelectorAll<HTMLElement>(".chat-reply")) {
      if (!pinned.has(card.dataset.replyId!))
        previous.set(card.dataset.replyId!, card.getBoundingClientRect());
    }
    stopCamera();
    pendingLayoutRects.current = previous;
    setLayoutRequest((value) => value + 1);
    update((current) =>
      layoutReplies(current, {
        x: (24 - x) / zoom,
        y: (88 - y) / zoom,
        width,
      }),
    );
    setMenu(null);
  };
  useLayoutEffect(() => {
    if (!newReplyIds.current.size) return;
    const positions = new Map<
      string,
      NonNullable<State["replies"][number]["position"]>
    >();
    for (const [index, reply] of state.replies.entries()) {
      if (!newReplyIds.current.delete(reply.id) || reply.position || !index)
        continue;
      const previous = state.replies[index - 1];
      const anchor = positions.get(previous.id) ?? replyGeometry(previous.id);
      if (!anchor) continue;
      const anchorHeight =
        "height" in anchor ? anchor.height : anchor.slotHeight;
      const size = replyGeometry(reply.id);
      const obstacles = state.replies.flatMap((candidate) => {
        if (candidate.id === reply.id || newReplyIds.current.has(candidate.id))
          return [];
        const rect = replyGeometry(candidate.id),
          placed = positions.get(candidate.id);
        return rect
          ? [
              {
                id: candidate.id,
                ...rect,
                ...(placed
                  ? { x: placed.x, y: placed.y, height: placed.slotHeight }
                  : {}),
                fixed: true,
              },
            ]
          : [];
      });
      const placed = arrangeReplies([
        ...obstacles,
        {
          id: reply.id,
          x: anchor.x,
          y: anchor.y + anchorHeight + 30,
          width: size?.width ?? 600,
          height: Math.max(24, size?.height ?? 24),
          fixed: false,
        },
      ]).at(-1)!;
      positions.set(reply.id, {
        x: placed.x,
        y: placed.y,
        slotHeight: placed.height,
        kind: state.replies.some((item) => item.position?.kind === "viewport")
          ? "viewport"
          : "auto",
        anchorHeight,
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
  useLayoutEffect(() => {
    const canvas = stage.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const sessionId = state.sessionId;
    let disposed = false;
    measuredReplyHeights.current.clear();
    const queued = new Map<HTMLElement, ResizeObserverEntry>();
    const process = () => {
      if (
        disposed ||
        stateRef.current.sessionId !== sessionId ||
        !queued.size ||
        dragging.current
      )
        return;
      const current = stateRef.current;
      const entries = [...queued.values()];
      queued.clear();
      const nodes = [...canvas.querySelectorAll<HTMLElement>(".chat-reply")];
      const geometry = new Map(
        nodes.flatMap((node) => {
          const id = node.dataset.replyId;
          const value = id && replyGeometry(id);
          return id && value ? [[id, value] as const] : [];
        }),
      );
      const inferredAuto = new Map<number, number>();
      for (let index = 1; index < current.replies.length; index++) {
        const previous = current.replies[index - 1],
          reply = current.replies[index];
        if (!reply.position || reply.position.kind || reply.pinned) continue;
        const anchor = geometry.get(previous.id);
        if (!anchor || Math.abs(reply.position.x - anchor.x) > 1) continue;
        const oldHeight = previous.position?.slotHeight;
        const gapHeight = reply.position.y - anchor.y - 30;
        if (oldHeight !== undefined && Math.abs(gapHeight - oldHeight) <= 1)
          inferredAuto.set(index, oldHeight);
        else if (
          oldHeight === undefined &&
          gapHeight >= 24 &&
          anchor.height - gapHeight >= 80
        )
          inferredAuto.set(index, gapHeight);
      }
      const measured = new Map<string, number>();
      const grown = new Set<string>();
      for (const entry of entries) {
        const node = entry.target as HTMLElement;
        const id = node.dataset.replyId;
        const index = current.replies.findIndex((reply) => reply.id === id);
        if (!id || index < 0 || !node.isConnected || !canvas.contains(node))
          continue;
        const height = geometry.get(id)?.height;
        if (!height || !Number.isFinite(height)) continue;
        const following = current.replies[index + 1]?.position;
        const baseline =
          measuredReplyHeights.current.get(id) ??
          current.replies[index].position?.slotHeight ??
          inferredAuto.get(index + 1) ??
          (following?.kind === "auto" ? following.anchorHeight : undefined) ??
          height;
        measuredReplyHeights.current.set(id, height);
        measured.set(id, height);
        if (height > baseline + 0.5) grown.add(id);
      }
      if (!measured.size) return;
      const cards = current.replies.flatMap((reply, index) => {
        const rect = geometry.get(reply.id);
        return rect
          ? [
              {
                id: reply.id,
                ...rect,
                fixed:
                  reply.pinned === true ||
                  !(
                    reply.position?.kind === "viewport" ||
                    reply.position?.kind === "auto" ||
                    inferredAuto.has(index)
                  ),
              },
            ]
          : [];
      });
      const repaired = new Map(
        repairReplyGrowth(cards, grown).map((card) => [card.id, card]),
      );
      let moved = false,
        changed = false;
      const replies = current.replies.map((reply, index) => {
        const old = reply.position,
          card = repaired.get(reply.id);
        if (!old || !card) return reply;
        const shifted = card.y > old.y + 0.5;
        const height = measured.get(reply.id) ?? old.slotHeight;
        const anchorHeight =
          old.kind === "auto" && index > 0
            ? (measured.get(current.replies[index - 1].id) ?? old.anchorHeight)
            : old.anchorHeight;
        if (
          !shifted &&
          Math.abs(height - old.slotHeight) <= 0.5 &&
          anchorHeight === old.anchorHeight
        )
          return reply;
        changed = true;
        moved ||= shifted;
        return {
          ...reply,
          position: {
            ...old,
            y: shifted ? card.y : old.y,
            slotHeight: height,
            ...(shifted && inferredAuto.has(index)
              ? {
                  kind: "auto" as const,
                  anchorHeight: geometry.get(current.replies[index - 1].id)
                    ?.height,
                }
              : { anchorHeight }),
          },
        };
      });
      if (changed) {
        if (moved) cancelLayoutMotion();
        update((value) => ({ ...value, replies }));
      }
    };
    flushReplyResize.current = process;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries)
        queued.set(entry.target as HTMLElement, entry);
      process();
    });
    for (const node of canvas.querySelectorAll<HTMLElement>(".chat-reply"))
      observer.observe(node);
    return () => {
      disposed = true;
      queued.clear();
      if (flushReplyResize.current === process) flushReplyResize.current = null;
      observer.disconnect();
    };
  }, [state.sessionId, replyIds, update]);
  const moveReply = (replyId: string, dx: number, dy: number) => {
    if (stateRef.current.replies.find((reply) => reply.id === replyId)?.pinned)
      return;
    const origin = replyPosition(replyId);
    if (!origin) return;
    stopCamera();
    update((current) => ({
      ...current,
      replies: current.replies.map((reply) =>
        reply.id === replyId
          ? {
              ...reply,
              position: {
                ...origin,
                x: origin.x + dx,
                y: origin.y + dy,
                kind: "manual",
                anchorHeight: undefined,
              },
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
      if (!mounted.current || snapshot.sessionId !== stateRef.current.sessionId)
        return;
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
  const persist = useCallback(
    (snapshot: State) => {
      if (storageErrorRef.current) return;
      try {
        const value = JSON.stringify(snapshot);
        if (snapshot.sessionId)
          localStorage.setItem(sessionKey(mode, snapshot.sessionId), value);
        localStorage.setItem(`${KEY}:${mode}`, value);
      } catch (error) {
        const message = `本地保存失败：${error instanceof Error ? error.message : String(error)}`;
        storageErrorRef.current = message;
        setStorageError(message);
      }
    },
    [mode],
  );
  const save = useCallback(() => persist(stateRef.current), [persist]);
  const switchSession = (id: string) => {
    if (id === stateRef.current.sessionId) {
      setMenu(null);
      return;
    }
    if (running.current || creatingSession.current) {
      setNavError("当前会话仍在准备或生成，请稍后再切换");
      setMenu("nav");
      return;
    }
    const previous = stateRef.current;
    const restored = sessionStates.current.get(id);
    const target = restored
      ? { state: restored, error: "" }
      : restore(mode, id);
    if (target.error) {
      setNavError(target.error);
      setMenu("nav");
      return;
    }
    if (previous.sessionId) {
      sessionStates.current.set(previous.sessionId, previous);
      sessionDrafts.current.set(previous.sessionId, draft);
    }
    persist(previous);
    stopCamera();
    stopRailScroll();
    newReplyIds.current.clear();
    previousReplyCount.current = target.state.replies.length;
    iuiActions.current.clear();
    clearPairing();
    setHistoryNotice("");
    setRunError("");
    setDraft(sessionDrafts.current.get(id) ?? "");
    stateRef.current = target.state;
    setState(target.state);
    persist(target.state);
    setMenu(null);
    setNavError("");
  };
  const createNewSession = async (targetWorkspaceId = workspaceId) => {
    if (!onNewSession || creatingNewSession.current) return;
    if (running.current || creatingSession.current) {
      setNavError("当前会话仍在准备或生成，请稍后再新建");
      return;
    }
    creatingNewSession.current = true;
    setNewSessionPending(true);
    setNavError("");
    try {
      const id = await onNewSession(targetWorkspaceId);
      if (mounted.current) switchSession(id);
    } catch (error) {
      if (mounted.current) {
        setNavError(
          `新建会话失败：${error instanceof Error ? error.message : String(error)}`,
        );
        setMenu("nav");
      }
    } finally {
      creatingNewSession.current = false;
      if (mounted.current) setNewSessionPending(false);
    }
  };
  useLayoutEffect(() => {
    if (!requestedSession || handledRequest.current === requestedSession.token)
      return;
    handledRequest.current = requestedSession.token;
    switchSession(requestedSession.sessionId);
    onRequestHandled?.();
  }, [requestedSession?.token]);
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
      persist(stateRef.current);
    };
  }, [adapter, persist, stopCamera]);
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
    stage.current?.removeAttribute("data-canvas-dragging");
    if (drag && (drag.active || drag.explicit)) suppressPanClick.current = true;
    setIsPanning(false);
    setIsMovingReply(false);
    setPanArmed(false);
    if (drag?.captureTarget.hasPointerCapture(drag.pointerId))
      drag.captureTarget.releasePointerCapture(drag.pointerId);
    flushReplyResize.current?.();
  }, []);
  const touchViewport = useTouchViewport(stage, {
    viewport: () => stateRef.current.viewport,
    change: (viewport) => update((current) => ({ ...current, viewport })),
    start: () => {
      finishPan();
      stopCamera();
      suppressPanClick.current = true;
      stage.current?.setAttribute("data-canvas-dragging", "");
      setIsPanning(true);
    },
    end: finishPan,
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      suppressPanClick.current = false;
      if (event.key === "Escape") {
        setRailLocate(null);
        setRailLocateStatus({ text: "", quiet: true });
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
      if (drag || stage.current?.hasAttribute("data-canvas-dragging"))
        event.preventDefault();
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
      stage.current?.removeAttribute("data-canvas-dragging");
      if (drag?.captureTarget.hasPointerCapture(drag.pointerId))
        drag.captureTarget.releasePointerCapture(drag.pointerId);
    };
  }, [finishPan, stopCamera]);
  const panStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (touchViewport.isActive()) return;
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
      if (
        stateRef.current.replies.find(
          (reply) =>
            reply.id ===
            replyHandle.closest<HTMLElement>(".chat-reply")?.dataset.replyId,
        )?.pinned
      )
        return;
      const replyId =
        replyHandle.closest<HTMLElement>(".chat-reply")?.dataset.replyId;
      const position = replyId && replyPosition(replyId);
      if (!replyId || !position) return;
      const card = replyHandle.closest<HTMLElement>(".chat-reply");
      const moving = card
        ?.getAnimations?.()
        .some((animation) => layoutAnimations.current.has(animation));
      let origin = position;
      if (moving && card) {
        const rect = card.getBoundingClientRect();
        const view = stage.current!.getBoundingClientRect();
        const camera = stateRef.current.viewport;
        origin = {
          ...position,
          x: (rect.left - view.left - camera.x) / camera.zoom,
          y: (rect.top - view.top - camera.y) / camera.zoom,
          kind: "manual",
        };
      }
      stopCamera();
      if (moving)
        update((current) => ({
          ...current,
          replies: current.replies.map((reply) =>
            reply.id === replyId ? { ...reply, position: origin } : reply,
          ),
        }));
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
        originX: origin.x,
        originY: origin.y,
        active: false,
        explicit: true,
      };
      stage.current?.setAttribute("data-canvas-dragging", "");
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
      blankRail ||
      target.matches(
        ".chat-stage,.canvas-touch-surface,.chat-world,.chat-reply-slot",
      );
    if (!explicit && !background) return;
    // This press is already a canvas gesture, even below the movement threshold.
    // Cancel native selection synchronously, before React commits drag classes.
    event.preventDefault();
    stage.current?.setAttribute("data-canvas-dragging", "");
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
    if (touchViewport.isActive()) return;
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
      // Clear any selection that existed before this deliberate drag.
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
                  kind: "manual",
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
    if (touchViewport.isActive()) return;
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
    if (externalComposer) {
      if (nativeTurnPending.current)
        return { ok: false, message: "正在提交，请稍后再试" };
      const sessionId = stateRef.current.sessionId;
      if (!sessionId || !onNativeTurn)
        return { ok: false, message: "原生会话尚未准备好，请稍后重试" };
      nativeTurnPending.current = true;
      try {
        // Host owns execution: unmounting this View must never cancel the turn.
        await onNativeTurn(sessionId, prompt);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (mounted.current) setRunError(message);
        return { ok: false, message };
      } finally {
        nativeTurnPending.current = false;
      }
    }
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
        {onExit && (
          <button
            type="button"
            className="chat-canvas-switch"
            role="switch"
            aria-checked="true"
            aria-label="画布模式"
            title="画布模式已开启；点击返回原生对话"
            onClick={onExit}
          >
            <span className="chat-canvas-switch-track" aria-hidden="true">
              <span className="chat-canvas-switch-thumb" />
            </span>
            <span className="chat-canvas-switch-label">画布</span>
          </button>
        )}
        {externalComposer && (
          <button
            type="button"
            className="chat-layout-action"
            aria-label="自动排布画布内容"
            title="按当前可用宽度整理自动回复，保留手动位置和当前视角"
            disabled={!state.replies.length}
            onClick={arrangeViewport}
          >
            <Icon name="fit" size={16} />
            <span>自动排布</span>
          </button>
        )}
        {onNewSession && (
          <button
            type="button"
            className="chat-float-button"
            aria-label="新建画布会话"
            title="新建画布会话"
            disabled={newSessionPending}
            onClick={() => void createNewSession()}
          >
            <Icon name="plus" size={18} />
          </button>
        )}
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
          <CanvasSidebar
            icons={sidebarIcons}
            sessions={hostSessions}
            workspaces={hostWorkspaces}
            currentSessionId={state.sessionId}
            newSessionPending={newSessionPending}
            navError={navError}
            iuiEnabled={iuiEnabled}
            zoom={v.zoom}
            legacyReplies={state.legacyReplies}
            onNewSession={() => void createNewSession()}
            onNewSessionInWorkspace={
              onNewSession
                ? (workspaceId) => void createNewSession(workspaceId)
                : undefined
            }
            onSwitchSession={switchSession}
            onOpenWorkspace={
              onOpenWorkspace
                ? (workspaceId) => {
                    setNavError("");
                    void onOpenWorkspace(workspaceId).catch((error) =>
                      setNavError(
                        error instanceof Error ? error.message : String(error),
                      ),
                    );
                  }
                : undefined
            }
            onCreateWorkspace={
              onCreateWorkspace
                ? () => {
                    setNavError("");
                    void onCreateWorkspace().catch((error) =>
                      setNavError(
                        error instanceof Error ? error.message : String(error),
                      ),
                    );
                  }
                : undefined
            }
            onClose={() => setMenu(null)}
            onPlugins={onPlugins}
            onSchedules={onSchedules}
            onLegacy={onLegacy}
            onToggleIui={() => setIuiEnabled((value) => !value)}
            onZoomOut={() =>
              zoom(
                v.zoom / 1.2,
                stage.current?.clientWidth ?? 600,
                stage.current?.clientHeight ?? 400,
              )
            }
            onZoomIn={() =>
              zoom(
                v.zoom * 1.2,
                stage.current?.clientWidth ?? 600,
                stage.current?.clientHeight ?? 400,
              )
            }
            onArrangeReplies={
              state.replies.length ? arrangeViewport : undefined
            }
            onResetView={() => {
              stopCamera();
              update((current) => ({
                ...current,
                viewport: { x: 64, y: 104, zoom: 1 },
              }));
            }}
            onExportLegacy={
              state.legacyReplies?.length
                ? () => {
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
                  }
                : undefined
            }
          />
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
              Canvas 0.2.4-experimental.2
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
        <div className="canvas-touch-surface" aria-hidden="true" />
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
                  data-pinned={reply.pinned || undefined}
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
                      disabled={reply.pinned === true}
                      title={
                        reply.pinned
                          ? "已固定，取消固定后可移动"
                          : "拖动移动这条回复；方向键微调，Shift + 方向键加速"
                      }
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
                    <div className="chat-reply-actions">
                      <button
                        type="button"
                        className="chat-locate-message"
                        aria-label="在消息列表中定位对应消息"
                        title="定位对应消息"
                        aria-busy={
                          railLocate?.replyId === reply.id || undefined
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          stopRailScroll();
                          setRailLocate({
                            scope: pairScope,
                            replyId: reply.id,
                          });
                        }}
                      >
                        <Icon name="locate" size={16} />
                      </button>
                      <button
                        type="button"
                        className="chat-pin-reply"
                        aria-pressed={reply.pinned === true}
                        aria-label={
                          reply.pinned ? "取消固定这条回复" : "固定这条回复"
                        }
                        title={
                          reply.pinned
                            ? "取消固定后可移动并参与自动排布"
                            : "固定位置，不参与自动排布"
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          togglePin(reply.id);
                        }}
                      >
                        <Icon
                          name={reply.pinned ? "pin" : "pin-off"}
                          size={16}
                        />
                      </button>
                    </div>
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
      <p
        className="chat-locate-status"
        role="status"
        data-quiet={railLocateStatus.quiet || undefined}
      >
        {railLocateStatus.text}
      </p>
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
        {externalComposer ? (
          storageError || historyNotice || runError ? (
            <div className="chat-external-notices" role="status">
              {storageError || historyNotice || runError}
            </div>
          ) : null
        ) : useNativeComposer ? (
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
