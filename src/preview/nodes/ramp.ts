import type { ComfyNode, RampHandle, RampPreviewGeometry } from "../../types.js";
import { resolveImageOpsClassName } from "../shared/classes.js";
import { findWidget, setWidgetStringValuesByName, setWidgetValue, widgetNumber, widgetString } from "../shared/widgets.js";

const RAMP_RATIO_PRESETS: Record<string, number> = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

function resolveRampRatioPreset(width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  for (const [preset, presetRatio] of Object.entries(RAMP_RATIO_PRESETS)) {
    if (Math.abs(ratio - presetRatio) <= 0.02) return preset;
  }
  return "custom";
}

export const NODE_CLASS = "ImageOpsRamp";

export function isNode(node: ComfyNode): boolean {
  return resolveImageOpsClassName(node?.comfyClass) === NODE_CLASS;
}

export type RampControlsUi = {
  controls: HTMLDivElement | null;
};

export function createRampControlsUi(): RampControlsUi {
  return { controls: null };
}

export function hideRampWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
}

export function getRampInfoText(node: ComfyNode): string {
  const width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  const height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const frameCount = Math.max(1, Math.round(widgetNumber(node, "frame_count", widgetNumber(node, "frame_length", widgetNumber(node, "batch_size", 1)))));
  const shape = widgetString(node, "ramp_shape", "linear");
  return `Ramp preview (${shape}, ${width}x${height}, frames ${frameCount})`;
}

export function rampCanvasPoint(geometry: RampPreviewGeometry, xNorm: number, yNorm: number): { x: number; y: number } {
  return {
    x: geometry.fitDx + xNorm * geometry.fitDrawWidth,
    y: geometry.fitDy + yNorm * geometry.fitDrawHeight,
  };
}

export function rampControlPoints(node: ComfyNode, geometry: RampPreviewGeometry): Record<RampHandle, { x: number; y: number }> {
  return {
    start: rampCanvasPoint(geometry, widgetNumber(node, "start_x", 0), widgetNumber(node, "start_y", 0.5)),
    end: rampCanvasPoint(geometry, widgetNumber(node, "end_x", 1), widgetNumber(node, "end_y", 0.5)),
  };
}

export function getRampHit(node: ComfyNode, geometry: RampPreviewGeometry | null, x: number, y: number): RampHandle | null {
  if (!geometry) return null;
  const points = rampControlPoints(node, geometry);
  const threshold = 14;
  for (const key of ["start", "end"] as RampHandle[]) {
    const point = points[key];
    const dx = x - point.x;
    const dy = y - point.y;
    if (dx * dx + dy * dy <= threshold * threshold) return key;
  }
  return null;
}

export function rampCanvasToNormalized(geometry: RampPreviewGeometry, x: number, y: number): { xNorm: number; yNorm: number } {
  return {
    xNorm: Math.max(-2, Math.min(3, (x - geometry.fitDx) / Math.max(1, geometry.fitDrawWidth))),
    yNorm: Math.max(-2, Math.min(3, (y - geometry.fitDy) / Math.max(1, geometry.fitDrawHeight))),
  };
}

export function setRampHandle(node: ComfyNode, handle: RampHandle, xNorm: number, yNorm: number, notify: boolean = true): void {
  if (handle === "start") {
    setWidgetValue(findWidget(node, "start_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "start_y"), yNorm, { notify });
  } else {
    setWidgetValue(findWidget(node, "end_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "end_y"), yNorm, { notify });
  }
}

export function syncRampWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
  hideRampWidgets(node);

  const colorA = widgetString(node, "color_a", "#ffffff");
  const colorB = widgetString(node, "color_b", "#000000");
  setWidgetStringValuesByName(node, "color_a", colorA, { notify: false, dirty: false });
  setWidgetStringValuesByName(node, "color_b", colorB, { notify: false, dirty: false });
}
