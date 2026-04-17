const NODE_CLASS = "ImageOpsPadOut";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function getPadOutInfoText(_node, width, height) {
  return `PadOut preview (${width}x${height})`;
}
function getPadOutInteractionMode(geometry, x, y) {
  if (!geometry) return null;
  const scaleX = geometry.fitDrawWidth / Math.max(1, geometry.outputWidth);
  const scaleY = geometry.fitDrawHeight / Math.max(1, geometry.outputHeight);
  const left = geometry.fitDx + geometry.padLeft * scaleX;
  const top = geometry.fitDy + geometry.padTop * scaleY;
  const right = left + geometry.sourceWidth * scaleX;
  const bottom = top + geometry.sourceHeight * scaleY;
  const threshold = 12;
  const near = (px, py) => Math.abs(x - px) <= threshold && Math.abs(y - py) <= threshold;
  if (near(left, top)) return "nw";
  if (near(right, top)) return "ne";
  if (near(left, bottom)) return "sw";
  if (near(right, bottom)) return "se";
  if (Math.abs(y - top) <= threshold && x >= left && x <= right) return "n";
  if (Math.abs(x - right) <= threshold && y >= top && y <= bottom) return "e";
  if (Math.abs(y - bottom) <= threshold && x >= left && x <= right) return "s";
  if (Math.abs(x - left) <= threshold && y >= top && y <= bottom) return "w";
  if (x >= left && x <= right && y >= top && y <= bottom) return "move";
  return null;
}
function getPadOutCursor(mode) {
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
export {
  NODE_CLASS,
  getPadOutCursor,
  getPadOutInfoText,
  getPadOutInteractionMode,
  isNode
};
