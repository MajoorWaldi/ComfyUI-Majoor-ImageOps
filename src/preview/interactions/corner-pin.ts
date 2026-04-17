import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { getCanvasPointer, screenToWorld } from "../shared/geometry.js";
import {
  isNode,
  getCornerPinHit,
  cornerPinCanvasToNormalized,
  setCornerPinHandle,
} from "../nodes/corner-pin.js";

function safeSetPointerCapture(canvas: HTMLCanvasElement, pointerId: number): void {
  try { canvas.setPointerCapture?.(pointerId); } catch { /* ignore */ }
}

function safeReleasePointerCapture(canvas: HTMLCanvasElement, pointerId: number): void {
  try { canvas.releasePointerCapture?.(pointerId); } catch { /* ignore */ }
}

export function attachInteractions(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st?.canvas || st.cornerPinInteractiveHooked) return;
  st.cornerPinInteractiveHooked = true;
  const canvas = st.canvas;

  const worldPt = (event: PointerEvent) => {
    const raw = getCanvasPointer(canvas, event);
    return screenToWorld(raw.x, raw.y, st.previewZoom ?? 1, st.previewPanX ?? 0, st.previewPanY ?? 0, canvas.width);
  };

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    const geometry = st.cornerPinGeometry;
    if (!geometry) return;
    const point = worldPt(event);
    const hit = getCornerPinHit(node, geometry, point.x, point.y);
    if (!hit) return;
    event.preventDefault();
    canvas.focus();
    safeSetPointerCapture(canvas, event.pointerId);
    st.cornerPinDrag = { pointerId: event.pointerId, handle: hit };
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    const point = worldPt(event);
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

  const releaseDrag = (event: PointerEvent) => {
    if (!st.cornerPinDrag || st.cornerPinDrag.pointerId !== event.pointerId) return;
    st.cornerPinDrag = null;
    safeReleasePointerCapture(canvas, event.pointerId);
    const point = worldPt(event);
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
