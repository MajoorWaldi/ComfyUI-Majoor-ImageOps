import { getCanvasPointer, screenToWorld } from "../shared/geometry.js";
import {
  isNode,
  getCornerPinHit,
  cornerPinCanvasToNormalized,
  setCornerPinHandle
} from "../nodes/corner-pin.js";
function safeSetPointerCapture(canvas, pointerId) {
  try {
    canvas.setPointerCapture?.(pointerId);
  } catch {
  }
}
function safeReleasePointerCapture(canvas, pointerId) {
  try {
    canvas.releasePointerCapture?.(pointerId);
  } catch {
  }
}
function attachInteractions(node, ctx) {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st?.canvas || st.cornerPinInteractiveHooked) return;
  st.cornerPinInteractiveHooked = true;
  let moveRafPending = false;
  const canvas = st.canvas;
  const worldPt = (event) => {
    const raw = getCanvasPointer(canvas, event);
    return screenToWorld(raw.x, raw.y, st.previewZoom ?? 1, st.previewPanX ?? 0, st.previewPanY ?? 0, canvas.width);
  };
  canvas.addEventListener("pointerdown", (event) => {
    const geometry = st.cornerPinGeometry;
    if (!geometry) return;
    const point = worldPt(event);
    const hit = getCornerPinHit(node, geometry, point.x, point.y);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.focus();
    safeSetPointerCapture(canvas, event.pointerId);
    st.cornerPinDrag = { pointerId: event.pointerId, handle: hit };
    canvas.style.cursor = "grabbing";
  });
  const SNAP_THRESHOLD = 0.015;
  const maybeSnap = (n, altKey) => {
    if (altKey) return n;
    if (Math.abs(n - 0) < SNAP_THRESHOLD) return 0;
    if (Math.abs(n - 1) < SNAP_THRESHOLD) return 1;
    return n;
  };
  canvas.addEventListener("pointermove", (event) => {
    const point = worldPt(event);
    const drag = st.cornerPinDrag;
    const geometry = st.cornerPinGeometry;
    if (!drag || drag.pointerId !== event.pointerId || !geometry) {
      canvas.style.cursor = getCornerPinHit(node, geometry, point.x, point.y) ? "grab" : "default";
      return;
    }
    event.preventDefault();
    const mapped = cornerPinCanvasToNormalized(geometry, point.x, point.y);
    const xN = maybeSnap(mapped.xNorm, event.altKey);
    const yN = maybeSnap(mapped.yNorm, event.altKey);
    setCornerPinHandle(node, drag.handle, xN, yN, false);
    canvas.style.cursor = "grabbing";
    if (!moveRafPending) {
      moveRafPending = true;
      requestAnimationFrame(() => {
        moveRafPending = false;
        ctx.refreshNode(node);
      });
    }
  });
  const releaseDrag = (event) => {
    if (!st.cornerPinDrag || st.cornerPinDrag.pointerId !== event.pointerId) return;
    const drag = st.cornerPinDrag;
    st.cornerPinDrag = null;
    safeReleasePointerCapture(canvas, event.pointerId);
    const point = worldPt(event);
    canvas.style.cursor = getCornerPinHit(node, st.cornerPinGeometry, point.x, point.y) ? "grab" : "default";
    if (st.cornerPinGeometry) {
      const mapped = cornerPinCanvasToNormalized(st.cornerPinGeometry, point.x, point.y);
      const xN = maybeSnap(mapped.xNorm, event.altKey);
      const yN = maybeSnap(mapped.yNorm, event.altKey);
      setCornerPinHandle(node, drag.handle, xN, yN, true);
    }
    ctx.refreshNode(node);
  };
  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", releaseDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!st.cornerPinDrag) {
      canvas.style.cursor = "default";
    }
  });
}
export {
  attachInteractions
};
