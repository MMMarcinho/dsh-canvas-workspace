import { parseDsl, parseDslPreview, Runtime, SafeEvaluator, type Document as ProtocolDocument, type Node as ProtocolNode } from '../protocol/index.js';
import type { SiteAdapter, SiteMessage } from './site-adapter.js';
import { SiteAdapterRegistry } from './adapter-registry.js';

export type ReplyView = { update(document: ProtocolDocument, hosts?: HTMLElement[]): void; dispose(): void };
export type CreateReplyView = (hosts: HTMLElement[], document: ProtocolDocument) => ReplyView;
type Region = { start: number; end: number; kind: 'declaration' | 'ui' };
type ReplyParts = { document: ProtocolDocument; regions: Region[] };
type Mounted = {
  message: SiteMessage;
  projection: HTMLElement;
  hosts: HTMLElement[];
  view: ReplyView;
  visible: boolean;
  lastText: string;
  lastValidText: string;
  signature: string;
  generation: number;
  invalidSince: number;
};

function hasComponent(nodes: ProtocolNode[]): boolean {
  return nodes.some(node => node.kind === 'element' || ('children' in node && hasComponent(node.children)));
}

function hasPreviewContent(nodes: ProtocolNode[]): boolean {
  return nodes.some(node => node.kind === 'text' ? !!node.text.trim() :
    node.kind === 'expression' || (node.span.end >= 0 && node.kind === 'element') ||
    ('children' in node && hasPreviewContent(node.children)));
}

/** Only inspect expression syntax and names; this never invokes model-provided functions. */
function referencesReady(source: string, available: Set<string>): boolean {
  let ast: any;
  try { ast = new SafeEvaluator().parse(source); } catch { return false; }
  const visit = (node: any, names: Set<string>): boolean => {
    if (!node || typeof node !== 'object') return true;
    if (Array.isArray(node)) return node.every(child => visit(child, names));
    if (node.type === 'Identifier') return names.has(node.name);
    if (node.type === 'Literal' || node.type === 'TemplateElement') return true;
    if (node.type === 'MemberExpression') return visit(node.object, names) && (!node.computed || visit(node.property, names));
    if (node.type === 'Property') return (!node.computed || visit(node.key, names)) && visit(node.value, names);
    if (node.type === 'ArrowFunctionExpression') {
      const local = new Set(names);
      for (const param of node.params) {
        if (param.type !== 'Identifier') return false;
        local.add(param.name);
      }
      return visit(node.body, local);
    }
    return Object.values(node).every(value => visit(value, names));
  };
  return visit(ast, available);
}

function readyForPreview(document: ProtocolDocument): boolean {
  const known = new Set(['Math', 'JSON', 'GenUI', 'Number', 'String']);
  for (const declaration of document.declarations) {
    if (known.has(declaration.name) || (declaration.setter && (known.has(declaration.setter) || declaration.setter === declaration.name))) return false;
    if (!referencesReady(declaration.expression, known)) return false;
    known.add(declaration.name);
    if (declaration.setter) known.add(declaration.setter);
  }
  const runtime = new Runtime(document);
  const scope = runtime.scope();
  if (runtime.feedback.length) return false; // A declaration still depends on unfinished source.
  const ready = (nodes: ProtocolNode[], env: Record<string, unknown>): boolean => {
    try {
      for (const node of nodes) {
        if (node.kind === 'text') continue;
        if (node.kind === 'expression') {
          if (!referencesReady(node.source, new Set([...Object.keys(env), 'Number', 'String']))) return false;
          runtime.value(node.source, env); continue;
        }
        if (node.kind === 'if') {
          if (!referencesReady(node.test, new Set([...Object.keys(env), 'Number', 'String']))) return false;
          if (runtime.value(node.test, env) && !ready(node.children, env)) return false;
          continue;
        }
        if (node.kind === 'each') {
          if (!referencesReady(node.source, new Set([...Object.keys(env), 'Number', 'String']))) return false;
          const values = runtime.value(node.source, env);
          if (!Array.isArray(values)) return false;
          for (const [index, value] of values.slice(0, 100).entries()) {
            if (!ready(node.children, { ...env, [node.item]: value, ...(node.index ? { [node.index]: index } : {}) })) return false;
          }
          continue;
        }
        for (const [name, attribute] of Object.entries(node.attributes)) {
          if (attribute.kind === 'expression') {
            if (!referencesReady(String(attribute.value), new Set([...Object.keys(env), 'Number', 'String']))) return false;
            if (!/^on[A-Z]/.test(name)) runtime.value(String(attribute.value), env);
          }
        }
        if (!ready(node.children, env)) return false;
      }
      return true;
    } catch { return false; }
  };
  return ready(document.children, scope);
}

const signatureOf = (document: ProtocolDocument): string => JSON.stringify({ declarations: document.declarations, children: document.children },
  (key, value) => key === 'span' ? undefined : value);

/** Preview a valid prefix inside open containers; never commit unfinished syntax. */
export function parseReply(source: string, messageId: string): ProtocolDocument | null {
  if (!source || !/[<{]/.test(source)) return null;
  const complete = parseDsl(source, messageId, true);
  const document = complete.complete ? complete : parseDslPreview(source, messageId);
  // A mixed prose answer mentioning a component-shaped tag is not a protocol reply.
  const onlyProtocolAtTopLevel = document.children.every(node => node.kind !== 'text' || !node.text.trim());
  return !document.diagnostics.some(item => item.severity === 'error') && onlyProtocolAtTopLevel &&
    hasComponent(document.children) && (document.complete || hasPreviewContent(document.children)) &&
    readyForPreview(document) ? document : null;
}

const mixedRoots = new Set(['box', 'row', 'col', 'grid', 'card', 'list', 'flow', 'table', 'carousel', 'Chart']);

/** Protocol regions are removed from a formatted site clone; all UI roots share one runtime. */
export function parseReplyParts(source: string, messageId: string): ReplyParts | null {
  if (!source || !/[<{]/.test(source)) return null;
  const complete = parseDsl(source, messageId, true);
  const parsed = complete.complete ? complete : parseDslPreview(source, messageId);
  if (parsed.diagnostics.some(item => item.severity === 'error')) return null;
  const hasProse = parsed.children.some(node => node.kind === 'text' && !!node.text.trim());
  const components = parsed.children.filter((node): node is Extract<ProtocolNode, { kind: 'element' }> => node.kind === 'element');
  const roots = components.filter(node => {
    if (!hasProse) return true;
    // An inline mention of a component name is ordinary text. A standalone
    // structural root, or a root directly following a declaration, is explicit UI.
    const beforeLine = source.slice(0, node.span.start).split('\n').at(-1) ?? '';
    const followsDeclaration = parsed.declarations.some(declaration =>
      declaration.span.end <= node.span.start && !source.slice(declaration.span.end, node.span.start).trim());
    return followsDeclaration || (mixedRoots.has(node.name) && !beforeLine.trim());
  });
  if (!roots.length) return null;
  const document: ProtocolDocument = { ...parsed, children: roots };
  if (!readyForPreview(document)) return null;
  const regions: Region[] = [
    ...parsed.declarations.map(item => ({ start: item.span.start, end: item.span.end, kind: 'declaration' as const })),
    ...roots.map(item => ({ start: item.span.start, end: item.span.end < 0 ? source.length : item.span.end, kind: 'ui' as const })),
  ].sort((a, b) => a.start - b.start);
  if (regions.some((region, index) => region.end <= region.start || (index > 0 && region.start < regions[index - 1].end))) return null;
  return { document, regions };
}

/** Keeps all site-specific DOM knowledge in adapters and all UI state in one mount per reply. */
export class ReplyCoordinator {
  private readonly mounted = new Map<Element, Mounted>();
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private routeTimer: ReturnType<typeof setInterval> | null = null;
  private style: HTMLStyleElement | null = null;
  private started = false;
  private enabled = true;
  private activeUrl = '';
  private activeAdapter: SiteAdapter | null = null;

  constructor(
    private readonly document: Document,
    private readonly registry: SiteAdapterRegistry,
    private readonly createView: CreateReplyView,
    private readonly debounceMs = 60,
    private readonly adapterForUrl: (url: URL) => SiteAdapter | null = url => registry.match(url),
  ) {}

  get status() { return { enabled: this.enabled, siteId: this.activeAdapter?.siteId ?? null, rendered: [...this.mounted.values()].filter(item => item.visible).length }; }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.enabled) this.activate();
  }

  private activate(): void {
    if (this.observer) return;
    this.style = this.document.createElement('style');
    this.style.textContent = '[data-iui-original-hidden]{display:none!important}';
    this.document.head.append(this.style);
    const Observer = this.document.defaultView?.MutationObserver;
    if (!Observer) throw new Error('MutationObserver unavailable');
    this.observer = new Observer(records => {
      if (!this.enabled || !records.some(record => this.isExternalMutation(record))) return;
      this.schedule();
    });
    this.observer.observe(this.document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    this.scan();
    this.routeTimer = setInterval(() => {
      if (!this.enabled) return;
      const url = this.document.defaultView?.location.href;
      if (url && !this.activeUrl.endsWith(url)) this.schedule();
    }, 1000);
  }

  stop(): void {
    this.started = false;
    this.deactivate();
  }

  private deactivate(): void {
    this.observer?.disconnect(); this.observer = null;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (this.routeTimer) clearInterval(this.routeTimer); this.routeTimer = null;
    this.clear(); this.style?.remove(); this.style = null;
    this.activeUrl = '';
    this.activeAdapter = null;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!this.started) return;
    if (enabled) this.activate();
    else this.deactivate();
  }

  refresh(): void { if (this.started && this.enabled) this.scan(); }

  private isExternalMutation(record: MutationRecord): boolean {
    const target = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
    if (target?.closest('[data-iui-projection]')) return false;
    if (record.type === 'childList') {
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if (nodes.length && nodes.every(node => node === this.style || (node.nodeType === 1 && (node as Element).matches('[data-iui-projection]')))) return false;
    }
    return true;
  }

  private schedule(): void {
    // A trailing debounce starves the renderer when tokens arrive faster than
    // debounceMs. Keep the first scheduled scan and sample a continuous stream.
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.scan(); }, this.debounceMs);
  }

  scan(): void {
    if (!this.enabled) return;
    const view = this.document.defaultView;
    if (!view) return;
    const url = new URL(view.location.href);
    const adapter = this.adapterForUrl(url);
    const route = `${adapter?.siteId ?? ''}:${url.href}`;
    if (route !== this.activeUrl) { this.clear(); this.activeUrl = route; }
    this.activeAdapter = adapter;
    if (!adapter) return;
    const seen = new Set<Element>();
    try {
      for (const element of adapter.findMessages(this.document)) {
        const message = adapter.readMessage(element, url);
        if (!message) continue;
        seen.add(message.element);
        this.accept(message, adapter);
      }
    } catch { /* A changing site DOM must leave its own reply readable. */ }
    for (const [element, item] of this.mounted) {
      if (!seen.has(element) || !element.isConnected || !item.message.body.isConnected || !item.projection.isConnected) this.unmount(element);
    }
  }

  private accept(message: SiteMessage, adapter: SiteAdapter): void {
    let item = this.mounted.get(message.element);
    if (item && (item.message.identity !== message.identity || item.message.conversationId !== message.conversationId)) {
      this.unmount(message.element); item = undefined;
    }
    const bodyChanged = !!item && item.message.body !== message.body;
    if (bodyChanged && item) {
      item.message.body.removeAttribute('data-iui-original-hidden');
      item.message = message;
      message.body.after(item.projection);
      if (item.visible) message.body.setAttribute('data-iui-original-hidden', '');
    } else if (item && !item.projection.isConnected) message.body.after(item.projection);
    if (item && item.lastText === message.text && !item.invalidSince && !bodyChanged) return;
    if (item) item.message = message; // Source ranges belong to the latest text nodes.
    const generation = item?.generation ?? 0;
    const changedGeneration = !!item && !!item.lastValidText && !!message.text &&
      !message.text.startsWith(item.lastValidText) && !item.lastValidText.startsWith(message.text) &&
      message.text.trimStart().slice(0, 8) !== item.lastValidText.trimStart().slice(0, 8);
    const nextGeneration = changedGeneration ? generation + 1 : generation;
    const messageId = `${adapter.siteId}:${message.conversationId}:${message.identity}:${nextGeneration}`;
    let parsed: ReplyParts | null;
    try { parsed = parseReplyParts(message.text, messageId); }
    catch { parsed = null; }
    if (!parsed) {
      if (item) {
        item.lastText = message.text;
        // A short Markdown reflow must not blank an interactive preview. A stable
        // ordinary replacement, however, should eventually return to site text.
        const ordinary = !!message.text.trim() && !/[<{]/.test(message.text);
        if (ordinary) {
          if (!item.invalidSince) {
            item.invalidSince = Date.now();
            setTimeout(() => { if (this.enabled && this.mounted.get(message.element) === item) this.scan(); }, 800);
          } else if (Date.now() - item.invalidSince >= 750) this.unmount(message.element);
        } else item.invalidSince = 0;
      }
      return;
    }
    if (changedGeneration) { this.unmount(message.element); item = undefined; }
    const signature = signatureOf(parsed.document);
    if (item) {
      try {
        const count = parsed.regions.filter(region => region.kind === 'ui').length;
        const resized = item.hosts.length !== count;
        while (item.hosts.length < count) {
          const host = this.document.createElement('div');
          host.setAttribute('data-iui-preview', '');
          item.hosts.push(host);
        }
        if (item.hosts.length > count) item.hosts.length = count;
        this.project(item, parsed);
        if (signature !== item.signature || resized) item.view.update(parsed.document, item.hosts);
      } catch { this.unmount(message.element); item = undefined; }
      if (item) {
        item.signature = signature;
        item.lastText = message.text; item.lastValidText = message.text; item.invalidSince = 0;
        this.setVisible(item, true);
        return;
      }
    }
    const projection = this.document.createElement('div');
    projection.setAttribute('data-iui-projection', '');
    message.decorateProjection?.(projection);
    const hosts = parsed.regions.filter(region => region.kind === 'ui').map(() => {
      const host = this.document.createElement('div');
      host.setAttribute('data-iui-preview', '');
      return host;
    });
    try {
      message.body.after(projection);
      item = { message, projection, hosts, view: { update() {}, dispose() {} }, visible: false, lastText: message.text, lastValidText: message.text, signature, generation: nextGeneration, invalidSince: 0 };
      this.project(item, parsed);
      item.view = this.createView(hosts, parsed.document);
      this.mounted.set(message.element, item);
      this.setVisible(item, true);
    } catch { projection.remove(); message.body.removeAttribute('data-iui-original-hidden'); }
  }

  private project(item: Mounted, parsed: ReplyParts): void {
    const { cloneTextRange, text } = item.message;
    const fragment = this.document.createDocumentFragment();
    let offset = 0, hostIndex = 0;
    for (const region of parsed.regions) {
      // Whitespace between declarations and UI is protocol spacing, not a
      // paragraph to replay. It otherwise leaves empty site block wrappers.
      if (text.slice(offset, region.start).trim()) fragment.append(cloneTextRange(offset, region.start));
      if (region.kind === 'ui') fragment.append(item.hosts[hostIndex++]);
      offset = region.end;
    }
    if (text.slice(offset).trim()) fragment.append(cloneTextRange(offset, text.length));
    item.projection.replaceChildren(fragment);
  }

  private setVisible(item: Mounted, visible: boolean): void {
    item.visible = visible;
    item.projection.hidden = !visible;
    if (visible) item.message.body.setAttribute('data-iui-original-hidden', '');
    else item.message.body.removeAttribute('data-iui-original-hidden');
  }

  private unmount(element: Element): void {
    const item = this.mounted.get(element);
    if (!item) return;
    this.mounted.delete(element);
    item.message.body.removeAttribute('data-iui-original-hidden');
    try { item.view.dispose(); } catch { /* Original text must still be restored. */ }
    item.projection.remove();
  }
  private clear(): void { for (const element of [...this.mounted.keys()]) this.unmount(element); }
}
