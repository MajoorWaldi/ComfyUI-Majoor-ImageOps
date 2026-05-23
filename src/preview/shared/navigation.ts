import type { ComfyNode } from "../../types.js";
import { ensureState, markPreviewInteraction } from "./state.js";
import { clampPreviewZoom } from "./geometry.js";
import { blit } from "./bounds.js";
import { isNode as isDrawNode } from "../nodes/draw.js";
import { isNode as isTextNode } from "../nodes/text.js";

function isInteractiveNode(node: ComfyNode): boolean {
  // Draw uses wheel for brush size; Text uses wheel for font size — skip zoom/pan for both.
  return isDrawNode(node) || isTextNode(node);
}

export function attachPreviewNavigation(node: ComfyNode, canvasSize: number): void {
  const st = ensureState(node);
  if (st.previewNavigationHooked) return;
  st.previewNavigationHooked = true;
  const canvas = st.canvas;
  if (!canvas) return;

  const reblitNow = (): void => {
    if (!st.previewLastSource) return;
    blit(node, st, st.previewLastSource, canvasSize);
  };

  /** Safe rect helper — returns null if canvas is detached / zero-size. */
  const safeRect = (): { rect: DOMRect; sx: number; sy: number } | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return { rect, sx: canvas.width / rect.width, sy: canvas.height / rect.height };
  };

  // ── Middle-button pan ──
  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    const r = safeRect();
    if (!r) return;
    st.previewPanDrag = {
      pointerId: event.pointerId,
      startCanvasX: (event.clientX - r.rect.left) * r.sx,
      startCanvasY: (event.clientY - r.rect.top) * r.sy,
      startPanX: st.previewPanX,
      startPanY: st.previewPanY,
    };
  });

  let panRafPending = false;
  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (!st.previewPanDrag || st.previewPanDrag.pointerId !== event.pointerId) return;
    const r = safeRect();
    if (!r) return;
    const cx = (event.clientX - r.rect.left) * r.sx;
    const cy = (event.clientY - r.rect.top) * r.sy;
    st.previewPanX = st.previewPanDrag.startPanX + (cx - st.previewPanDrag.startCanvasX);
    st.previewPanY = st.previewPanDrag.startPanY + (cy - st.previewPanDrag.startCanvasY);
    markPreviewInteraction(node);
    if (!panRafPending) {
      panRafPending = true;
      requestAnimationFrame(() => { panRafPending = false; reblitNow(); });
    }
  });

  canvas.addEventListener("pointerup", (event: PointerEvent) => {
    if (st.previewPanDrag?.pointerId === event.pointerId) {
      st.previewPanDrag = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
    }
  });

  canvas.addEventListener("pointercancel", (event: PointerEvent) => {
    if (st.previewPanDrag?.pointerId === event.pointerId) {
      st.previewPanDrag = null;
    }
  });

  // ── Wheel: zoom toward cursor (disabled for interactive nodes — they handle wheel themselves) ──
  // In Node 2.0, graph-canvas-container intercepts wheel events in capture phase
  // before they reach our canvas.  We therefore register our own capture-phase
  // handler on the document so we can stop the event first.
  const handleWheel = (event: WheelEvent): void => {
    const target = event.target as Node | null;
    if (target !== canvas && !canvas.contains(target)) return;
    // Let interactive nodes (Draw) handle wheel themselves — don't block their handlers.
    if (isInteractiveNode(node)) return;
    // Prevent the graph from zooming when the cursor is over our preview canvas.
    event.stopImmediatePropagation();
    event.preventDefault();
    const r = safeRect();
    if (!r) return;
    // Mouse position relative to canvas center
    const mx = (event.clientX - r.rect.left) * r.sx - canvas.width / 2;
    const my = (event.clientY - r.rect.top) * r.sy - canvas.height / 2;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const prevZoom = st.previewZoom ?? 1;
    const newZoom = clampPreviewZoom(prevZoom * factor);
    const ratio = newZoom / Math.max(0.001, prevZoom);
    // Keep the point under the cursor fixed
    st.previewPanX = mx - (mx - (st.previewPanX ?? 0)) * ratio;
    st.previewPanY = my - (my - (st.previewPanY ?? 0)) * ratio;
    st.previewZoom = newZoom;
    markPreviewInteraction(node);
    reblitNow();
  };
  const signal = st?._abortController?.signal;
  document.addEventListener("wheel", handleWheel, { capture: true, passive: false, signal } as any);
  // Store cleanup ref so onRemoved can deregister the document-level listener.
  (st as any)._navWheelCleanup = () => document.removeEventListener("wheel", handleWheel, { capture: true } as EventListenerOptions);

  // ── Double-click: reset zoom/pan ──
  canvas.addEventListener("dblclick", () => {
    if (isInteractiveNode(node)) return;
    if (st.previewZoom === 1 && st.previewPanX === 0 && st.previewPanY === 0) return;
    st.previewZoom = 1;
    st.previewPanX = 0;
    st.previewPanY = 0;
    reblitNow();
  });
}
