/** Persisted canvas data, independent of DSH host internals. */
import type { UserContentAttachment } from "@deepseek-ai/dsh-client-ui-chat/client";

export type UserMessageAttachment = UserContentAttachment;
export interface CanvasNode {
  id: string;
  type: "note" | "task" | "agent" | "artifact";
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  body: string;
  sessionId?: string;
  status?: "idle" | "running" | "done" | "error";
  contextIds: string[];
}
export interface Workspace {
  version: 1;
  id: string;
  title: string;
  nodes: CanvasNode[];
  viewport: { x: number; y: number; zoom: number };
}
export interface AgentRun {
  sessionId: string;
  prompt: string;
  context: CanvasNode[];
  signal: AbortSignal;
  /** Current accumulated assistant text, not a delta. */
  onText: (
    text: string,
    meta?: {
      /** Provider-reported reasoning, kept separate from the visible answer and prompt. */
      reasoning?: string;
      timestamp?: number;
      /** True only when every observed assistant step is durable and uninterrupted. */
      durable?: boolean;
      /** Host identity, published as soon as the submitted RPC is admitted. */
      turnId?: number;
      requestId?: string;
    },
  ) => void;
}
export interface AgentConversationTurn {
  turnId: number;
  userMessages: {
    id: string;
    requestId?: string;
    text: string;
    /** Presentation only; attachment labels never enter the host prompt. */
    displayText?: string;
    /** Host-authoritative durable references, never uploaded bytes or guessed paths. */
    attachments?: UserMessageAttachment[];
    timestamp: number;
  }[];
  body: string;
  reasoning?: string;
  timestamp?: number;
  durable: boolean;
  status: "running" | "done" | "error";
  error?: string;
}
export interface AgentSessionSnapshot {
  sessionId: string;
  /** Only turns whose turn/start is covered by the authoritative event window. */
  turns: AgentConversationTurn[];
  hasMore: boolean;
  error?: string;
}
/** Adapters do not own canvas layout, secrets, or implicit global context. */
export interface AgentAdapter {
  kind: "mock" | "dsh";
  createSession(): Promise<string>;
  run(input: AgentRun): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  /** Prevent IUI actions from racing a native Composer submission. */
  isSessionBusy?(sessionId: string): boolean;
  openSession?(sessionId: string): void;
  /** Read-only history subscription; disposing it never cancels a host run. */
  observeSession?(
    sessionId: string,
    onSnapshot: (snapshot: AgentSessionSnapshot) => void,
  ): () => void;
}
