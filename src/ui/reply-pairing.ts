import {
  getVisibleUserMessages,
  type ConversationReply,
} from "../core/conversation";
import type { UserMessageAttachment } from "../core/types";

export type PairTarget = {
  scope: string;
  source: "reply" | "user";
  id: string;
};

/** A display-only projection. Host history and persisted reply IDs stay untouched. */
export function buildReplyPairs(replies: ConversationReply[], scope: string) {
  const parents = new Map<string, string>();
  const identity = (kind: string, id: string | number) =>
    JSON.stringify([kind, id]);
  const find = (key: string): string => {
    const parent = parents.get(key);
    if (!parent) {
      parents.set(key, key);
      return key;
    }
    if (parent === key) return key;
    const root = find(parent);
    parents.set(key, root);
    return root;
  };
  const link = (left: string, right: string) => {
    const a = find(left),
      b = find(right);
    // Deterministic across rendering order; real host identities win over fallback IDs.
    if (a !== b) parents.set(a < b ? b : a, a < b ? a : b);
  };
  const replyIdentity = (id: string) => identity("3-reply", id);
  for (const reply of replies) {
    const key = replyIdentity(reply.id);
    find(key);
    if (reply.hostTurnId !== undefined)
      link(key, identity("0-turn", reply.hostTurnId));
    if (reply.requestId) link(key, identity("1-request", reply.requestId));
    for (const message of reply.userMessages ?? [])
      link(key, identity("2-user", message.id));
  }
  const replyPairs = new Map(
    replies.map((reply) => [
      reply.id,
      JSON.stringify([scope, find(replyIdentity(reply.id))]),
    ]),
  );
  const userMessages: {
    id: string;
    messageId: string;
    text: string;
    attachments?: UserMessageAttachment[];
    timestamp?: number;
    replyId: string;
    pairKey: string;
  }[] = [];
  const userPairs = new Map<string, string>();
  for (const reply of replies) {
    const pairKey = replyPairs.get(reply.id)!;
    for (const message of getVisibleUserMessages(reply)) {
      if (!message.text && !message.attachments?.length) continue;
      const id = reply.userMessages?.length
        ? identity("user", message.id)
        : reply.requestId
          ? identity("request", reply.requestId)
          : reply.hostTurnId !== undefined
            ? identity("turn", reply.hostTurnId)
            : identity("reply", reply.id);
      // One native input may be attached to several assistant outputs. Never dedupe text.
      if (userPairs.has(id)) continue;
      userPairs.set(id, pairKey);
      userMessages.push({
        id,
        messageId: message.id,
        text: message.text,
        ...(message.attachments ? { attachments: message.attachments } : {}),
        ...(message.timestamp !== undefined
          ? { timestamp: message.timestamp }
          : {}),
        replyId: reply.id,
        pairKey,
      });
    }
  }
  return { scope, replyPairs, userPairs, userMessages };
}

export function activeReplyPair(
  pairs: ReturnType<typeof buildReplyPairs>,
  target: PairTarget | null,
): string | undefined {
  if (!target || target.scope !== pairs.scope) return;
  return (target.source === "reply" ? pairs.replyPairs : pairs.userPairs).get(
    target.id,
  );
}
