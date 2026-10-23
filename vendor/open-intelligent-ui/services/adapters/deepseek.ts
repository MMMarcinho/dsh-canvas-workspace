import type { SiteAdapter, SiteMessage } from '../site-adapter.js';

const messageSelector = '.ds-message';
const answerSelector = ':scope > .ds-markdown.ds-assistant-message-main-content';
const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);
const proseTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'BR', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'DEL', 'CODE', 'PRE', 'SPAN', 'A', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SUP', 'SUB', 'KBD', 'MARK']);

type Point = { node: Node; offset: number };
type Character = { start: Point; end: Point };

function beside(node: Node, after: boolean): Point {
  const parent = node.parentNode;
  if (!parent) return { node, offset: after ? node.childNodes.length : 0 };
  const index = Array.prototype.indexOf.call(parent.childNodes, node) as number;
  return { node: parent, offset: index + Number(after) };
}

/** A source offset can be mapped back to a DOM Range without flattening formatted prose. */
export function readDeepSeekReplySource(body: Element): { text: string; cloneTextRange: (start: number, end: number) => DocumentFragment } {
  const out: string[] = [];
  const positions: Character[] = [];
  const append = (value: string, start: Point, end: Point) => {
    for (let i = 0; i < value.length; i++) { out.push(value[i]); positions.push({ start, end }); }
  };
  const line = (point: Point) => { if (out.length && out.at(-1) !== '\n') append('\n', point, point); };
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? '';
      for (let i = 0; i < value.length; i++) {
        const start = i;
        const character = value[i] === '\u00a0' ? ' ' : value[i] === '\r' ? '\n' : value[i];
        if (value[i] === '\r' && value[i + 1] === '\n') i++;
        append(character, { node, offset: start }, { node, offset: i + 1 });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.closest('[data-iui-preview]')) return;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON', 'SVG'].includes(element.tagName)) return;
    if (element.tagName === 'BR') { append('\n', beside(element, false), beside(element, true)); return; }
    const isBlockCode = element.tagName === 'PRE' || element.classList.contains('ds-markdown-code-block');
    if (isBlockCode) {
      line(beside(element, false));
      append('```\n', beside(element, false), beside(element, false));
      append(element.textContent ?? '', beside(element, false), beside(element, true));
      append('\n```\n', beside(element, true), beside(element, true));
      return;
    }
    if (element.tagName === 'CODE') {
      append('`', beside(element, false), beside(element, false));
      append(element.textContent ?? '', beside(element, false), beside(element, true));
      append('`', beside(element, true), beside(element, true));
      return;
    }
    const block = blockTags.has(element.tagName);
    // DeepSeek's Markdown pass consumes paired * markers inside DSL expressions.
    // Restore source punctuation rather than concatenating emphasis text.
    const marker = element.tagName === 'EM' ? '*' : element.tagName === 'STRONG' ? '**' : '';
    if (block) line(beside(element, false));
    if (marker) append(marker, beside(element, false), beside(element, false));
    for (const child of element.childNodes) walk(child);
    if (marker) append(marker, beside(element, true), beside(element, true));
    if (block) line(beside(element, true));
  };
  for (const child of body.childNodes) walk(child);
  const raw = out.join('');
  const leading = raw.length - raw.trimStart().length;
  const text = raw.trim();
  const mapped = positions.slice(leading, leading + text.length);
  const cloneTextRange = (start: number, end: number): DocumentFragment => {
    const fragment = body.ownerDocument.createDocumentFragment();
    if (start >= end || !mapped.length) return fragment;
    const first = mapped[Math.max(0, start)]?.start;
    const last = mapped[Math.min(end, mapped.length) - 1]?.end;
    if (!first || !last) return fragment;
    const range = body.ownerDocument.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    fragment.append(range.cloneContents());
    // Cloned site content is display-only: never activate saved scripts, media or controls.
    for (const unsafe of fragment.querySelectorAll('script,style,noscript,button,svg,img,iframe,video,audio,form,input,textarea,select,object,embed,link,base,meta,template')) unsafe.remove();
    for (const element of [...fragment.querySelectorAll('*')]) {
      if (!proseTags.has(element.tagName)) { element.replaceWith(...element.childNodes); continue; }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (!['class', 'href', 'title', 'lang', 'dir'].includes(name) ||
          (name === 'href' && (element.tagName !== 'A' || !/^https?:\/\//i.test(attribute.value)))) element.removeAttribute(attribute.name);
      }
      if (element.tagName === 'A') element.setAttribute('rel', 'noopener noreferrer');
    }
    return fragment;
  };
  return { text, cloneTextRange };
}

/** Read rendered text nodes, never HTML markup or source attributes. DOM text already decodes entities. */
export function readDeepSeekReply(body: Element): string { return readDeepSeekReplySource(body).text; }

/** Snapshot evidence: assistant body is a direct child; thinking and user text use separate containers. */
export class DeepSeekAdapter implements SiteAdapter {
  readonly siteId = 'deepseek';
  private readonly ids = new WeakMap<Element, string>();
  private nextId = 0;
  matches(url: URL): boolean { return url.protocol === 'https:' && url.hostname === 'chat.deepseek.com'; }
  findMessages(document: Document): Iterable<Element> { return document.querySelectorAll(messageSelector); }
  readMessage(element: Element, url: URL): SiteMessage | null {
    if (!element.matches(messageSelector)) return null;
    const answer = element.querySelector(answerSelector);
    if (!answer) return null;
    // The saved protocol starts in a paragraph and continues in a direct
    // .ds-markdown-html span. Treat the complete assistant body as one source.
    const body = answer;
    let identity = this.ids.get(element);
    if (!identity) { identity = `${this.siteId}-${++this.nextId}`; this.ids.set(element, identity); }
    const source = readDeepSeekReplySource(body);
    return {
      element, body, identity, conversationId: `${url.pathname}${url.search}`,
      text: source.text, cloneTextRange: source.cloneTextRange,
      decorateProjection: projection => { projection.classList.add('ds-markdown'); },
      // The saved page provides neither a reliable message ID nor a completion signal.
      stream: 'unknown',
    };
  }
}
