import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { getCanvasPointer, screenToWorld } from "../shared/geometry.js";
import { findWidget, setWidgetValue } from "../shared/widgets.js";
import { isNode, getPadOutInteractionMode, getPadOutCursor } from "../nodes/pad-out.js";

export function attachInteractions(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st?.canvas || st.padOutInteractiveHooked) return;
  st.padOutInteractiveHooked = true;
  const canvas = st.canvas;

  const worldPt = (event: PointerEvent) => {
    const raw = getCanvasPointer(canvas, event);
    return screenToWorld(raw.x, raw.y, st.previewZoom ?? 1, st.previewPanX ?? 0, st.previewPanY ?? 0, canvas.width);
  };

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    const geometry = st.padOutGeometry;
    if (!geometry) return;
    const point = worldPt(event);
    const mode = getPadOutInteractionMode(geometry, point.x, point.y);
    if (!mode) return;
    event.preventDefault();
    canvas.focus();
    canvas.setPointerCapture?.(event.pointerId);
    st.padOutDrag = {
      pointerId: event.pointerId,
      mode,
      startCanvasX: point.x,
      startCanvasY: point.y,
      startPadLeft: geometry.padLeft,
      startPadTop: geometry.padTop,
      startPadRight: geometry.padRight,
      startPadBottom: geometry.padBottom,
    };
    canvas.style.cursor = getPadOutCursor(mode);
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    const point = worldPt(event);
    const drag = st.padOutDrag;
    const geometry = st.padOutGeometry;
    if (!drag || drag.pointerId !== event.pointerId || !geometry) {
      canvas.style.cursor = getPadOutCursor(getPadOutInteractionMode(geometry, point.x, point.y));
      return;
    }
    event.preventDefault();

    const deltaCanvasX = point.x - drag.startCanvasX;
    const deltaCanvasY = point.y - drag.startCanvasY;
    const deltaX = deltaCanvasX * geometry.outputWidth / Math.max(1, geometry.fitDrawWidth);
    const deltaY = deltaCanvasY * geometry.outputHeight / Math.max(1, geometry.fitDrawHeight);

    let left = drag.startPadLeft;
    let top = drag.startPadTop;
    let right = drag.startPadRight;
    let bottom = drag.startPadBottom;

    if (drag.mode === "move") {
      const totalX = drag.startPadLeft + drag.startPadRight;
      const totalY = drag.startPadTop + drag.startPadBottom;
      left = Math.max(0, Math.min(totalX, Math.round(drag.startPadLeft + deltaX)));
      right = totalX - left;
      top = Math.max(0, Math.min(totalY, Math.round(drag.startPadTop + deltaY)));
      bottom = totalY - top;
    } else {
      if (drag.mode === "w" || drag.mode === "nw" || drag.mode === "sw") {
        left = Math.max(0, Math.round(drag.startPadLeft + deltaX));
      }
      if (drag.mode === "e" || drag.mode === "ne" || drag.mode === "se") {
        right = Math.max(0, Math.round(drag.startPadRight - deltaX));
      }
      if (drag.mode === "n" || drag.mode === "nw" || drag.mode === "ne") {
        top = Math.max(0, Math.round(drag.startPadTop + deltaY));
      }
      if (drag.mode === "s" || drag.mode === "sw" || drag.mode === "se") {
        bottom = Math.max(0, Math.round(drag.startPadBottom - deltaY));
      }
    }

    setWidgetValue(findWidget(node, "pad_left"), left);
    setWidgetValue(findWidget(node, "pad_top"), top);
    setWidgetValue(findWidget(node, "pad_right"), right);
    setWidgetValue(findWidget(node, "pad_bottom"), bottom);
    ctx.refreshNode(node);
    canvas.style.cursor = getPadOutCursor(drag.mode);
  });

  const releaseDrag = (event: PointerEvent) => {
    if (!st.padOutDrag || st.padOutDrag.pointerId !== event.pointerId) return;
    st.padOutDrag = null;
    canvas.releasePointerCapture?.(event.pointerId);
    const point = worldPt(event);
    canvas.style.cursor = getPadOutCursor(getPadOutInteractionMode(st.padOutGeometry, point.x, point.y));
    ctx.refreshNode(node);
  };

  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", releaseDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!st.padOutDrag) {
      canvas.style.cursor = "default";
    }
  });
}
