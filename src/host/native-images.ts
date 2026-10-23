import {
  fileMediaUrl,
  resolveWorkspacePath,
} from "@deepseek-ai/dsh-util-workspace-path";
import type { MarkdownPathImages } from "@deepseek-ai/dsh-client-ui-primitives";

/** Use the same session cwd and authenticated file route as native DSH chat. */
export function createNativePathImages(
  base: string,
  cwd?: string,
): MarkdownPathImages {
  return {
    resolve(value) {
      let path: string;
      try {
        // Decode exactly once. Suffixes belong to Markdown, not the filename.
        path = decodeURIComponent(value.split(/[?#]/u)[0] ?? "");
      } catch {
        return undefined;
      }
      // Never turn protocols or network shares into local file requests.
      if (
        !path ||
        /^[\\/]{2}/u.test(path) ||
        /[\u0000-\u001f\u007f]/u.test(path) ||
        (/^[a-z][a-z0-9+.-]*:/iu.test(path) && !/^[a-z]:[\\/]/iu.test(path))
      )
        return undefined;
      return fileMediaUrl(base, resolveWorkspacePath(cwd, path));
    },
  };
}

/** Resolve explicit image paths/URLs only. This is not an image search service. */
export async function resolveNativeImageResource(
  base: string,
  cwd: string | undefined,
  request: { kind: string; query?: unknown },
) {
  if (
    request.kind !== "AsyncImage" ||
    typeof request.query !== "string" ||
    !request.query.trim()
  ) {
    return { ok: false, message: "图片需要明确的文件路径或 HTTP(S) 地址。" };
  }
  const query = request.query.trim();
  let src: string | undefined;
  if (/^https?:\/\//iu.test(query)) {
    try {
      const url = new URL(query);
      if (!url.username && !url.password) src = url.href;
    } catch {
      /* An invalid URL remains an unavailable resource. */
    }
  } else {
    // A prose search query must not silently become a local file request.
    if (!/\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#]|$)/iu.test(query)) {
      return {
        ok: false,
        message: "请提供图片文件路径或 URL；画布未接入图片搜索。",
      };
    }
    src = createNativePathImages(base, cwd).resolve(query);
  }
  if (!src)
    return { ok: false, message: "图片路径无法解析，或会话工作目录尚未就绪。" };
  const alt =
    query.split(/[?#]/u)[0].split(/[\\/]/u).at(-1)?.slice(0, 240) || "图片";
  return { ok: true, value: { src, alt } };
}
