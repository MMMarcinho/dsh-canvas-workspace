import { parseReplyParts } from '../../../services/reply-coordinator.js';
import type { Document } from '../../../protocol/index.js';

export type ReplySegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'ui'; index: number };

/** Keep Markdown in its original order while sharing one IUI document per text block. */
export function splitReply(source: string, messageId: string): { document: Document; segments: ReplySegment[] } | null {
  const parsed = parseReplyParts(source, messageId);
  if (!parsed) return null;
  const segments: ReplySegment[] = [];
  let cursor = 0;
  let uiIndex = 0;
  const appendMarkdown = (text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'markdown') last.text += text;
    else segments.push({ kind: 'markdown', text });
  };
  for (const region of parsed.regions) {
    if (region.start > cursor) appendMarkdown(source.slice(cursor, region.start));
    if (region.kind === 'ui') segments.push({ kind: 'ui', index: uiIndex++ });
    cursor = region.end;
  }
  if (cursor < source.length) appendMarkdown(source.slice(cursor));
  return { document: parsed.document, segments };
}
