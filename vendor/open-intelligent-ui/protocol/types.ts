export type Span = { start: number; end: number };
export type Diagnostic = { code: string; message: string; span: Span; severity: 'error' | 'warning' };
export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export type Attribute = { kind: 'literal' | 'expression'; value: string | boolean; span: Span };
export type Node =
  | { kind: 'text'; text: string; span: Span }
  | { kind: 'expression'; source: string; span: Span }
  | { kind: 'element'; name: string; attributes: Record<string, Attribute>; children: Node[]; span: Span; rawContent?: string }
  | { kind: 'if'; test: string; children: Node[]; span: Span }
  | { kind: 'each'; source: string; item: string; index?: string; children: Node[]; span: Span };
export type Declaration = { name: string; setter?: string; expression: string; state: boolean; span: Span };
export type Document = { protocol: 'iui/0.1'; messageId: string; declarations: Declaration[]; children: Node[]; diagnostics: Diagnostic[]; complete: boolean };
export type HostAction = { kind: 'copy' | 'issueNewTurn'; payload: string; id: string; messageId: string };
export type ResourceRequest = { kind: string; query?: Value; url?: string; props: Record<string, Value>; messageId: string };
export type AppBlockRequest = { messageId: string; id: string; title?: string; html: string };
export type HostAdapter = {
  requestAction?: (action: HostAction) => Promise<{ ok: boolean; message?: string }>;
  resolveResource?: (request: ResourceRequest) => Promise<{ ok: boolean; value?: Value; message?: string }>;
  /** Called only after a user presses Run. The host must review/allowlist this content. */
  authorizeAppBlock?: (request: AppBlockRequest) => Promise<{ ok: boolean; html?: string; message?: string }>;
};
export const limits = { sourceBytes: 200_000, nodes: 2_000, depth: 32, expressionSteps: 5_000, arrayItems: 1_000, stringLength: 20_000, actionLength: 8_000 } as const;
