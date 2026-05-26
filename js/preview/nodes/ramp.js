import { resolveImageOpsClassName } from "../shared/classes.js";
import { findWidget, setWidgetStringValuesByName, setWidgetValue, widgetNumber, widgetString } from "../shared/widgets.js";
const RAMP_RATIO_PRESETS = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "9:16": 9 / 16
};
function resolveRampRatioPreset(width, height) {
  const ratio = width / Math.max(1, height);
  for (const [preset, presetRatio] of Object.entries(RAMP_RATIO_PRESETS)) {
    if (Math.abs(ratio - presetRatio) <= 0.02) return preset;
  }
  return "custom";
}
const NODE_CLASS = "ImageOpsRamp";
function isNode(node) {
  return resolveImageOpsClassName(node?.comfyClass) === NODE_CLASS;
}
function createRampControlsUi() {
  return { controls: null };
}
function hideRampWidgets(node) {
  if (!isNode(node)) return;
}
function getRampInfoText(node) {
  const width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  const height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const frameCount = Math.max(1, Math.round(widgetNumber(node, "frame_count", widgetNumber(node, "frame_length", widgetNumber(node, "batch_size", 1)))));
  const shape = widgetString(node, "ramp_shape", "linear");
  return `Ramp preview (${shape}, ${width}x${height}, frames ${frameCount})`;
}
function rampCanvasPoint(geometry, xNorm, yNorm) {
  return {
    x: geometry.fitDx + xNorm * geometry.fitDrawWidth,
    y: geometry.fitDy + yNorm * geometry.fitDrawHeight
  };
}
function rampControlPoints(node, geometry) {
  return {
    start: rampCanvasPoint(geometry, widgetNumber(node, "start_x", 0), widgetNumber(node, "start_y", 0.5)),
    end: rampCanvasPoint(geometry, widgetNumber(node, "end_x", 1), widgetNumber(node, "end_y", 0.5))
  };
}
function getRampHit(node, geometry, x, y) {
  if (!geometry) return null;
  const points = rampControlPoints(node, geometry);
  const threshold = 14;
  for (const key of ["start", "end"]) {
    const point = points[key];
    const dx = x - point.x;
    const dy = y - point.y;
    if (dx * dx + dy * dy <= threshold * threshold) return key;
  }
  return null;
}
function rampCanvasToNormalized(geometry, x, y) {
  return {
    xNorm: Math.max(-2, Math.min(3, (x - geometry.fitDx) / Math.max(1, geometry.fitDrawWidth))),
    yNorm: Math.max(-2, Math.min(3, (y - geometry.fitDy) / Math.max(1, geometry.fitDrawHeight)))
  };
}
function setRampHandle(node, handle, xNorm, yNorm, notify = true) {
  if (handle === "start") {
    setWidgetValue(findWidget(node, "start_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "start_y"), yNorm, { notify });
  } else {
    setWidgetValue(findWidget(node, "end_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "end_y"), yNorm, { notify });
  }
}
function syncRampWidgets(node) {
  if (!isNode(node)) return;
  hideRampWidgets(node);
  const colorA = widgetString(node, "color_a", "#ffffff");
  const colorB = widgetString(node, "color_b", "#000000");
  setWidgetStringValuesByName(node, "color_a", colorA, { notify: false, dirty: false });
  setWidgetStringValuesByName(node, "color_b", colorB, { notify: false, dirty: false });
}
export {
  NODE_CLASS,
  createRampControlsUi,
  getRampHit,
  getRampInfoText,
  hideRampWidgets,
  isNode,
  rampCanvasPoint,
  rampCanvasToNormalized,
  rampControlPoints,
  setRampHandle,
  syncRampWidgets
};
