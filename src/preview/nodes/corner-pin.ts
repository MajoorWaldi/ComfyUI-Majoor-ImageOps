import type { ComfyNode, CornerPinHandle, CornerPinPreviewGeometry } from "../../types.js";
import { findWidget, widgetNumber, setWidgetValue } from "../shared/widgets.js";

export const NODE_CLASS = "ImageOpsCornerPin";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export function getCornerPinInfoText(_node: ComfyNode, width: number, height: number): string {
  return `Corner Pin preview (${width}x${height})`;
}

export function cornerPinCanvasPoint(geometry: CornerPinPreviewGeometry, xNorm: number, yNorm: number): { x: number; y: number } {
  const sourceX = xNorm * Math.max(1, geometry.sourceWidth - 1);
  const sourceY = yNorm * Math.max(1, geometry.sourceHeight - 1);
  return {
    x: geometry.fitDx + sourceX * geometry.fitDrawWidth / Math.max(1, geometry.sourceWidth - 1),
    y: geometry.fitDy + sourceY * geometry.fitDrawHeight / Math.max(1, geometry.sourceHeight - 1),
  };
}

export function cornerPinControlPoints(node: ComfyNode, geometry: CornerPinPreviewGeometry): Record<CornerPinHandle, { x: number; y: number }> {
  return {
    tl: cornerPinCanvasPoint(geometry, widgetNumber(node, "tl_x", 0), widgetNumber(node, "tl_y", 0)),
    tr: cornerPinCanvasPoint(geometry, widgetNumber(node, "tr_x", 1), widgetNumber(node, "tr_y", 0)),
    bl: cornerPinCanvasPoint(geometry, widgetNumber(node, "bl_x", 0), widgetNumber(node, "bl_y", 1)),
    br: cornerPinCanvasPoint(geometry, widgetNumber(node, "br_x", 1), widgetNumber(node, "br_y", 1)),
  };
}

export function getCornerPinHit(node: ComfyNode, geometry: CornerPinPreviewGeometry | null, x: number, y: number): CornerPinHandle | null {
  if (!geometry) return null;
  const points = cornerPinControlPoints(node, geometry);
  const threshold = 12;
  for (const key of ["tl", "tr", "bl", "br"] as CornerPinHandle[]) {
    const point = points[key];
    const dx = x - point.x;
    const dy = y - point.y;
    if (dx * dx + dy * dy <= threshold * threshold) return key;
  }
  return null;
}

export function cornerPinCanvasToNormalized(geometry: CornerPinPreviewGeometry, x: number, y: number): { xNorm: number; yNorm: number } {
  const sourceX = (x - geometry.fitDx) * Math.max(1, geometry.sourceWidth - 1) / Math.max(1, geometry.fitDrawWidth);
  const sourceY = (y - geometry.fitDy) * Math.max(1, geometry.sourceHeight - 1) / Math.max(1, geometry.fitDrawHeight);
  const denomX = Math.max(1, geometry.sourceWidth - 1);
  const denomY = Math.max(1, geometry.sourceHeight - 1);
  return {
    xNorm: Math.max(-2, Math.min(2, sourceX / denomX)),
    yNorm: Math.max(-2, Math.min(2, sourceY / denomY)),
  };
}

export function setCornerPinHandle(node: ComfyNode, handle: CornerPinHandle, xNorm: number, yNorm: number): void {
  if (handle === "tl") {
    setWidgetValue(findWidget(node, "tl_x"), xNorm);
    setWidgetValue(findWidget(node, "tl_y"), yNorm);
  } else if (handle === "tr") {
    setWidgetValue(findWidget(node, "tr_x"), xNorm);
    setWidgetValue(findWidget(node, "tr_y"), yNorm);
  } else if (handle === "bl") {
    setWidgetValue(findWidget(node, "bl_x"), xNorm);
    setWidgetValue(findWidget(node, "bl_y"), yNorm);
  } else {
    setWidgetValue(findWidget(node, "br_x"), xNorm);
    setWidgetValue(findWidget(node, "br_y"), yNorm);
  }
}
