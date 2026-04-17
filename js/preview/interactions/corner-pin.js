import { getCanvasPointer } from "../shared/geometry.js";
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
  const canvas = st.canvas;
  canvas.addEventListener("pointerdown", (event) => {
    const geometry = st.cornerPinGeometry;
    if (!geometry) return;
    const point = getCanvasPointer(canvas, event);
    const hit = getCornerPinHit(node, geometry, point.x, point.y);
    if (!hit) return;
    event.preventDefault();
    canvas.focus();
    safeSetPointerCapture(canvas, event.pointerId);
    st.cornerPinDrag = { pointerId: event.pointerId, handle: hit };
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = getCanvasPointer(canvas, event);
    const drag = st.cornerPinDrag;
    const geometry = st.cornerPinGeometry;
    if (!drag || drag.pointerId !== event.pointerId || !geometry) {
      canvas.style.cursor = getCornerPinHit(node, geometry, point.x, point.y) ? "grab" : "default";
      return;
    }
    event.preventDefault();
    const mapped = cornerPinCanvasToNormalized(geometry, point.x, point.y);
    setCornerPinHandle(node, drag.handle, mapped.xNorm, mapped.yNorm);
    ctx.refreshNode(node);
    canvas.style.cursor = "grabbing";
  });
  const releaseDrag = (event) => {
    if (!st.cornerPinDrag || st.cornerPinDrag.pointerId !== event.pointerId) return;
    st.cornerPinDrag = null;
    safeReleasePointerCapture(canvas, event.pointerId);
    const point = getCanvasPointer(canvas, event);
    canvas.style.cursor = getCornerPinHit(node, st.cornerPinGeometry, point.x, point.y) ? "grab" : "default";
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
