import type { HostAdapter, ResourceRequest, Value } from '../protocol/types.js';

export const projectImageQueries = {
  banner: 'iui:readme-banner',
  icon: 'iui:extension-icon',
} as const;

type LocalImage = { src: string; alt: string; width: number; height: number };

/** Exact project-owned assets only. Query text is never converted into a network request. */
export function createProjectMediaHost(urls: { banner: string; icon: string }): HostAdapter {
  const images: Record<string, LocalImage> = {
    [projectImageQueries.banner]: { src: urls.banner, alt: 'Open Intelligent UI 项目 README 手绘横幅', width: 2172, height: 724 },
    [projectImageQueries.icon]: { src: urls.icon, alt: 'Open Intelligent UI Chrome 扩展图标', width: 128, height: 128 },
  };
  return {
    async resolveResource(request: ResourceRequest): Promise<{ ok: boolean; value?: Value; message?: string }> {
      if (request.kind !== 'AsyncImage' || typeof request.query !== 'string') {
        return { ok: false, message: '只提供 AsyncImage 的本地项目素材' };
      }
      const image = Object.prototype.hasOwnProperty.call(images, request.query) ? images[request.query] : null;
      return image ? { ok: true, value: image } : { ok: false, message: '图片资源未授权或不存在' };
    },
  };
}
