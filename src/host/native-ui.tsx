import { createNativePathImages } from "./native-images";
import {
  BrandWordmark,
  IconUserOutlineMedium,
  IconPanelLeftOutlineRegular,
  IconSendOutlineMedium,
  MarkdownText,
  MarkdownDelegateProvider,
  ImageLightbox,
  type MarkdownLabels,
} from "@deepseek-ai/dsh-client-ui-primitives";

/** Stable labels preserve the native renderer's memoized parsing state. */
const markdownLabels: MarkdownLabels = {
  code: { copyLabel: "复制", copiedLabel: "已复制" },
  footnotes: "脚注",
};
const imageLabels = {
  open: "查看原图",
  loading: "图片加载中",
  failed: "图片加载失败",
  dialog: "图片预览",
  close: "关闭图片预览",
};

/** The public DSH lightbox handles viewport sizing, Escape, backdrop and focus. */
export function renderNativeImagePreview(
  src: string,
  alt: string,
  onClose: () => void,
) {
  return (
    <ImageLightbox src={src} alt={alt} labels={imageLabels} onClose={onClose} />
  );
}

/** The shared host artwork inherits the host theme, including badge inversion. */
export function NativeBrand() {
  return <BrandWordmark size={24} />;
}

/** Generic native avatar glyph; deliberately does not claim account identity. */
export function NativeAvatar() {
  return <IconUserOutlineMedium size={16} />;
}

/** Native navigation glyph, without invoking or changing the host sidebar. */
export function NativeNavigationIcon() {
  return <IconPanelLeftOutlineRegular size={18} />;
}

/** Public native send arrow; the canvas still owns its one persistent session. */
export function NativeSendIcon() {
  return <IconSendOutlineMedium size={16} />;
}

/** DSH's safe Markdown body renderer, with native incremental stream parsing. */
export function renderNativeMarkdown(
  text: string,
  streaming = false,
  cwd?: string,
) {
  const pathImages =
    typeof document === "undefined"
      ? undefined
      : createNativePathImages(document.baseURI, cwd);
  return (
    <MarkdownDelegateProvider
      fileImages={
        pathImages
          ? {
              resolve: pathImages.resolve,
              labels: imageLabels,
            }
          : undefined
      }
    >
      <MarkdownText
        text={text}
        streaming={streaming}
        labels={markdownLabels}
        pathImages={pathImages}
        variant="body"
      />
    </MarkdownDelegateProvider>
  );
}
