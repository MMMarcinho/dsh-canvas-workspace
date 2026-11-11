import { projectSidebar } from "./host/sidebar-projection";
import { resolveNativeImageResource } from "./host/native-images";
import { createNativeFileDrag } from "./host/native-file-drag";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { WorkspaceId } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { MessageImageLoader } from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  FileTypeIcon,
  fileExtension,
  fileSizeText,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  MenuItemButton,
  Tooltip,
  writeClipboard,
  type FileDragActions,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { SessionReference } from "@deepseek-ai/dsh-api-session-controller/client";
import type { Context } from "@deepseek-ai/cordis";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type {
  PropsRenderFactories,
  PropsRenderSlots,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import { CanvasWorkspace } from "./ui/CanvasWorkspace";
import { ChatCanvas } from "./ui/ChatCanvas";
import { createNativeSidebarIcons } from "./host/native-sidebar-icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { createDshAdapter } from "./adapters/dsh";
import { createMockAdapter } from "./adapters/mock";
import type { AgentAdapter } from "./core/types";
import css from "./styles.css?raw";
import {
  NativeBrand,
  NativeAvatar,
  NativeNavigationIcon,
  NativeSendIcon,
  renderNativeMarkdown,
  renderNativeImagePreview,
} from "./host/native-ui";
import {
  createNativeAccountActions,
  type NativeAccountActions,
} from "./host/native-account";

export const name = "dsh-canvas-workspace";
export const inject = [
  "slots",
  "layout",
  "sessions",
  "uiSession",
  "uiWorkspace",
  "workspaces",
  "connection",
  "conversation",
  "uiConversation",
];
const PANEL_ID = "canvas-workspace" as MainPanelId;
const NATIVE_SIDEBAR_ICONS = createNativeSidebarIcons();
type CanvasOpenRequest = { sessionId: string; token: number };
let openRequest: CanvasOpenRequest | null = null;
let openRequestToken = 0;
const openRequestListeners = new Set<() => void>();
const subscribeOpenRequest = (listener: () => void) => {
  openRequestListeners.add(listener);
  return () => openRequestListeners.delete(listener);
};
const getOpenRequest = () => openRequest;
const publishOpenRequest = (request: CanvasOpenRequest | null) => {
  openRequest = request;
  for (const listener of openRequestListeners) listener();
};
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "canvas.composer.native": { kind: "single"; scope: "session-maybe" };
  }
}
interface CanvasFace {
  fileDrag: FileDragActions;
  adapter: AgentAdapter;
  mode: "mock" | "dsh";
  onExit: () => void;
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
  createCanvasSession: (workspaceId?: string) => Promise<string>;
  onOpenWorkspace: (id: string) => Promise<void>;
  onCreateWorkspace: () => Promise<void>;
  onPlugins: () => void;
  onSchedules: () => void;
  accountActions: NativeAccountActions;
  retainSession: (id: string) => SessionReference;
  sendNativeTurn: (id: string, text: string) => Promise<void>;
  loadUserImage: (
    sessionId: string,
    attachment: Parameters<MessageImageLoader>[0],
  ) => Promise<string>;
}
function CanvasPanel(_props: PropsRuntime<"main">) {
  // The keyed panel owns navigation; the supported frame overlay owns the view.
  return null;
}
function CanvasNativeComposer(
  props: PropsRuntime<"canvas.composer.native"> & PropsRenderFactories,
) {
  return props.renderFactorySlot(
    "conversation.content",
    { variant: "embedded", phase: "active", hero: false },
    { slots: { views: () => null, widthControls: () => null } },
  );
}
function CanvasOverlay(
  props: PropsRuntime<"shell.overlay"> &
    PropsRenderSlots<"canvas.composer.native"> &
    CanvasFace,
) {
  const active = props.usePanelInfo((info) => info.activePanelId === PANEL_ID);
  const sessionList = props.useSessions((state) => state);
  const workspaceList = props.useWorkspaces((state) => state);
  const requestedSession = useSyncExternalStore(
    subscribeOpenRequest,
    getOpenRequest,
  );
  const [legacy, setLegacy] = useState(false);
  const [canvasSessionId, setCanvasSessionId] = useState<string>();
  const [composerReference, setComposerReference] =
    useState<SessionReference>();
  const retained = useRef(new Map<string, SessionReference>());
  useEffect(() => {
    if (!active || legacy || !canvasSessionId) {
      setComposerReference(undefined);
      return;
    }
    let reference = retained.current.get(canvasSessionId);
    if (!reference) {
      reference = props.retainSession(canvasSessionId);
      retained.current.set(canvasSessionId, reference);
      // The native composer observes open failures through its Session scope.
      void reference.ready.catch(() => {});
    }
    setComposerReference(reference);
  }, [active, legacy, canvasSessionId, props.retainSession]);
  useEffect(() => {
    if (active) return;
    for (const reference of retained.current.values()) reference.release();
    retained.current.clear();
  }, [active]);
  useEffect(
    () => () => {
      for (const reference of retained.current.values()) reference.release();
      retained.current.clear();
    },
    [],
  );
  if (!active) return null;
  const SessionProvider = props.SessionProvider;
  const { sessions: hostSessions, workspaces: hostWorkspaces } = projectSidebar(
    sessionList,
    workspaceList,
    canvasSessionId ?? undefined,
  );
  return (
    <div className="canvas-frame-overlay">
      {legacy ? (
        <CanvasWorkspace
          {...props}
          hostSessions={hostSessions}
          onBackToChat={() => setLegacy(false)}
        />
      ) : (
        <CanvasChat
          {...props}
          hostSessions={hostSessions}
          hostWorkspaces={hostWorkspaces}
          requestedSession={requestedSession}
          onRequestHandled={() => {
            if (openRequest === requestedSession) publishOpenRequest(null);
          }}
          onSessionChange={setCanvasSessionId}
          nativeComposer={
            props.mode === "dsh" &&
            composerReference?.sessionId === canvasSessionId ? (
              <SessionProvider session={composerReference}>
                {props.renderSlot("canvas.composer.native", {})}
              </SessionProvider>
            ) : null
          }
          onLegacy={() => setLegacy(true)}
        />
      )}
    </div>
  );
}
type CanvasChatProps = CanvasFace &
  Pick<
    ComponentProps<typeof ChatCanvas>,
    | "hostSessions"
    | "hostWorkspaces"
    | "requestedSession"
    | "onRequestHandled"
    | "onSessionChange"
    | "nativeComposer"
    | "externalComposer"
    | "onLegacy"
  >;
function CanvasChat(props: CanvasChatProps) {
  const { hostSessions = [], hostWorkspaces = [], requestedSession } = props;
  return (
    <ChatCanvas
      {...props}
      sidebarIcons={NATIVE_SIDEBAR_ICONS}
      onNewSession={props.createCanvasSession}
      requestedSession={requestedSession}
      onRequestHandled={props.onRequestHandled}
      hostSessions={hostSessions}
      hostWorkspaces={hostWorkspaces}
      NativeBrand={<NativeBrand />}
      avatar={<NativeAvatar />}
      navIcon={<NativeNavigationIcon />}
      sendIcon={<NativeSendIcon />}
      renderMarkdown={(text, streaming, sessionId) =>
        renderNativeMarkdown(
          text,
          streaming,
          sessionId
            ? hostSessions.find((session) => session.id === sessionId)?.cwd
            : undefined,
          props.fileDrag,
        )
      }
      renderImagePreview={renderNativeImagePreview}
      loadUserImage={(attachment, sessionId) =>
        props.loadUserImage(sessionId, attachment)
      }
      userChrome={{
        renderFileIcon: (name) => (
          <FileTypeIcon path={name} className="chat-user-file-icon-glyph" />
        ),
        formatFileMeta: (name, bytes) =>
          [fileExtension(name).toUpperCase().slice(0, 8), fileSizeText(bytes)]
            .filter(Boolean)
            .join(" "),
        copyText: writeClipboard,
        renderCopyIcon: (copied) =>
          copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />,
        wrapCopyButton: (button, label) => (
          <Tooltip label={label} side="bottom">
            {button}
          </Tooltip>
        ),
      }}
      resolveImage={(request, sessionId) =>
        resolveNativeImageResource(
          document.baseURI,
          sessionId
            ? hostSessions.find((session) => session.id === sessionId)?.cwd
            : undefined,
          request,
        )
      }
      useNativeComposer={props.mode === "dsh"}
      onSessionChange={props.onSessionChange}
      nativeComposer={props.nativeComposer}
      externalComposer={props.externalComposer}
      onNativeTurn={props.externalComposer ? props.sendNativeTurn : undefined}
      onLegacy={props.onLegacy}
    />
  );
}

/** A genuine session-scoped View: native tabs and the existing input stay mounted. */
export function CanvasConversationView(
  props: PropsRuntime<"conversation.view"> & CanvasFace,
) {
  const sessionList = props.useSessions((state) => state);
  const workspaceList = props.useWorkspaces((state) => state);
  const request = useMemo(
    () => ({ sessionId: props.sessionId, token: ++openRequestToken }),
    [props.sessionId],
  );
  const sidebar = projectSidebar(sessionList, workspaceList, props.sessionId);
  const exit = () => props.openView("chat", "");
  return (
    <div className="canvas-conversation-view" data-canvas-conversation-view>
      <CanvasChat
        {...props}
        onExit={exit}
        accountActions={createNativeAccountActions(exit)}
        requestedSession={request}
        hostSessions={sidebar.sessions}
        hostWorkspaces={sidebar.workspaces}
        externalComposer
      />
    </div>
  );
}
/** Selects a keyed panel and draws the canvas in the supported frame-wide overlay. */
export function apply(ctx: Context): void {
  const fileDrag = createNativeFileDrag(ctx);
  const adapter = createDshAdapter(ctx);
  // Explicit opt-in local test mode; it cannot send a host prompt.
  const demo = new URLSearchParams(location.search).get("canvasMock") === "1";
  const selected = demo ? createMockAdapter() : adapter;
  const returnToNative = () => ctx.layout.selectPanel(null);
  const accountActions = createNativeAccountActions(returnToNative);
  const canvasFace = (): CanvasFace => ({
    fileDrag,
    adapter: selected,
    mode: selected.kind,
    onExit: returnToNative,
    accountActions,
    retainSession: (id) =>
      ctx.sessions.retain(id as SessionId, { source: "canvas" }),
    sendNativeTurn: async (id, text) => {
      const reference = ctx.sessions.retain(id as SessionId, {
        source: "canvas",
      });
      try {
        const binding = await reference.ready;
        await binding.ctx.conversation.send(text);
      } finally {
        reference.release();
      }
    },
    loadUserImage: (id, attachment) =>
      ctx.uiConversation.imageUrl(id as SessionId, attachment),
    onOpenSession: (id) =>
      ctx.uiWorkspace.openSession(
        id as Parameters<typeof ctx.uiWorkspace.openSession>[0],
      ),
    onNewSession: () => ctx.uiWorkspace.startSession(),
    createCanvasSession: (workspaceId) =>
      ctx.sessions.create(
        workspaceId ? { workspaceId: workspaceId as WorkspaceId } : undefined,
      ),
    onOpenWorkspace: (id) =>
      ctx.uiWorkspace.openWorkspace(
        id as Parameters<typeof ctx.uiWorkspace.openWorkspace>[0],
      ),
    onCreateWorkspace: async () => {
      const path = await ctx.uiWorkspace.pickDirectory();
      if (path) await ctx.workspaces.create({ path });
    },
    onPlugins: () => ctx.layout.selectPanel("plugins" as MainPanelId),
    onSchedules: () => {
      try {
        ctx.layout.selectPanel("schedules" as MainPanelId);
      } catch {
        // Older hosts may not register the Automation tasks panel.
      }
    },
  });
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = name;
    style.textContent = css;
    document.head.append(style);
    return () => {
      style.remove();
      adapter.dispose();
    };
  }, "canvas: scoped stylesheet and session cleanup");
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
      },
      CanvasPanel,
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "canvas-workspace-frame",
        children: {
          "canvas.composer.native": { kind: "single", scope: "session-maybe" },
        },
        inject: canvasFace,
      },
      CanvasOverlay,
    ),
  );
  ctx.slots.inject("canvas.composer.native", () =>
    ctx.slots.register(
      { name: "canvas.composer.native" },
      CanvasNativeComposer,
    ),
  );
  ctx.slots.inject("conversation.view", () =>
    ctx.slots.register(
      {
        name: "conversation.view",
        id: "canvas",
        label: "画布",
        order: 50,
        inject: canvasFace,
      },
      CanvasConversationView,
    ),
  );
  ctx.slots.inject("sidebar.workspaces.session.menu.item", () =>
    ctx.slots.register(
      {
        name: "sidebar.workspaces.session.menu.item",
        id: "dsh-canvas-open",
        order: 480,
      },
      ({ sessionId, useMenuOpenState }) => {
        const [, setMenuOpen] = useMenuOpenState();
        return (
          <MenuItemButton
            onSelect={() => {
              setMenuOpen(false);
              ctx.layout.selectPanel(PANEL_ID);
              publishOpenRequest({
                sessionId,
                token: ++openRequestToken,
              });
            }}
          >
            在画布中打开
          </MenuItemButton>
        );
      },
    ),
  );
}
