import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import {
    cornerPinCanvasToNormalized,
    getCornerPinHit,
    isNode,
    setCornerPinHandle,
} from "../nodes/corner-pin.js";
import { getCanvasPointer, screenToWorld } from "../shared/geometry.js";

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
  let moveRafPending = false;
  const canvas = st.canvas;
  const listenerOptions = st._abortController?.signal ? { signal: st._abortController.signal } : undefined;

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
    event.stopPropagation();
    canvas.focus();
    safeSetPointerCapture(canvas, event.pointerId);
    st.cornerPinDrag = { pointerId: event.pointerId, handle: hit };
    canvas.style.cursor = "grabbing";
  }, listenerOptions);

  // Snap to source-frame corners (0 or 1) when the pointer is within SNAP_THRESHOLD
  // unless Alt is held. Tightens precision of edge-aligned setups.
  const SNAP_THRESHOLD = 0.015;
  const maybeSnap = (n: number, altKey: boolean): number => {
    if (altKey) return n;
    if (Math.abs(n - 0) < SNAP_THRESHOLD) return 0;
    if (Math.abs(n - 1) < SNAP_THRESHOLD) return 1;
    return n;
  };

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
    const xN = maybeSnap(mapped.xNorm, event.altKey);
    const yN = maybeSnap(mapped.yNorm, event.altKey);
    setCornerPinHandle(node, drag.handle, xN, yN, false);
    canvas.style.cursor = "grabbing";
    if (!moveRafPending) {
      moveRafPending = true;
      requestAnimationFrame(() => { moveRafPending = false; ctx.refreshNode(node); });
    }
  }, listenerOptions);

  const releaseDrag = (event: PointerEvent) => {
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

  canvas.addEventListener("pointerup", releaseDrag, listenerOptions);
  canvas.addEventListener("pointercancel", releaseDrag, listenerOptions);
  canvas.addEventListener("pointerleave", () => {
    if (!st.cornerPinDrag) {
      canvas.style.cursor = "default";
    }
  }, listenerOptions);
}
