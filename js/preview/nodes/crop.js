import { clampCropCenter, clampCropScale, resolveCropAspectRatio } from "../crop.js";
import { markCanvasDirty } from "../shared/canvas.js";
import { styleInlineAction } from "../shared/dom-styles.js";
import { ensureState } from "../shared/state.js";
import { findWidget, hideWidgetForGood, setWidgetBooleanValue, setWidgetValue, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsCrop";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function createCropResetButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reset";
  styleInlineAction(button);
  button.style.opacity = "0.85";
  return button;
}
function hideCropGeometryWidgets(node) {
  hideWidgetForGood(node, findWidget(node, "crop_center_x"));
  hideWidgetForGood(node, findWidget(node, "crop_center_y"));
  hideWidgetForGood(node, findWidget(node, "crop_scale"));
}
function resolveCropAspectRatioValue(node, fallbackWidth = 1, fallbackHeight = 1) {
  return resolveCropAspectRatio(
    widgetString(node, "aspect_ratio", "custom"),
    Math.max(1, widgetNumber(node, "width", fallbackWidth)),
    Math.max(1, widgetNumber(node, "height", fallbackHeight))
  );
}
function getCropControlState(node, fallbackWidth = 1, fallbackHeight = 1) {
  return {
    aspectRatio: resolveCropAspectRatioValue(node, fallbackWidth, fallbackHeight),
    centerX: clampCropCenter(widgetNumber(node, "crop_center_x", 0.5)),
    centerY: clampCropCenter(widgetNumber(node, "crop_center_y", 0.5)),
    scale: clampCropScale(widgetNumber(node, "crop_scale", 1))
  };
}
function setCropControlState(node, centerX, centerY, scale, notify = true) {
  setWidgetValue(findWidget(node, "crop_center_x"), clampCropCenter(centerX), { notify });
  setWidgetValue(findWidget(node, "crop_center_y"), clampCropCenter(centerY), { notify });
  setWidgetValue(findWidget(node, "crop_scale"), clampCropScale(scale), { notify });
}
function resetCropControlState(node) {
  setCropControlState(node, 0.5, 0.5, 1);
}
function isFreeCropResizeEnabled(node) {
  return widgetString(node, "aspect_ratio", "custom") === "custom" && !widgetBoolean(node, "sync_dimensions", true);
}
function getCropCanvasMetrics(left, top, width, height) {
  const right = left + width;
  const bottom = top + height;
  return {
    left,
    top,
    right,
    bottom,
    topMid: { x: left + width / 2, y: top },
    rightMid: { x: right, y: top + height / 2 },
    bottomMid: { x: left + width / 2, y: bottom },
    leftMid: { x: left, y: top + height / 2 },
    handleThreshold: Math.max(10, Math.min(18, Math.floor(Math.min(width, height) * 0.16)))
  };
}
function getCropInfoText(node) {
  const preset = widgetString(node, "aspect_ratio", "custom");
  const width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  const height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const ratioLabel = preset === "custom" ? `${width}:${height}` : preset;
  return `Crop preview (${ratioLabel} -> ${width}x${height})`;
}
function getCropInteractionMode(geometry, x, y) {
  if (!geometry) return null;
  const left = geometry.fitDx + geometry.cropX * (geometry.fitDrawWidth / Math.max(1, geometry.sourceWidth));
  const top = geometry.fitDy + geometry.cropY * (geometry.fitDrawHeight / Math.max(1, geometry.sourceHeight));
  const width = geometry.cropWidth * (geometry.fitDrawWidth / Math.max(1, geometry.sourceWidth));
  const height = geometry.cropHeight * (geometry.fitDrawHeight / Math.max(1, geometry.sourceHeight));
  const metrics = getCropCanvasMetrics(left, top, width, height);
  const threshold = metrics.handleThreshold;
  const near = (px, py) => Math.abs(x - px) <= threshold && Math.abs(y - py) <= threshold;
  if (near(metrics.left, metrics.top)) return "nw";
  if (near(metrics.right, metrics.top)) return "ne";
  if (near(metrics.left, metrics.bottom)) return "sw";
  if (near(metrics.right, metrics.bottom)) return "se";
  if (near(metrics.topMid.x, metrics.topMid.y)) return "n";
  if (near(metrics.rightMid.x, metrics.rightMid.y)) return "e";
  if (near(metrics.bottomMid.x, metrics.bottomMid.y)) return "s";
  if (near(metrics.leftMid.x, metrics.leftMid.y)) return "w";
  if (x >= metrics.left && x <= metrics.right && y >= metrics.top && y <= metrics.bottom) return "move";
  return null;
}
function getCropCursor(mode) {
  switch (mode) {
    case "move":
      return "move";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    default:
      return "default";
  }
}
function canvasToSourcePoint(geometry, x, y) {
  const localX = (x - geometry.fitDx) / Math.max(1, geometry.fitDrawWidth);
  const localY = (y - geometry.fitDy) / Math.max(1, geometry.fitDrawHeight);
  return {
    x: Math.max(0, Math.min(geometry.sourceWidth, localX * geometry.sourceWidth)),
    y: Math.max(0, Math.min(geometry.sourceHeight, localY * geometry.sourceHeight))
  };
}
function syncCropWidgets(node, changedName, notify = true) {
  if (!isNode(node)) return;
  const st = ensureState(node);
  const widthWidget = findWidget(node, "width");
  const heightWidget = findWidget(node, "height");
  if (!widthWidget || !heightWidget) return;
  let width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  let height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const preset = widgetString(node, "aspect_ratio", "custom");
  let sync = widgetBoolean(node, "sync_dimensions", true);
  if (changedName === "aspect_ratio" && preset === "custom" && sync) {
    setWidgetBooleanValue(findWidget(node, "sync_dimensions"), false);
    sync = false;
  }
  if (preset === "custom") {
    if (!sync || st.cropAspectRatio == null || changedName === "aspect_ratio" || changedName === "sync_dimensions") {
      st.cropAspectRatio = Math.max(1, width) / Math.max(1, height);
    }
    if (sync && st.cropAspectRatio) {
      if (changedName === "height") {
        width = Math.max(1, Math.round(height * st.cropAspectRatio));
      } else if (changedName === "width") {
        height = Math.max(1, Math.round(width / st.cropAspectRatio));
      }
    }
  } else {
    st.cropAspectRatio = resolveCropAspectRatioValue(node, width, height);
    if (sync || changedName === "aspect_ratio" || changedName === "sync_dimensions") {
      if (changedName === "height" && sync) {
        width = Math.max(1, Math.round(height * st.cropAspectRatio));
      } else {
        height = Math.max(1, Math.round(width / st.cropAspectRatio));
      }
    }
  }
  setWidgetValue(widthWidget, width, { notify });
  setWidgetValue(heightWidget, height, { notify });
  markCanvasDirty();
}
function setCropOutputDimensions(node, width, height, notify = true) {
  setWidgetValue(findWidget(node, "width"), Math.max(1, Math.round(width)), { notify });
  setWidgetValue(findWidget(node, "height"), Math.max(1, Math.round(height)), { notify });
  syncCropWidgets(node, void 0, notify);
}
function projectedCropWidth(deltaX, deltaY, targetRatio) {
  const ratio = Math.max(1e-4, targetRatio);
  return (deltaX + deltaY / ratio) / (1 + 1 / (ratio * ratio));
}
function cropRectFromAnchor(anchor, mode, targetRatio, pointerSource, maxRect, sourceWidth, sourceHeight) {
  const ratio = Math.max(1e-4, targetRatio);
  const minWidth = Math.max(1, maxRect.cropWidth * 0.05);
  let cropWidth = minWidth;
  let cropHeight = minWidth / ratio;
  let rectX = anchor.x;
  let rectY = anchor.y;
  if (mode === "n" || mode === "s") {
    const deltaY = Math.abs(anchor.y - pointerSource.y);
    cropHeight = Math.max(1, Math.min(maxRect.cropHeight, deltaY));
    cropWidth = cropHeight * ratio;
    if (cropWidth > maxRect.cropWidth) {
      cropWidth = maxRect.cropWidth;
      cropHeight = cropWidth / ratio;
    }
    rectX = anchor.x - cropWidth / 2;
    rectY = mode === "n" ? anchor.y - cropHeight : anchor.y;
  } else if (mode === "e" || mode === "w") {
    const deltaX = Math.abs(anchor.x - pointerSource.x);
    cropWidth = Math.max(minWidth, Math.min(maxRect.cropWidth, deltaX));
    cropHeight = cropWidth / ratio;
    if (cropHeight > maxRect.cropHeight) {
      cropHeight = maxRect.cropHeight;
      cropWidth = cropHeight * ratio;
    }
    rectX = mode === "w" ? anchor.x - cropWidth : anchor.x;
    rectY = anchor.y - cropHeight / 2;
  } else {
    const deltaX = Math.abs(anchor.x - pointerSource.x);
    const deltaY = Math.abs(anchor.y - pointerSource.y);
    cropWidth = Math.max(minWidth, Math.min(maxRect.cropWidth, projectedCropWidth(deltaX, deltaY, ratio)));
    cropHeight = cropWidth / ratio;
    if (cropHeight > maxRect.cropHeight) {
      cropHeight = maxRect.cropHeight;
      cropWidth = cropHeight * ratio;
    }
    if (mode === "nw") {
      rectX = anchor.x - cropWidth;
      rectY = anchor.y - cropHeight;
    } else if (mode === "ne") {
      rectX = anchor.x;
      rectY = anchor.y - cropHeight;
    } else if (mode === "sw") {
      rectX = anchor.x - cropWidth;
      rectY = anchor.y;
    } else {
      rectX = anchor.x;
      rectY = anchor.y;
    }
  }
  const centerPx = rectX + cropWidth / 2;
  const centerPy = rectY + cropHeight / 2;
  return {
    centerX: clampCropCenter(centerPx / Math.max(1, sourceWidth)),
    centerY: clampCropCenter(centerPy / Math.max(1, sourceHeight)),
    scale: clampCropScale(cropWidth / Math.max(1, maxRect.cropWidth))
  };
}
function freeCropRectFromAnchor(anchor, mode, pointerSource, startRect, sourceWidth, sourceHeight) {
  const safeW = Math.max(1, sourceWidth);
  const safeH = Math.max(1, sourceHeight);
  const minWidth = Math.max(1, safeW * 0.05);
  const minHeight = Math.max(1, safeH * 0.05);
  let left = startRect.x;
  let top = startRect.y;
  let right = startRect.x + startRect.cropWidth;
  let bottom = startRect.y + startRect.cropHeight;
  if (mode === "n" || mode === "nw" || mode === "ne") top = Math.max(0, Math.min(pointerSource.y, anchor.y - minHeight));
  if (mode === "s" || mode === "sw" || mode === "se") bottom = Math.min(safeH, Math.max(pointerSource.y, anchor.y + minHeight));
  if (mode === "w" || mode === "nw" || mode === "sw") left = Math.max(0, Math.min(pointerSource.x, anchor.x - minWidth));
  if (mode === "e" || mode === "ne" || mode === "se") right = Math.min(safeW, Math.max(pointerSource.x, anchor.x + minWidth));
  const cropWidth = Math.max(1, Math.min(safeW, right - left));
  const cropHeight = Math.max(1, Math.min(safeH, bottom - top));
  return {
    x: Math.max(0, Math.min(safeW - cropWidth, left)),
    y: Math.max(0, Math.min(safeH - cropHeight, top)),
    cropWidth,
    cropHeight
  };
}
export {
  NODE_CLASS,
  canvasToSourcePoint,
  createCropResetButton,
  cropRectFromAnchor,
  freeCropRectFromAnchor,
  getCropCanvasMetrics,
  getCropControlState,
  getCropCursor,
  getCropInfoText,
  getCropInteractionMode,
  hideCropGeometryWidgets,
  isFreeCropResizeEnabled,
  isNode,
  resetCropControlState,
  resolveCropAspectRatioValue,
  setCropControlState,
  setCropOutputDimensions,
  syncCropWidgets
};
