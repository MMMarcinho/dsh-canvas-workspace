/** URL routing is separate from site DOM adapters and from Chrome permissions. */
export type AdapterId = 'deepseek';
export type UrlRule = { id: string; pattern: string; adapterId: AdapterId };
export type ExtensionSettings = { enabled: boolean; defaultDeepSeek: boolean; rules: UrlRule[] };
export const DEFAULT_SETTINGS: ExtensionSettings = { enabled: true, defaultDeepSeek: true, rules: [] };
export const ADAPTER_OPTIONS: ReadonlyArray<{ id: AdapterId; label: string }> = [
  { id: 'deepseek', label: 'DeepSeek 回复结构（含保存页）' },
];

type ValidRule = { ok: true; pattern: string; adapterId: AdapterId; hostPattern: string };
type InvalidRule = { ok: false; error: string };

/** Wildcards are allowed only after the URL authority, so grants remain origin scoped. */
export function validateUrlRule(patternInput: string, adapterInput: string): ValidRule | InvalidRule {
  const raw = patternInput.trim();
  if (!raw || raw.length > 512 || /[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, error: '请输入不超过 512 字符的页面 URL 或路径规则。' };
  if (!ADAPTER_OPTIONS.some(option => option.id === adapterInput)) return { ok: false, error: '请选择已安装的站点适配器。' };
  const scheme = /^(https?:\/\/|file:\/\/\/)/i.exec(raw)?.[1];
  if (!scheme) return { ok: false, error: '仅支持 http://、https:// 或 file:/// 页面。' };
  if (scheme.toLowerCase() !== 'file:///') {
    const authority = /^https?:\/\/([^/?#]+)/i.exec(raw)?.[1] ?? '';
    if (!authority || authority.includes('*')) return { ok: false, error: '域名必须写完整；* 只能用于路径、查询或片段。' };
  }
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, error: '页面 URL 格式无效。' }; }
  if (url.username || url.password) return { ok: false, error: '规则中不能包含账号或密码。' };
  if (url.protocol === 'file:') {
    if (url.host || !raw.toLowerCase().startsWith('file:///')) return { ok: false, error: '本地文件请使用 file:///绝对路径。' };
    return { ok: true, pattern: url.href, adapterId: adapterInput as AdapterId, hostPattern: 'file:///*' };
  }
  if (!url.hostname || !['http:', 'https:'].includes(url.protocol)) return { ok: false, error: '页面 URL 格式无效。' };
  return { ok: true, pattern: url.href, adapterId: adapterInput as AdapterId, hostPattern: `${url.protocol}//${url.hostname}/*` };
}

export function normalizeSettings(value: unknown, legacyEnabled?: unknown): ExtensionSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS, enabled: legacyEnabled !== false, rules: [] };
  const input = value as Record<string, unknown>;
  const rules: UrlRule[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input.rules)) for (const raw of input.rules.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || seen.has(id)) continue;
    const result = validateUrlRule(String(item.pattern ?? ''), String(item.adapterId ?? ''));
    if (!result.ok) continue;
    seen.add(id);
    rules.push({ id, pattern: result.pattern, adapterId: result.adapterId });
  }
  return { enabled: input.enabled !== false, defaultDeepSeek: input.defaultDeepSeek !== false, rules };
}

const escapeRegex = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
export function urlMatchesPattern(url: URL, pattern: string): boolean {
  const validated = validateUrlRule(pattern, 'deepseek');
  if (!validated.ok) return false;
  const expression = `^${validated.pattern.split('*').map(escapeRegex).join('.*')}$`;
  return new RegExp(expression).test(url.href);
}

/** Most recently added custom rule wins; the built-in DeepSeek rule is fallback. */
export function selectPageAdapter(url: URL, settings: ExtensionSettings): AdapterId | null {
  if (!settings.enabled) return null;
  for (let index = settings.rules.length - 1; index >= 0; index--) {
    const rule = settings.rules[index];
    if (urlMatchesPattern(url, rule.pattern)) return rule.adapterId;
  }
  if (settings.defaultDeepSeek && url.protocol === 'https:' && url.hostname === 'chat.deepseek.com') return 'deepseek';
  return null;
}
