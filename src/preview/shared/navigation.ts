import type { ComfyNode } from "../../types.js";
import { ensureState } from "./state.js";
import { clampPreviewZoom } from "./geometry.js";
import { blit } from "./bounds.js";
import { isNode as isDrawNode } from "../nodes/draw.js";

function isInteractiveNode(node: ComfyNode): boolean {
  // Only Draw uses the wheel event (brush size) — all other nodes can use zoom/pan.
  return isDrawNode(node);
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

  // ── Middle-button pan ──
  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, rect.width);
    const sy = canvas.height / Math.max(1, rect.height);
    st.previewPanDrag = {
      pointerId: event.pointerId,
      startCanvasX: (event.clientX - rect.left) * sx,
      startCanvasY: (event.clientY - rect.top) * sy,
      startPanX: st.previewPanX,
      startPanY: st.previewPanY,
    };
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (!st.previewPanDrag || st.previewPanDrag.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, rect.width);
    const sy = canvas.height / Math.max(1, rect.height);
    const cx = (event.clientX - rect.left) * sx;
    const cy = (event.clientY - rect.top) * sy;
    st.previewPanX = st.previewPanDrag.startPanX + (cx - st.previewPanDrag.startCanvasX);
    st.previewPanY = st.previewPanDrag.startPanY + (cy - st.previewPanDrag.startCanvasY);
    reblitNow();
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
  canvas.addEventListener("wheel", (event: WheelEvent) => {
    if (isInteractiveNode(node)) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, rect.width);
    const sy = canvas.height / Math.max(1, rect.height);
    // Mouse position relative to canvas center
    const mx = (event.clientX - rect.left) * sx - canvas.width / 2;
    const my = (event.clientY - rect.top) * sy - canvas.height / 2;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const prevZoom = st.previewZoom ?? 1;
    const newZoom = clampPreviewZoom(prevZoom * factor);
    const ratio = newZoom / Math.max(0.001, prevZoom);
    // Keep the point under the cursor fixed
    st.previewPanX = mx - (mx - (st.previewPanX ?? 0)) * ratio;
    st.previewPanY = my - (my - (st.previewPanY ?? 0)) * ratio;
    st.previewZoom = newZoom;
    reblitNow();
  }, { passive: false });

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
