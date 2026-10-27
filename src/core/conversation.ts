import type { AgentSessionSnapshot } from "./types";
import type { UserMessageAttachment } from "./types";
import { visibleCanvasPrompt } from "./prompt";

export type ConversationReply = {
  id: string;
  prompt: string;
  body: string;
  /** Only reasoning supplied by the DSH session; never part of prompt. */
  reasoning?: string;
  /** World coordinates after the user moves this reply by its stable ID. */
  position?: {
    x: number;
    y: number;
    slotHeight: number;
    /** Automatically placed replies may follow later content-height changes. */
    kind?: "auto" | "manual";
    /** Height of the preceding reply when this position was first assigned. */
    anchorHeight?: number;
  };
  timestamp?: number;
  durableTime?: boolean;
  hostTurnId?: number;
  requestId?: string;
  localPrompt?: string;
  /** Exact locally authored input must never be interpreted as transport metadata. */
  promptSource?: "user";
  userMessages?: {
    id: string;
    text: string;
    source?: "user";
    attachments?: UserMessageAttachment[];
    timestamp?: number;
  }[];
  status: "running" | "done" | "stopped" | "error";
  error?: string;
};

/** Keep archived/native bytes intact; migrate only the displayed projection. */
export function getVisibleUserMessages(reply: ConversationReply): {
  id: string;
  text: string;
  attachments?: UserMessageAttachment[];
  timestamp?: number;
}[] {
  const messages = reply.userMessages?.length
    ? reply.userMessages
    : [{ id: reply.id, text: reply.prompt, source: reply.promptSource }];
  return messages.map((message) => ({
    id: message.id,
    ...(message.attachments ? { attachments: message.attachments } : {}),
    ...(message.timestamp !== undefined
      ? { timestamp: message.timestamp }
      : {}),
    text:
      message.source === "user"
        ? message.text
        : visibleCanvasPrompt(message.text),
  }));
}
export type ConversationState = {
  version: 1;
  sessionId?: string;
  viewport: { x: number; y: number; zoom: number };
  replies: ConversationReply[];
  /** An untouched archive when an old identity-less view is rebuilt from complete host history. */
  legacyReplies?: ConversationReply[];
};

/** Authoritative host identities, never text matching, control reconciliation. */
export function reconcileConversation(
  state: ConversationState,
  snapshot: AgentSessionSnapshot,
  activeReplyId?: string,
): ConversationState {
  if (snapshot.sessionId !== state.sessionId || snapshot.error) return state;
  const unbound = state.replies.filter(
    (reply) => reply.hostTurnId === undefined && reply.id !== activeReplyId,
  );
  // Older versions only saved random card IDs. Full host history can safely rebuild
  // the presentation without guessing a prompt match. The old data remains archived.
  const migrate =
    unbound.length > 0 &&
    !snapshot.hasMore &&
    !activeReplyId &&
    snapshot.turns.length > 0;
  const replies = migrate ? [] : [...state.replies];
  const archive = migrate
    ? [...(state.legacyReplies ?? []), ...unbound]
    : state.legacyReplies;
  const turns = [...snapshot.turns].sort((a, b) => a.turnId - b.turnId);
  for (const turn of turns) {
    let index = replies.findIndex(
      (reply) =>
        reply.hostTurnId === turn.turnId ||
        (reply.requestId !== undefined &&
          turn.userMessages.some(
            (message) => message.requestId === reply.requestId,
          )),
    );
    // A partial host window cannot prove which identity-less legacy cards it covers.
    // Keep those originals, rather than duplicate or silently discard them.
    if (index < 0 && unbound.length > 0 && !migrate) continue;
    // An own prompt that has not yet received its RPC identity must not be duplicated.
    if (
      index < 0 &&
      activeReplyId &&
      replies.some(
        (reply) => reply.id === activeReplyId && reply.hostTurnId === undefined,
      )
    )
      continue;
    const previous = index < 0 ? undefined : replies[index];
    const localPrompt =
      previous?.localPrompt ??
      (previous && !previous.id.startsWith("host:")
        ? previous.prompt
        : undefined);
    const userMessages = turn.userMessages.map((message) => ({
      id: message.id,
      ...(message.attachments ? { attachments: message.attachments } : {}),
      timestamp: message.timestamp,
      text:
        localPrompt !== undefined && message.requestId === previous?.requestId
          ? localPrompt
          : (message.displayText ?? message.text),
      ...(localPrompt !== undefined &&
      message.requestId === previous?.requestId &&
      previous?.promptSource === "user"
        ? { source: "user" as const }
        : {}),
    }));
    const reply: ConversationReply = {
      id: previous?.id ?? `host:${snapshot.sessionId}:${turn.turnId}`,
      prompt: userMessages.length
        ? userMessages.map((message) => message.text).join("\n\n")
        : (previous?.prompt ?? ""),
      localPrompt,
      ...(previous?.promptSource
        ? { promptSource: previous.promptSource }
        : {}),
      userMessages,
      body: turn.body,
      reasoning:
        turn.reasoning ?? (turn.durable ? undefined : previous?.reasoning),
      position: previous?.position,
      hostTurnId: turn.turnId,
      requestId:
        previous?.requestId ??
        turn.userMessages.find((message) => message.requestId)?.requestId,
      timestamp: turn.timestamp ?? previous?.timestamp,
      durableTime: turn.durable,
      status:
        previous?.status === "stopped" && turn.status !== "done"
          ? "stopped"
          : turn.status,
      error: turn.error,
    };
    if (index < 0) replies.push(reply);
    else replies[index] = reply;
  }
  if (!unbound.length || migrate)
    replies.sort(
      (a, b) => (a.hostTurnId ?? Infinity) - (b.hostTurnId ?? Infinity),
    );
  return {
    ...state,
    replies,
    ...(archive?.length ? { legacyReplies: archive } : {}),
  };
}
