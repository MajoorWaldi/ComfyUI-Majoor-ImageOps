import type { ComfyNode, CompDragMode, CompLayerPreviewGeometry, CornerPinHandle } from "../../types.js";
import { getCompSlots, serializeCompLayers, syncCompLayers, clampCompCenter } from "../comp.js";
import { type FitPlacement, getFitPlacement } from "../shared/geometry.js";
import { findWidget, hideWidgetForGood, setWidgetStringValue } from "../shared/widgets.js";
import { ensureState } from "../shared/state.js";
import { setControlDisabled, styleSoftButton, syncDarkColorInputUI, setDarkColorInputState } from "../shared/dom-styles.js";
export { syncDarkColorInputUI, setDarkColorInputState } from "../shared/dom-styles.js";

export const NODE_CLASS = "ImageOpsComp";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export function hideCompWidgets(node: ComfyNode): void {
  hideWidgetForGood(node, findWidget(node, "layers_json"));
}

export function ensureCompInputs(node: ComfyNode, minLayers: number = 1): void {
  if (!isNode(node) || !node.addInput) return;
  const slots = getCompSlots(node);
  const existingNames = new Set((node.inputs ?? []).map((input) => String((input as any)?.name ?? "")));
  for (const slot of slots) {
    if (!existingNames.has(slot.maskSlot)) {
      node.addInput?.(slot.maskSlot, "MASK");
      existingNames.add(slot.maskSlot);
    }
  }
  const currentMax = slots.reduce((max, slot) => Math.max(max, slot.layerNumber), 0);
  const targetLayers = Math.max(minLayers, currentMax || 0);
  for (let layerNumber = currentMax + 1; layerNumber <= targetLayers; layerNumber++) {
    node.addInput?.(`image_${layerNumber}`, "IMAGE,VIDEO", { shape: 7 });
    node.addInput?.(`mask_${layerNumber}`, "MASK");
  }
}

export function readCompLayers(node: ComfyNode) {
  return syncCompLayers(findWidget(node, "layers_json")?.value ?? "", getCompSlots(node));
}

export function writeCompLayers(node: ComfyNode, layers: ReturnType<typeof readCompLayers>): void {
  setWidgetStringValue(findWidget(node, "layers_json"), serializeCompLayers(layers));
}

export function getCompInfoText(_node: ComfyNode, connectedLayers: number, totalLayers: number, width: number, height: number): string {
  return `Comp preview (${connectedLayers}/${totalLayers} layers, ${width}x${height})`;
}

export function getCompCursor(mode: CompDragMode | "move" | null): string {
  switch (mode) {
    case "move": return "move";
    case "rotate": return "crosshair";
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

export function cloneCompCorners(corners: Record<CornerPinHandle, { x: number; y: number }> | null): Record<CornerPinHandle, { x: number; y: number }> | null {
  if (!corners) return null;
  return {
    tl: { ...corners.tl },
    tr: { ...corners.tr },
    bl: { ...corners.bl },
    br: { ...corners.br },
  };
}

export function clearCompLayerCorners(layer: ReturnType<typeof readCompLayers>[number]): void {
  layer.tlX = null;
  layer.tlY = null;
  layer.trX = null;
  layer.trY = null;
  layer.blX = null;
  layer.blY = null;
  layer.brX = null;
  layer.brY = null;
}

export function compDragHandleToCorner(mode: CompDragMode): CornerPinHandle | null {
  if (mode === "nw") return "tl";
  if (mode === "ne") return "tr";
  if (mode === "sw") return "bl";
  if (mode === "se") return "br";
  return null;
}

// ── Runtime state helpers ──

function pointInCompPolygon(point: { x: number; y: number }, corners: Array<{ x: number; y: number }>): boolean {
  let sign = 0;
  for (let index = 0; index < corners.length; index++) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) <= 0.01) continue;
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = currentSign;
    } else if (sign !== currentSign) {
      return false;
    }
  }
  return true;
}

export function ensureCompState(node: ComfyNode): ReturnType<typeof readCompLayers> {
  ensureCompInputs(node, 1);
  const layers = readCompLayers(node);
  writeCompLayers(node, layers);
  const st = ensureState(node);
  if (!st.compSelectedSlot || !layers.some((layer) => layer.slot === st.compSelectedSlot)) {
    st.compSelectedSlot = layers[layers.length - 1]?.slot ?? null;
  }
  return layers;
}

export function updateCompControls(node: ComfyNode): void {
  const st = ensureState(node);
  const layers = ensureCompState(node);
  const selected = layers.find((layer) => layer.slot === st.compSelectedSlot) ?? layers[layers.length - 1] ?? null;

  // Reflect current edit mode on the Scale/Pin toggle buttons.
  const isPin = st.compEditMode === "cornerpin";
  if (st.compResizeButton) styleSoftButton(st.compResizeButton, !isPin);
  if (st.compCornerPinButton) styleSoftButton(st.compCornerPinButton, isPin);

  if (!selected) {
    if (st.compLayerLabel) st.compLayerLabel.textContent = "No layer";
    setControlDisabled(st.compResetButton, true);
    setControlDisabled(st.compModeSelect, true);
    setControlDisabled(st.compOpacityInput, true);
    if (st.compOpacityLabel) st.compOpacityLabel.textContent = "0%";
    return;
  }
  st.compSelectedSlot = selected.slot;
  setControlDisabled(st.compResetButton, false);
  if (st.compLayerLabel) {
    const match = /_(\d+)$/.exec(selected.slot);
    st.compLayerLabel.textContent = `Layer ${match?.[1] ?? "?"}`;
  }
  if (st.compModeSelect) {
    setControlDisabled(st.compModeSelect, false);
    st.compModeSelect.value = selected.mode;
  }
  if (st.compOpacityInput) {
    const opacity = Math.round(selected.opacity * 100);
    setControlDisabled(st.compOpacityInput, false);
    st.compOpacityInput.value = String(opacity);
    st.compOpacityInput.title = `Layer opacity ${opacity}%`;
    if (st.compOpacityLabel) st.compOpacityLabel.textContent = `${opacity}%`;
  }
}

export function updateSelectedCompLayer(node: ComfyNode, updater: (layer: ReturnType<typeof readCompLayers>[number]) => void): void {
  const st = ensureState(node);
  const layers = ensureCompState(node);
  const index = layers.findIndex((layer) => layer.slot === st.compSelectedSlot);
  if (index < 0) return;
  updater(layers[index]);
  writeCompLayers(node, layers);
  updateCompControls(node);
}

export function compCanvasToOutputPoint(node: ComfyNode, canvasWidth: number, canvasHeight: number, x: number, y: number): { x: number; y: number } {
  const st = ensureState(node);
  const fit = getFitPlacement(canvasWidth, canvasHeight, st.compOutputWidth || 1, st.compOutputHeight || 1);
  return {
    x: (x - fit.dx) * (st.compOutputWidth || 1) / Math.max(1, fit.drawWidth),
    y: (y - fit.dy) * (st.compOutputHeight || 1) / Math.max(1, fit.drawHeight),
  };
}

export function getCompHit(node: ComfyNode, canvasWidth: number, canvasHeight: number, x: number, y: number): { layer: CompLayerPreviewGeometry; mode: CompDragMode | "move" } | null {
  const st = ensureState(node);
  const fit = getFitPlacement(canvasWidth, canvasHeight, st.compOutputWidth || 1, st.compOutputHeight || 1);
  const threshold = 10;
  const ordered = [...st.compLayers].reverse();

  for (const layer of ordered) {
    const metrics = getCompCanvasMetrics(layer, fit, st.compOutputWidth || 1, st.compOutputHeight || 1);
    const near = (px: number, py: number) => Math.abs(x - px) <= threshold && Math.abs(y - py) <= threshold;
    const handleDx = x - metrics.rotationHandle.x;
    const handleDy = y - metrics.rotationHandle.y;
    if (handleDx * handleDx + handleDy * handleDy <= metrics.handleRadius * metrics.handleRadius) return { layer, mode: "rotate" };
    if (near(metrics.topLeft.x, metrics.topLeft.y)) return { layer, mode: "nw" };
    if (near(metrics.topRight.x, metrics.topRight.y)) return { layer, mode: "ne" };
    if (near(metrics.bottomLeft.x, metrics.bottomLeft.y)) return { layer, mode: "sw" };
    if (near(metrics.bottomRight.x, metrics.bottomRight.y)) return { layer, mode: "se" };
    if (pointInCompPolygon({ x, y }, [metrics.topLeft, metrics.topRight, metrics.bottomRight, metrics.bottomLeft])) return { layer, mode: "move" };
  }
  return null;
}



export function writeCompLayerCorners(node: ComfyNode, layer: any, corners: { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } }): void {
  const st = ensureState(node);
  const maxX = Math.max(1, (st.compOutputWidth || 1) - 1);
  const maxY = Math.max(1, (st.compOutputHeight || 1) - 1);
  layer.tlX = clampCompCenter(corners.tl.x / maxX);
  layer.tlY = clampCompCenter(corners.tl.y / maxY);
  layer.trX = clampCompCenter(corners.tr.x / maxX);
  layer.trY = clampCompCenter(corners.tr.y / maxY);
  layer.blX = clampCompCenter(corners.bl.x / maxX);
  layer.blY = clampCompCenter(corners.bl.y / maxY);
  layer.brX = clampCompCenter(corners.br.x / maxX);
  layer.brY = clampCompCenter(corners.br.y / maxY);
  layer.centerX = clampCompCenter((corners.tl.x + corners.tr.x + corners.bl.x + corners.br.x) / 4 / Math.max(1, st.compOutputWidth || 1));
  layer.centerY = clampCompCenter((corners.tl.y + corners.tr.y + corners.bl.y + corners.br.y) / 4 / Math.max(1, st.compOutputHeight || 1));
}

export function getCompCanvasMetrics(
  layer: CompLayerPreviewGeometry,
  fit: FitPlacement,
  outputWidth: number,
  outputHeight: number,
): {
  center: { x: number; y: number };
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  topMid: { x: number; y: number };
  rotationHandle: { x: number; y: number };
  handleRadius: number;
} {
  const scaleX = fit.drawWidth / Math.max(1, outputWidth);
  const scaleY = fit.drawHeight / Math.max(1, outputHeight);
  const toCanvas = (point: { x: number; y: number }) => ({
    x: fit.dx + point.x * scaleX,
    y: fit.dy + point.y * scaleY,
  });

  const topLeft = toCanvas(layer.corners?.tl ?? { x: layer.centerX - layer.drawWidth / 2, y: layer.centerY - layer.drawHeight / 2 });
  const topRight = toCanvas(layer.corners?.tr ?? { x: layer.centerX + layer.drawWidth / 2, y: layer.centerY - layer.drawHeight / 2 });
  const bottomLeft = toCanvas(layer.corners?.bl ?? { x: layer.centerX - layer.drawWidth / 2, y: layer.centerY + layer.drawHeight / 2 });
  const bottomRight = toCanvas(layer.corners?.br ?? { x: layer.centerX + layer.drawWidth / 2, y: layer.centerY + layer.drawHeight / 2 });
  const center = {
    x: (topLeft.x + topRight.x + bottomLeft.x + bottomRight.x) / 4,
    y: (topLeft.y + topRight.y + bottomLeft.y + bottomRight.y) / 4,
  };
  const topMid = {
    x: (topLeft.x + topRight.x) / 2,
    y: (topLeft.y + topRight.y) / 2,
  };
  const edgeX = topRight.x - topLeft.x;
  const edgeY = topRight.y - topLeft.y;
  const edgeLength = Math.max(1, Math.hypot(edgeX, edgeY));
  let normalX = -edgeY / edgeLength;
  let normalY = edgeX / edgeLength;
  const towardCenterX = center.x - topMid.x;
  const towardCenterY = center.y - topMid.y;
  if (normalX * towardCenterX + normalY * towardCenterY > 0) {
    normalX *= -1;
    normalY *= -1;
  }
  const handleDistance = Math.max(16, Math.min(28, edgeLength * 0.28));
  const rotationHandle = {
    x: topMid.x + normalX * handleDistance,
    y: topMid.y + normalY * handleDistance,
  };
  return {
    center,
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
    topMid,
    rotationHandle,
    handleRadius: 10,
  };
}
