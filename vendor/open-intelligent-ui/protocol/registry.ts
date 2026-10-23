export type Support = 'local' | 'host' | 'unsupported';
export type ComponentSpec = { name: string; support: Support; description: string; props?: string[] };
const local = '本地 React 实现';
const host = '需宿主资源或授权';
export const registry: ComponentSpec[] = [
  ...'text title caption badge code math label bold italic underline strikethrough icon box row col grid flow card carousel table list divider spacer pressable popover blockquote carousel-item grid-item table-row table-cell list-item flow-item popover-trigger popover-content button input textarea select checkbox radio-group radio slider date-picker segmented-control Chart CodeBlock'.split(' ').map(name => ({ name, support: 'local' as const, description: local })),
  ...'AsyncImage AsyncImageGroup AsyncVideo MapWidgetV2 favicon Entity Cite Link FollowUp FileCite FileNavList MemoryCite WritingBlock'.split(' ').map(name => ({ name, support: 'host' as const, description: host })),
  {name:'AppBlock',support:'host' as const,description:'本地受限宿主可手动运行已审阅样本；默认未配置，不接受任意代码'}
  ,{name:'svg',support:'unsupported',description:'v0.1 不接受模型提供的任意 SVG；仅图表与内置图标生成固定 SVG'}
];
export const componentNames = new Set(registry.map(x => x.name));
export const byName = new Map(registry.map(x => [x.name, x]));
export const safeUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    return u.href;
  } catch { return null; }
};
export const safeCssSize = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return `${Math.max(0, Math.min(2000, value))}px`;
  if (typeof value === 'string' && /^(?:\d+(?:\.\d+)?(?:px|%|rem|em|vh|vw)|auto)$/.test(value)) return value;
  return undefined;
};
export const safeColor = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  const colors: Record<string,string> = { primary:'var(--iui-primary)',success:'var(--iui-success)',warning:'var(--iui-warning)',danger:'var(--iui-danger)',info:'var(--iui-info)',secondary:'var(--iui-text-muted)',tertiary:'var(--iui-text-muted)',default:'var(--iui-text)',subtle:'var(--iui-border)','surface-secondary':'var(--iui-surface-muted)','surface-tertiary':'var(--iui-surface-tertiary)',surface:'var(--iui-surface)' };
  return colors[value];
};
