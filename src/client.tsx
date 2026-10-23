import { resolveNativeImageResource } from "./host/native-images";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { MessageImageLoader } from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  FileTypeIcon,
  fileExtension,
  fileSizeText,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  Tooltip,
  writeClipboard,
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
import { useEffect, useRef, useState } from "react";
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
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "canvas.composer.native": { kind: "single"; scope: "session-maybe" };
  }
}
interface CanvasFace {
  adapter: AgentAdapter;
  mode: "mock" | "dsh";
  onExit: () => void;
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
  onOpenWorkspace: (id: string) => Promise<void>;
  onCreateWorkspace: () => Promise<void>;
  onPlugins: () => void;
  accountActions: NativeAccountActions;
  retainSession: (id: string) => SessionReference;
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
  const hostSessions = sessionList.ids.map((id) => ({
    id,
    title: sessionList.byId[id]?.displayTitle ?? String(id),
    cwd: sessionList.byId[id]?.cwd,
  }));
  const hostWorkspaces = workspaceList.items.map((workspace) => ({
    id: workspace.workspaceId,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
  }));
  return (
    <div className="canvas-frame-overlay">
      {legacy ? (
        <CanvasWorkspace
          {...props}
          hostSessions={hostSessions}
          onBackToChat={() => setLegacy(false)}
        />
      ) : (
        <ChatCanvas
          {...props}
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
                ? sessionList.byId[sessionId as SessionId]?.cwd
                : undefined,
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
              [
                fileExtension(name).toUpperCase().slice(0, 8),
                fileSizeText(bytes),
              ]
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
                ? sessionList.byId[sessionId as SessionId]?.cwd
                : undefined,
              request,
            )
          }
          useNativeComposer={props.mode === "dsh"}
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
function CanvasIcon({ size }: PropsRuntime<"sidebar.panellist">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="14" y="4" width="7" height="5" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
      <path d="M7 14v4a1 1 0 0 0 1 1h2M16 10v1" />
    </svg>
  );
}
/** Selects a keyed panel and draws the canvas in the supported frame-wide overlay. */
export function apply(ctx: Context): void {
  const adapter = createDshAdapter(ctx);
  // Explicit opt-in local test mode; it cannot send a host prompt.
  const demo = new URLSearchParams(location.search).get("canvasMock") === "1";
  const selected = demo ? createMockAdapter() : adapter;
  const returnToNative = () => ctx.layout.selectPanel(null);
  const accountActions = createNativeAccountActions(returnToNative);
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
        inject: (): CanvasFace => ({
          adapter: selected,
          mode: selected.kind,
          onExit: returnToNative,
          accountActions,
          retainSession: (id) =>
            ctx.sessions.retain(id as SessionId, { source: "canvas" }),
          loadUserImage: (id, attachment) =>
            ctx.uiConversation.imageUrl(id as SessionId, attachment),
          onOpenSession: (id) =>
            ctx.uiWorkspace.openSession(
              id as Parameters<typeof ctx.uiWorkspace.openSession>[0],
            ),
          onNewSession: () => ctx.uiWorkspace.startSession(),
          onOpenWorkspace: (id) =>
            ctx.uiWorkspace.openWorkspace(
              id as Parameters<typeof ctx.uiWorkspace.openWorkspace>[0],
            ),
          onCreateWorkspace: async () => {
            const path = await ctx.uiWorkspace.pickDirectory();
            if (path) await ctx.workspaces.create({ path });
          },
          onPlugins: () => ctx.layout.selectPanel("plugins" as MainPanelId),
        }),
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
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: -5,
        label: "Canvas · 画布",
      },
      CanvasIcon,
    ),
  );
}
