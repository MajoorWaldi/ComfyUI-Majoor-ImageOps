import type { ComfyNode, PadOutPreviewGeometry, PadOutDragMode } from "../../types.js";

export const NODE_CLASS = "ImageOpsPadOut";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export function getPadOutInfoText(_node: ComfyNode, width: number, height: number): string {
  return `PadOut preview (${width}x${height})`;
}

export function getPadOutInteractionMode(geometry: PadOutPreviewGeometry | null, x: number, y: number): PadOutDragMode | "move" | null {
  if (!geometry) return null;
  const scaleX = geometry.fitDrawWidth / Math.max(1, geometry.outputWidth);
  const scaleY = geometry.fitDrawHeight / Math.max(1, geometry.outputHeight);
  const left = geometry.fitDx + geometry.padLeft * scaleX;
  const top = geometry.fitDy + geometry.padTop * scaleY;
  const right = left + geometry.sourceWidth * scaleX;
  const bottom = top + geometry.sourceHeight * scaleY;
  const threshold = 12;
  const near = (px: number, py: number): boolean => Math.abs(x - px) <= threshold && Math.abs(y - py) <= threshold;

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
