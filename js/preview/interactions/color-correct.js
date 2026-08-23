import { colorWheelPointToValues } from "../color.js";
import { colorWidgetNameForZone, isNode, syncColorCorrectWidgets } from "../nodes/color-correct.js";
import { getCanvasPointer } from "../shared/geometry.js";
import { findWidget, resetNodeWidgetsToDefaults, setWidgetValue } from "../shared/widgets.js";
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
function refreshDirty(node, ctx) {
  const st = node.__imageops_state ?? null;
  if (!st) return;
  st.nativeDirty = true;
  ctx.markCanvasDirty();
  ctx.refreshNode(node);
}
function bindZoneRange(node, ctx, input, param, parser = (value) => Number(value)) {
  if (!input) return;
  const st = node.__imageops_state ?? null;
  const listenerOptions = st?._abortController?.signal ? { signal: st._abortController.signal } : void 0;
  input.addEventListener("input", () => {
    const st2 = node.__imageops_state ?? null;
    const zone = st2?.colorActiveZone ?? "global";
    let value = parser(input.value);
    if (param === "saturation" && zone !== "global" && value < 0) value = 0;
    setWidgetValue(findWidget(node, colorWidgetNameForZone(param, zone)), value);
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  }, listenerOptions);
}
function bindZoneWheel(node, ctx, canvas) {
  if (!canvas) return;
  const st0 = node.__imageops_state ?? null;
  const listenerOptions = st0?._abortController?.signal ? { signal: st0._abortController.signal } : void 0;
  let activePointerId = null;
  let moveRafPending = false;
  const commitWheelPoint = (event, notify) => {
    const st = node.__imageops_state ?? null;
    const zone = st?.colorActiveZone ?? "global";
    const point = getCanvasPointer(canvas, event);
    const values = colorWheelPointToValues(point.x, point.y, canvas);
    setWidgetValue(findWidget(node, colorWidgetNameForZone("hue", zone)), values.hueDeg, { notify });
    setWidgetValue(findWidget(node, colorWidgetNameForZone("saturation", zone)), values.saturation, { notify });
    syncColorCorrectWidgets(node);
    if (notify) {
      markDirty(node, ctx);
    } else if (!moveRafPending) {
      moveRafPending = true;
      requestAnimationFrame(() => {
        moveRafPending = false;
        refreshDirty(node, ctx);
      });
    }
  };
  canvas.addEventListener("pointerdown", (event) => {
    activePointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    commitWheelPoint(event, false);
  }, listenerOptions);
  canvas.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId) return;
    commitWheelPoint(event, false);
  }, listenerOptions);
  const release = (event) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);
    commitWheelPoint(event, true);
  };
  canvas.addEventListener("pointerup", release, listenerOptions);
  canvas.addEventListener("pointercancel", release, listenerOptions);
}
function bindZoneTab(node, ctx, btn, zone) {
  if (!btn) return;
  const st0 = node.__imageops_state ?? null;
  const listenerOptions = st0?._abortController?.signal ? { signal: st0._abortController.signal } : void 0;
  btn.addEventListener("click", () => {
    const st = node.__imageops_state ?? null;
    if (!st) return;
    if (st.colorActiveZone === zone) return;
    st.colorActiveZone = zone;
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  }, listenerOptions);
}
function attachInteractions(node, ctx) {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st || st.colorInteractiveHooked) return;
  st.colorInteractiveHooked = true;
  bindZoneRange(node, ctx, st.colorBrightnessInput, "brightness");
  bindZoneRange(node, ctx, st.colorTemperatureInput, "temperature");
  bindZoneRange(node, ctx, st.colorTintInput, "hue");
  bindZoneRange(node, ctx, st.colorContrastInput, "contrast");
  bindZoneRange(node, ctx, st.colorSaturationInput, "saturation");
  bindZoneRange(node, ctx, st.colorVibranceInput, "vibrance");
  bindZoneRange(node, ctx, st.colorGammaInput, "gamma");
  bindZoneWheel(node, ctx, st.colorWheelCanvas);
  bindZoneTab(node, ctx, st.colorZoneTabGlobal, "global");
  bindZoneTab(node, ctx, st.colorZoneTabShadows, "shadows");
  bindZoneTab(node, ctx, st.colorZoneTabMidtones, "midtones");
  bindZoneTab(node, ctx, st.colorZoneTabHighlights, "highlights");
  const resetAll = () => {
    resetNodeWidgetsToDefaults(node);
    st.colorActiveZone = "global";
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  };
  const listenerOptions = st._abortController?.signal ? { signal: st._abortController.signal } : void 0;
  st.colorWheelCanvas?.addEventListener("dblclick", resetAll, listenerOptions);
  st.colorResetButton?.addEventListener("click", resetAll, listenerOptions);
  syncColorCorrectWidgets(node);
}
export {
  attachInteractions
};
