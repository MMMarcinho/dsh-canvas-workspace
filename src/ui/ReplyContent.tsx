import {
  Component,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Runtime,
  type Document as IuiDocument,
  type HostAdapter,
} from "../../vendor/open-intelligent-ui/protocol/index.js";
import { UIRenderer } from "../../vendor/open-intelligent-ui/ui/renderer/Renderer.js";
import { splitCanvasReply, type CanvasReply } from "../adapters/iui";
import iuiStyles from "./iui-styles";

export type IuiResourceHandler = NonNullable<HostAdapter["resolveResource"]>;
export type IuiActionHandler = NonNullable<HostAdapter["requestAction"]>;
export type ReplyMarkdownRenderer = (
  text: string,
  streaming: boolean,
  sessionId?: string,
) => ReactNode;
export type ReplyImagePreviewRenderer = (
  src: string,
  alt: string,
  onClose: () => void,
) => ReactNode;
export type ReplyContentProps = {
  text: string;
  messageId: string;
  reasoning?: string;
  /** Owning session, used by the host to resolve workspace-relative images. */
  sessionId?: string;
  resourceScopeKey?: string;
  streaming: boolean;
  iuiEnabled: boolean;
  /** Inject the public native MarkdownText in DSH; the offline demo uses ReactMarkdown. */
  renderMarkdown?: ReplyMarkdownRenderer;
  /** Public host image viewer, offered to safe IUI images in the shadow root. */
  renderImagePreview?: ReplyImagePreviewRenderer;
  /** User-initiated copy/new-turn actions only; never arbitrary script execution. */
  onIuiAction?: IuiActionHandler;
  /** Trusted host resolver for explicit image resources, not arbitrary network code. */
  onIuiResource?: IuiResourceHandler;
};
type ParsedReply = CanvasReply;
let runtimeSequence = 0;

function MarkdownBody({
  text,
  streaming,
  renderMarkdown,
  sessionId,
}: Pick<
  ReplyContentProps,
  "text" | "streaming" | "renderMarkdown" | "sessionId"
>) {
  return (
    <div className="chat-markdown">
      {renderMarkdown ? (
        renderMarkdown(text, streaming, sessionId)
      ) : (
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      )}
    </div>
  );
}

function SourceFallback({
  text,
  reason,
  pending = false,
}: {
  text: string;
  reason: string;
  pending?: boolean;
}) {
  return (
    <div
      className="chat-iui-fallback"
      data-iui-state={pending ? "pending" : "error"}
    >
      <p role="status">{reason}</p>
      <pre aria-label="保留的回复原文">{text}</pre>
    </div>
  );
}

/** A broken UI or native renderer must never take the composer/canvas down with it. */
class ReplyBoundary extends Component<
  { text: string; resetKey: string; children: ReactNode },
  { error: boolean; resetKey: string }
> {
  state = { error: false, resetKey: this.props.resetKey };
  static getDerivedStateFromError() {
    return { error: true };
  }
  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { resetKey: string },
  ) {
    return props.resetKey === state.resetKey
      ? null
      : { error: false, resetKey: props.resetKey };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div>
        <SourceFallback
          text={this.props.text}
          reason="回复渲染失败，原文已保留。可以重试或继续对话。"
        />
        <button type="button" onClick={() => this.setState({ error: false })}>
          重试渲染
        </button>
      </div>
    );
  }
}

/** Separate render boundaries share state, but one failed root cannot hide its peers. */
class RootRuntime extends Runtime {
  constructor(
    private owner: CanvasRuntime,
    index: number,
  ) {
    super(
      { ...owner.document, children: [owner.document.children[index]] },
      { ...owner.adapter },
    );
  }
  override scope() {
    return this.owner.scope();
  }
  override async event(...args: Parameters<Runtime["event"]>) {
    await this.owner.event(...args);
  }
}

function IuiTarget({
  index,
  runtime,
  mode,
  resourceScopeKey,
  renderImagePreview,
}: {
  index: number;
  runtime: CanvasRuntime;
  mode: "light" | "dark";
  resourceScopeKey?: string;
  renderImagePreview?: ReplyImagePreviewRenderer;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [, revision] = useState(0);
  useLayoutEffect(
    () => runtime.subscribe(() => revision((value) => value + 1)),
    [runtime],
  );
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${iuiStyles}\n:host{display:block;min-width:0}.iui-theme{min-height:0;background:transparent}.iui-root{white-space:normal}`;
    const element = document.createElement("div");
    shadow.append(style, element);
    setTarget(element);
    return () => {
      style.remove();
      element.remove();
    };
  }, []);
  useLayoutEffect(() => {
    if (!renderImagePreview || !target) return;
    const shadow = target.getRootNode() as ShadowRoot;
    const imageFrom = (event: Event) =>
      event
        .composedPath()
        .find(
          (item): item is HTMLImageElement =>
            (item as Element).tagName === "IMG" &&
            Boolean(
              (item as Element).closest?.(
                '.iui-async-image[data-image-status="ready"]',
              ),
            ),
        );
    const open = (event: Event) => {
      const image = imageFrom(event);
      if (!image) return;
      image.focus();
      setImagePreview({ src: image.src, alt: image.alt });
    };
    const onKey = (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (key !== "Enter" && key !== " ") return;
      if (!imageFrom(event)) return;
      event.preventDefault();
      open(event);
    };
    const annotate = () => {
      for (const image of shadow.querySelectorAll<HTMLImageElement>(
        '.iui-async-image[data-image-status="ready"] img',
      )) {
        image.tabIndex = 0;
        image.setAttribute("role", "button");
        image.setAttribute("aria-label", `查看原图：${image.alt || "图片"}`);
      }
    };
    const observer = new MutationObserver(annotate);
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-image-status"],
    });
    annotate();
    shadow.addEventListener("click", open);
    shadow.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      shadow.removeEventListener("click", open);
      shadow.removeEventListener("keydown", onKey);
    };
  }, [target, renderImagePreview]);
  useLayoutEffect(() => setImagePreview(null), [resourceScopeKey]);
  const localRuntime = useMemo(
    () => new RootRuntime(runtime, index),
    [runtime, index, resourceScopeKey],
  );
  // Keep the adapter stable, not the streaming document. Root state still
  // delegates to the owner; revised text and queries reach the rendered root.
  localRuntime.document = {
    ...runtime.document,
    children: [runtime.document.children[index]],
  };
  return (
    <>
      <div ref={ref} data-canvas-iui-root="" />
      {target && (
        <UIRenderer
          runtime={localRuntime}
          targets={[target]}
          themeMode={mode}
        />
      )}
      {imagePreview &&
        renderImagePreview?.(imagePreview.src, imagePreview.alt, () =>
          setImagePreview(null),
        )}
    </>
  );
}

function useHostTheme(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
    document.body.hasAttribute("data-ds-dark-theme")
      ? "dark"
      : "light",
  );
  useLayoutEffect(() => {
    const observer = new MutationObserver(() =>
      setMode(
        document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light",
      ),
    );
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-ds-dark-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return mode;
}

/** Observe safe-runtime feedback, including event-time errors, without changing its evaluator. */
class CanvasRuntime extends Runtime {
  private listeners = new Set<() => void>();
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  constructor(
    document: IuiDocument,
    adapter: HostAdapter,
    private report: (message: string) => void,
  ) {
    super(document, adapter);
  }
  override async event(...args: Parameters<Runtime["event"]>) {
    await super.event(...args);
    this.report(this.feedback.at(-1) ?? "");
    for (const listener of this.listeners) listener();
  }
}

function IuiReply({
  parsed,
  text,
  streaming,
  renderMarkdown,
  renderImagePreview,
  onIuiAction,
  onIuiResource,
  sessionId,
  resourceScopeKey,
  preview,
}: Pick<
  ReplyContentProps,
  | "text"
  | "streaming"
  | "renderMarkdown"
  | "renderImagePreview"
  | "onIuiAction"
  | "onIuiResource"
  | "sessionId"
  | "resourceScopeKey"
> & { parsed: ParsedReply; preview: boolean }) {
  const action = useRef(onIuiAction);
  action.current = onIuiAction;
  const resource = useRef(onIuiResource);
  resource.current = onIuiResource;
  const active = useRef(true);
  const [feedback, setFeedback] = useState("");
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [runtime] = useState(() => {
    // Runtime event numbers restart on remount (e.g. toggling IUI off and on).
    // Add a mount namespace so the host can deduplicate retries without
    // suppressing a new intentional click after the UI is restored.
    const instance = ++runtimeSequence;
    return new CanvasRuntime(
      parsed.document,
      {
        resolveResource: (request) =>
          resource.current
            ? resource.current(request)
            : Promise.resolve({ ok: false, message: "此处尚未连接图片资源。" }),
        requestAction: (request) =>
          action.current
            ? action.current({
                ...request,
                id: `canvas:${instance}:${request.id}`,
              })
            : Promise.resolve({
                ok: false,
                message: "此处尚未连接 IUI 宿主操作，未执行任何操作。",
              }),
      },
      (message) => {
        if (active.current) setFeedback(message);
      },
    );
  });
  runtime.update(parsed.document); // Preserves local DIL state across appended streaming revisions.
  const mode = useHostTheme();
  return (
    <div
      className="chat-iui-content"
      data-iui-state={preview ? "preview" : "ready"}
      data-iui-layout={
        parsed.segments.some(
          (segment) => segment.kind === "markdown" && segment.text.trim(),
        )
          ? "mixed"
          : "standalone"
      }
    >
      {parsed.segments
        .filter((segment) => segment.kind !== "markdown" || segment.text.trim())
        .map((segment) => (
          <ReplyBoundary
            key={`${segment.kind}-${segment.start}`}
            text={segment.text}
            resetKey={`${segment.kind}\u0000${segment.text}\u0000${streaming}`}
          >
            {segment.kind === "markdown" ? (
              <MarkdownBody
                text={segment.text}
                streaming={streaming}
                renderMarkdown={renderMarkdown}
                sessionId={sessionId}
              />
            ) : segment.kind === "error" ? (
              <SourceFallback
                text={segment.text}
                pending={streaming}
                reason={`${streaming ? "这段 IUI 暂时无法安全显示" : "这段 IUI 未通过安全解析"}，原文已保留。（${segment.reason}）`}
              />
            ) : (
              <IuiTarget
                index={segment.index}
                runtime={runtime}
                mode={mode}
                resourceScopeKey={resourceScopeKey}
                renderImagePreview={renderImagePreview}
              />
            )}
          </ReplyBoundary>
        ))}
      {preview && (
        <p role="status">IUI 正在生成，当前显示已通过安全解析的部分。</p>
      )}
      {feedback && (
        <p className="chat-iui-feedback" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}

function ReplyBody({
  text,
  messageId,
  reasoning,
  sessionId,
  resourceScopeKey,
  streaming,
  iuiEnabled,
  renderMarkdown,
  renderImagePreview,
  onIuiAction,
  onIuiResource,
}: ReplyContentProps) {
  const [open, setOpen] = useState<"source" | "reasoning" | null>(null);
  const sourceId = useId();
  const reasoningId = useId();
  const result = useMemo(() => {
    if (!iuiEnabled) return null;
    try {
      return splitCanvasReply(text, messageId, streaming);
    } catch {
      return { document: null, segments: null };
    }
  }, [text, messageId, streaming, iuiEnabled]);
  const hasSource = Boolean(result?.document && result.segments);
  const hasReasoning = Boolean(reasoning?.trim()) && !streaming;
  const body =
    hasSource && result?.document && result.segments ? (
      <IuiReply
        resourceScopeKey={resourceScopeKey}
        parsed={result}
        text={text}
        streaming={streaming}
        renderMarkdown={renderMarkdown}
        renderImagePreview={renderImagePreview}
        sessionId={sessionId}
        onIuiAction={onIuiAction}
        onIuiResource={onIuiResource}
        preview={result.segments.some(
          (segment) => segment.kind === "ui" && !segment.complete,
        )}
      />
    ) : result ? (
      <SourceFallback
        text={text}
        pending={streaming}
        reason="解析器无法处理这段内容，原文已保留。"
      />
    ) : (
      <MarkdownBody
        text={text}
        streaming={streaming}
        renderMarkdown={renderMarkdown}
        sessionId={sessionId}
      />
    );
  return (
    <>
      {body}
      {(hasSource || hasReasoning) && (
        <div className="chat-reply-disclosures">
          <div className="chat-reply-disclosure-actions">
            {hasSource && (
              <button
                type="button"
                aria-label="查看原文"
                aria-expanded={open === "source"}
                aria-controls={sourceId}
                onClick={() => setOpen(open === "source" ? null : "source")}
              >
                查看原文
              </button>
            )}
            {hasReasoning && (
              <button
                type="button"
                aria-expanded={open === "reasoning"}
                aria-controls={reasoningId}
                onClick={() =>
                  setOpen(open === "reasoning" ? null : "reasoning")
                }
              >
                查看思考内容
              </button>
            )}
          </div>
          {hasSource && (
            <div
              id={sourceId}
              className="chat-iui-source"
              hidden={open !== "source"}
            >
              <pre>{text}</pre>
            </div>
          )}
          {hasReasoning && (
            <div
              id={reasoningId}
              className="chat-reasoning-done"
              hidden={open !== "reasoning"}
            >
              <pre>{reasoning}</pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** MIT IUI protocol/runtime/renderer, isolated from the host DOM and script execution. */
export function ReplyContent(props: ReplyContentProps) {
  return (
    <ReplyBoundary
      text={props.text}
      resetKey={`${props.messageId}\u0000${props.iuiEnabled}\u0000${props.text}`}
    >
      <ReplyBody key={props.messageId} {...props} />
    </ReplyBoundary>
  );
}
