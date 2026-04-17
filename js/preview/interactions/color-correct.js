import { colorWheelPointToValues } from "../color.js";
import { getCanvasPointer } from "../shared/geometry.js";
import { findWidget, setWidgetValue } from "../shared/widgets.js";
import { isNode, syncColorCorrectWidgets } from "../nodes/color-correct.js";
function markDirty(node, ctx) {
  const st = node.__imageops_state ?? null;
  if (!st) return;
  st.nativeDirty = true;
  ctx.markCanvasDirty();
  ctx.schedule(node, () => {
    ctx.startLoopIfVideo(node);
    ctx.refreshDependents(node);
  }, 0);
}
function bindRange(node, ctx, input, widgetName, parser = (value) => Number(value)) {
  if (!input || input.dataset.bound === "1") return;
  input.dataset.bound = "1";
  input.addEventListener("input", () => {
    setWidgetValue(findWidget(node, widgetName), parser(input.value));
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  });
}
function bindWheel(node, ctx, canvas, hueWidget, amountWidget) {
  if (!canvas || canvas.dataset.bound === "1") return;
  canvas.dataset.bound = "1";
  let activePointerId = null;
  const commitWheelPoint = (event) => {
    const point = getCanvasPointer(canvas, event);
    const values = colorWheelPointToValues(point.x, point.y, canvas);
    setWidgetValue(findWidget(node, hueWidget), values.hueDeg);
    setWidgetValue(findWidget(node, amountWidget), values.saturation);
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  };
  canvas.addEventListener("pointerdown", (event) => {
    activePointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    commitWheelPoint(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId) return;
    commitWheelPoint(event);
  });
  const release = (event) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
}
function attachInteractions(node, ctx) {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st || st.colorInteractiveHooked) return;
  st.colorInteractiveHooked = true;
  bindRange(node, ctx, st.colorTemperatureInput, "temperature");
  bindRange(node, ctx, st.colorTintInput, "tint");
  bindRange(node, ctx, st.colorContrastInput, "contrast");
  bindRange(node, ctx, st.colorSaturationInput, "saturation");
  bindRange(node, ctx, st.colorVibranceInput, "vibrance");
  bindRange(node, ctx, st.colorGammaInput, "gamma", (value) => Number(value));
  bindWheel(node, ctx, st.colorWheelCanvas, "hue", "saturation");
  bindWheel(node, ctx, st.colorShadowWheelCanvas, "shadows_hue", "shadows_amount");
  bindWheel(node, ctx, st.colorMidtoneWheelCanvas, "midtones_hue", "midtones_amount");
  bindWheel(node, ctx, st.colorHighlightWheelCanvas, "highlights_hue", "highlights_amount");
  const resetAll = () => {
    setWidgetValue(findWidget(node, "temperature"), 0);
    setWidgetValue(findWidget(node, "tint"), 0);
    setWidgetValue(findWidget(node, "hue"), 0);
    setWidgetValue(findWidget(node, "brightness"), 0);
    setWidgetValue(findWidget(node, "contrast"), 0);
    setWidgetValue(findWidget(node, "saturation"), 0);
    setWidgetValue(findWidget(node, "vibrance"), 0);
    setWidgetValue(findWidget(node, "gamma"), 1);
    setWidgetValue(findWidget(node, "shadows_hue"), 0);
    setWidgetValue(findWidget(node, "shadows_amount"), 0);
    setWidgetValue(findWidget(node, "midtones_hue"), 0);
    setWidgetValue(findWidget(node, "midtones_amount"), 0);
    setWidgetValue(findWidget(node, "highlights_hue"), 0);
    setWidgetValue(findWidget(node, "highlights_amount"), 0);
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  };
  st.colorWheelCanvas?.addEventListener("dblclick", resetAll);
  st.colorResetButton?.addEventListener("click", resetAll);
  syncColorCorrectWidgets(node);
}
export {
  attachInteractions
};
