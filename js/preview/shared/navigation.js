import { ensureState, markPreviewInteraction } from "./state.js";
import { clampPreviewZoom } from "./geometry.js";
import { blit } from "./bounds.js";
import { isNode as isDrawNode } from "../nodes/draw.js";
function isInteractiveNode(node) {
  return isDrawNode(node);
}
function attachPreviewNavigation(node, canvasSize) {
  const st = ensureState(node);
  if (st.previewNavigationHooked) return;
  st.previewNavigationHooked = true;
  const canvas = st.canvas;
  if (!canvas) return;
  const reblitNow = () => {
    if (!st.previewLastSource) return;
    blit(node, st, st.previewLastSource, canvasSize);
  };
  const safeRect = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return { rect, sx: canvas.width / rect.width, sy: canvas.height / rect.height };
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
    }
    const r = safeRect();
    if (!r) return;
    st.previewPanDrag = {
      pointerId: event.pointerId,
      startCanvasX: (event.clientX - r.rect.left) * r.sx,
      startCanvasY: (event.clientY - r.rect.top) * r.sy,
      startPanX: st.previewPanX,
      startPanY: st.previewPanY
    };
  });
  let panRafPending = false;
  canvas.addEventListener("pointermove", (event) => {
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
      requestAnimationFrame(() => {
        panRafPending = false;
        reblitNow();
      });
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (st.previewPanDrag?.pointerId === event.pointerId) {
      st.previewPanDrag = null;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
      }
    }
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (st.previewPanDrag?.pointerId === event.pointerId) {
      st.previewPanDrag = null;
    }
  });
  const handleWheel = (event) => {
    const target = event.target;
    if (target !== canvas && !canvas.contains(target)) return;
    if (isInteractiveNode(node)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const r = safeRect();
    if (!r) return;
    const mx = (event.clientX - r.rect.left) * r.sx - canvas.width / 2;
    const my = (event.clientY - r.rect.top) * r.sy - canvas.height / 2;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const prevZoom = st.previewZoom ?? 1;
    const newZoom = clampPreviewZoom(prevZoom * factor);
    const ratio = newZoom / Math.max(1e-3, prevZoom);
    st.previewPanX = mx - (mx - (st.previewPanX ?? 0)) * ratio;
    st.previewPanY = my - (my - (st.previewPanY ?? 0)) * ratio;
    st.previewZoom = newZoom;
    markPreviewInteraction(node);
    reblitNow();
  };
  document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  st._navWheelCleanup = () => document.removeEventListener("wheel", handleWheel, { capture: true });
  canvas.addEventListener("dblclick", () => {
    if (isInteractiveNode(node)) return;
    if (st.previewZoom === 1 && st.previewPanX === 0 && st.previewPanY === 0) return;
    st.previewZoom = 1;
    st.previewPanX = 0;
    st.previewPanY = 0;
    reblitNow();
  });
}
export {
  attachPreviewNavigation
};
