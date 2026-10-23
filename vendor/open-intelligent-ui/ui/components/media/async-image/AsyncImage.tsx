import React, { useEffect, useState } from 'react';
import type { HostAdapter, Value } from '../../../../protocol/types.js';
import { safeCssSize } from '../../../../protocol/registry.js';
import { UnconfiguredHost } from '../unconfigured-host/UnconfiguredHost.js';

type ImageResource = { src: string; alt: string; width?: number; height?: number };
type Props = { query: unknown; aspectRatio?: unknown; width?: unknown; messageId: string; adapter: HostAdapter };
type State = { phase: 'resolving' | 'loading' | 'ready' | 'error'; image?: ImageResource; message?: string };

function safeImageSource(src: string): string | null {
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(src) && src.length <= 4_000_000) return src;
  try {
    const url = new URL(src);
    if (url.username || url.password) return null;
    if (['https:', 'http:'].includes(url.protocol)) return url.href;
    // Trusted host resolution may return DSH Desktop's exact authenticated
    // file endpoint. Do not allow arbitrary custom-scheme routes.
    const path = url.searchParams.get('path');
    if (url.protocol === 'dsh-app:' && url.hostname === 'app' && !url.port &&
        url.pathname === '/api/file' && !url.hash && path &&
        [...url.searchParams.keys()].length === 1 &&
        (path.startsWith('/') || /^[a-z]:[/\\]/i.test(path)) &&
        !/^[/\\]{2}/.test(path) && !/[\u0000-\u001f\u007f]/.test(path)) return url.href;
    return null;
  } catch { return null; }
}

function imageFromValue(value: Value | undefined): ImageResource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const src = typeof value.src === 'string' ? safeImageSource(value.src) : null;
  if (!src || typeof value.alt !== 'string' || !value.alt.trim() || value.alt.length > 240) return null;
  const width = typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 ? value.width : undefined;
  const height = typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0 ? value.height : undefined;
  return { src, alt: value.alt, width, height };
}

function ratio(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(value);
  if (!match || !Number(match[1]) || !Number(match[2])) return undefined;
  return `${Number(match[1])} / ${Number(match[2])}`;
}

export function AsyncImage({ query, aspectRatio, width, messageId, adapter }: Props) {
  const [state, setState] = useState<State>({ phase: 'resolving' });
  useEffect(() => {
    if (!adapter.resolveResource) return;
    let active = true;
    if (typeof query !== 'string' || !query.trim()) {
      setState({ phase: 'error', message: '图片查询需为非空字符串' });
      return () => { active = false; };
    }
    setState({ phase: 'resolving' });
    void adapter.resolveResource({ kind: 'AsyncImage', query, props: {}, messageId }).then(result => {
      if (!active) return;
      const image = result.ok ? imageFromValue(result.value) : null;
      setState(image ? { phase: 'loading', image } : { phase: 'error', message: result.message || '图片资源不可用' });
    }, () => { if (active) setState({ phase: 'error', message: '图片资源解析失败' }); });
    return () => { active = false; };
  }, [adapter, query, messageId]);
  if (!adapter.resolveResource) return <UnconfiguredHost name="AsyncImage" />;
  const style: React.CSSProperties = { width: safeCssSize(width) ?? '100%', aspectRatio: ratio(aspectRatio) };
  return <figure className="iui-async-image" style={style} data-image-status={state.phase}>
    {state.image && <img src={state.image.src} alt={state.image.alt} width={state.image.width} height={state.image.height}
      onLoad={() => setState(current => current.image?.src === state.image?.src ? { ...current, phase: 'ready' } : current)}
      onError={() => setState({ phase: 'error', message: '图片加载失败', image: state.image })} />}
    {state.phase !== 'ready' && <div className="iui-image-status" role="status">
      {state.phase === 'error' ? `${state.image?.alt ?? String(query ?? '')}：${state.message}` : '图片加载中…'}
    </div>}
  </figure>;
}

export function AsyncImageGroup({ queries, aspectRatio, layout, messageId, adapter }: {
  queries: unknown; aspectRatio?: unknown; layout?: unknown; messageId: string; adapter: HostAdapter;
}) {
  const [index, setIndex] = useState(0);
  if (!adapter.resolveResource) return <UnconfiguredHost name="AsyncImageGroup" />;
  if (!Array.isArray(queries) || !queries.length || queries.length > 8 || queries.some(query => typeof query !== 'string' || !query.trim())) {
    return <div className="iui-unavailable">AsyncImageGroup · 图片查询需为 1–8 个非空字符串</div>;
  }
  if (layout === 'carousel') return <div className="iui-image-carousel">
    <AsyncImage key={queries[index % queries.length]} query={queries[index % queries.length]} aspectRatio={aspectRatio} messageId={messageId} adapter={adapter} />
    <div className="iui-image-controls"><button type="button" onClick={() => setIndex(value => (value + queries.length - 1) % queries.length)} aria-label="上一张图片">‹</button>
      <span>{index % queries.length + 1} / {queries.length}</span>
      <button type="button" onClick={() => setIndex(value => (value + 1) % queries.length)} aria-label="下一张图片">›</button></div>
  </div>;
  return <div className="iui-image-group">{queries.map((query, index) =>
    <AsyncImage key={`${query}:${index}`} query={query} aspectRatio={aspectRatio} messageId={messageId} adapter={adapter} />)}</div>;
}
