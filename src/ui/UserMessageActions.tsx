import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon } from "./icons";

/** Follows DSH Chat's sent-message action placement with Canvas's local clock. */
export function UserMessageActions({
  text,
  time,
  copyText,
  renderCopyIcon,
  wrapCopyButton,
}: {
  text: string;
  time: { short: string; full: string } | null;
  copyText?: (text: string) => Promise<boolean>;
  renderCopyIcon?: (copied: boolean) => ReactNode;
  wrapCopyButton?: (button: ReactElement, label: string) => ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  async function copy() {
    if (!text || copied || pending.current) return;
    pending.current = true;
    let ok = false;
    try {
      if (copyText) ok = await copyText(text);
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      // A blocked clipboard should leave the source message available to select.
    } finally {
      pending.current = false;
    }
    if (!alive.current || !ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (alive.current) setCopied(false);
    }, 1000);
  }
  return (
    <div className="chat-user-message-actions" data-chat-user-actions="">
      {time && (
        <time className="chat-user-message-time" title={time.full}>
          {time.short}
        </time>
      )}
      {text &&
        (() => {
          const label = copied ? "已复制" : "复制";
          const button = (
            <button
              className="chat-user-message-copy"
              type="button"
              aria-label={copied ? "已复制" : "复制消息文字"}
              title={label}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void copy();
              }}
            >
              {renderCopyIcon?.(copied) ?? (
                <Icon name={copied ? "check" : "copy"} size={15} />
              )}
            </button>
          );
          return wrapCopyButton?.(button, label) ?? button;
        })()}
    </div>
  );
}
