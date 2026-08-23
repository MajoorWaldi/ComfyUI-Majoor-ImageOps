import { findWidget, setWidgetValue, widgetNumber } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsCornerPin";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function getCornerPinInfoText(_node, width, height) {
  return `Corner Pin preview (${width}x${height})`;
}
function cornerPinCanvasPoint(geometry, xNorm, yNorm) {
  const sourceX = xNorm * Math.max(1, geometry.sourceWidth - 1);
  const sourceY = yNorm * Math.max(1, geometry.sourceHeight - 1);
  return {
    x: geometry.fitDx + sourceX * geometry.fitDrawWidth / Math.max(1, geometry.sourceWidth - 1),
    y: geometry.fitDy + sourceY * geometry.fitDrawHeight / Math.max(1, geometry.sourceHeight - 1)
  };
}
function cornerPinControlPoints(node, geometry) {
  return {
    tl: cornerPinCanvasPoint(geometry, widgetNumber(node, "tl_x", 0), widgetNumber(node, "tl_y", 0)),
    tr: cornerPinCanvasPoint(geometry, widgetNumber(node, "tr_x", 1), widgetNumber(node, "tr_y", 0)),
    bl: cornerPinCanvasPoint(geometry, widgetNumber(node, "bl_x", 0), widgetNumber(node, "bl_y", 1)),
    br: cornerPinCanvasPoint(geometry, widgetNumber(node, "br_x", 1), widgetNumber(node, "br_y", 1))
  };
}
function getCornerPinHit(node, geometry, x, y) {
  if (!geometry) return null;
  const points = cornerPinControlPoints(node, geometry);
  const threshold = 12;
  for (const key of ["tl", "tr", "bl", "br"]) {
    const point = points[key];
    const dx = x - point.x;
    const dy = y - point.y;
    if (dx * dx + dy * dy <= threshold * threshold) return key;
  }
  return null;
}
function cornerPinCanvasToNormalized(geometry, x, y) {
  const sourceX = (x - geometry.fitDx) * Math.max(1, geometry.sourceWidth - 1) / Math.max(1, geometry.fitDrawWidth);
  const sourceY = (y - geometry.fitDy) * Math.max(1, geometry.sourceHeight - 1) / Math.max(1, geometry.fitDrawHeight);
  const denomX = Math.max(1, geometry.sourceWidth - 1);
  const denomY = Math.max(1, geometry.sourceHeight - 1);
  return {
    xNorm: Math.max(-2, Math.min(2, sourceX / denomX)),
    yNorm: Math.max(-2, Math.min(2, sourceY / denomY))
  };
}
function setCornerPinHandle(node, handle, xNorm, yNorm, notify = true) {
  if (handle === "tl") {
    setWidgetValue(findWidget(node, "tl_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "tl_y"), yNorm, { notify });
  } else if (handle === "tr") {
    setWidgetValue(findWidget(node, "tr_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "tr_y"), yNorm, { notify });
  } else if (handle === "bl") {
    setWidgetValue(findWidget(node, "bl_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "bl_y"), yNorm, { notify });
  } else {
    setWidgetValue(findWidget(node, "br_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "br_y"), yNorm, { notify });
  }
}
export {
  NODE_CLASS,
  cornerPinCanvasPoint,
  cornerPinCanvasToNormalized,
  cornerPinControlPoints,
  getCornerPinHit,
  getCornerPinInfoText,
  isNode,
  setCornerPinHandle
};
