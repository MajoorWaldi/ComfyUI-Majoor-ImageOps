import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { colorWheelPointToValues } from "../color.js";
import { getCanvasPointer } from "../shared/geometry.js";
import { findWidget, setWidgetValue } from "../shared/widgets.js";
import { isNode, syncColorCorrectWidgets } from "../nodes/color-correct.js";

export function attachInteractions(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  const canvas = st?.colorWheelCanvas;
  if (!st || !canvas || st.colorInteractiveHooked) return;
  st.colorInteractiveHooked = true;

  let activePointerId: number | null = null;

  const commitWheelPoint = (event: PointerEvent): void => {
    const point = getCanvasPointer(canvas, event);
    const values = colorWheelPointToValues(point.x, point.y, canvas);
    setWidgetValue(findWidget(node, "hue"), values.hueDeg);
    setWidgetValue(findWidget(node, "saturation"), values.saturation);
    syncColorCorrectWidgets(node);
    st.nativeDirty = true;
    ctx.markCanvasDirty();
    ctx.schedule(node, () => {
      ctx.startLoopIfVideo(node);
      ctx.refreshDependents(node);
    }, 0);
  };

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    activePointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    commitWheelPoint(event);
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    commitWheelPoint(event);
  });

  const release = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);
  };

  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  const resetWheel = (): void => {
    setWidgetValue(findWidget(node, "hue"), 0);
    setWidgetValue(findWidget(node, "saturation"), 0);
    syncColorCorrectWidgets(node);
    st.nativeDirty = true;
    ctx.markCanvasDirty();
    ctx.schedule(node, () => {
      ctx.startLoopIfVideo(node);
      ctx.refreshDependents(node);
    }, 0);
  };

  canvas.addEventListener("dblclick", resetWheel);
  st.colorResetButton?.addEventListener("click", resetWheel);

  syncColorCorrectWidgets(node);
}
