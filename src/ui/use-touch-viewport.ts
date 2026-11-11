import { useEffect, useRef, type RefObject } from "react";
import { TouchViewportGesture, type TouchViewport } from "./touch-viewport";

const CONTROLS =
  'input,textarea,select,button,a,label,summary,iframe,video,audio,[role="button"],[role="textbox"],[role="slider"],[role="checkbox"],[role="radio"],[role="switch"],[contenteditable]:not([contenteditable="false"]),[data-canvas-pan-exclude],[data-canvas-iui-root]';
function isControl(target: EventTarget | null, stage: HTMLElement): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== stage) {
    if (
      element.matches(CONTROLS) &&
      !element.matches("[data-canvas-reply-handle],[data-canvas-pan-handle]")
    )
      return true;
    const style = getComputedStyle(element);
    if (
      (/auto|scroll/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight) ||
      (/auto|scroll/.test(style.overflowX) &&
        element.scrollWidth > element.clientWidth)
    )
      return true;
    const parent = element.parentElement;
    const root = element.getRootNode();
    element =
      parent ??
      (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot
        ? root.host
        : null);
  }
  return false;
}

// Touch Events deliberately own only a multi-touch sequence. Pointer Events
// alone cannot preserve native one-finger scrolling AND take over a later pinch
// after the browser has sent pointercancel. No document-level touch prevention.
export function useTouchViewport(
  stage: RefObject<HTMLElement>,
  options: {
    viewport: () => TouchViewport;
    change: (viewport: TouchViewport) => void;
    start: () => void;
    end: () => void;
  },
) {
  const latest = useRef(options);
  latest.current = options;
  const gesture = useRef(new TouchViewportGesture());
  const cancelRef = useRef(() => {});
  const api = useRef({
    isActive: () => gesture.current.active,
    cancel: () => cancelRef.current(),
  });
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const eligible = new Set<number>();
    let suppressClick = false;
    const cancel = () => {
      suppressClick = false;
      gesture.current.reset();
      eligible.clear();
      latest.current.end();
    };
    cancelRef.current = cancel;
    const sample = (event: TouchEvent) => {
      // A native scroll already latched by the browser cannot safely be taken
      // back. Freeze this sequence rather than moving both page and camera.
      if (
        (event.type === "touchstart" || event.type === "touchmove") &&
        !event.cancelable
      ) {
        cancel();
        return;
      }
      const rect = element.getBoundingClientRect();
      const points = Array.from(event.touches)
        .filter((touch) => eligible.has(touch.identifier))
        .map((touch) => ({
          id: touch.identifier,
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        }));
      // A native control, scroll area or a finger outside this canvas owns its
      // entire sequence, even when another finger lands on the canvas later.
      if (points.length !== event.touches.length) {
        cancel();
        return;
      }
      const wasActive = gesture.current.active;
      const viewport = gesture.current.sample(
        points,
        latest.current.viewport(),
      );
      if (gesture.current.active) {
        // Only two eligible fingers (or the remainder of that pinch) belong to us.
        if (event.cancelable) event.preventDefault();
        suppressClick = true;
        if (!wasActive) latest.current.start();
        if (viewport) latest.current.change(viewport);
      } else if (wasActive) latest.current.end();
    };
    const start = (event: TouchEvent) => {
      if (!gesture.current.active) suppressClick = false;
      for (const touch of Array.from(event.changedTouches))
        if (!isControl(touch.target, element)) eligible.add(touch.identifier);
      sample(event);
    };
    const end = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches))
        eligible.delete(touch.identifier);
      sample(event);
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const press = () => {
      if (!gesture.current.active) suppressClick = false;
    };
    const key = (event: KeyboardEvent) => {
      suppressClick = false;
      if (event.key === "Escape") cancel();
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    element.addEventListener("touchstart", start, { passive: false });
    element.addEventListener("touchmove", sample, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", cancel);
    element.addEventListener("click", click, true);
    element.addEventListener("pointerdown", press, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("orientationchange", cancel);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("keydown", key);
    return () => {
      cancel();
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", sample);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", cancel);
      element.removeEventListener("click", click, true);
      element.removeEventListener("pointerdown", press, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("orientationchange", cancel);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("keydown", key);
    };
  }, [stage]);
  return api.current;
}
