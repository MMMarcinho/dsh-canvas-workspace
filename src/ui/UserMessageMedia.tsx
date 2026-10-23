import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MessageImageLoader } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { UserMessageAttachment } from "../core/types";
import type { ReplyImagePreviewRenderer } from "./ReplyContent";
import { Icon } from "./icons";

type DurableImage = {
  type: "image";
  image: { attachment: Parameters<MessageImageLoader>[0] };
};
type DisplayAttachment =
  | DurableImage
  | Extract<UserMessageAttachment, { type: "file" }>;
export type UserImageLoader = (
  attachment: DurableImage["image"]["attachment"],
  sessionId: string,
) => Promise<string>;

/** DSH Web's singleFit rule: a lone image has a 240px long edge, no upscale. */
export function nativeSingleImageFit(
  attachment: DurableImage["image"]["attachment"],
) {
  const width = attachment.width;
  const height = attachment.height;
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height))
    return { width: 240, height: 240, objectPosition: "center" };
  const natural = width / height;
  const ratio = Math.min(4, Math.max(0.25, natural));
  const box =
    ratio >= 1
      ? { width: 240, height: 240 / ratio }
      : { width: 240 * ratio, height: 240 };
  const scale = Math.min(1, width / box.width, height / box.height);
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition:
      natural < 0.25 ? "center top" : natural > 4 ? "left center" : "center",
  };
}

function ImageTile({
  image,
  index,
  compact,
  sessionId,
  loadImage,
  renderPreview,
}: {
  image: DurableImage;
  index: number;
  compact: boolean;
  sessionId: string;
  loadImage: UserImageLoader;
  renderPreview?: ReplyImagePreviewRenderer;
}) {
  const attachment = image.image.attachment;
  const fit = nativeSingleImageFit(attachment);
  const loader = useRef(loadImage);
  loader.current = loadImage;
  const [retry, setRetry] = useState(0);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const alt = attachment.name || `图片 ${index + 1}`;
  useEffect(() => {
    let active = true;
    setUrl(undefined);
    setFailed(false);
    setOpen(false);
    void loader.current(attachment, sessionId).then(
      (value) => {
        if (active) setUrl(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attachment.attachmentId, sessionId, retry]);
  return (
    <>
      <button
        className="chat-user-image-tile"
        data-variant={compact ? "tile" : "single"}
        style={compact ? undefined : { width: fit.width, height: fit.height }}
        type="button"
        aria-label={failed ? `重试加载${alt}` : `查看${alt}`}
        title={failed ? "图片暂不可用，点击重试" : alt}
        onClick={(event) => {
          event.stopPropagation();
          if (failed) setRetry((value) => value + 1);
          else if (url) setOpen(true);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {url ? (
          <img
            src={url}
            alt={alt}
            loading="lazy"
            draggable={false}
            style={compact ? undefined : { objectPosition: fit.objectPosition }}
          />
        ) : (
          <span>{failed ? "重试图片" : "图片加载中"}</span>
        )}
      </button>
      {open && url && renderPreview?.(url, alt, () => setOpen(false))}
    </>
  );
}

/** Native attachment order and file cards; durable images use the host loader. */
export function UserMessageMedia({
  attachments,
  sessionId,
  loadImage,
  renderPreview,
  renderFileIcon,
  formatFileMeta,
}: {
  attachments?: UserMessageAttachment[];
  sessionId?: string;
  loadImage?: UserImageLoader;
  renderPreview?: ReplyImagePreviewRenderer;
  renderFileIcon?: (name: string) => ReactNode;
  formatFileMeta?: (name: string, bytes: number) => string;
}) {
  const items = attachments?.filter(
    (item): item is DisplayAttachment =>
      item.type === "file" ||
      (item.type === "image" &&
        "attachment" in item.image &&
        !!item.image.attachment &&
        !!sessionId &&
        !!loadImage),
  );
  if (!items?.length) return null;
  const compact = items.length > 1;
  return (
    <div className="chat-user-media" data-message-attachments="">
      {items.map((item, index) =>
        item.type === "file" ? (
          <span
            className="chat-user-file-card"
            key={`file:${item.file.attachmentId}`}
            title={item.file.name}
          >
            <span className="chat-user-file-icon">
              {renderFileIcon?.(item.file.name) ?? (
                <Icon name="artifact" size={28} />
              )}
            </span>
            <span className="chat-user-file-content">
              <span className="chat-user-file-name">{item.file.name}</span>
              <span className="chat-user-file-meta">
                {formatFileMeta?.(item.file.name, item.file.bytes) ??
                  `${item.file.bytes}B`}
              </span>
            </span>
          </span>
        ) : (
          <ImageTile
            key={`image:${item.image.attachment.attachmentId}`}
            image={item}
            index={index}
            compact={compact}
            sessionId={sessionId!}
            loadImage={loadImage!}
            renderPreview={renderPreview}
          />
        ),
      )}
    </div>
  );
}
