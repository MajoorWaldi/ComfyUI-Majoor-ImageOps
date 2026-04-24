import { colorWheelPointToValues } from "../color.js";
import { getCanvasPointer } from "../shared/geometry.js";
import { findWidget, setWidgetValue } from "../shared/widgets.js";
import { colorWidgetDefaultFor, colorWidgetNameForZone, isNode, syncColorCorrectWidgets } from "../nodes/color-correct.js";
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
function bindZoneRange(node, ctx, input, param, parser = (value) => Number(value)) {
  if (!input || input.dataset.bound === "1") return;
  input.dataset.bound = "1";
  input.addEventListener("input", () => {
    const st = node.__imageops_state ?? null;
    const zone = st?.colorActiveZone ?? "global";
    let value = parser(input.value);
    if (param === "saturation" && zone !== "global" && value < 0) value = 0;
    setWidgetValue(findWidget(node, colorWidgetNameForZone(param, zone)), value);
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  });
}
function bindZoneWheel(node, ctx, canvas) {
  if (!canvas || canvas.dataset.bound === "1") return;
  canvas.dataset.bound = "1";
  let activePointerId = null;
  const commitWheelPoint = (event) => {
    const st = node.__imageops_state ?? null;
    const zone = st?.colorActiveZone ?? "global";
    const point = getCanvasPointer(canvas, event);
    const values = colorWheelPointToValues(point.x, point.y, canvas);
    setWidgetValue(findWidget(node, colorWidgetNameForZone("hue", zone)), values.hueDeg);
    setWidgetValue(findWidget(node, colorWidgetNameForZone("saturation", zone)), values.saturation);
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
function bindZoneTab(node, ctx, btn, zone) {
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => {
    const st = node.__imageops_state ?? null;
    if (!st) return;
    if (st.colorActiveZone === zone) return;
    st.colorActiveZone = zone;
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  });
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
    for (const zone of ["global", "shadows", "midtones", "highlights"]) {
      for (const param of ["temperature", "hue", "contrast", "saturation", "vibrance", "gamma", "brightness"]) {
        setWidgetValue(findWidget(node, colorWidgetNameForZone(param, zone)), colorWidgetDefaultFor(param));
      }
    }
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
