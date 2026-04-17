import type { ComfyNode, PadOutPreviewGeometry, PadOutDragMode } from "../../types.js";

export const NODE_CLASS = "ImageOpsPadOut";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export function getPadOutInfoText(_node: ComfyNode, width: number, height: number): string {
  return `PadOut (${width}×${height})`;
}

export function getPadOutInteractionMode(geometry: PadOutPreviewGeometry | null, x: number, y: number): PadOutDragMode | "move" | null {
  if (!geometry) return null;
  const scaleX = geometry.fitDrawWidth / Math.max(1, geometry.outputWidth);
  const scaleY = geometry.fitDrawHeight / Math.max(1, geometry.outputHeight);

  // Outer frame (output canvas boundary) — resize handles.
  const oLeft   = geometry.fitDx;
  const oTop    = geometry.fitDy;
  const oRight  = geometry.fitDx + geometry.fitDrawWidth;
  const oBottom = geometry.fitDy + geometry.fitDrawHeight;
  const oMidX   = (oLeft + oRight) / 2;
  const oMidY   = (oTop + oBottom) / 2;

  // Inner source image box — move handle.
  const iLeft   = geometry.fitDx + geometry.padLeft * scaleX;
  const iTop    = geometry.fitDy + geometry.padTop * scaleY;
  const iRight  = iLeft + geometry.sourceWidth * scaleX;
  const iBottom = iTop + geometry.sourceHeight * scaleY;

  const T = 12;
  const near = (px: number, py: number): boolean => Math.abs(x - px) <= T && Math.abs(y - py) <= T;

  // Outer frame corners (highest priority).
  if (near(oLeft,  oTop))    return "nw";
  if (near(oRight, oTop))    return "ne";
  if (near(oLeft,  oBottom)) return "sw";
  if (near(oRight, oBottom)) return "se";

  // Outer frame mid-edges.
  if (near(oMidX, oTop)    && x >= oLeft && x <= oRight) return "n";
  if (near(oRight, oMidY)  && y >= oTop  && y <= oBottom) return "e";
  if (near(oMidX, oBottom) && x >= oLeft && x <= oRight) return "s";
  if (near(oLeft,  oMidY)  && y >= oTop  && y <= oBottom) return "w";

  // Outer frame edges (wider hit zone when no mid-edge matched).
  if (Math.abs(y - oTop)    <= T && x > oLeft + T && x < oRight - T) return "n";
  if (Math.abs(x - oRight)  <= T && y > oTop  + T && y < oBottom - T) return "e";
  if (Math.abs(y - oBottom) <= T && x > oLeft + T && x < oRight - T) return "s";
  if (Math.abs(x - oLeft)   <= T && y > oTop  + T && y < oBottom - T) return "w";

  // Inner source image: drag to reposition within the output canvas.
  if (x >= iLeft && x <= iRight && y >= iTop && y <= iBottom) return "move";

  return null;
}

export function getPadOutCursor(mode: PadOutDragMode | "move" | null): string {
  switch (mode) {
    case "move": return "move";
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
