const NODE_CLASS = "ImageOpsPadOut";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function getPadOutInfoText(_node, width, height) {
  return `PadOut (${width}\xD7${height})`;
}
function getPadOutInteractionMode(geometry, x, y) {
  if (!geometry) return null;
  const scaleX = geometry.fitDrawWidth / Math.max(1, geometry.outputWidth);
  const scaleY = geometry.fitDrawHeight / Math.max(1, geometry.outputHeight);
  const oLeft = geometry.fitDx;
  const oTop = geometry.fitDy;
  const oRight = geometry.fitDx + geometry.fitDrawWidth;
  const oBottom = geometry.fitDy + geometry.fitDrawHeight;
  const oMidX = (oLeft + oRight) / 2;
  const oMidY = (oTop + oBottom) / 2;
  const iLeft = geometry.fitDx + geometry.padLeft * scaleX;
  const iTop = geometry.fitDy + geometry.padTop * scaleY;
  const iRight = iLeft + geometry.sourceWidth * scaleX;
  const iBottom = iTop + geometry.sourceHeight * scaleY;
  const T = 12;
  const near = (px, py) => Math.abs(x - px) <= T && Math.abs(y - py) <= T;
  if (near(oLeft, oTop)) return "nw";
  if (near(oRight, oTop)) return "ne";
  if (near(oLeft, oBottom)) return "sw";
  if (near(oRight, oBottom)) return "se";
  if (near(oMidX, oTop) && x >= oLeft && x <= oRight) return "n";
  if (near(oRight, oMidY) && y >= oTop && y <= oBottom) return "e";
  if (near(oMidX, oBottom) && x >= oLeft && x <= oRight) return "s";
  if (near(oLeft, oMidY) && y >= oTop && y <= oBottom) return "w";
  if (Math.abs(y - oTop) <= T && x > oLeft + T && x < oRight - T) return "n";
  if (Math.abs(x - oRight) <= T && y > oTop + T && y < oBottom - T) return "e";
  if (Math.abs(y - oBottom) <= T && x > oLeft + T && x < oRight - T) return "s";
  if (Math.abs(x - oLeft) <= T && y > oTop + T && y < oBottom - T) return "w";
  if (x >= iLeft && x <= iRight && y >= iTop && y <= iBottom) return "move";
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
